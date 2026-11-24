"""OCR a scanned PDF into a searchable PDF.

Pipeline (no ocrmypdf needed):
  1. Check each page for native text with pypdf (cheap, no rendering).
     Pages that already have a text layer are copied as-is — no re-OCR.
  2. Render only text-less pages to images with pypdfium2 (200 DPI).
  3. Recognize words with Tesseract via the shared OCR service
     (``pdfedi.tools._ocr``): PSM 3 fast path, PSM 11 retry on sparse
     pages, per-page quality signal.
  4. Rebuild: pypdf interleaves original text pages with reportlab-built
     OCR pages (scanned image as background + invisible text layer).

Quality signal: pages whose OCR came back low-confidence or nearly
empty are listed in the output PDF's Subject metadata (jobs have no
warning channel, so the note lives in the file itself) — never silently
shipped as good output.

Degrades gracefully: if pytesseract or the ``tesseract`` system binary is
unavailable, raises ToolError with code "ocr_unavailable".
"""
from __future__ import annotations

import gc
import io
import logging
import shutil
import tempfile
import time
from pathlib import Path

log = logging.getLogger(__name__)

from pdfedi.tools._ocr import (
    ocr_image,
    page_needs_ocr,
    quality_note,
    validate_language,
)
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_OCR_UNAVAILABLE = "OCR is not available on this server."
# Per-page recognition timeout (seconds): fail gracefully, never hang forever.
_PAGE_TIMEOUT = 600
_DPI = 200


def _require_ocr():
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable") from None
    if shutil.which("tesseract") is None:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable")
    import pytesseract

    return pytesseract


def _attach_quality_notes(pdf_path: Path, notes: list[str]) -> None:
    """Write the quality notes into the PDF's Subject metadata, in place.

    Jobs carry no warning channel, so the note lives in the output file
    itself: visible in any reader's document properties, and it changes
    nothing about how the pages look.
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    meta = dict(reader.metadata or {})
    subject = "OCR quality: " + "; ".join(notes) + ". Please check these pages."
    meta["/Subject"] = subject
    writer.add_metadata(meta)
    tmp = pdf_path.with_suffix(".noted.pdf")
    with open(tmp, "wb") as f:
        writer.write(f)
    tmp.replace(pdf_path)


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
    language = validate_language(language)
    _require_ocr()

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    import pypdfium2 as pdfium
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen.canvas import Canvas
    from pypdf import PdfReader, PdfWriter

    try:
        pdf = pdfium.PdfDocument(io.BytesIO(data))
        n_pages = len(pdf)
    except Exception as e:
        raise ToolError(f"Could not parse PDF: {e}", code="invalid_input") from e
    if n_pages == 0:
        raise ToolError("The PDF has no pages.", code="invalid_input")

    # --- Optimization: skip OCR for pages that already have native text ---
    # pypdf text extraction is cheap (no rendering). Pages with a real text
    # layer are copied as-is; only scanned pages go through Tesseract.
    try:
        reader = PdfReader(io.BytesIO(data))
        needs_ocr = [page_needs_ocr(p) for p in reader.pages]
    except Exception:
        # If pypdf can't parse, fall back to OCR-ing everything.
        needs_ocr = [True] * n_pages
    n_ocr = sum(needs_ocr)
    log.info("ocr page plan", extra={"total": n_pages, "ocr_pages": n_ocr,
                                     "skipped": n_pages - n_ocr})

    out_path = ctx.new_output_path("ocr").with_suffix(".pdf")

    if n_ocr == 0:
        # All pages already searchable: copy through (dedup via sha256 in
        # jobs.py handles the identical-output case).
        log.info("ocr skipped entirely: all pages have native text")
        out_path.write_bytes(data)
        return out_path

    # Build OCR'd pages with reportlab (only for pages that need it).
    c = Canvas(str(out_path))
    # Rendered page images go to temp files on disk, never held in memory
    # during OCR. Peak Python-side memory per page is ~one small buffer.
    tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-ocr-"))
    ocr_page_indices: list[int] = []
    # Per-page quality signal, for the note in the output metadata.
    quality_notes: list[str] = []
    try:
        for i in range(n_pages):
            if not needs_ocr[i]:
                continue
            ocr_page_indices.append(i)
            t0 = time.perf_counter()
            page = pdf[i]
            pil_image = page.render(scale=_DPI / 72).to_pil()
            t_render = time.perf_counter() - t0
            img_w, img_h = pil_image.size
            page_w_pt = img_w * 72 / _DPI
            page_h_pt = img_h * 72 / _DPI

            # Spill the image to disk, then release it BEFORE tesseract runs.
            # The shared service accepts a file path; the tesseract
            # subprocess reads the file itself, so Python holds no image
            # copy during OCR.
            img_file = tmpdir / f"page_{i}.png"
            pil_image.save(str(img_file), optimize=True)
            del pil_image
            gc.collect()

            c.setPageSize((page_w_pt, page_h_pt))
            c.drawImage(ImageReader(str(img_file)), 0, 0,
                        width=page_w_pt, height=page_h_pt)

            # Invisible text layer (transparent fill = selectable but unseen).
            # The shared service runs PSM 3 with a PSM 11 retry on sparse
            # pages and returns the kept words with their boxes.
            t1 = time.perf_counter()
            try:
                result = ocr_image(
                    img_file, lang=language, timeout=_PAGE_TIMEOUT,
                )
            except ToolError as e:
                raise ToolError(f"OCR failed on page {i + 1}: {e}", code="ocr_failed") from e
            t_ocr = time.perf_counter() - t1
            log.info(
                "ocr page timing",
                extra={"page": i + 1, "render_s": round(t_render, 1),
                       "ocr_s": round(t_ocr, 1), "px": f"{img_w}x{img_h}",
                       "words": result.word_count,
                       "mean_conf": round(result.mean_confidence, 1),
                       "retried": result.retried},
            )
            note = quality_note(i + 1, result)
            if note is not None:
                quality_notes.append(note)
            c.saveState()
            c.setFillAlpha(0)
            for word in result.words:
                x_pt = word.x * 72 / _DPI
                # Tesseract origin is top-left; PDF origin is bottom-left.
                y_pt = page_h_pt - (word.y + word.h) * 72 / _DPI
                font_size = max(word.h * 72 / _DPI, 1)
                c.setFont("Helvetica", font_size)
                c.drawString(x_pt, y_pt, word.text)
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

    if n_ocr == n_pages:
        # Every page was OCR'd: the reportlab output is already complete.
        if quality_notes:
            _attach_quality_notes(out_path, quality_notes)
        return out_path

    # Mixed: interleave original text pages with OCR'd pages via pypdf.
    try:
        ocr_reader = PdfReader(str(out_path))
        writer = PdfWriter()
        ocr_idx = 0
        for i, page in enumerate(reader.pages):
            if needs_ocr[i]:
                writer.add_page(ocr_reader.pages[ocr_idx])
                ocr_idx += 1
            else:
                writer.add_page(page)
        # Write to a distinct file, then drop the OCR-only intermediate.
        # (new_output_path("ocr") always returns workdir/"output_ocr", so
        # reusing it here would make final_path == out_path and the unlink
        # below would delete the finished file.)
        final_path = ctx.new_output_path("ocr_final").with_suffix(".pdf")
        with open(final_path, "wb") as f:
            writer.write(f)
        out_path.unlink(missing_ok=True)
        if quality_notes:
            _attach_quality_notes(final_path, quality_notes)
        return final_path
    except Exception as e:
        # If interleaving fails, fall back to the OCR-only output
        # (all scanned pages are in there; text pages would be missing,
        # so this is a last resort — log loudly).
        log.error("ocr interleave failed, returning OCR-only PDF: %s", e)
        if quality_notes:
            _attach_quality_notes(out_path, quality_notes)
        return out_path
