"""Split a PDF into multiple PDFs by ranges or into single pages.

The old multi-output behaviour is preserved by packaging the per-range
PDFs into a single ZIP archive (one output file per run).
"""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="split",
    name="Split PDF",
    tagline="Split a PDF into multiple files",
    description=(
        "Split a PDF into several PDFs — one per page range (e.g. '1-3,5'), "
        "or one PDF per page — delivered together as a ZIP archive."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="mode",
            kind="select",
            label="Split mode",
            required=False,
            default="ranges",
            choices=["ranges", "every"],
            help="'ranges': one PDF per comma-separated range. "
            "'every': one PDF per page.",
        ),
        ToolOption(
            name="ranges",
            kind="text",
            label="Page ranges",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Required when mode is 'ranges'.",
        ),
    ],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    category="organize",
)

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")
_EVERY_OUTPUT_CAP = 200


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


def _range_groups(spec: str, page_count: int) -> list[list[int]]:
    """Parse ``"1-3,5"`` into one page-list per comma token (order preserved)."""
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "Page ranges must be a non-empty string like '1-3,5'.", code="bad_option"
        )
    groups: list[list[int]] = []
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid range token {token.strip()!r}. Use forms like '1-3,5'.",
                code="bad_option",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("Page numbers start at 1.", code="bad_option")
        if end < start:
            raise ToolError(
                f"Invalid range {start}-{end}: end is before start.", code="bad_option"
            )
        if end > page_count:
            raise ToolError(
                f"Range {start}-{end} exceeds the document page count ({page_count}).",
                code="bad_option",
            )
        groups.append(list(range(start, end + 1)))
    return groups


def run(ctx: ToolContext, options: dict) -> Path:
    """Split the single input PDF; return a ZIP of the resulting PDFs."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Split needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)

    mode = get_option(options, SPEC, "mode")
    if mode not in ("ranges", "every"):
        raise ToolError(
            "Option 'mode' must be 'ranges' or 'every'.", code="bad_option"
        )

    if mode == "ranges":
        ranges = get_option(options, SPEC, "ranges")
        if ranges is None or (isinstance(ranges, str) and not ranges.strip()):
            raise ToolError(
                "Option 'ranges' is required when mode is 'ranges' "
                "(e.g. '1-3,5').",
                code="missing_option",
            )
        groups = _range_groups(ranges, page_count)
    else:
        if page_count > _EVERY_OUTPUT_CAP:
            raise ToolError(
                f"Split-every supports at most {_EVERY_OUTPUT_CAP} pages per job.",
                code="bad_option",
            )
        groups = [[p] for p in range(1, page_count + 1)]

    out = ctx.new_output_path("split.zip").with_suffix(".zip")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for group in groups:
            writer = PdfWriter()
            for page_no in group:
                writer.add_page(reader.pages[page_no - 1])
            buf = io.BytesIO()
            writer.write(buf)
            if len(group) == 1:
                name = f"page-{group[0]:03d}.pdf"
            else:
                name = f"pages-{group[0]:03d}-{group[-1]:03d}.pdf"
            zf.writestr(name, buf.getvalue())
    return out
