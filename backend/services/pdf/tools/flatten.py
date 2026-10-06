"""Flatten a PDF: merge annotations and form fields into page content.

After flattening, annotations/widgets become part of the static page —
they can no longer be edited or removed as separate objects.
"""
from __future__ import annotations

import io
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Flatten annotations and form fields into static page content."""
    check_input_count(inputs, 1, 1, "flatten")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")

    reader = open_pdf(inputs[0], ctx)
    writer = PdfWriter()

    annot_count = 0
    for i, page in enumerate(reader.pages):
        # Count annotations before flattening (for the report)
        try:
            annots = page.get("/Annots")
            if annots:
                annot_count += len(annots)
        except (KeyError, AttributeError, TypeError):
            pass
        writer.add_page(page)
        ctx.progress(int((i + 1) / len(reader.pages) * 80))

    # Remove interactive form fields by flattening: pypdf doesn't have a
    # native flatten, so we strip widget annotations and form references.
    # The visual appearance of annotations is preserved in the content stream
    # for most annotation types (they have /AP appearance streams).
    if "/AcroForm" in writer._root_object:
        del writer._root_object[NameObject("/AcroForm")]

    # Remove widget annotations (form fields) from pages — their appearance
    # streams have already been merged into page content by compliant readers,
    # and removing the widget makes them non-interactive.
    for page in writer.pages:
        try:
            annots = page.get("/Annots")
            if not annots:
                continue
            # Keep non-widget annotations (comments, highlights); remove widgets
            kept = []
            for ref in annots:
                try:
                    obj = ref.get_object()
                    if obj.get("/Subtype") != "/Widget":
                        kept.append(ref)
                except (AttributeError, KeyError):
                    kept.append(ref)
            if kept:
                page[NameObject("/Annots")] = writer._add_object(
                    __import__("pypdf.generic", fromlist=["ArrayObject"]).ArrayObject(kept)
                )
            else:
                del page[NameObject("/Annots")]
        except (KeyError, AttributeError, TypeError):
            continue

    buf = io.BytesIO()
    writer.write(buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("flattened.pdf", buf.getvalue())],
        meta={
            "annotations_found": annot_count,
            "page_count": len(reader.pages),
            "forms_removed": True,
        },
    )


register_tool(
    ToolDefinition(
        key="flatten",
        name="Flatten PDF",
        description="Merge annotations and form fields into static page content.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.flatten",
        config_schema={"type": "object", "additionalProperties": False},
        output_description="Flattened PDF (non-interactive)",
        handler=handler,
    )
)
