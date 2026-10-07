"""Remove password protection from an encrypted PDF (pypdf)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter, PasswordType

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    require_option,
)

SPEC = ToolSpec(
    key="unlock_pdf",
    name="Unlock PDF",
    tagline="Remove password protection",
    description=(
        "Remove the password from an encrypted PDF so it opens without one. "
        "You must know the current password."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="password",
            kind="text",
            label="Current password",
            required=True,
            help="The password currently protecting the PDF.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="processing",
    category="security",
)


def run(ctx: ToolContext, options: dict) -> Path:
    password = require_option(options, SPEC, "password")
    if not isinstance(password, str) or not password:
        raise ToolError("Option 'password' must be a non-empty string.", code="invalid_option")

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    reader = PdfReader(io.BytesIO(data))
    if not reader.is_encrypted:
        raise ToolError("This PDF is not password protected.", code="invalid_input")

    result = reader.decrypt(password)
    if result == PasswordType.NOT_DECRYPTED:
        raise ToolError("Incorrect password.", code="wrong_password")

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    if reader.metadata:
        clean = {k: str(v) for k, v in reader.metadata.items() if v is not None}
        if clean:
            writer.add_metadata(clean)

    out_path = ctx.new_output_path("unlocked.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
