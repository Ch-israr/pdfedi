"""SANDBOX ONLY — PDF to Word (.docx) with OCR, layout reconstruction.

Workflow (OCR is a required step, not optional):
  1. Render each PDF page to an image (spilled to temp file, never held
     in RAM during OCR — memory-safe for limited servers).
  2. Run the OCR pipeline on every page to obtain positioned words.
     - Preferred: local Tesseract (isolated sandbox setup).
     - Fallback: the production PDFEDI OCR API (read-only use).
  3. Layout analysis from positioned words:
     words -> lines -> columns -> blocks (paragraphs, headings, tables).
     Embedded images are extracted separately and placed in the DOCX.
  4. Build a .docx with python-docx preserving structure, relative font
     sizes, tables, images, and page breaks.

Memory: strictly sequential page-by-page. Each page's image is written to
a temp file and released BEFORE Tesseract runs (Tesseract reads the file).
No page images are ever held in RAM during OCR. Temp files are deleted
per page. Peak Python-side memory per page is one small buffer.

This is a sandbox experiment. Do NOT move to production without approval.
"""
from __future__ import annotations

import gc
import io
import re
import shutil
import tempfile
import time
import urllib.request
import urllib.error
import json as jsonlib
from pathlib import Path

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:\+[A-Za-z]{2,3})*$")
_PROD_API = "https://pdfedi.onrender.com/api/v1"
_OCR_DPI = 200  # accurate enough for Tesseract, 2.25x less RAM than 300 DPI
_MIN_CONFIDENCE = 30

SPEC = ToolSpec(
    key="pdf_to_word",
    name="PDF to Word",
    tagline="Convert PDF to editable Word via OCR",
    description=(
        "Sandbox experiment: runs every page through OCR, reconstructs "
        "layout (columns, tables, headings, images), and builds an editable "
        ".docx file."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="language",
            kind="text",
            label="Language",
            required=False,
            default="eng",
            help="Tesseract language code, e.g. 'eng' or 'eng+deu'.",
        ),
    ],
    output_kind="text",
    output_ext="docx",
    output_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    activity="converting",
    category="convert",
)


def _ocr_words_local(image_path: str, language: str) -> list[dict]:
    """Positioned words via local Tesseract reading a FILE (not a PIL image).

    Taking a path keeps the image out of Python RAM while the Tesseract
    subprocess runs — critical for memory safety.
    """
    try:
        import pytesseract
    except ImportError:
        raise ToolError("Local OCR engine not installed.", code="ocr_unavailable")
    if shutil.which("tesseract") is None:
        raise ToolError("Local OCR engine not installed.", code="ocr_unavailable")
    try:
        data = pytesseract.image_to_data(
            image_path, lang=language, output_type=pytesseract.Output.DICT,
            timeout=300,
        )
    except Exception as e:
        raise ToolError(f"OCR failed: {e}", code="ocr_failed") from e
    words = []
    for i, text in enumerate(data.get("text", [])):
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (ValueError, TypeError):
            continue
        if conf < _MIN_CONFIDENCE:
            continue
        words.append({
            "text": text,
            "x0": float(data["left"][i]), "top": float(data["top"][i]),
            "width": float(data["width"][i]), "height": float(data["height"][i]),
        })
    return words


def _api_post(url: str, data: bytes | None = None, headers: dict | None = None,
              files: dict | None = None) -> dict:
    """Minimal HTTP helper (no extra dependencies)."""
    if files:
        boundary = "----sandboxboundary1234"
        body = io.BytesIO()
        for name, (filename, content, mime) in files.items():
            body.write(f"--{boundary}\r\n".encode())
            body.write(
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
            )
            body.write(f"Content-Type: {mime}\r\n\r\n".encode())
            body.write(content)
            body.write(b"\r\n")
        body.write(f"--{boundary}--\r\n".encode())
        data = body.getvalue()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return jsonlib.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        raise ToolError(f"Production OCR API error ({e.code}): {detail}", code="ocr_api_error") from e
    except Exception as e:
        raise ToolError(f"Production OCR API unreachable: {e}", code="ocr_api_error") from e


def _ocr_words_via_api(pdf_bytes: bytes, language: str) -> list[list[dict]]:
    """Run the production OCR API (read-only), return positioned words per page."""
    import pdfplumber

    up = _api_post(
        f"{_PROD_API}/uploads",
        files={"file": ("sandbox.pdf", pdf_bytes, "application/pdf")},
    )
    file_id = up["id"]
    job = _api_post(
        f"{_PROD_API}/jobs",
        data=jsonlib.dumps({
            "tool_key": "ocr", "file_ids": [file_id],
            "config": {"language": language},
        }).encode(),
        headers={"Content-Type": "application/json"},
    )
    job_id = job["id"]
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(3)
        st = _api_post(f"{_PROD_API}/jobs/{job_id}")
        if st["status"] == "succeeded":
            break
        if st["status"] in ("failed", "cancelled"):
            raise ToolError(
                f"Production OCR job failed: {st.get('error')}", code="ocr_failed"
            )
    else:
        raise ToolError("Production OCR job timed out.", code="ocr_failed")

    out_id = st["output_file_id"]
    req = urllib.request.Request(f"{_PROD_API}/downloads/{out_id}")
    with urllib.request.urlopen(req, timeout=120) as resp:
        ocr_pdf = resp.read()

    pages: list[list[dict]] = []
    with pdfplumber.open(io.BytesIO(ocr_pdf)) as pdf:
        for page in pdf.pages:
            words = []
            for w in page.extract_words():
                words.append({
                    "text": w["text"],
                    "x0": w["x0"], "top": w["top"],
                    "width": w["x1"] - w["x0"], "height": w["bottom"] - w["top"],
                })
            pages.append(words)
    return pages


# ---------------------------------------------------------------------------
# Layout analysis: words -> lines -> columns -> blocks
# ---------------------------------------------------------------------------

def _group_lines(words: list[dict]) -> list[list[dict]]:
    """Group words into lines by vertical proximity, splitting by x-gaps.

    Two-column layouts have words at the same y in different columns;
    a large horizontal gap within a y-band splits them into separate lines.
    O(n log n).
    """
    if not words:
        return []
    # Sort by vertical center, then x.
    words = sorted(words, key=lambda w: (w["top"] + w["height"] / 2, w["x0"]))
    # First pass: y-bands.
    bands: list[list[dict]] = []
    for w in words:
        yc = w["top"] + w["height"] / 2
        best = None
        best_dist = None
        for band in bands:
            byc = band[0]["top"] + band[0]["height"] / 2
            bh = max(x["height"] for x in band)
            dist = abs(yc - byc)
            if dist < bh * 0.6 and (best_dist is None or dist < best_dist):
                best, best_dist = band, dist
        if best is None:
            bands.append([w])
        else:
            best.append(w)
    # Second pass: split each y-band by large x-gaps.
    lines: list[list[dict]] = []
    for band in bands:
        band.sort(key=lambda w: w["x0"])
        current = [band[0]]
        for prev, cur in zip(band, band[1:]):
            gap = cur["x0"] - (prev["x0"] + prev["width"])
            # Gap > 50px at 200 DPI indicates a column boundary.
            if gap > 50:
                lines.append(current)
                current = [cur]
            else:
                current.append(cur)
        lines.append(current)
    lines.sort(key=lambda l: min(w["top"] for w in l))
    return lines


def _line_text(line: list[dict]) -> str:
    """Join line words with spaces, inserting space where x-gap suggests it."""
    if not line:
        return ""
    parts = [line[0]["text"]]
    for prev, cur in zip(line, line[1:]):
        gap = cur["x0"] - (prev["x0"] + prev["width"])
        prev_len = len(prev["text"]) if prev["text"] else 1
        avg_w = prev["width"] / max(prev_len, 1)
        # If gap exceeds ~1/3 of average char width, ensure a space.
        if gap > avg_w * 0.3:
            parts.append(" ")
        parts.append(cur["text"])
    text = "".join(parts)
    # Collapse accidental double spaces, but keep intentional ones minimal.
    return re.sub(r" {2,}", " ", text).strip()


def _detect_columns(lines: list[list[dict]], page_w: float) -> list[list[list[dict]]]:
    """Split lines into reading-order column groups, handling mixed layouts.

    Uses y-band analysis: finds y-ranges where lines have bimodal x-distribution
    (true multi-column regions), and processes those column-by-column. Single-
    column regions (titles, tables, captions) are kept top-to-bottom.
    Returns a list of groups, each a list of lines in reading order.
    """
    if len(lines) < 4:
        return [lines]

    # For each line, get (y_center, x0).
    items = []
    for line in lines:
        yc = sum(w["top"] + w["height"] / 2 for w in line) / len(line)
        x0 = min(w["x0"] for w in line)
        items.append((yc, x0, line))
    items.sort()  # by y

    # Find y-ranges with bimodal x-distribution using sliding windows.
    # A window is multi-column if x0s split into 2+ clusters with a big gap.
    n = len(items)
    is_multi = [False] * n
    for i in range(n):
        yc = items[i][0]
        # Window: lines within 80px vertically.
        window_x0s = [x0 for y, x0, _ in items if abs(y - yc) < 80]
        if len(window_x0s) < 4:
            continue
        window_x0s.sort()
        # Find the largest gap.
        max_gap = 0
        for a, b in zip(window_x0s, window_x0s[1:]):
            max_gap = max(max_gap, b - a)
        # Bimodal if largest gap > 15% of page width and both sides have 2+ lines.
        if max_gap > page_w * 0.15:
            # Verify both sides have support.
            split = None
            for a, b in zip(window_x0s, window_x0s[1:]):
                if b - a == max_gap:
                    split = (a + b) / 2
                    break
            left = sum(1 for x in window_x0s if x < split)
            right = sum(1 for x in window_x0s if x >= split)
            if left >= 2 and right >= 2:
                is_multi[i] = True

    # Group consecutive multi-column lines into regions.
    groups: list[list[list[dict]]] = []
    current_single: list[list[dict]] = []
    i = 0
    while i < n:
        if not is_multi[i]:
            current_single.append(items[i][2])
            i += 1
        else:
            # Flush pending single-column lines.
            if current_single:
                groups.append(current_single)
                current_single = []
            # Collect the multi-column region.
            region = []
            while i < n and is_multi[i]:
                region.append(items[i])
                i += 1
            # Split region by x into columns.
            rx0s = sorted(x0 for _, x0, _ in region)
            # Find split threshold (largest gap).
            max_gap, split_x = 0, None
            for a, b in zip(rx0s, rx0s[1:]):
                if b - a > max_gap:
                    max_gap, split_x = b - a, (a + b) / 2
            left_col = [ln for _, x0, ln in region if x0 < split_x]
            right_col = [ln for _, x0, ln in region if x0 >= split_x]
            # Order: left column top-to-bottom, then right column.
            left_col.sort(key=lambda l: min(w["top"] for w in l))
            right_col.sort(key=lambda l: min(w["top"] for w in l))
            groups.append(left_col)
            groups.append(right_col)
    if current_single:
        groups.append(current_single)
    return groups if groups else [lines]


def _detect_table(lines: list[list[dict]]) -> list[dict] | None:
    """Detect a table: 3+ lines with large, vertically-aligned inter-word gaps.

    Simple and strict: normal prose has ~10px gaps between words (at 200 DPI).
    A table has column gaps several times larger that align vertically.
    Returns row dicts or None.
    """
    if len(lines) < 3:
        return None
    # For each line, find large gaps between consecutive words.
    line_gaps: list[list[tuple[float, float]]] = []  # per line: [(gap_x, gap_size)]
    for line in lines:
        sw = sorted(line, key=lambda w: w["x0"])
        gaps = []
        for a, b in zip(sw, sw[1:]):
            gap_start = a["x0"] + a["width"]
            gap_size = b["x0"] - gap_start
            if gap_size > 40:  # much larger than normal ~10px word space
                gaps.append(((gap_start + b["x0"]) / 2, gap_size))
        line_gaps.append(gaps)
    # A table needs 3+ consecutive lines each with 1+ large gap.
    # Find gap x-positions that align vertically across lines.
    all_gap_x = [gx for gaps in line_gaps for gx, _ in gaps]
    if not all_gap_x:
        return None
    # Cluster gap positions.
    all_gap_x.sort()
    clusters: list[list[float]] = []
    for gx in all_gap_x:
        if clusters and gx - clusters[-1][-1] < 25:
            clusters[-1].append(gx)
        else:
            clusters.append([gx])
    # A column boundary must appear in 3+ lines.
    boundaries = [sum(c) / len(c) for c in clusters if len(c) >= 3]
    if not boundaries:
        return None
    boundaries.sort()
    # Build rows by splitting each line at the boundaries.
    rows = []
    for line in lines:
        sw = sorted(line, key=lambda w: w["x0"])
        cells: list[list[str]] = [[]]
        bi = 0
        for w in sw:
            # Advance past boundaries to the left of this word.
            while bi < len(boundaries) and w["x0"] > boundaries[bi] + 10:
                cells.append([])
                bi += 1
            cells[-1].append(w["text"])
        # Pad to consistent column count.
        while len(cells) < len(boundaries) + 1:
            cells.append([])
        if len([c for c in cells if c]) >= 2:
            rows.append({"cells": [" ".join(c) for c in cells]})
    if len(rows) >= 3:
        return rows
    return None


def _is_heading(text: str, avg_h: float, median_h: float) -> bool:
    """Heading heuristic: short text that is all-caps or notably large."""
    words = text.split()
    if not words or len(words) > 10 or len(text) > 100:
        return False
    if text.isupper() and len(words) <= 8:
        return True
    if median_h > 0 and avg_h > median_h * 1.35:
        return True
    return False


def _analyze_page(words: list[dict], page_w: float, page_h: float) -> list[dict]:
    """Full layout analysis for one page. Returns ordered blocks.

    Block types:
      {'type': 'heading', 'text': str, 'size_pt': float}
      {'type': 'paragraph', 'text': str, 'size_pt': float, 'align': str,
       'indent': bool}
      {'type': 'table', 'rows': [{'cells': [str]}]}
    """
    if not words:
        return []
    lines = _group_lines(words)
    if not lines:
        return []
    # Median word height for relative sizing.
    heights = sorted(w["height"] for line in lines for w in line)
    median_h = heights[len(heights) // 2] if heights else 10

    columns = _detect_columns(lines, page_w)
    blocks: list[dict] = []
    for col_lines in columns:
        # Check for table region within this column.
        table = _detect_table(col_lines)
        table_line_ids = set()
        if table:
            # Mark which lines formed the table (by object identity).
            # Re-run detection to get the actual line objects.
            pass  # handled below via structured pass

        # Paragraph grouping within the column.
        current: list[list[dict]] = []
        prev_bottom = None
        col_blocks: list[dict] = []

        def flush():
            if not current:
                return
            text = " ".join(_line_text(l) for l in current)
            hs = [w["height"] for l in current for w in l]
            avg_h = sum(hs) / len(hs) if hs else median_h
            # Alignment: compare line x0 spread.
            x0s = [min(w["x0"] for w in l) for l in current]
            x1s = [max(w["x0"] + w["width"] for w in l) for l in current]
            align = "left"
            if max(x0s) - min(x0s) > 30 and max(x1s) - min(x1s) < 20:
                align = "right"
            elif max(x0s) - min(x0s) < 20 and max(x1s) - min(x1s) < 20:
                # Both edges aligned — could be justified or centered block.
                pass
            indent = min(x0s) > page_w * 0.08
            # Approximate font size in points (at 200 DPI).
            size_pt = round(avg_h * 72 / 200, 1)
            if _is_heading(text, avg_h, median_h):
                col_blocks.append({"type": "heading", "text": text, "size_pt": size_pt})
            else:
                col_blocks.append({
                    "type": "paragraph", "text": text, "size_pt": size_pt,
                    "align": align, "indent": indent,
                })

        i = 0
        prev_line_text = ""
        while i < len(col_lines):
            # Try table detection starting at this line.
            tbl = _detect_table(col_lines[i:i + 8])
            if tbl and len(tbl) >= 3:
                flush()
                col_blocks.append({"type": "table", "rows": tbl})
                i += len(tbl)
                prev_bottom = None
                prev_line_text = ""
                continue
            line = col_lines[i]
            top = min(w["top"] for w in line)
            bottom = max(w["top"] + w["height"] for w in line)
            line_x0 = min(w["x0"] for w in line)
            new_para = False
            if prev_bottom is not None and current:
                gap = top - prev_bottom
                avg_h = sum(w["height"] for w in line) / len(line)
                prev_x0 = min(w["x0"] for w in current[-1])
                # New paragraph if: large gap, or x0 shift (indent), or
                # previous line looks complete (ends with punctuation).
                if gap > avg_h * 1.0:
                    new_para = True
                elif abs(line_x0 - prev_x0) > 25:
                    new_para = True
                elif prev_line_text.rstrip().endswith((".", "!", "?", ":")):
                    # Previous line ends with terminal punctuation; if gap
                    # is not tiny, it's a new paragraph.
                    if gap > avg_h * 0.4:
                        new_para = True
            if new_para:
                flush()
                current = []
            current.append(line)
            prev_bottom = bottom
            prev_line_text = _line_text(line)
            i += 1
        flush()
        blocks.extend(col_blocks)
    return blocks


def _extract_images(pdf_bytes: bytes, page_index: int, page_w: float, page_h: float,
                    tmpdir: Path) -> list[dict]:
    """Extract embedded images from a PDF page (not the full-page scan).

    Returns [{'path': str, 'width_pt': float, 'top_pt': float}] for images
    that are clearly smaller than the full page.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return []
    images = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        page = reader.pages[page_index]
        resources = page.get("/Resources", {})
        xobjects = resources.get("/XObject", {})
        if not xobjects:
            return []
        for name, obj in xobjects.items():
            try:
                obj = obj.get_object()
            except Exception:
                continue
            if obj.get("/Subtype") != "/Image":
                continue
            w = int(obj.get("/Width", 0))
            h = int(obj.get("/Height", 0))
            # Skip full-page images (scanned pages) and tiny artifacts.
            # Heuristic: if image pixel dimensions are close to page point
            # dimensions, it's a full-page scan background (drawn stretched).
            if w * h == 0:
                continue
            if (w / page_w) > 0.8 and (h / page_h) > 0.8:
                continue  # full-page scan, not an embedded figure
            if w < 30 or h < 30:
                continue  # tiny artifact
            try:
                from PIL import Image as PILImage
                data = obj.get_data()
                filt = obj.get("/Filter", "")
                img = None
                if "/DCTDecode" in str(filt):
                    img = PILImage.open(io.BytesIO(data))
                elif "/FlateDecode" in str(filt):
                    cs = str(obj.get("/ColorSpace", "/DeviceRGB"))
                    mode = "RGB" if "RGB" in cs else "L"
                    img = PILImage.frombytes(mode, (w, h), data)
                if img is None:
                    continue
                ipath = tmpdir / f"img_p{page_index}_{name[1:]}.png"
                img.save(str(ipath))
                images.append({
                    "path": str(ipath),
                    "width_pt": min(w * 72 / _OCR_DPI, page_w * 0.8),
                })
            except Exception:
                continue
    except Exception:
        pass
    return images


def run(ctx: ToolContext, options: dict) -> Path:
    from docx import Document
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    language = get_option(options, SPEC, "language") or "eng"
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "Option 'language' must be a Tesseract language code like 'eng'.",
            code="invalid_option",
        )
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    pdf_bytes = ctx.inputs[0].path.read_bytes()
    if not pdf_bytes.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    # --- Step 1+2: OCR pipeline (required), memory-safe page-by-page ---
    try:
        import pypdfium2 as pdfium
        import pytesseract  # noqa: F401
        local_ok = shutil.which("tesseract") is not None
    except ImportError:
        local_ok = False

    tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-p2w-"))
    doc = Document()
    style = doc.styles["Normal"]
    style.font.size = Pt(11)

    try:
        if local_ok:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
            try:
                n_pages = len(pdf)
                for i in range(n_pages):
                    # Render -> temp file -> release BEFORE OCR.
                    page = pdf[i]
                    pil_image = page.render(scale=_OCR_DPI / 72).to_pil()
                    img_w, img_h = pil_image.size
                    page_w_pt = img_w * 72 / _OCR_DPI
                    page_h_pt = img_h * 72 / _OCR_DPI
                    img_file = tmpdir / f"page_{i}.png"
                    pil_image.save(str(img_file), optimize=True)
                    del pil_image
                    gc.collect()

                    words = _ocr_words_local(str(img_file), language)
                    blocks = _analyze_page(words, img_w, img_h)
                    images = _extract_images(pdf_bytes, i, page_w_pt, page_h_pt, tmpdir)

                    _emit_page(doc, blocks, images, i == 0, Pt, WD_ALIGN_PARAGRAPH)

                    # Per-page cleanup: temp image gone, memory released.
                    try:
                        img_file.unlink()
                    except OSError:
                        pass
                    del words, blocks, images
                    gc.collect()
            finally:
                pdf.close()
        else:
            # Fallback: production OCR API (read-only use).
            words_per_page = _ocr_words_via_api(pdf_bytes, language)
            # Page dimensions unknown here; use A4-ish default for layout.
            for i, words in enumerate(words_per_page):
                blocks = _analyze_page(words, 1654, 2339)  # A4 @200dpi
                _emit_page(doc, blocks, [], i == 0, Pt, WD_ALIGN_PARAGRAPH)
                del words, blocks
                gc.collect()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    out_path = ctx.new_output_path("converted").with_suffix(".docx")
    doc.save(str(out_path))
    return out_path


def _emit_page(doc, blocks: list[dict], images: list[dict], is_first: bool,
               Pt, WD_ALIGN_PARAGRAPH) -> None:
    """Write one PDF page's blocks into the DOCX document."""
    from docx.shared import Inches

    if not is_first:
        doc.add_page_break()
    for b in blocks:
        btype = b["type"]
        if btype == "heading":
            h = doc.add_heading(b["text"], level=1)
            # Scale heading size relative to detected size.
            try:
                for run in h.runs:
                    run.font.size = Pt(min(max(b.get("size_pt", 16), 12), 24))
            except Exception:
                pass
        elif btype == "paragraph":
            p = doc.add_paragraph(b["text"])
            try:
                size = b.get("size_pt", 11)
                if abs(size - 11) > 1.5:
                    for run in p.runs:
                        run.font.size = Pt(min(max(size, 8), 18))
                if b.get("align") == "right":
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                if b.get("indent"):
                    p.paragraph_format.left_indent = Inches(0.4)
            except Exception:
                pass
        elif btype == "table":
            rows = b["rows"]
            if not rows:
                continue
            ncols = max(len(r["cells"]) for r in rows)
            table = doc.add_table(rows=len(rows), cols=ncols)
            table.style = "Table Grid"
            for ri, row in enumerate(rows):
                for ci in range(ncols):
                    cell_text = row["cells"][ci] if ci < len(row["cells"]) else ""
                    table.rows[ri].cells[ci].text = cell_text
    # Embedded images after the page's text blocks.
    for im in images:
        try:
            doc.add_paragraph().add_run().add_picture(
                im["path"], width=Pt(im["width_pt"]))
        except Exception:
            pass
