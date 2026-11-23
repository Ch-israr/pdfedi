"""Extract tables from a PDF into an Excel workbook (.xlsx).

pdfplumber's table detection (ruled lines + text alignment) pulls real
tables out of each page; one sheet per page that has tables. Pages with no
detectable tables fall back to their text lines in a single column, so
nothing is silently lost — the sheet is named "Page N (text)" in that case.
If the whole document has no tables and no text, the job is refused with a
pointer to OCR.

Honest limits, stated in the tool copy: unruled / borderless tables are
detected from text alignment and come out approximate; merged cells,
formulas and charts are not preserved; scanned PDFs have no tables to find.
"""
from __future__ import annotations

import io
from pathlib import Path

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="pdf_to_excel",
    name="PDF to Excel",
    tagline="Extract tables from a PDF into a spreadsheet",
    description=(
        "Extract tables from a PDF into an Excel (.xlsx) workbook — one sheet "
        "per page that has tables. Ruled tables come out clean; borderless "
        "tables are detected from text alignment and are approximate. Pages "
        "with no tables fall back to their text lines in a single column. "
        "Scanned PDFs with no text layer should go through the OCR tool first."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="first_row_header",
            kind="boolean",
            label="First row is a header",
            required=False,
            default=True,
            help="Bold the first row of each detected table.",
        ),
    ],
    output_kind="document",
    output_ext="xlsx",
    output_mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    activity="converting",
    category="convert",
)

_PAGE_CAP = 50
_MAX_CELLS_PER_PAGE = 20_000


def run(ctx: ToolContext, options: dict) -> Path:
    """Extract tables page by page into an .xlsx workbook."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to Excel needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )
    first_row_header = bool(get_option(options, SPEC, "first_row_header"))

    try:
        import pdfplumber
    except ImportError as exc:
        raise ToolError(
            "Table extraction is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font
    except ImportError as exc:
        raise ToolError(
            "Spreadsheet export is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    tool_input = ctx.inputs[0]
    data = tool_input.path.read_bytes()
    filename = tool_input.filename
    reader = open_pdf_reader(data, filename)
    page_count = len(reader.pages)
    if page_count > _PAGE_CAP:
        raise ToolError(
            f"PDF to Excel supports at most {_PAGE_CAP} pages per job.",
            code="too_many_pages",
        )

    wb = Workbook()
    # openpyxl starts with one default sheet; reuse it for page 1.
    default_sheet = wb.active
    assert default_sheet is not None
    sheets_used = 0
    any_text = False
    bold = Font(bold=True)

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages):
            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []
            # Cap work per page: a pathological page must not blow memory.
            cell_total = sum(len(r) for t in tables for r in t)
            if cell_total > _MAX_CELLS_PER_PAGE:
                tables = tables[:1]
            rows: list[list] = []
            for t in tables:
                for r in t:
                    rows.append([(c if c is not None else "") for c in r])
            if rows:
                any_text = True
                sheet = default_sheet if sheets_used == 0 else wb.create_sheet()
                sheet.title = f"Page {i + 1}"
                for r_idx, row in enumerate(rows, start=1):
                    for c_idx, value in enumerate(row, start=1):
                        cell = sheet.cell(row=r_idx, column=c_idx, value=value)
                        if first_row_header and r_idx == 1:
                            cell.font = bold
                sheets_used += 1
                continue
            # No tables on this page: text-lines fallback, one column.
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            lines = [ln for ln in text.splitlines() if ln.strip()]
            if lines:
                any_text = True
                sheet = default_sheet if sheets_used == 0 else wb.create_sheet()
                sheet.title = f"Page {i + 1} (text)"
                for r_idx, line in enumerate(lines, start=1):
                    sheet.cell(row=r_idx, column=1, value=line)
                sheets_used += 1

    if not any_text:
        raise ToolError(
            f"'{filename}' has no extractable tables or text — it may be scanned. "
            "Use the OCR tool first to make it searchable, then convert.",
            code="no_text",
        )
    if sheets_used == 0:  # pragma: no cover - guarded by any_text above
        raise ToolError("No tables or text could be extracted.", code="no_text")

    out = ctx.new_output_path("spreadsheet.xlsx").with_suffix(".xlsx")
    wb.save(str(out))
    return out
