"""Place multiple PDF pages on each sheet (N-up) for printing handouts."""
from __future__ import annotations

import io
from math import ceil
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="n_up",
    name="N-Up PDF",
    tagline="Print multiple pages per sheet",
    description=(
        "Place 2, 4, 6 or 9 pages on each sheet of a new PDF — ideal for "
        "handouts and booklets. Each page keeps its proportions and is "
        "centred in its cell with a small gap between cells."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="layout",
            kind="select",
            label="Pages per sheet",
            required=True,
            default="4",
            choices=["2", "4", "6", "9"],
            help="How many source pages to place on each sheet.",
        ),
        ToolOption(
            name="sheet",
            kind="select",
            label="Sheet size",
            required=False,
            default="a4",
            choices=["a4", "letter"],
            help="Output sheet size.",
        ),
        ToolOption(
            name="orientation",
            kind="select",
            label="Orientation",
            required=False,
            default="portrait",
            choices=["portrait", "landscape"],
            help="Sheet orientation.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)

_SHEET_SIZES: dict[str, tuple[float, float]] = {
    "a4": (595.0, 842.0),
    "letter": (612.0, 792.0),
}

_MARGIN = 18.0  # points around the sheet
_GAP = 12.0  # points between cells


def _grid(layout: int, landscape: bool) -> tuple[int, int]:
    """Return (columns, rows) for the layout."""
    if layout == 2:
        return (2, 1) if landscape else (1, 2)
    if layout == 4:
        return (2, 2)
    if layout == 6:
        return (3, 2) if landscape else (2, 3)
    return (3, 3)


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
    """Lay source pages out on sheets in a grid."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"N-Up needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    raw_layout = get_option(options, SPEC, "layout")
    try:
        layout = int(str(raw_layout).strip())
    except (TypeError, ValueError):
        raise ToolError(
            "Option 'layout' must be one of: 2, 4, 6, 9.", code="bad_option"
        ) from None
    if layout not in (2, 4, 6, 9):
        raise ToolError(
            "Option 'layout' must be one of: 2, 4, 6, 9.", code="bad_option"
        )

    sheet = get_option(options, SPEC, "sheet")
    if sheet not in _SHEET_SIZES:
        raise ToolError(
            "Option 'sheet' must be 'a4' or 'letter'.", code="bad_option"
        )
    orientation = get_option(options, SPEC, "orientation")
    if orientation not in ("portrait", "landscape"):
        raise ToolError(
            "Option 'orientation' must be 'portrait' or 'landscape'.",
            code="bad_option",
        )

    sw, sh = _SHEET_SIZES[sheet]
    landscape = orientation == "landscape"
    if landscape:
        sw, sh = sh, sw
    cols, rows = _grid(layout, landscape)

    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    pages = list(reader.pages)

    cell_w = (sw - 2 * _MARGIN - (cols - 1) * _GAP) / cols
    cell_h = (sh - 2 * _MARGIN - (rows - 1) * _GAP) / rows
    if cell_w <= 0 or cell_h <= 0:
        raise ToolError("Sheet layout is unusable.", code="bad_option")

    writer = PdfWriter()
    for sheet_start in range(0, len(pages), layout):
        sheet_page = writer.add_blank_page(sw, sh)
        for cell in range(min(layout, len(pages) - sheet_start)):
            src = pages[sheet_start + cell]
            box = src.mediabox
            pw = float(box.right) - float(box.left)
            ph = float(box.top) - float(box.bottom)
            if pw <= 0 or ph <= 0:
                continue
            col = cell % cols
            row = cell // cols
            cell_x = _MARGIN + col * (cell_w + _GAP)
            # Rows fill from the top of the sheet.
            cell_y = sh - _MARGIN - (row + 1) * cell_h - row * _GAP
            scale = min(cell_w / pw, cell_h / ph)
            tx = cell_x + (cell_w - pw * scale) / 2.0
            ty = cell_y + (cell_h - ph * scale) / 2.0
            sheet_page.merge_transformed_page(
                src, Transformation().scale(scale, scale).translate(tx, ty)
            )

    out = ctx.new_output_path("n-up.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
