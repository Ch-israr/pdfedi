"""Set or clear a PDF's document metadata fields; output the updated PDF (pypdf)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdfedi.tools._helpers import read_input_bytes
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_WRITABLE_FIELDS = {
    "title": "/Title",
    "author": "/Author",
    "subject": "/Subject",
    "keywords": "/Keywords",
}

SPEC = ToolSpec(
    key="edit_metadata",
    name="Edit Metadata",
    tagline="Change a PDF's title, author and more",
    description=(
        "Set the title, author, subject or keywords stored in a PDF's "
        "document information. Leave a field empty to remove it. The pages "
        "are untouched; only the metadata changes."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="title",
            kind="text",
            label="Title",
            required=False,
            default=None,
            help="Document title. Empty removes it.",
        ),
        ToolOption(
            name="author",
            kind="text",
            label="Author",
            required=False,
            default=None,
            help="Document author. Empty removes it.",
        ),
        ToolOption(
            name="subject",
            kind="text",
            label="Subject",
            required=False,
            default=None,
            help="Document subject. Empty removes it.",
        ),
        ToolOption(
            name="keywords",
            kind="text",
            label="Keywords",
            required=False,
            default=None,
            help="Document keywords. Empty removes them.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Edit Metadata needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")

    # Only fields the user actually supplied (None = untouched; "" = cleared).
    updates: dict[str, str] = {}
    for name in _WRITABLE_FIELDS:
        value = get_option(options, SPEC, name)
        if value is None:
            continue
        if not isinstance(value, str):
            raise ToolError(
                f"Option '{name}' must be text.", code="invalid_option"
            )
        updates[_WRITABLE_FIELDS[name]] = value
    if not updates:
        raise ToolError(
            "Provide at least one of title, author, subject or keywords.",
            code="missing_option",
        )

    data = read_input_bytes(ctx.inputs[0].path)
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "Input is not a valid PDF file (missing %PDF- header).",
            code="invalid_input",
        )
    try:
        reader = PdfReader(io.BytesIO(data))
        if getattr(reader, "is_encrypted", False):
            raise ToolError(
                "This PDF is encrypted; its metadata cannot be edited.",
                code="encrypted_input",
            )
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.add_metadata(updates)
        buf = io.BytesIO()
        writer.write(buf)
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            f"Could not update the PDF metadata: {exc}", code="tool_error"
        ) from exc

    out = Path(str(ctx.new_output_path("metadata_updated")) + ".pdf")
    out.write_bytes(buf.getvalue())
    return out
