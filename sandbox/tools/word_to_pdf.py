"""SANDBOX ONLY — Word (.docx) to PDF via LibreOffice headless.

Converts with `soffice --headless --convert-to pdf`, which preserves text,
paragraphs, formatting, images and page structure.

This is a sandbox experiment. Do NOT move to production without approval.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

_DOCX_MAGIC = b"PK\x03\x04"  # docx is a zip
_CONVERT_TIMEOUT = 180

SPEC = ToolSpec(
    key="word_to_pdf",
    name="Word to PDF",
    tagline="Convert Word documents to PDF",
    description=(
        "Sandbox experiment: converts .docx to PDF with LibreOffice, "
        "preserving text, formatting, images and layout."
    ),
    input_kinds=["document"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="converting",
    category="convert",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.startswith(_DOCX_MAGIC):
        raise ToolError("Input is not a valid .docx file.", code="invalid_input")

    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise ToolError(
            "Word-to-PDF converter (LibreOffice) is not installed in the sandbox.",
            code="converter_unavailable",
        )

    workdir = Path(tempfile.mkdtemp(prefix="pdfedi-docx2pdf-"))
    try:
        src = workdir / "input.docx"
        src.write_bytes(data)
        try:
            proc = subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(workdir), str(src)],
                capture_output=True, text=True, timeout=_CONVERT_TIMEOUT,
            )
        except subprocess.TimeoutExpired as e:
            raise ToolError("Conversion timed out.", code="conversion_failed") from e
        out_pdf = workdir / "input.pdf"
        if proc.returncode != 0 or not out_pdf.is_file():
            err = (proc.stderr or proc.stdout or "")[-500:]
            raise ToolError(f"Conversion failed: {err}", code="conversion_failed")

        out_path = ctx.new_output_path("converted").with_suffix(".pdf")
        shutil.copyfile(out_pdf, out_path)
        return out_path
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
