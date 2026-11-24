"""Extract tables from a PDF into an Excel workbook (.xlsx).

Hybrid engine (local, $0 — no paid API):

1. Per-page probe + multi-strategy extraction. Each page is probed
   (vector lines? text chars? image-only? rotated?) and pdfplumber is
   run with the ``lines``, ``text`` and ``lines_strict`` strategies;
   each candidate is scored (non-empty-cell ratio) and the best kept.
   Page rotation is normalised before extraction: pages whose text
   runs sideways (few upright chars) are re-tried at 90/180/270
   degrees via a rotated single-page copy, and the orientation whose
   text reads upright wins.
2. Camelot ``stream`` fallback. If all pdfplumber candidates score
   low on a text-bearing page (no tables, or a sparse/fragmented
   grid), Camelot ``stream`` is tried and whichever scores higher is
   kept. Camelot is optional: if it (or Ghostscript) is unavailable
   the pdfplumber result stands.
3. OCR path for image-only pages. A page with (near-)no text layer
   but a raster image is read with the shared OCR service
   (``pdfedi.tools._ocr``: 200 DPI, tesseract ``--oem 1``, PSM 3 with a
   PSM 11 retry on sparse pages); the recognised words are clustered
   into rows/columns by position. Only pages that need it are OCR'd,
   never the whole document.
4. AcroForm sheet. Where ``pypdf.get_fields()`` finds form fields, a
   "Form data" sheet lists label/value pairs and checkbox states.
5. Post-processing. All-empty rows/columns are dropped; merged
   cells are rebuilt from pdfplumber's ``None`` span markers via
   openpyxl ``merge_cells()``; numbers, currency, percentages and
   ISO dates become real Excel values so columns sum and sort; a
   table split across pages (same column count + repeated header)
   is stitched into one sheet; and when no table is found anywhere
   in the document, a "Notes" sheet in the workbook says so instead
   of silently succeeding.

Pages with no detectable tables fall back to their text lines in a
single column ("Page N (text)"); pages that yield nothing at all get
a "Page N (empty)" marker sheet, so no page is silently dropped.
If the whole document has no tables and no text, the job is refused
with a pointer to OCR, as before.

Honest limits, stated in the tool copy: borderless tables are
detected from text alignment and are approximate; OCR'd values can
be misread and should be checked; merged cells, formulas and charts
are not preserved.
"""
from __future__ import annotations

import datetime
import io
import logging
import re
import shutil
import statistics
import tempfile
from pathlib import Path

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools._ocr import (
    ocr_page as _shared_ocr_page,
    quality_note as _shared_quality_note,
    validate_language,
)
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

log = logging.getLogger(__name__)

SPEC = ToolSpec(
    key="pdf_to_excel",
    name="PDF to Excel",
    tagline="Extract tables from a PDF into a spreadsheet",
    description=(
        "Extract tables from a PDF into an Excel (.xlsx) workbook — one sheet "
        "per page that has tables. Ruled and borderless tables are detected "
        "from lines and text alignment; scanned pages are read with built-in "
        "OCR, and form fields get their own sheet. Numbers, currency and "
        "dates become real spreadsheet values. If no table is found, the "
        "workbook says so on a Notes sheet instead of silently succeeding."
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
        ToolOption(
            name="language",
            kind="text",
            label="Language",
            required=False,
            default="eng",
            help="Tesseract language code, e.g. 'eng' or 'eng+deu'.",
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
# A page with fewer native-text chars than this is treated as scanned
# (same threshold as the OCR tool's page_needs_ocr default).
_OCR_MIN_TEXT_CHARS = 50
_OCR_TIMEOUT = 120
# Camelot is tried when the best pdfplumber candidate is sparse: no
# tables at all, or a non-empty-cell ratio below this.
_CAMELOT_MIN_RATIO = 0.75
# A page counts as rotated when fewer than half its chars are upright.
_ROTATED_UPRIGHT_MAX = 0.5

_STRATEGIES: dict[str, dict] = {
    "lines": {},
    "text": {"vertical_strategy": "text", "horizontal_strategy": "text"},
    "lines_strict": {
        "vertical_strategy": "lines_strict",
        "horizontal_strategy": "lines_strict",
    },
}

_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_PERCENT_RE = re.compile(r"^(-?[\d,]+(?:\.\d+)?)%$")
_CURRENCY_RE = re.compile(r"^([$€£])\s*(-?[\d,]+(?:\.\d+)?)$")
_INT_RE = re.compile(r"^-?\d[\d,]*$")
_FLOAT_RE = re.compile(r"^-?[\d,]+\.\d+$")

# A cell value is one grid entry from an extractor: str, or None where
# pdfplumber marks a cell covered by a merged span (a genuinely empty
# cell comes back as "").
Grid = list[list]


def _clean(value) -> str | None:
    """Normalise one extracted cell: None stays None (span marker)."""
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text


def _normalise_tables(tables: list[Grid]) -> list[Grid]:
    """Drop all-empty rows/columns from each table; drop empty tables."""
    out: list[Grid] = []
    for table in tables:
        rows = [[_clean(c) for c in row] for row in table]
        if not rows:
            continue
        width = max(len(r) for r in rows)
        rows = [r + [None] * (width - len(r)) for r in rows]
        rows = [r for r in rows if any(c not in (None, "") for c in r)]
        if not rows:
            continue
        keep_cols = [
            c
            for c in range(width)
            if any(rows[r][c] not in (None, "") for r in range(len(rows)))
        ]
        if not keep_cols:
            continue
        out.append([[r[c] for c in keep_cols] for r in rows])
    return out


def _score_tables(tables: list[Grid]) -> tuple[float, int, int, float]:
    """Score a candidate: (score, non_empty, cells, ratio).

    score = non_empty * ratio**2 rewards dense, well-filled grids and
    penalises the over-segmented grids the text strategy can produce
    (many cells, mostly empty). A perfect 5x5 table scores 25.
    """
    cells = sum(len(r) for t in tables for r in t)
    if cells == 0:
        return 0.0, 0, 0, 0.0
    non_empty = sum(
        1 for t in tables for r in t for c in r if c not in (None, "")
    )
    ratio = non_empty / cells
    return non_empty * ratio * ratio, non_empty, cells, ratio


def _extract_with_settings(page, settings: dict) -> list[Grid]:
    try:
        return page.extract_tables(table_settings=settings) or []
    except Exception:
        return []


def _pdfplumber_candidates(page) -> list[tuple[list[Grid], float, float, int, int]]:
    """One candidate per pdfplumber strategy: (tables, score, ratio, ne, cells)."""
    candidates: list[tuple[list[Grid], float, float, int, int]] = []
    for settings in _STRATEGIES.values():
        tables = _normalise_tables(_extract_with_settings(page, settings))
        if not tables:
            continue
        score, ne, cells, ratio = _score_tables(tables)
        candidates.append((tables, score, ratio, ne, cells))
    return candidates


def _select_best(candidates) -> tuple[list[Grid], float, float]:
    """Pick the winning candidate: (tables, score, ratio).

    Highest non-empty-cell ratio wins — but a strategy that splits one
    value into two cells ("Item 1" -> "Item" | "1") inflates its cell
    count at (near-)equal ratio, so among candidates within 0.02 of
    the best ratio the one with the fewest cells wins (a candidate
    must also carry at least half the best non-empty count, so a
    spurious 1-cell "table" cannot beat a real table on ratio alone).
    """
    if not candidates:
        return [], 0.0, 0.0
    # A candidate with fewer than 2 non-empty cells is prose, not a
    # table — Camelot stream returns a 1x1 "table" holding a lone
    # text line, which must fall through to the text-lines fallback.
    # Likewise a single-column candidate is a text dump, not a table:
    # prose lines land in one column, so they must not count as a
    # detected table (or the no-table warning would never fire).
    def _width(tables):
        return max((len(r) for t in tables for r in t), default=0)

    candidates = [
        c for c in candidates if c[3] >= 2 and _width(c[0]) >= 2
    ]
    if not candidates:
        return [], 0.0, 0.0
    best_ratio = max(c[2] for c in candidates)
    tied = [c for c in candidates if c[2] >= best_ratio - 0.02]
    max_ne = max(c[3] for c in tied)
    tied = [c for c in tied if c[3] >= 0.5 * max_ne]
    tied.sort(key=lambda c: (c[4], -c[3]))
    tables, score, ratio, _ne, _cells = tied[0]
    return tables, score, ratio


def _upright_ratio(page) -> float:
    """Fraction of the page's chars that read upright (1.0 = normal)."""
    try:
        chars = page.chars or []
    except Exception:
        return 1.0
    if not chars:
        return 1.0
    upright = sum(1 for c in chars if c.get("upright"))
    return upright / len(chars)


def _single_page_rotated(data: bytes, page_index: int, degrees: int) -> io.BytesIO:
    """One-page PDF containing page ``page_index`` rotated by degrees."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    page = reader.pages[page_index]
    page.rotate(degrees)
    writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)
    return buf


def _camelot_tables(tmp_pdf: Path, page_no: int) -> list[Grid]:
    """Camelot ``stream`` tables for one page, or [] if unavailable."""
    try:
        import camelot
    except ImportError:
        return []
    try:
        tables = camelot.read_pdf(
            str(tmp_pdf), flavor="stream", pages=str(page_no)
        )
    except Exception as exc:  # noqa: BLE001 - fallback is best-effort
        log.info("camelot stream failed on page %d: %s", page_no, exc)
        return []
    out: list[Grid] = []
    for table in tables:
        try:
            df = table.df
        except Exception:
            continue
        rows = [
            [_clean(v) if str(v).strip().lower() != "nan" else "" for v in row]
            for row in df.values.tolist()
        ]
        out.append(rows)
    return _normalise_tables(out)


def _ocr_grid(data: bytes, page_index: int, tmpdir: Path,
              lang: str = "eng"):
    """Cluster shared-service OCR words on one image-only page into a grid.

    Groups words into rows by their vertical position, then into cells by
    horizontal gaps. Returns (grid, result) where result is the shared
    service's :class:`OcrPageResult` (or None when OCR is unavailable);
    the caller uses it for the quality notes. Returns ([], None) when
    OCR finds (near-)nothing.
    """
    try:
        result = _shared_ocr_page(
            data, page_index, lang=lang, timeout=_OCR_TIMEOUT, tmpdir=tmpdir,
        )
    except Exception as exc:  # noqa: BLE001 - OCR is best-effort
        log.info("ocr failed on page %d: %s", page_index + 1, exc)
        return [], None
    words = [
        {"t": w.text, "x": w.x, "y": w.y, "w": w.w, "h": w.h}
        for w in result.words
    ]
    if len(words) < 3:
        return [], result
    med_h = statistics.median(w["h"] for w in words) or 10
    row_tol = max(10.0, med_h * 0.9)
    gap_thresh = max(18.0, med_h * 1.2)
    words.sort(key=lambda w: (w["y"], w["x"]))
    rows: list[list[dict]] = [[words[0]]]
    for word in words[1:]:
        cur = rows[-1]
        cur_y = statistics.median([c["y"] for c in cur])
        if abs(word["y"] - cur_y) <= row_tol:
            cur.append(word)
        else:
            rows.append([word])
    grid: list[list[str]] = []
    for row in rows:
        row.sort(key=lambda w: w["x"])
        cells = [row[0]["t"]]
        prev_end = row[0]["x"] + row[0]["w"]
        for word in row[1:]:
            if word["x"] - prev_end > gap_thresh:
                cells.append(word["t"])
            else:
                cells[-1] += " " + word["t"]
            prev_end = max(prev_end, word["x"] + word["w"])
        grid.append(cells)
    width = max(len(r) for r in grid)
    grid = [r + [""] * (width - len(r)) for r in grid]
    grid = [r for r in grid if any(c.strip() for c in r)]
    return grid, result


def _ocr_quality_note(page_no: int, result) -> str | None:
    """Quality note for an OCR'd page, or None when the OCR looks good."""
    if result is None:
        return None
    note = _shared_quality_note(page_no, result)
    if note is None:
        return None
    # Excel values come from OCR text: tell the user to check them.
    if result.word_count == 0:
        return f"Page {page_no} — OCR found no readable text."
    return note[0].upper() + note[1:] + "; check values before relying on them."


def _form_fields(reader) -> list[tuple[str, str]]:
    """AcroForm label/value pairs, checkbox states included.

    Returns [] for documents without form fields (the common case).
    """
    try:
        fields = reader.get_fields() or {}
    except Exception:
        return []
    out: list[tuple[str, str]] = []
    for name, field in fields.items():
        try:
            field_type = str(field.get("/FT", ""))
            label = field.get("/TU") or field.get("/T") or name
            label = str(label).strip() or str(name)
            raw = field.get("/V")
            if field_type == "/Btn":
                # Checkbox / radio: /V is /Yes (on) or /Off (off).
                value = "Checked" if raw not in (None, "/Off", "Off", "") else "Unchecked"
            else:
                if raw is None or str(raw).strip() == "":
                    continue
                value = str(raw).strip()
            out.append((label, value))
        except Exception:
            continue
    return out


def _merge_ranges(table: Grid) -> list[tuple[int, int, int, int]]:
    """Merged ranges (r0, c0, r1, c1) rebuilt from None span markers.

    pdfplumber returns None only for cells covered by a span (a
    genuinely empty cell comes back as ""); a None is merged into the
    value cell to its left (column span) or above it (row span) when
    exactly one direction is a clean continuation of that value's
    own span. Ambiguous corners are left unmerged.
    """
    n_rows = len(table)
    if n_rows == 0:
        return []
    n_cols = max(len(r) for r in table)
    origin: list[list[tuple[int, int] | None]] = [
        [None] * n_cols for _ in range(n_rows)
    ]
    kind: dict[tuple[int, int], str] = {}
    ranges: dict[tuple[int, int], list[int]] = {}
    for r in range(n_rows):
        for c in range(n_cols):
            value = table[r][c] if c < len(table[r]) else None
            if value is not None:
                origin[r][c] = (r, c)
                kind[(r, c)] = "single"
                ranges[(r, c)] = [r, c, r, c]
                continue
            left = origin[r][c - 1] if c > 0 else None
            above = origin[r - 1][c] if r > 0 else None
            horiz = (
                left is not None
                and left[0] == r
                and kind.get(left) in ("single", "h")
            )
            vert = (
                above is not None
                and above[1] == c
                and kind.get(above) in ("single", "v")
            )
            if horiz and not vert:
                origin[r][c] = left
                kind[left] = "h"
                ranges[left][3] = c
            elif vert and not horiz:
                origin[r][c] = above
                kind[above] = "v"
                ranges[above][2] = r
            else:
                origin[r][c] = None
    return [
        (r0, c0, r1, c1)
        for (r0, c0, r1, c1) in ranges.values()
        if r1 > r0 or c1 > c0
    ]


_CURRENCY_FORMATS = {"$": '"$"#,##0.00', "€": '"€"#,##0.00', "£": '"£"#,##0.00'}


def _type_value(value: str):
    """Convert a cell string to a real Excel value, or return it as-is.

    Returns (value, number_format_or_None). ISO dates become dates,
    currency/percentages become numbers, plain integers/floats become
    numbers. Strings with leading zeros (e.g. "007") are left alone
    so codes are not mangled.
    """
    text = value.strip()
    if not text:
        return "", None
    match = _DATE_RE.match(text)
    if match:
        try:
            return datetime.date.fromisoformat(text), "yyyy-mm-dd"
        except ValueError:
            return text, None
    match = _PERCENT_RE.match(text)
    if match:
        try:
            number = float(match.group(1).replace(",", "")) / 100.0
        except ValueError:
            return text, None
        fmt = "0.00%" if "." in match.group(1) else "0%"
        return number, fmt
    match = _CURRENCY_RE.match(text)
    if match:
        try:
            number = float(match.group(2).replace(",", ""))
        except ValueError:
            return text, None
        return number, _CURRENCY_FORMATS[match.group(1)]
    if _INT_RE.match(text) and not (len(text.lstrip("-")) > 1 and text.lstrip("-").startswith("0")):
        try:
            return int(text.replace(",", "")), "#,##0"
        except ValueError:
            return text, None
    if _FLOAT_RE.match(text):
        try:
            return float(text.replace(",", "")), "#,##0.00"
        except ValueError:
            return text, None
    return text, None


def _write_table_rows(sheet, table, start_row, first_row_header, bold, typed=True):
    """Write one table's rows; returns the next free row number.

    Merged spans are rebuilt from None markers; each table's first
    row is bolded when first_row_header is on.
    """
    merges = _merge_ranges(table)
    row_no = start_row
    for r_idx, row in enumerate(table):
        is_header = first_row_header and r_idx == 0
        for c_idx, raw in enumerate(row):
            value = "" if raw is None else raw
            if typed and not is_header:
                typed_value, fmt = _type_value(value)
            else:
                typed_value, fmt = value, None
            cell = sheet.cell(row=row_no, column=c_idx + 1, value=typed_value)
            if fmt:
                cell.number_format = fmt
            if is_header:
                cell.font = bold
        row_no += 1
    for (r0, c0, r1, c1) in merges:
        sheet.merge_cells(
            start_row=start_row + r0,
            start_column=c0 + 1,
            end_row=start_row + r1,
            end_column=c1 + 1,
        )
    return row_no


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
    language = validate_language(get_option(options, SPEC, "language") or "eng")

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

    form_fields = _form_fields(reader)

    wb = Workbook()
    # openpyxl starts with one default sheet; reuse it for page 1.
    default_sheet = wb.active
    assert default_sheet is not None
    sheets_used = 0
    any_text = False
    any_table = False
    bold = Font(bold=True)
    # Per-page notes for the "Notes" sheet (only written when the
    # document contains no table at all — see below).
    page_notes: list[tuple[int, str]] = []
    # OCR quality warnings: unlike page_notes these are ALWAYS written to
    # a Notes sheet when non-empty — a low-confidence or empty OCR page
    # must be flagged even when other pages have tables.
    ocr_notes: list[tuple[int, str]] = []
    # Stitching state: the last table sheet, its header row and width.
    stitch_sheet = None
    stitch_header: tuple | None = None
    stitch_ncols: int | None = None
    stitch_next_row = 0
    # Camelot needs a file path; write the input once, lazily.
    tmp_pdf_path: Path | None = None
    tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-xlsx-"))
    # Rotated single-page PDFs opened for deskewed pages; closed at
    # the end of the job (their pages must stay alive while extracted).
    extra_pdfs: list = []

    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for i, page in enumerate(pdf.pages):
                # --- probe -------------------------------------------------
                try:
                    text_len = len((page.extract_text() or "").strip())
                except Exception:
                    text_len = 0
                try:
                    n_images = len(page.images or [])
                except Exception:
                    n_images = 0

                # --- rotation normalisation ------------------------------
                # A page whose chars are mostly not upright was drawn
                # rotated (content-stream rotation or /Rotate). Re-try
                # it at 90/180/270 degrees and keep the first
                # orientation whose text reads upright; the choice is
                # made on upright chars alone, not on table scores
                # (a garbled extraction can score as well as a good
                # one on cell counts alone).
                if text_len > 0 and _upright_ratio(page) < _ROTATED_UPRIGHT_MAX:
                    for degrees in (90, 180, 270):
                        try:
                            rotated = _single_page_rotated(data, i, degrees)
                            rpdf = pdfplumber.open(rotated)
                            rpage = rpdf.pages[0]
                            if _upright_ratio(rpage) >= 0.9:
                                extra_pdfs.append(rpdf)
                                page = rpage
                            else:
                                rpdf.close()
                            if _upright_ratio(page) >= 0.9:
                                break
                        except Exception:
                            continue

                candidates = _pdfplumber_candidates(page)
                tables, score, ratio = _select_best(candidates)

                # --- Camelot stream fallback ------------------------------
                # Only on text-bearing pages where pdfplumber came up
                # sparse; Camelot joins the candidate pool and the
                # same selection rule picks the winner.
                if text_len >= 20 and (not tables or ratio < _CAMELOT_MIN_RATIO):
                    if tmp_pdf_path is None:
                        tmp_pdf_path = tmpdir / "input.pdf"
                        tmp_pdf_path.write_bytes(data)
                    camelot_tables = _camelot_tables(tmp_pdf_path, i + 1)
                    if camelot_tables:
                        c_score, c_ne, c_cells, c_ratio = _score_tables(camelot_tables)
                        candidates.append(
                            (camelot_tables, c_score, c_ratio, c_ne, c_cells)
                        )
                        tables, score, ratio = _select_best(candidates)

                # --- cap work per page ------------------------------------
                cell_total = sum(len(r) for t in tables for r in t)
                if cell_total > _MAX_CELLS_PER_PAGE:
                    tables = tables[:1]

                if tables:
                    any_text = True
                    any_table = True
                    # Stitch: a single table whose header and width
                    # match the previous page's table continues it.
                    header = tuple(
                        "" if c is None else str(c) for c in tables[0][0]
                    ) if tables[0] else ()
                    ncols = max(len(r) for t in tables for r in t)
                    if (
                        len(tables) == 1
                        and stitch_sheet is not None
                        and stitch_header == header
                        and stitch_ncols == ncols
                    ):
                        row_no = _write_table_rows(
                            stitch_sheet, tables[0][1:], stitch_next_row,
                            first_row_header=False, bold=bold,
                        )
                        stitch_next_row = row_no
                        continue
                    sheet = default_sheet if sheets_used == 0 else wb.create_sheet()
                    sheet.title = f"Page {i + 1}"
                    row_no = 1
                    for t in tables:
                        row_no = _write_table_rows(
                            sheet, t, row_no, first_row_header, bold
                        )
                    sheets_used += 1
                    stitch_sheet = sheet
                    stitch_header = header
                    stitch_ncols = ncols
                    stitch_next_row = row_no
                    continue

                # No tables on this page.
                stitch_sheet = None
                stitch_header = None
                stitch_ncols = None

                # --- OCR path for image-only pages -----------------------
                if text_len < _OCR_MIN_TEXT_CHARS and n_images > 0:
                    ocr_grid, ocr_result = _ocr_grid(data, i, tmpdir, lang=language)
                    if ocr_grid:
                        any_text = True
                        sheet = default_sheet if sheets_used == 0 else wb.create_sheet()
                        sheet.title = f"Page {i + 1} (OCR)"
                        _write_table_rows(
                            sheet, ocr_grid, 1, first_row_header, bold
                        )
                        sheets_used += 1
                        page_notes.append(
                            (i + 1, "Scanned page — text recovered by OCR; check values before relying on them.")
                        )
                        warning = _ocr_quality_note(i + 1, ocr_result)
                        if warning is not None:
                            ocr_notes.append((i + 1, warning))
                        continue
                    page_notes.append(
                        (i + 1, "Scanned page — OCR found no readable text.")
                    )
                    ocr_notes.append(
                        (i + 1, "Scanned page — OCR found no readable text.")
                    )

                # --- text-lines fallback ----------------------------------
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
                    page_notes.append(
                        (i + 1, "No table detected — showing text lines.")
                    )
                    continue

                # --- nothing on this page ---------------------------------
                sheet = default_sheet if sheets_used == 0 else wb.create_sheet()
                sheet.title = f"Page {i + 1} (empty)"
                sheet.cell(
                    row=1, column=1,
                    value="No content could be extracted from this page.",
                )
                sheets_used += 1
                page_notes.append(
                    (i + 1, "No content could be extracted from this page.")
                )

        if not any_text:
            raise ToolError(
                f"'{filename}' has no extractable tables or text — it may be scanned "
                "and OCR found no readable text.",
                code="no_text",
            )
        if sheets_used == 0:  # pragma: no cover - guarded by any_text above
            raise ToolError("No tables or text could be extracted.", code="no_text")

        # --- AcroForm sheet ----------------------------------------------
        if form_fields:
            sheet = wb.create_sheet()
            sheet.title = "Form data"
            sheet.cell(row=1, column=1, value="Field").font = bold
            sheet.cell(row=1, column=2, value="Value").font = bold
            for r_idx, (label, value) in enumerate(form_fields, start=2):
                sheet.cell(row=r_idx, column=1, value=label)
                sheet.cell(row=r_idx, column=2, value=value)

        # --- Notes sheet: warn when no table was found at all -----------
        # jobs.py has no warning channel (ToolContext carries no
        # warnings field and Job has no warning column), so the warning
        # lives in the workbook itself, where the user will see it.
        # OCR quality warnings are always written (even when other pages
        # have tables); the informational page notes only when no table
        # was found anywhere.
        if (not any_table and page_notes) or ocr_notes:
            sheet = wb.create_sheet()
            sheet.title = "Notes"
            sheet.cell(row=1, column=1, value="Page").font = bold
            sheet.cell(row=1, column=2, value="Note").font = bold
            note_rows = list(page_notes) if not any_table else []
            note_rows.extend(ocr_notes)
            for r_idx, (page_no, note) in enumerate(note_rows, start=2):
                sheet.cell(row=r_idx, column=1, value=f"Page {page_no}")
                sheet.cell(row=r_idx, column=2, value=note)

        out = ctx.new_output_path("spreadsheet.xlsx").with_suffix(".xlsx")
        wb.save(str(out))
        return out
    finally:
        for extra in extra_pdfs:
            try:
                extra.close()
            except Exception:
                pass
        shutil.rmtree(tmpdir, ignore_errors=True)
