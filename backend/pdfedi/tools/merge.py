"""Merge multiple PDFs into a single PDF, preserving input order."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

SPEC = ToolSpec(
    key="merge",
    name="Merge PDFs",
    tagline="Combine multiple PDFs into one",
    description=(
        "Combine two or more PDF files into a single PDF, preserving the "
        "order the files were uploaded in."
    ),
    input_kinds=["pdf"],
    min_files=2,
    max_files=20,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)


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


def run(ctx: ToolContext, options: dict) -> Path:
    """Merge ctx.inputs (2-20 PDFs) into one PDF inside ctx.workdir."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    n = len(ctx.inputs)
    if not SPEC.min_files <= n <= SPEC.max_files:
        raise ToolError(
            f"Merge needs between {SPEC.min_files} and {SPEC.max_files} PDF files; "
            f"got {n}.",
            code="bad_input_count",
        )

    writer = PdfWriter()
    for tool_input in ctx.inputs:
        data = tool_input.path.read_bytes()
        reader = _open_reader(data, tool_input.filename)
        for page in reader.pages:
            writer.add_page(page)

    out = ctx.new_output_path("merged.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
