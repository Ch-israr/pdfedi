"""Split a PDF into multiple PDFs by ranges or into single pages."""
from __future__ import annotations

import io
import re
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

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")
_EVERY_OUTPUT_CAP = 200


def _range_groups(spec: str, page_count: int) -> list[list[int]]:
    """Parse ``"1-3,5"`` into one page-list per comma token (order preserved)."""
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "INVALID_CONFIG",
            "config.ranges must be a non-empty string like '1-3,5'.",
        )
    groups: list[list[int]] = []
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                "INVALID_CONFIG",
                f"Invalid range token {token.strip()!r}. Use forms like '1-3,5'.",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("INVALID_CONFIG", "Page numbers start at 1.")
        if end < start:
            raise ToolError(
                "INVALID_CONFIG", f"Invalid range {start}-{end}: end is before start."
            )
        if end > page_count:
            raise ToolError(
                "INVALID_CONFIG",
                f"Range {start}-{end} exceeds the document page count ({page_count}).",
            )
        groups.append(list(range(start, end + 1)))
    return groups


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Split one PDF into several PDFs.

    - mode ``"ranges"``: one output PDF per comma-separated range token.
    - mode ``"every"``: one output PDF per page (capped at 200 outputs).
    """
    check_input_count(inputs, 1, 1, "split")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)

    mode = config.get("mode", "ranges")
    if mode not in ("ranges", "every"):
        raise ToolError("INVALID_CONFIG", "config.mode must be 'ranges' or 'every'.")

    if mode == "ranges":
        groups = _range_groups(config.get("ranges", ""), page_count)
    else:
        if page_count > _EVERY_OUTPUT_CAP:
            raise ToolError(
                "INVALID_CONFIG",
                f"Split-every supports at most {_EVERY_OUTPUT_CAP} pages per job.",
            )
        groups = [[p] for p in range(1, page_count + 1)]

    outputs: list[tuple[str, bytes]] = []
    for i, group in enumerate(groups):
        writer = PdfWriter()
        for page_no in group:
            writer.add_page(reader.pages[page_no - 1])
        buf = io.BytesIO()
        writer.write(buf)
        if len(group) == 1:
            name = f"page-{group[0]:03d}.pdf"
        else:
            name = f"pages-{group[0]:03d}-{group[-1]:03d}.pdf"
        outputs.append((name, buf.getvalue()))
        ctx.progress(int((i + 1) / len(groups) * 100))

    return ToolResult(
        outputs=outputs,
        meta={"mode": mode, "output_files": len(outputs), "page_count": page_count},
    )


register_tool(
    ToolDefinition(
        key="split",
        name="Split PDF",
        description="Split a PDF into multiple PDFs by page ranges or into single pages.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.split",
        config_schema={
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["ranges", "every"], "default": "ranges"},
                "ranges": {
                    "type": "string",
                    "description": "1-based ranges like '1-3,5'. Required when mode='ranges'.",
                },
            },
            "additionalProperties": False,
        },
        output_description="One PDF file per range (or per page)",
        handler=handler,
    )
)
