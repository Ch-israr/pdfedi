"""OCR a scanned PDF into a searchable PDF with OCRmyPDF.

Degrades gracefully: if the ``ocrmypdf`` package or the ``tesseract``
system binary is unavailable, raises ToolError with code "ocr_unavailable"
instead of failing obscurely.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:\+[A-Za-z]{2,3})*$")
_OCR_UNAVAILABLE = "OCR is not available on this server."

SPEC = ToolSpec(
    key="ocr",
    name="OCR to Searchable PDF",
    tagline="Make scanned PDFs searchable",
    description="Run OCR on a scanned PDF to produce a searchable PDF with a text layer.",
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
)


def run(ctx: ToolContext, options: dict) -> Path:
    language = get_option(options, SPEC, "language")
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "Option 'language' must be a Tesseract language code like 'eng' or 'eng+deu'.",
            code="invalid_option",
        )

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    try:
        import ocrmypdf
    except ImportError as exc:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable") from exc
    if shutil.which("tesseract") is None:
        raise ToolError(_OCR_UNAVAILABLE, code="ocr_unavailable")

    src = ctx.workdir / "ocr_input.pdf"
    dst = ctx.new_output_path("ocr.pdf")
    src.write_bytes(data)
    try:
        try:
            ocrmypdf.ocr(
                str(src),
                str(dst),
                language=[language],
                output_type="pdf",
                jobs=1,
                progress_bar=False,
            )
        except Exception as exc:
            raise ToolError(f"OCR processing failed: {exc}", code="ocr_failed") from exc
    finally:
        src.unlink(missing_ok=True)
    if not dst.exists():
        raise ToolError("OCR processing failed: no output was produced.", code="ocr_failed")
    return dst
