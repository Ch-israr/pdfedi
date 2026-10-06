"""Password-protect a PDF with 128-bit encryption via pypdf."""
from __future__ import annotations

import io
from typing import Any

from pypdf import PdfWriter

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf

_MIN_PASSWORD_LEN = 4


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Encrypt the PDF with a user password (128-bit) and optional owner password."""
    check_input_count(inputs, 1, 1, "password_protect")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    user_password = config.get("user_password")
    if not isinstance(user_password, str) or len(user_password) < _MIN_PASSWORD_LEN:
        raise ToolError(
            "INVALID_CONFIG",
            f"config.user_password must be a string of at least {_MIN_PASSWORD_LEN} characters.",
        )
    owner_password = config.get("owner_password")
    if owner_password is not None and (
        not isinstance(owner_password, str) or not owner_password
    ):
        raise ToolError(
            "INVALID_CONFIG",
            "config.owner_password must be a non-empty string when provided.",
        )

    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        writer.add_page(page)
        if i % 10 == 0:
            ctx.progress(int(i / page_count * 80))
    if reader.metadata:
        clean = {k: str(v) for k, v in reader.metadata.items() if v is not None}
        if clean:
            writer.add_metadata(clean)
    writer.encrypt(
        user_password=user_password,
        owner_password=owner_password,
        use_128bit=True,
    )
    buf = io.BytesIO()
    writer.write(buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("protected.pdf", buf.getvalue())],
        meta={"page_count": page_count, "encryption": "128-bit"},
    )


register_tool(
    ToolDefinition(
        key="password_protect",
        name="Password Protect",
        description="Encrypt a PDF with 128-bit password protection.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.protect",
        config_schema={
            "type": "object",
            "properties": {
                "user_password": {
                    "type": "string",
                    "minLength": 4,
                    "description": "Password required to open the PDF.",
                },
                "owner_password": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Optional owner password for permissions.",
                },
            },
            "required": ["user_password"],
            "additionalProperties": False,
        },
        output_description="Password-protected PDF",
        handler=handler,
    )
)
