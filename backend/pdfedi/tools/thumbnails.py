"""Render PDF pages as a contact-sheet thumbnail grid in one PNG (pypdfium2)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes, resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_THUMBNAIL_CAP = 50
_MIN_WIDTH = 16
_MAX_WIDTH = 500
_MIN_COLUMNS = 1
_MAX_COLUMNS = 8
_GAP = 8  # pixels between thumbnails

SPEC = ToolSpec(
    key="thumbnails",
    name="Page Thumbnails",
    tagline="A contact sheet of every page",
    description=(
        "Render the selected pages of a PDF as small thumbnails arranged "
        "in a grid on a single PNG contact sheet."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="columns",
            kind="number",
            label="Columns",
            required=False,
            default=4,
            help=f"Thumbnails per row ({_MIN_COLUMNS}–{_MAX_COLUMNS}).",
        ),
        ToolOption(
            name="thumb_width",
            kind="number",
            label="Thumbnail width (px)",
            required=False,
            default=200,
            help=f"Width of each thumbnail in pixels ({_MIN_WIDTH}–{_MAX_WIDTH}).",
        ),
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Leave empty for all pages.",
        ),
    ],
    output_kind="images",
    output_ext="png",
    output_mime="image/png",
    category="convert",
)


def _as_int(value, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ToolError(
            f"Option '{name}' must be a number.", code="invalid_option"
        ) from exc


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Page Thumbnails needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")

    columns = _as_int(get_option(options, SPEC, "columns"), "columns")
    if not _MIN_COLUMNS <= columns <= _MAX_COLUMNS:
        raise ToolError(
            f"Option 'columns' must be between {_MIN_COLUMNS} and "
            f"{_MAX_COLUMNS}.",
            code="invalid_option",
        )
    thumb_width = _as_int(get_option(options, SPEC, "thumb_width"), "thumb_width")
    if not _MIN_WIDTH <= thumb_width <= _MAX_WIDTH:
        raise ToolError(
            f"Option 'thumb_width' must be between {_MIN_WIDTH} and "
            f"{_MAX_WIDTH} pixels.",
            code="invalid_option",
        )

    data = read_input_bytes(ctx.inputs[0].path)
    page_count = page_count_of_pdf(data)
    pages = resolve_pages(get_option(options, SPEC, "pages"), page_count)
    if not pages:
        raise ToolError("No pages selected.", code="invalid_option")
    if len(pages) > _THUMBNAIL_CAP:
        raise ToolError(
            f"At most {_THUMBNAIL_CAP} thumbnails per job; "
            f"{len(pages)} requested.",
            code="invalid_option",
        )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Thumbnails are unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    pdf = pdfium.PdfDocument(data)
    try:
        # Pass 1 (cheap): compute each thumbnail's dimensions from page size
        # without rendering. This gives us max_h for the sheet layout while
        # holding zero PIL images in RAM.
        dims: list[tuple[float, int]] = []  # (scale, thumb_height_px)
        max_h = 0
        for page_no in pages:
            page = pdf[page_no - 1]
            try:
                src_w_pt, src_h_pt = page.get_size()
                scale = thumb_width / src_w_pt if src_w_pt > 0 else 1.0
                # Rendered height in pixels at this scale.
                thumb_h = max(1, int(src_h_pt * scale))
            finally:
                page.close()
            dims.append((scale, thumb_h))
            max_h = max(max_h, thumb_h)

        rows = (len(pages) + columns - 1) // columns
        sheet_w = columns * thumb_width + (columns + 1) * _GAP
        sheet_h = rows * max_h + (rows + 1) * _GAP
        sheet = Image.new("RGB", (sheet_w, sheet_h), "white")

        # Pass 2: render one thumbnail at a time, paste, release immediately.
        # Peak PIL memory is now a single thumbnail instead of up to 50.
        for idx, page_no in enumerate(pages):
            scale, _ = dims[idx]
            page = pdf[page_no - 1]
            try:
                thumb = page.render(scale=scale).to_pil()
            finally:
                page.close()
            try:
                r, c = divmod(idx, columns)
                x = _GAP + c * (thumb_width + _GAP)
                y = _GAP + r * (max_h + _GAP)
                sheet.paste(thumb, (x, y))
            finally:
                thumb.close()
    finally:
        pdf.close()

    out = Path(str(ctx.new_output_path("thumbnails")) + ".png")
    sheet.save(out, format="PNG")
    sheet.close()
    return out
