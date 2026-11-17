"""Combine exhibits into one filing-ready PDF.

Takes 2–20 PDFs (one per exhibit) and builds a single document:
- a slip sheet before each exhibit ("EXHIBIT A", original filename,
  page count), unless slip sheets are turned off;
- Bates-style numbers stamped on every exhibit page ("BATES-000001",
  counting up continuously across exhibits, slip sheets excluded).

Built on the same merge + page-stamp approach as the Merge and
Page Numbers tools instead of duplicating their logic.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_MARGIN = 36.0

SPEC = ToolSpec(
    key="exhibit_combine",
    name="Combine Exhibits",
    tagline="Filing-ready PDF with slip sheets and Bates numbers",
    description=(
        "Combine 2–20 PDFs into one filing-ready document: a slip sheet "
        "before each exhibit (Exhibit A, B, C…) with its filename and page "
        "count, and Bates-style numbers stamped on every exhibit page, "
        "counting continuously across exhibits."
    ),
    input_kinds=["pdf"],
    min_files=2,
    max_files=20,
    options=[
        ToolOption(
            name="exhibit_prefix",
            kind="text",
            label="Exhibit label",
            required=False,
            default="Exhibit",
            help="Word printed on each slip sheet, e.g. 'Exhibit'.",
        ),
        ToolOption(
            name="bates_prefix",
            kind="text",
            label="Bates prefix",
            required=False,
            default="BATES",
            help="Prefix for the stamped numbers, e.g. 'BATES' gives BATES-000001.",
        ),
        ToolOption(
            name="bates_start",
            kind="number",
            label="First Bates number",
            required=False,
            default=1,
            help="Numbering starts here (positive integer).",
        ),
        ToolOption(
            name="slip_sheets",
            kind="boolean",
            label="Add slip sheets between exhibits",
            required=False,
            default=True,
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)


def _exhibit_letter(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, ..."""
    letters = ""
    n = index
    while True:
        letters = chr(ord("A") + (n % 26)) + letters
        n = n // 26 - 1
        if n < 0:
            return letters


def _slip_sheet(width: float, height: float, label: str, filename: str, pages: int) -> object:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(width / 2, height / 2 + 24, label)
    c.setFont("Helvetica", 12)
    c.drawCentredString(width / 2, height / 2 - 8, filename)
    c.drawCentredString(width / 2, height / 2 - 28, f"{pages} page(s)")
    c.save()
    return PdfReader(buf).pages[0]


def _bates_stamp(width: float, height: float, text: str) -> object:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setFillColor(black)
    c.setFont("Helvetica", 10)
    c.drawRightString(width - _MARGIN, _MARGIN, text)
    c.save()
    return PdfReader(buf).pages[0]


def run(ctx: ToolContext, options: dict) -> Path:
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if not SPEC.min_files <= len(ctx.inputs) <= SPEC.max_files:
        raise ToolError(
            f"Combine Exhibits needs between {SPEC.min_files} and "
            f"{SPEC.max_files} PDF files; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )
    exhibit_prefix = str(get_option(options, SPEC, "exhibit_prefix") or "Exhibit").strip()
    bates_prefix = str(get_option(options, SPEC, "bates_prefix") or "BATES").strip()
    for label, value in (("exhibit_prefix", exhibit_prefix), ("bates_prefix", bates_prefix)):
        if not re.fullmatch(r"[A-Za-z0-9 _-]+", value):
            raise ToolError(
                f"Option '{label}' must be letters, numbers, spaces, hyphens or underscores.",
                code="invalid_option",
            )
    raw_start = get_option(options, SPEC, "bates_start")
    try:
        bates_start = int(raw_start)
    except (TypeError, ValueError):
        raise ToolError("Option 'bates_start' must be an integer.", code="invalid_option")
    if isinstance(raw_start, float) and not raw_start.is_integer():
        raise ToolError("Option 'bates_start' must be an integer.", code="invalid_option")
    if bates_start < 1:
        raise ToolError("Option 'bates_start' must be at least 1.", code="invalid_option")
    slip_sheets = bool(get_option(options, SPEC, "slip_sheets"))

    writer = PdfWriter()
    bates_number = bates_start
    for index, tool_input in enumerate(ctx.inputs):
        data = tool_input.path.read_bytes()
        reader = open_pdf_reader(data, tool_input.filename)
        page_count = len(reader.pages)
        first = reader.pages[0]
        width = float(first.mediabox.width)
        height = float(first.mediabox.height)
        if slip_sheets:
            label = f"{exhibit_prefix} {_exhibit_letter(index)}"
            writer.add_page(_slip_sheet(width, height, label, tool_input.filename, page_count))
        for page in reader.pages:
            stamp = _bates_stamp(
                float(page.mediabox.width),
                float(page.mediabox.height),
                f"{bates_prefix}-{bates_number:06d}",
            )
            page.merge_page(stamp)
            writer.add_page(page)
            bates_number += 1

    out = ctx.new_output_path("exhibits.pdf")
    with open(out, "wb") as f:
        writer.write(f)
    return out
