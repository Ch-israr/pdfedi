"""Convert a PDF to an editable Word (.docx) document.

Text is rebuilt from pypdfium2 character boxes, font sizes and font weights:
characters are grouped into lines and paragraphs, the largest type sizes map
to Heading 1/2 styles, and embedded images are placed in reading order.
Best for text-based documents — complex tables and multi-column layouts come
out approximate. Scanned (image-only) PDFs are refused with a pointer to OCR.
"""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)
from pdfedi.tools.extract_images import _pil_from_xobject

SPEC = ToolSpec(
    key="pdf_to_word",
    name="PDF to Word",
    tagline="Convert PDF to editable Word document",
    description=(
        "Convert a PDF into an editable Word (.docx) document. Text is "
        "reconstructed into real paragraphs with heading styles, and embedded "
        "images are placed in reading order. Best for text-based documents — "
        "complex tables and multi-column layouts are approximate. Scanned "
        "PDFs with no text layer should go through the OCR tool instead."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="document",
    output_ext="docx",
    output_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    activity="converting",
    category="convert",
)

_PAGE_CAP = 50
_LINE_TOL_FACTOR = 0.35   # fraction of char height for line grouping
_PARA_GAP_FACTOR = 1.5    # line-height multiple that starts a new paragraph
_HEADING_RATIO = 1.25     # size ratio over body that qualifies as a heading


def _open_reader(data: bytes, filename: str) -> PdfReader:
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            f"'{filename}' is not a valid PDF file.", code="invalid_input"
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc
    if getattr(reader, "is_encrypted", False):
        raise ToolError(
            f"'{filename}' is password-protected; encrypted PDFs are not supported.",
            code="encrypted_pdf",
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            f"Could not read the pages of '{filename}': {exc}", code="invalid_input"
        ) from exc
    if count == 0:
        raise ToolError(f"'{filename}' contains no pages.", code="invalid_input")
    return reader


def _iter_ops(page, reader) -> list:
    """Version-safe content-stream operations list (pypdf 5/6)."""
    try:
        contents = page.get_contents()
    except Exception:
        return []
    if contents is None:
        return []
    ops = getattr(contents, "operations", None)
    if ops is not None:
        return list(ops)
    try:
        return list(ContentStream(contents, reader))
    except Exception:
        return []


def _resolve(obj):
    return obj.get_object() if hasattr(obj, "get_object") else obj


def _walk_ops(ops, xobjects, ctm, out, seen):
    """CTM-tracking walk; recurses into Form XObjects. Appends
    (y_top_pt, image_xobject) for each unique image XObject."""
    stack: list[list[float]] = []
    for operands, op in ops:
        try:
            if op == b"cm" and len(operands) == 6:
                m = [float(o) for o in operands]
                a, b, c, d, e, f = m
                A, B, C, D, E, F = ctm
                ctm = [
                    a * A + b * C,
                    a * B + b * D,
                    c * A + d * C,
                    c * B + d * D,
                    e * A + f * C + E,
                    e * B + f * D + F,
                ]
            elif op == b"q":
                stack.append(list(ctm))
            elif op == b"Q":
                if stack:
                    ctm = stack.pop()
            elif op == b"Do" and operands:
                name = str(operands[0])
                xobj = xobjects.get(name)
                if xobj is None:
                    continue
                xobj = _resolve(xobj)
                try:
                    subtype = xobj.get("/Subtype")
                except Exception:
                    continue
                if subtype == "/Image":
                    ident = id(xobj)
                    if ident in seen:
                        continue
                    seen.add(ident)
                    a, b, c, d, e, f = ctm
                    ys = [b * x + d * y + f for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
                    out.append((max(ys), xobj))
                elif subtype == "/Form":
                    # Recurse with the form's matrix composed into the CTM.
                    try:
                        raw_mx = xobj.get("/Matrix", [1, 0, 0, 1, 0, 0])
                        mx = [float(v) for v in raw_mx]
                        sub_res = _resolve(xobj.get("/Resources")) or {}
                        sub_raw = sub_res.get("/XObject")
                        sub_xo = _resolve(sub_raw) if sub_raw is not None else {}
                        sub_ops = getattr(xobj, "operations", None)
                        if sub_ops is None:
                            try:
                                sub_ops = list(ContentStream(xobj, None))
                            except Exception:
                                sub_ops = []
                    except Exception:
                        continue
                    a, b, c, d, e, f = mx
                    A, B, C, D, E, F = ctm
                    form_ctm = [
                        a * A + b * C,
                        a * B + b * D,
                        c * A + d * C,
                        c * B + d * D,
                        e * A + f * C + E,
                        e * B + f * D + F,
                    ]
                    _walk_ops(list(sub_ops), sub_xo, form_ctm, out, seen)
        except Exception:
            continue


def _image_placements(page, reader) -> list[tuple[float, bytes]]:
    """Return (y_top_pt, png_bytes) for image XObjects via a CTM walk."""
    try:
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return []
        xobjects = _resolve(xobjects)
    except Exception:
        return []
    found: list[tuple[float, object]] = []
    _walk_ops(
        _iter_ops(page, reader), xobjects,
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], found, set(),
    )
    placements: list[tuple[float, bytes]] = []
    for y_top, xobj in found:
        pil_img = _pil_from_xobject(xobj)
        if pil_img is None:
            continue
        buf = io.BytesIO()
        try:
            pil_img.convert("RGB").save(buf, format="PNG")
        except Exception:
            continue
        placements.append((y_top, buf.getvalue()))
    return placements



def _extract_page_blocks(data: bytes, page_index: int, page) -> tuple[list, bool]:
    """Extract text blocks and images from one page.

    Returns (blocks, has_text) where blocks are dicts:
    {"y": y_top, "kind": "para", "text": str, "runs": [(text, bold)], "size": float}
    or {"y": y_top, "kind": "image", "png": bytes}.
    """
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    doc = pdfium.PdfDocument(data)
    blocks: list = []
    has_text = False
    try:
        pdfium_page = doc[page_index]
        tp = pdfium_page.get_textpage()
        n = tp.count_chars()
        if n:
            full = tp.get_text_range(0, n)
            chars = []
            for i in range(n):
                ch = full[i] if i < len(full) else ""
                if ch in ("\r", "\n"):
                    continue
                x0, y0, x1, y1 = tp.get_charbox(i)
                try:
                    size = float(raw.FPDFText_GetFontSize(tp, i))
                except Exception:
                    size = 0.0
                try:
                    weight = int(raw.FPDFText_GetFontWeight(tp, i))
                except Exception:
                    weight = 0
                chars.append({
                    "ch": ch, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "size": size, "bold": weight >= 600,
                })
            # Group chars into lines by vertical proximity.
            chars.sort(key=lambda c: (-(c["y0"] + c["y1"]) / 2, c["x0"]))
            lines: list[list] = []
            for ch in chars:
                cy = (ch["y0"] + ch["y1"]) / 2
                ch_h = max(1.0, ch["y1"] - ch["y0"])
                placed = False
                for line in lines:
                    ly = (line[0]["y0"] + line[0]["y1"]) / 2
                    lh = max(1.0, line[0]["y1"] - line[0]["y0"])
                    if abs(cy - ly) <= _LINE_TOL_FACTOR * max(ch_h, lh):
                        line.append(ch)
                        placed = True
                        break
                if not placed:
                    lines.append([ch])
            # Sort lines top-down, chars left-to-right; merge into paragraphs.
            for line in lines:
                line.sort(key=lambda c: c["x0"])
            lines.sort(key=lambda ln: -sum((c["y0"] + c["y1"]) / 2 for c in ln) / len(ln))

            def line_height(ln):
                return sum(c["y1"] - c["y0"] for c in ln) / len(ln)

            # Insert spaces from horizontal gaps (pdfium often omits space
            # chars; wide gaps between words imply them).
            spaced_lines: list[list] = []
            for line in lines:
                widths = [c["x1"] - c["x0"] for c in line if c["x1"] > c["x0"]]
                med_w = sorted(widths)[len(widths) // 2] if widths else 4.0
                out_line: list = []
                for c in line:
                    if out_line:
                        gap = c["x0"] - out_line[-1]["x1"]
                        if gap > 0.45 * med_w:
                            out_line.append({
                                "ch": " ", "x0": out_line[-1]["x1"],
                                "x1": c["x0"], "y0": c["y0"], "y1": c["y1"],
                                "size": c["size"], "bold": c["bold"],
                            })
                    out_line.append(c)
                spaced_lines.append(out_line)
            lines = spaced_lines

            paragraphs: list[list] = []
            prev_bottom = None
            prev_h = 0.0
            for line in lines:
                top = max(c["y1"] for c in line)
                bottom = min(c["y0"] for c in line)
                h = line_height(line)
                gap = (prev_bottom - top) if prev_bottom is not None else 0.0
                if paragraphs and gap > _PARA_GAP_FACTOR * min(h, prev_h or h):
                    paragraphs.append([])
                if not paragraphs:
                    paragraphs.append([])
                paragraphs[-1].extend(line)
                prev_bottom = bottom
                prev_h = h

            for para_chars in paragraphs:
                text = "".join(c["ch"] for c in para_chars).strip()
                if not text:
                    continue
                has_text = True
                sizes = [c["size"] for c in para_chars if c["size"] > 0]
                med_size = sorted(sizes)[len(sizes) // 2] if sizes else 0.0
                y_top = max(c["y1"] for c in para_chars)
                # Bold runs.
                runs: list[tuple[str, bool]] = []
                for c in para_chars:
                    if runs and runs[-1][1] == c["bold"]:
                        runs[-1] = (runs[-1][0] + c["ch"], c["bold"])
                    else:
                        runs.append((c["ch"], c["bold"]))
                blocks.append({
                    "y": y_top, "kind": "para", "text": text,
                    "runs": runs, "size": med_size,
                })
    finally:
        doc.close()

    # Images with positions from the pypdf content stream.
    try:
        reader = PdfReader(io.BytesIO(data))
        for y_top, png in _image_placements(page, reader):
            blocks.append({"y": y_top, "kind": "image", "png": png})
    except Exception:
        pass

    blocks.sort(key=lambda b: -b["y"])
    return blocks, has_text


def run(ctx: ToolContext, options: dict) -> Path:
    """Rebuild the PDF as an editable .docx in reading order."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to Word needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    try:
        from docx import Document
        from docx.shared import Inches
    except ImportError as exc:
        raise ToolError(
            "Word export is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    try:
        import pypdfium2  # noqa: F401
    except ImportError as exc:
        raise ToolError(
            "Text extraction is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    tool_input = ctx.inputs[0]
    data = tool_input.path.read_bytes()
    filename = tool_input.filename
    reader = _open_reader(data, filename)
    page_count = len(reader.pages)
    if page_count > _PAGE_CAP:
        raise ToolError(
            f"PDF to Word supports at most {_PAGE_CAP} pages per job.",
            code="too_many_pages",
        )

    # First pass: collect per-line sizes to identify heading sizes.
    page_blocks: list[list] = []
    any_text = False
    for i, page in enumerate(reader.pages):
        blocks, has_text = _extract_page_blocks(data, i, page)
        page_blocks.append(blocks)
        any_text = any_text or has_text

    if not any_text:
        raise ToolError(
            f"'{filename}' has no extractable text — it may be scanned. "
            "Use the OCR tool first to make it searchable, then convert.",
            code="no_text",
        )

    sizes = sorted({round(b["size"], 1) for blocks in page_blocks for b in blocks
                    if b["kind"] == "para" and b["size"] > 0}, reverse=True)
    # Body size = the most common line size; headings = distinctly larger sizes.
    from collections import Counter
    size_counts = Counter(round(b["size"], 1) for blocks in page_blocks for b in blocks
                          if b["kind"] == "para" and b["size"] > 0)
    body_size = size_counts.most_common(1)[0][0] if size_counts else 0.0
    heading_sizes = [s for s in sizes if s >= body_size * _HEADING_RATIO]

    doc = Document()
    for pi, blocks in enumerate(page_blocks):
        if pi > 0 and blocks:
            doc.add_page_break()
        for b in blocks:
            if b["kind"] == "image":
                try:
                    from PIL import Image as PILImage
                    img = PILImage.open(io.BytesIO(b["png"]))
                    w_in = min(6.0, max(1.0, img.width / 150.0))
                    doc.add_picture(io.BytesIO(b["png"]), width=Inches(w_in))
                except Exception:
                    continue
            else:
                level = 0
                if b["size"] in heading_sizes:
                    level = heading_sizes.index(b["size"]) + 1
                    level = min(level, 2)
                if level:
                    doc.add_heading(b["text"], level=level)
                else:
                    p = doc.add_paragraph()
                    for text, bold in b["runs"]:
                        run_ = p.add_run(text)
                        if bold:
                            run_.bold = True

    out = ctx.new_output_path("document.docx").with_suffix(".docx")
    doc.save(str(out))
    return out
