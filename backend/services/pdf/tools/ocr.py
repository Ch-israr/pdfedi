"""OCR a scanned PDF into a searchable PDF with OCRmyPDF.

Degrades gracefully: if the ``ocrmypdf`` package or the ``tesseract``
system binary is unavailable, the handler raises
``ToolError("OCR_UNAVAILABLE", ...)`` instead of failing obscurely.
"""
from __future__ import annotations

import re
import shutil
from typing import Any

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:\+[A-Za-z]{2,3})*$")


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Run OCR over the PDF and return a searchable PDF."""
    check_input_count(inputs, 1, 1, "ocr")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    language = config.get("language", "eng")
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "INVALID_CONFIG",
            "config.language must be a Tesseract language code like 'eng' or 'eng+deu'.",
        )
    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)

    try:
        import ocrmypdf
    except ImportError as exc:
        raise ToolError(
            "OCR_UNAVAILABLE", "OCR is not available on this deployment."
        ) from exc
    if shutil.which("tesseract") is None:
        raise ToolError(
            "OCR_UNAVAILABLE", "OCR is not available on this deployment."
        )

    work_dir = ctx.work_dir
    work_dir.mkdir(parents=True, exist_ok=True)
    src = work_dir / f"{ctx.job_id}-ocr-input.pdf"
    dst = work_dir / f"{ctx.job_id}-ocr-output.pdf"
    try:
        src.write_bytes(inputs[0])
        ctx.progress(10)
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
            raise ToolError("OCR_FAILED", f"OCR processing failed: {exc}") from exc
        ctx.progress(90)
        result = dst.read_bytes()
    finally:
        src.unlink(missing_ok=True)
        dst.unlink(missing_ok=True)
    ctx.progress(100)
    return ToolResult(
        outputs=[("ocr.pdf", result)],
        meta={"page_count": page_count, "language": language, "searchable": True},
    )


register_tool(
    ToolDefinition(
        key="ocr",
        name="OCR to Searchable PDF",
        description="Run OCR on a scanned PDF to produce a searchable PDF.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.ocr",
        feature_flag="tool.ocr",
        config_schema={
            "type": "object",
            "properties": {
                "language": {
                    "type": "string",
                    "default": "eng",
                    "description": "Tesseract language code, e.g. 'eng' or 'eng+deu'.",
                }
            },
            "additionalProperties": False,
        },
        output_description="Searchable PDF with an OCR text layer",
        handler=handler,
    )
)
