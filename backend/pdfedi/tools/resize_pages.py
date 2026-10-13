"""Resize every page of a PDF to a standard page size (A4, A5, Letter, Legal)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation

from pdfedi.tools._helpers import PAGE_SIZES_PT, open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="resize_pages",
    name="Resize Pages",
    tagline="Change page size to A4, Letter and more",
    description=(
        "Resize every page of a PDF to a standard page size. 'Fit' scales the "
        "page content to fit inside the new size while keeping its proportions; "
        "'Stretch' fills the new page size exactly."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="size",
            kind="select",
            label="Page size",
            required=True,
            default=None,
            choices=["a4", "a5", "letter", "legal"],
            help="Target page size for every page.",
        ),
        ToolOption(
            name="mode",
            kind="select",
            label="Content mode",
            required=False,
            default="fit",
            choices=["fit", "stretch"],
            help="'fit' keeps the content's proportions, centred. "
            "'stretch' fills the new page exactly.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)


def run(ctx: ToolContext, options: dict) -> Path:
    """Resize every page to the target size, scaling content accordingly."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Resize needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    raw_size = get_option(options, SPEC, "size")
    size_key = str(raw_size).strip().lower() if raw_size is not None else ""
    if size_key not in PAGE_SIZES_PT:
        raise ToolError(
            "Option 'size' must be one of: a4, a5, letter, legal.",
            code="bad_option",
        )
    tw, th = PAGE_SIZES_PT[size_key]

    mode = get_option(options, SPEC, "mode")
    if mode not in ("fit", "stretch"):
        raise ToolError(
            "Option 'mode' must be 'fit' or 'stretch'.", code="bad_option"
        )

    tool_input = ctx.inputs[0]
    reader = open_pdf_reader(tool_input.path.read_bytes(), tool_input.filename)

    writer = PdfWriter()
    for page in reader.pages:
        box = page.mediabox
        sw = float(box.right) - float(box.left)
        sh = float(box.top) - float(box.bottom)
        if sw <= 0 or sh <= 0:
            raise ToolError(
                "A page has no usable size; cannot resize.", code="invalid_input"
            )
        if mode == "fit":
            scale = min(tw / sw, th / sh)
            sx = sy = scale
            tx = (tw - sw * scale) / 2.0
            ty = (th - sh * scale) / 2.0
        else:
            sx, sy = tw / sw, th / sh
            tx = ty = 0.0
        new_page = writer.add_blank_page(tw, th)
        new_page.merge_transformed_page(
            page, Transformation().scale(sx, sy).translate(tx, ty)
        )

    out = ctx.new_output_path("resized.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
