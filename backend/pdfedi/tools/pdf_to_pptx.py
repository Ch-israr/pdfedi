"""Convert a PDF into a PowerPoint deck (.pptx) — one slide per page.

Each slide carries a rendered image of its page (so the layout always looks
right) plus editable text boxes rebuilt from the page's text layer, so the
words can be selected and edited. Text boxes are positioned from the
character boxes, so they sit where the words are on the page. Scanned
pages are read with the shared OCR service, so their text becomes editable
text boxes too.

Honest limits, stated in the tool copy: the page image is the visual truth
— text boxes are an editable overlay and may drift slightly on complex
layouts; vector graphics and embedded images are not rebuilt as editable
shapes.
"""
from __future__ import annotations

import gc
import io
from pathlib import Path

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools._ocr import (
    ocr_page as _shared_ocr_page,
    quality_note as _shared_quality_note,
    validate_language,
)
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="pdf_to_pptx",
    name="PDF to PowerPoint",
    tagline="Turn PDF pages into editable slides",
    description=(
        "Convert a PDF into a PowerPoint (.pptx) deck — one slide per page. "
        "Each slide shows a rendered image of its page with editable text "
        "boxes over the words, so the text can be selected and changed. "
        "Complex layouts may drift slightly; scanned pages are read with "
        "built-in OCR, so their text becomes editable too."
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
    output_kind="document",
    output_ext="pptx",
    output_mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    activity="converting",
    category="convert",
)

_PAGE_CAP = 50
_DPI = 150
_SLIDE_W_IN = 13.333
_SLIDE_H_IN = 7.5


def _lines_for_page(data: bytes, page_index: int,
                    lang: str = "eng") -> tuple[list[dict], object | None]:
    """Group a page's characters into text lines with boxes and sizes.

    Simple y-proximity grouping (same tolerance idea as pdf_to_word, without
    its column/heading machinery — here the page image carries the layout,
    so the boxes only need to sit on the right words). Boxes are PDF points
    in pdfium's bottom-origin convention (x0/y0 = bottom-left, x1/y1 =
    top-right); the caller converts y1 to a top-origin offset for the slide.

    Returns (lines, ocr_result): ``ocr_result`` is the shared OCR service's
    result when the page had no text layer and was OCR'd instead (None
    otherwise) — the caller uses it for the quality note.
    """
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    doc = pdfium.PdfDocument(data)
    lines: list[dict] = []
    ocr_result = None
    try:
        page = doc[page_index]
        tp = page.get_textpage()
        n = tp.count_chars()
        if not n:
            # Scanned page (no text layer): read it with the shared OCR
            # service instead of leaving an image-only slide.
            pw, ph = page.get_size()
            ocr_result = _shared_ocr_page(data, page_index, lang=lang)
            lines = [
                {
                    "text": ln["text"],
                    "x0": ln["x0"], "y0": ln["y0"],
                    "x1": ln["x1"], "y1": ln["y1"],
                    "size": ln["size"],
                }
                for ln in ocr_result.lines_in_points(pw, ph)
            ]
            lines.sort(key=lambda ln: -ln["y1"])
            return lines, ocr_result
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
            chars.append({"ch": ch, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                          "size": size})
        chars.sort(key=lambda c: (-(c["y0"] + c["y1"]) / 2, c["x0"]))
        line_objs: list[dict] = []
        for ch in chars:
            cy = (ch["y0"] + ch["y1"]) / 2
            ch_h = max(1.0, ch["y1"] - ch["y0"])
            best = None
            best_d = None
            for ln in line_objs:
                tol = 0.35 * max(ch_h, ln["h"])
                d = abs(cy - ln["yc"])
                if d <= tol and (best_d is None or d < best_d):
                    best, best_d = ln, d
            if best is None:
                line_objs.append({"chars": [ch], "yc": cy, "h": ch_h})
            else:
                best["chars"].append(ch)
                n_ln = len(best["chars"])
                best["yc"] += (cy - best["yc"]) / n_ln
        for ln in line_objs:
            ordered = sorted(ln["chars"], key=lambda c: c["x0"])
            # Join with a space where the gap exceeds a third of the font size.
            text = ""
            prev = None
            for c in ordered:
                if prev is not None:
                    gap = c["x0"] - prev["x1"]
                    if gap > 0.3 * max(prev["size"] or 10.0, 1.0):
                        text += " "
                text += c["ch"]
                prev = c
            text = text.strip()
            if not text:
                continue
            sizes = [c["size"] for c in ordered if c["size"] > 0]
            med_size = sorted(sizes)[len(sizes) // 2] if sizes else 10.0
            lines.append({
                "text": text,
                "x0": min(c["x0"] for c in ordered),
                "y0": min(c["y0"] for c in ordered),
                "x1": max(c["x1"] for c in ordered),
                "y1": max(c["y1"] for c in ordered),
                "size": med_size,
            })
    finally:
        doc.close()
    # Top-first (larger y1 = higher on the page, pdfium is bottom-origin).
    lines.sort(key=lambda ln: -ln["y1"])
    return lines, ocr_result


def run(ctx: ToolContext, options: dict) -> Path:
    """Render each page to an image slide with editable text boxes."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to PowerPoint needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except ImportError as exc:
        raise ToolError(
            "Slide export is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Page rendering is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    tool_input = ctx.inputs[0]
    data = tool_input.path.read_bytes()
    filename = tool_input.filename
    reader = open_pdf_reader(data, filename)
    page_count = len(reader.pages)
    if page_count > _PAGE_CAP:
        raise ToolError(
            f"PDF to PowerPoint supports at most {_PAGE_CAP} pages per job.",
            code="too_many_pages",
        )
    language = validate_language(get_option(options, SPEC, "language") or "eng")

    prs = Presentation()
    prs.slide_width = Inches(_SLIDE_W_IN)
    prs.slide_height = Inches(_SLIDE_H_IN)
    blank = prs.slide_layouts[6]
    scale = _DPI / 72.0

    doc = pdfium.PdfDocument(data)
    try:
        for i in range(page_count):
            page = doc[i]
            pw, ph = page.get_size()
            # Render the page image (visual truth for the slide).
            bitmap = page.render(scale=scale).to_pil()
            img_buf = io.BytesIO()
            bitmap.save(img_buf, format="PNG")
            bitmap.close()
            img_buf.seek(0)

            slide = prs.slides.add_slide(blank)
            slide.shapes.add_picture(
                img_buf, Inches(0), Inches(0),
                width=Inches(_SLIDE_W_IN), height=Inches(_SLIDE_H_IN),
            )
            # Editable text boxes over the words. pdfium boxes are
            # bottom-origin PDF points; the slide is top-origin, so the
            # box top comes from the TOP edge (y1), not the bottom (y0).
            # (Using y0 here placed every box vertically flipped — fixed
            # in the Phase 0 round; see BUILD-REPORT.md.)
            sx = _SLIDE_W_IN * 72.0 / pw if pw else 1.0
            sy = _SLIDE_H_IN * 72.0 / ph if ph else 1.0
            s = min(sx, sy)
            lines, ocr_result = _lines_for_page(data, i, lang=language)
            for ln in lines:
                left = Inches(ln["x0"] * sx / 72.0)
                top = Inches((ph - ln["y1"]) * sy / 72.0)
                width = Inches(max(0.2, (ln["x1"] - ln["x0"]) * sx / 72.0))
                height = Inches(max(0.15, (ln["y1"] - ln["y0"]) * sy / 72.0))
                box = slide.shapes.add_textbox(left, top, width, height)
                tf = box.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                run_ = p.add_run()
                run_.text = ln["text"]
                run_.font.size = Pt(max(6.0, ln["size"] * s))
            # Quality signal: slide notes carry the OCR warning (invisible
            # in the slideshow, visible in the notes pane).
            if ocr_result is not None:
                note = _shared_quality_note(i + 1, ocr_result)
                if note is not None:
                    slide.notes_slide.notes_text_frame.text = (
                        "OCR quality: " + note + ". Please check this slide."
                    )
            del img_buf
            gc.collect()
    finally:
        doc.close()

    out = ctx.new_output_path("slides.pptx").with_suffix(".pptx")
    prs.save(str(out))
    return out
