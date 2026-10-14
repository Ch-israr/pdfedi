"""Shared helpers for tool modules (page-range parsing). Pure functions only."""
from __future__ import annotations

import re

from pdfedi.tools.base import ToolError

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")

# Page sizes in PDF points (1/72 inch), shared by tools that offer them.
# Superset of n_up's _SHEET_SIZES and resize_pages' _SIZES (values identical).
PAGE_SIZES_PT: dict[str, tuple[float, float]] = {
    "a4": (595.0, 842.0),
    "a5": (420.0, 595.0),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
}


def parse_page_ranges(spec: str) -> list[int]:
    """Parse a 1-based inclusive page-range string like ``"1-3,5,8-10"``.

    Returns a sorted list of unique page numbers. Raises ToolError on any
    malformed token.
    """
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "Page range must be a non-empty string like '1-3,5'.",
            code="invalid_option",
        )
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid page range token {token.strip()!r}. "
                "Use forms like '1-3,5,8-10'.",
                code="invalid_option",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("Page numbers start at 1.", code="invalid_option")
        if end < start:
            raise ToolError(
                f"Invalid range {start}-{end}: end is before start.",
                code="invalid_option",
            )
        pages.update(range(start, end + 1))
    return sorted(pages)


def resolve_pages(spec: str | None, page_count: int) -> list[int]:
    """Resolve a page-range spec against a document.

    ``None`` (or an empty string) means all pages. Returns 1-based page
    numbers in ascending order. Raises ToolError if any page is out of range.
    """
    if spec is None or (isinstance(spec, str) and not spec.strip()):
        return list(range(1, page_count + 1))
    pages = parse_page_ranges(spec)
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            f"Page(s) {out_of_range} exceed the document page count "
            f"({page_count}).",
            code="invalid_option",
        )
    return pages


def read_input_bytes(ctx_inputs_path) -> bytes:
    """Read an input file's bytes, raising ToolError if unreadable."""
    try:
        return ctx_inputs_path.read_bytes()
    except OSError as exc:
        raise ToolError(
            f"Could not read input file: {exc}", code="invalid_input"
        ) from exc


def open_pdf_reader(
    data: bytes, filename: str, *, encrypted_code: str = "encrypted_pdf"
):
    """Parse and validate PDF bytes, returning a pypdf PdfReader.

    Shared replacement for the identical ``_open_reader`` previously copied
    into 12 tools (compare, crop, delete_pages, extract_images,
    merge, n_up, pdf_to_word, reorder_pages, resize_pages, rotate_pages,
    split) and for 5 same-shape inline validation sites (watermark,
    page_numbers, flatten, password_protect, redact).

    ``encrypted_code`` preserves each tool's observable error code:
    most tools use ``"encrypted_pdf"``; the 5 inline sites use
    ``"invalid_input"`` for encrypted inputs.

    DELIBERATE CONSISTENCY FIX (see audit-2026-10-13/CHANGELOG.md): parse
    failures are mapped to ``ToolError(code="invalid_input")`` everywhere.
    The 5 inline sites previously let a corrupt-PDF parse failure propagate
    as a raw pypdf exception; they now raise a clean ToolError like the
    other tools. The unlock_pdf / metadata / edit_metadata / ocr sites are
    genuinely different and intentionally left untouched.
    """
    from io import BytesIO

    from pypdf import PdfReader

    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            f"'{filename}' is not a valid PDF file.", code="invalid_input"
        )
    try:
        reader = PdfReader(BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be parsed as a PDF: {exc}",
            code="invalid_input",
        ) from exc
    if getattr(reader, "is_encrypted", False):
        raise ToolError(
            f"'{filename}' is password-protected; encrypted PDFs are not supported.",
            code=encrypted_code,
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            f"Could not read the pages of '{filename}': {exc}",
            code="invalid_input",
        ) from exc
    if count == 0:
        raise ToolError(f"'{filename}' contains no pages.", code="invalid_input")
    return reader


def page_count_of_pdf(data: bytes) -> int:
    """Return the page count of PDF bytes, raising ToolError if unparsable."""
    from pypdf import PdfReader

    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "Input is not a valid PDF file (missing %PDF- header).",
            code="invalid_input",
        )
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        if getattr(reader, "is_encrypted", False):
            raise ToolError(
                "This PDF is encrypted; tools cannot process it without "
                "the password.",
                code="encrypted_input",
            )
        return len(reader.pages)
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            f"Input could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc


def _inflate_rows(enc: bytes, width: int, height: int, n: int, row_step: int):
    """Inflate a Flate stream keeping every ``row_step``-th row.

    Returns (bytearray, kept_height) or None. Avoids pypdf get_data()'s
    ~2.2x transient on 100MB+ images: output is pulled in 1MB slices and
    only kept rows are stored, so peak ~= (full_size/row_step)*2 + 1MB.
    Rows must be exactly width*n bytes (PNG predictors are rejected by
    the caller); total output must equal height*width*n exactly.
    """
    import zlib

    row_len = width * n
    if row_len <= 0 or height <= 0 or row_step < 1:
        return None
    try:
        d = zlib.decompressobj()
        out = bytearray()
        carry = b""
        row_idx = 0
        total = 0
        pending = b""
        i = 0
        step = 1 << 20
        guard = 0
        while True:
            guard += 1
            if guard > 40_000_000:
                return None
            if not pending:
                if i >= len(enc):
                    break
                pending = enc[i : i + step]
                i += step
            chunk = d.decompress(pending, step)
            pending = d.unconsumed_tail
            if chunk:
                total += len(chunk)
                if total > height * row_len:
                    return None
                buf = carry + chunk if carry else chunk
                nrows = len(buf) // row_len
                base = row_idx
                for r in range(nrows):
                    if (base + r) % row_step == 0:
                        out += buf[r * row_len : (r + 1) * row_len]
                row_idx += nrows
                carry = buf[nrows * row_len :]
            if d.eof:
                break
            if not chunk and not pending and i >= len(enc):
                break
        if not d.eof:
            return None
        if total != height * row_len or row_idx != height or carry:
            return None
        kept_h = (height + row_step - 1) // row_step
        return (out, kept_h)
    except Exception:
        return None


def _iccbased_params(img_obj):
    """Strict dict validation for /ICCBased image XObjects.

    Returns (mode, width, height, ncomp, filter_names) for 8-bits/component
    images whose ICC profile stream declares /N components
    (1 -> "L", 3 -> "RGB", 4 -> "CMYK"), else None. Only FlateDecode or
    unfiltered streams qualify — the manual inflater cannot handle other
    filters (see the gate at the end). PNG predictors are rejected (kept
    rows must be exactly width*ncomp bytes). No color-profile conversion
    is attempted; whether the profile is preserved on output is the
    caller's decision. The /ColorSpace may be an IndirectObject to the
    ICCBased array.
    """
    from pypdf.generic import ArrayObject

    try:
        cs = img_obj.get("/ColorSpace")
        if hasattr(cs, "get_object"):
            cs = cs.get_object()
        if not (
            isinstance(cs, ArrayObject)
            and len(cs) >= 2
            and str(cs[0]) == "/ICCBased"
        ):
            return None
        width = int(img_obj["/Width"])
        height = int(img_obj["/Height"])
        if width <= 0 or height <= 0:
            return None
        if int(img_obj.get("/BitsPerComponent", 8)) != 8:
            return None
        dp = img_obj.get("/DecodeParms")
        if dp is not None:
            if hasattr(dp, "get_object"):
                dp = dp.get_object()
            if isinstance(dp, ArrayObject):
                return None  # per-filter parms: stay conservative
            try:
                pred = dp.get("/Predictor", 1)
            except Exception:
                pred = 1
            if int(pred) != 1:
                return None
        profile = cs[1].get_object()
        n = int(profile.get("/N"))
        if n == 1:
            mode = "L"
        elif n == 3:
            mode = "RGB"
        elif n == 4:
            mode = "CMYK"
        else:
            return None
        filt = img_obj.get("/Filter")
        filters = list(filt) if isinstance(filt, ArrayObject) else [filt]
        fnames = [str(f) for f in filters if f]
        if fnames not in ([], ["/FlateDecode"]):
            # The manual inflater below only handles Flate/raw data. Any
            # other filter — notably DCTDecode, i.e. JPEG scans carrying an
            # ICC profile (the standard output of most MFP scanners) — must
            # NOT be claimed here: _decode_iccbased would return None and
            # callers would silently skip the image. Returning None lets
            # _pil_from_xobject use its generic decode path instead.
            return None
        return (mode, width, height, n, fnames)
    except Exception:
        return None


def _decode_iccbased(img_obj, params, row_step: int = 1):
    """Decode an /ICCBased image XObject to a PIL image, or None.

    FlateDecode streams use the row-decimated inflater (row_step > 1 keeps
    every k-th row, so the full 100MB+ buffer is never materialized);
    unfiltered streams are sliced by row. Decoded length must match
    width*height*ncomp exactly.
    """
    from PIL import Image

    mode, width, height, n, fnames = params
    row_len = width * n
    buf = None
    kept_h = height
    try:
        if fnames == ["/FlateDecode"]:
            enc = bytes(img_obj._data)
            res = _inflate_rows(enc, width, height, n, row_step)
            if res is None:
                return None
            buf, kept_h = res
        elif not fnames:
            enc = img_obj._data
            if enc is None or len(enc) != height * row_len:
                return None
            if row_step > 1:
                parts = [
                    enc[r * row_len : (r + 1) * row_len]
                    for r in range(0, height, row_step)
                ]
                acc = bytearray()
                for part in parts:
                    acc += part
                buf = acc
                kept_h = (height + row_step - 1) // row_step
            else:
                buf = bytes(enc)
        else:
            return None
    except Exception:
        return None
    if buf is None:
        return None
    try:
        return Image.frombytes(mode, (width, kept_h), buf)
    except Exception:
        return None
