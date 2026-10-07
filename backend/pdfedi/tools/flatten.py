"""Flatten a PDF: bake annotations and form fields into static page content.

After flattening, annotations/widgets are part of the static page — they can
no longer be edited or removed as separate objects, and form fields are no
longer interactive.
"""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

SPEC = ToolSpec(
    key="flatten",
    name="Flatten PDF",
    tagline="Bake annotations and forms into the page",
    description=(
        "Merge annotations and interactive form fields into static page content. "
        "The output PDF is no longer editable or interactive."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="security",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ToolError("Input PDF is encrypted.", code="invalid_input")

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    # Drop the interactive form dictionary: fields are no longer fillable.
    root = writer._root_object
    if "/AcroForm" in root:
        del root[NameObject("/AcroForm")]

    # Remove widget annotations (form fields) from each page. Their appearance
    # streams stay in the page content, so the visuals are preserved — they
    # just stop being interactive. Non-widget annotations (comments, etc.)
    # are kept.
    for page in writer.pages:
        try:
            annots = page.get("/Annots")
        except Exception:
            continue
        if not annots:
            continue
        kept = []
        try:
            refs = list(annots)
        except TypeError:
            continue
        for ref in refs:
            try:
                if ref.get_object().get("/Subtype") == "/Widget":
                    continue
            except Exception:
                pass
            kept.append(ref)
        try:
            if kept:
                page[NameObject("/Annots")] = writer._add_object(ArrayObject(kept))
            elif "/Annots" in page:
                del page[NameObject("/Annots")]
        except Exception:
            continue

    out_path = ctx.new_output_path("flattened.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
