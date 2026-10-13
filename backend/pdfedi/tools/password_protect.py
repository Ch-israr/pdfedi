"""Password-protect a PDF with 128-bit encryption (pypdf)."""
from __future__ import annotations

from pathlib import Path

from pypdf import PdfWriter

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
    require_option,
)

_MIN_PASSWORD_LEN = 4

SPEC = ToolSpec(
    key="password_protect",
    name="Password Protect",
    tagline="Lock a PDF with a password",
    description=(
        "Encrypt a PDF with 128-bit password protection. "
        "The password is required to open the file."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="password",
            kind="text",
            label="Password",
            required=True,
            help=f"Minimum {_MIN_PASSWORD_LEN} characters. Required to open the PDF.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="security",
)


def run(ctx: ToolContext, options: dict) -> Path:
    password = require_option(options, SPEC, "password")
    if not isinstance(password, str) or len(password) < _MIN_PASSWORD_LEN:
        raise ToolError(
            f"Option 'password' must be a string of at least {_MIN_PASSWORD_LEN} characters.",
            code="invalid_option",
        )

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(
        data, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    if reader.metadata:
        clean = {k: str(v) for k, v in reader.metadata.items() if v is not None}
        if clean:
            writer.add_metadata(clean)
    writer.encrypt(user_password=password, use_128bit=True)

    out_path = ctx.new_output_path("protected.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
