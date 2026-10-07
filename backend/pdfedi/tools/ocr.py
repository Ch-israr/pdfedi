"""OCR a scanned PDF into a searchable PDF.

Pipeline (no ocrmypdf needed):
  1. Render each page to an image with pypdfium2 (200 DPI).
  2. Recognize words with Tesseract (via pytesseract).
  3. Rebuild the PDF with reportlab: the scanned image as background plus
     an invisible (fully transparent) text layer, so the output looks
     identical but is searchable and selectable.

Degrades gracefully: if pytesseract or the ``tesseract`` system binary is
unavailable, raises ToolError with code "ocr_unavailable".
"""
from __future__ import annotations

import gc
import io
import logging
import re
import shutil
import tempfile
import time
from pathlib import Path

log = logging.getLogger(__name__)

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:\+[A-Za-z]{2,3})*$")
_OCR_UNAVAILABLE = "OCR is not available on this server."
# 200 DPI render: Tesseract is accurate at 200+ DPI and this uses 2.25x less
# memory than 300 DPI. Critical on memory-constrained hosts (Render free tier
# = 512MB): the old code held the full-res PIL image in memory *while*
# Tesseract (a subprocess) allocated its own copy, pushing RSS over the limit
# and getting the container OOM-killed mid-job.
_DPI = 200
# Tesseract config: legacy OCR engine, fully automatic page segmentation.
_TESSERACT_CONFIG = "--oem 0"
# Per-page recognition timeout (seconds): fail gracefully, never hang forever.
_PAGE_TIMEOUT = 600
_MIN_CONFIDENCE = 30


SPEC = ToolSpec(
    key="ocr",
    name="OCR to Searchable PDF",
    tagline="Make scanned PDFs searchable",
    description=(
        "Run OCR on a scanned PDF to produce a searchable PDF: the original "
        "page images are kept and an invisible text layer is added, so the "
        "output looks identical but text can be selected and searched."
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
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="convert",
)


def _require_ocr():
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable") from None
    if shutil.which("tesseract") is None:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable")
    import pytesseract

    return pytesseract


def run(ctx: ToolContext, options: dict) -> Path:
    language = get_option(options, SPEC, "language") or "eng"
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "Option 'language' must be a Tesseract language code like 'eng' or 'eng+deu'.",
            code="invalid_option",
        )
    pytesseract = _require_ocr()

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    import pypdfium2 as pdfium
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen.canvas import Canvas

    try:
        pdf = pdfium.PdfDocument(io.BytesIO(data))
        n_pages = len(pdf)
    except Exception as e:
        raise ToolError(f"Could not parse PDF: {e}", code="invalid_input") from e
    if n_pages == 0:
        raise ToolError("The PDF has no pages.", code="invalid_input")

    out_path = ctx.new_output_path("ocr").with_suffix(".pdf")
    c = Canvas(str(out_path))
    # Rendered page images go to temp files on disk, never held in memory
    # during OCR. Peak Python-side memory per page is ~one small buffer.
    tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-ocr-"))
    try:
        for i in range(n_pages):
            t0 = time.perf_counter()
            page = pdf[i]
            pil_image = page.render(scale=_DPI / 72).to_pil()
            t_render = time.perf_counter() - t0
            img_w, img_h = pil_image.size
            page_w_pt = img_w * 72 / _DPI
            page_h_pt = img_h * 72 / _DPI

            # Spill the image to disk, then release it BEFORE tesseract runs.
            # pytesseract accepts a file path; the tesseract subprocess reads
            # the file itself, so Python holds no image copy during OCR.
            img_file = tmpdir / f"page_{i}.png"
            pil_image.save(str(img_file), optimize=True)
            del pil_image
            gc.collect()

            c.setPageSize((page_w_pt, page_h_pt))
            c.drawImage(ImageReader(str(img_file)), 0, 0,
                        width=page_w_pt, height=page_h_pt)

            # Invisible text layer (transparent fill = selectable but unseen).
            t1 = time.perf_counter()
            try:
                words = pytesseract.image_to_data(
                    str(img_file), lang=language,
                    output_type=pytesseract.Output.DICT,
                    config=_TESSERACT_CONFIG, timeout=_PAGE_TIMEOUT,
                )
            except Exception as e:
                raise ToolError(f"OCR failed on page {i + 1}: {e}", code="ocr_failed") from e
            t_ocr = time.perf_counter() - t1
            log.info(
                "ocr page timing",
                extra={"page": i + 1, "render_s": round(t_render, 1),
                       "ocr_s": round(t_ocr, 1), "px": f"{img_w}x{img_h}"},
            )
            c.saveState()
            c.setFillAlpha(0)
            texts = words.get("text", [])
            for idx, text in enumerate(texts):
                text = (text or "").strip()
                if not text:
                    continue
                try:
                    conf = float(words["conf"][idx])
                except (ValueError, TypeError):
                    continue
                if conf < 0 or conf < _MIN_CONFIDENCE:
                    continue
                x, y, w, h = (words["left"][idx], words["top"][idx],
                              words["width"][idx], words["height"][idx])
                if w <= 0 or h <= 0:
                    continue
                x_pt = x * 72 / _DPI
                # Tesseract origin is top-left; PDF origin is bottom-left.
                y_pt = page_h_pt - (y + h) * 72 / _DPI
                font_size = max(h * 72 / _DPI, 1)
                c.setFont("Helvetica", font_size)
                c.drawString(x_pt, y_pt, text)
            c.restoreState()
            c.showPage()
            # Free the page image file as soon as the page is done.
            try:
                img_file.unlink()
            except OSError:
                pass
            gc.collect()
    finally:
        c.save()
        pdf.close()
        shutil.rmtree(tmpdir, ignore_errors=True)

    return out_path
