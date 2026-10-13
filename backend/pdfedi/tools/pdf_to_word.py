"""Convert a PDF to an editable Word (.docx) document.

Text is rebuilt from pypdfium2 character boxes, font sizes and font weights:
characters are grouped into lines and paragraphs, the largest type sizes map
to Heading 1/2 styles, and embedded images are placed in reading order.
Best for text-based documents — complex tables and multi-column layouts come
out approximate. Scanned (image-only) PDFs are refused with a pointer to OCR.
"""
from __future__ import annotations

import gc
import io
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ArrayObject, ContentStream

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)
from pdfedi.tools.extract_images import _pil_from_xobject

SPEC = ToolSpec(
    key="pdf_to_word",
    name="PDF to Word",
    tagline="Convert PDF to editable Word document",
    description=(
        "Convert a PDF into an editable Word (.docx) document. Text is "
        "reconstructed into real paragraphs with heading styles, and embedded "
        "images are placed in reading order. Best for text-based documents — "
        "complex tables and multi-column layouts are approximate. Scanned "
        "PDFs with no text layer should go through the OCR tool instead."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="document",
    output_ext="docx",
    output_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    activity="converting",
    category="convert",
)

_PAGE_CAP = 50

# Memory safety for image handling (the benchmark file has 600-DPI page-scan
# backgrounds that decode to ~100MB+ each). Images larger than this are never
# decoded at all; decoded images are downscaled to _MAX_IMAGE_DIM before embed.
_MAX_IMAGE_MP = 60_000_000
_MAX_IMAGE_DIM = 1600
_LINE_TOL_FACTOR = 0.35   # fraction of char height for line grouping
_PARA_GAP_FACTOR = 1.5    # line-height multiple that starts a new paragraph
_HEADING_RATIO = 1.25     # size ratio over body that qualifies as a heading
_SPACE_EXTRA_FACTOR = 0.55  # extra advance (multiple of the estimated space
                            # width) that implies a word space
_GUTTER_FACTOR = 2.75     # gap multiple of the estimated space width that
                          # marks a column gutter (segment break)
_SPACE_WIDTH_RATIO = 0.32 # fallback space width as a fraction of font size

# Helvetica/Arial advance widths (fraction of em) used as a sane prior for
# per-character advances. Observed data refines them (see _estimate_advances);
# the table keeps rarely-seen or space-inflated characters honest.
_WIDTHS = {
    ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, '$': 0.556, '%': 0.889,
    '&': 0.667, "'": 0.191, '(': 0.333, ')': 0.333, '*': 0.389, '+': 0.584,
    ',': 0.278, '-': 0.333, '.': 0.278, '/': 0.278,
    '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556,
    '5': 0.556, '6': 0.556, '7': 0.556, '8': 0.556, '9': 0.556,
    ':': 0.278, ';': 0.278, '<': 0.584, '=': 0.584, '>': 0.584, '?': 0.556,
    '@': 0.833,
    'A': 0.667, 'B': 0.667, 'C': 0.722, 'D': 0.722, 'E': 0.667, 'F': 0.611,
    'G': 0.778, 'H': 0.722, 'I': 0.278, 'J': 0.500, 'K': 0.667, 'L': 0.556,
    'M': 0.833, 'N': 0.722, 'O': 0.778, 'P': 0.667, 'Q': 0.778, 'R': 0.722,
    'S': 0.667, 'T': 0.611, 'U': 0.722, 'V': 0.667, 'W': 0.944, 'X': 0.667,
    'Y': 0.667, 'Z': 0.611,
    '[': 0.278, ']': 0.278, '^': 0.469, '_': 0.556, '`': 0.278,
    'a': 0.556, 'b': 0.556, 'c': 0.500, 'd': 0.556, 'e': 0.556, 'f': 0.333,
    'g': 0.556, 'h': 0.556, 'i': 0.222, 'j': 0.222, 'k': 0.500, 'l': 0.222,
    'm': 0.833, 'n': 0.556, 'o': 0.556, 'p': 0.556, 'q': 0.556, 'r': 0.333,
    's': 0.500, 't': 0.278, 'u': 0.556, 'v': 0.500, 'w': 0.944, 'x': 0.500,
    'y': 0.500, 'z': 0.500,
    '{': 0.334, '|': 0.260, '}': 0.334, '~': 0.584,
}


def _table_ratio(ch: str) -> float:
    """Helvetica/Arial advance width as a fraction of em (font size)."""
    r = _WIDTHS.get(ch)
    if r is None:
        if ch.isdigit():
            r = 0.556
        elif ch.isupper():
            r = 0.70
        elif ch.islower():
            r = 0.50
        else:
            r = 0.45
    return r


def _estimate_advances(all_lines) -> dict:
    """Estimate each character's advance as a fraction of em (font size).

    Advances are normalized by the character's own font size so estimates
    work across mixed sizes (e.g. a 24pt heading and 12pt body). For a
    character, the typical x0-step to its visual successor is used; a low
    percentile keeps real spaces and column gutters (which inflate some
    steps) from skewing it. This is what lets the spacing test tell a narrow
    glyph's side bearings ("1" followed by "9") apart from a genuine word
    space. A font-model table caps characters that are (almost) always
    followed by a space, whose observed steps would otherwise absorb it.
    """
    diffs: dict[str, list[float]] = {}
    for ln in all_lines:
        ordered = sorted(ln, key=lambda c: c["x0"])
        for a, b in zip(ordered, ordered[1:]):
            if a["size"] <= 0 or a["ch"] == " ":
                continue
            d = (b["x0"] - a["x0"]) / a["size"]
            if d > 0:
                diffs.setdefault(a["ch"], []).append(d)
    adv: dict[str, float] = {}
    for ch, ds in diffs.items():
        ds.sort()
        tval = _table_ratio(ch)
        ds = [d for d in ds if d >= 0.5 * tval]  # drop overlaps/degenerate
        if not ds:
            adv[ch] = tval
            continue
        m = ds[min(1, len(ds) // 4)] if len(ds) >= 2 else ds[0]
        # Observed steps dominate, but the table wins when the data is
        # space-inflated (character almost always followed by a space).
        adv[ch] = m if m < tval else tval
    return adv


def _reattach_tiny_glyphs(lines):
    """Move tiny glyphs ('-', '.', ':', ...) stranded in a neighboring line
    back to the line where they fill a glyph-sized gap between normal chars.

    Dense forms often set punctuation on a slightly different baseline than
    the surrounding text, which fools pure y-distance grouping; without this,
    e.g. the '.' of "gmail.com" ends up orphaned and its gap reads as a
    word space.
    """
    heights = sorted(c["y1"] - c["y0"] for ln in lines for c in ln
                     if c["y1"] > c["y0"] and c["ch"] != " ")
    if not heights:
        return lines
    med_h = heights[len(heights) // 2]

    def line_yc(ln):
        return sum((c["y0"] + c["y1"]) / 2 for c in ln) / len(ln)

    def fills_interior_gap(c, ln):
        ordered = [x for x in sorted(ln, key=lambda x: x["x0"]) if x is not c]
        for a, b in zip(ordered, ordered[1:]):
            if (a["y1"] - a["y0"]) < 0.45 * med_h:
                continue
            if (b["y1"] - b["y0"]) < 0.45 * med_h:
                continue
            if (a["x1"] <= c["x0"] <= b["x0"]
                    and (b["x0"] - a["x1"]) < 2.0 * med_h):
                return True
        return False

    for li in range(len(lines)):
        for c in list(lines[li]):
            if (c["y1"] - c["y0"]) >= 0.45 * med_h or c["ch"] == " ":
                continue
            if fills_interior_gap(c, lines[li]):
                continue  # already home
            cy = (c["y0"] + c["y1"]) / 2
            cands = []
            for lj, other in enumerate(lines):
                if lj == li or not other:
                    continue
                d = abs(cy - line_yc(other))
                if d > med_h:
                    continue
                if fills_interior_gap(c, other):
                    cands.append((d, other))
            if cands:
                cands.sort(key=lambda t: t[0])
                lines[li].remove(c)
                cands[0][1].append(c)
    lines = [ln for ln in lines if ln]
    for ln in lines:
        ln.sort(key=lambda c: c["x0"])
    lines.sort(key=lambda ln: -sum((c["y0"] + c["y1"]) / 2 for c in ln) / len(ln))
    return lines


def _estimate_space_width(line_chars) -> float:
    """Estimate a real word-space width for one line of chars.

    Uses actual space characters when present (their advance between the
    neighboring glyphs); otherwise falls back to a fraction of the median
    font size. Deliberately NOT a fraction of median ink width: pdfium
    charboxes are ink boxes, so narrow glyphs (1, i, -, .) leave phantom
    gaps that a ink-width-relative threshold mistakes for spaces.
    """
    widths: list[float] = []
    for i, c in enumerate(line_chars):
        if c["ch"] != " ":
            continue
        prev = next((line_chars[j] for j in range(i - 1, -1, -1)
                     if line_chars[j]["ch"] != " "), None)
        nxt = next((line_chars[j] for j in range(i + 1, len(line_chars))
                    if line_chars[j]["ch"] != " "), None)
        if prev is None or nxt is None:
            continue
        w = nxt["x0"] - prev["x1"]
        size = c["size"] or 10.0
        if 0 < w < 10 * size:
            widths.append(w)
    if widths:
        widths.sort()
        return widths[len(widths) // 2]
    sizes = [c["size"] for c in line_chars if c["size"] > 0]
    med_size = sorted(sizes)[len(sizes) // 2] if sizes else 10.0
    return _SPACE_WIDTH_RATIO * med_size


def _line_tokens(line_chars, advances: dict) -> list[tuple]:
    """Build ("text", str, bold) / ("tab",) tokens for one x-sorted line.

    A word space is *extra* advance beyond the previous glyph's own advance:
    ``(curr.x0 - prev.x0) - advance(prev)``. This distinguishes a narrow
    glyph's side bearings ("1" followed by "9") from a genuine word space,
    which ink-box gaps alone cannot. Gaps wider than _GUTTER_FACTOR become
    column-gutter tabs, so side-by-side columns don't interleave.
    """
    line = sorted(line_chars, key=lambda c: c["x0"])
    space_w = _estimate_space_width(line)
    tokens: list[tuple] = []
    prev = None
    prev_was_space = False
    for c in line:
        if c["ch"] == " ":
            tokens.append(("text", " ", c["bold"]))
            prev_was_space = True
            continue
        if prev is not None and prev["x1"] > prev["x0"]:
            gap = c["x0"] - prev["x1"]
            if gap > _GUTTER_FACTOR * space_w:
                tokens.append(("tab",))
            elif not prev_was_space:
                ratio = advances.get(prev["ch"])
                if ratio is None:
                    ratio = _table_ratio(prev["ch"])
                adv = ratio * (prev["size"] or 10.0)
                extra = (c["x0"] - prev["x0"]) - adv
                if extra > _SPACE_EXTRA_FACTOR * space_w:
                    tokens.append(("text", " ", c["bold"]))
        tokens.append(("text", c["ch"], c["bold"]))
        prev = c
        prev_was_space = False
    return tokens


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


def _iter_ops(page, reader) -> list:
    """Version-safe content-stream operations list (pypdf 5/6)."""
    try:
        contents = page.get_contents()
    except Exception:
        return []
    if contents is None:
        return []
    ops = getattr(contents, "operations", None)
    if ops is not None:
        return list(ops)
    try:
        return list(ContentStream(contents, reader))
    except Exception:
        return []


def _resolve(obj):
    return obj.get_object() if hasattr(obj, "get_object") else obj


def _walk_ops(ops, xobjects, ctm, out, seen):
    """CTM-tracking walk; recurses into Form XObjects. Appends
    (y_top_pt, image_xobject) for each unique image XObject."""
    stack: list[list[float]] = []
    for operands, op in ops:
        try:
            if op == b"cm" and len(operands) == 6:
                m = [float(o) for o in operands]
                a, b, c, d, e, f = m
                A, B, C, D, E, F = ctm
                ctm = [
                    a * A + b * C,
                    a * B + b * D,
                    c * A + d * C,
                    c * B + d * D,
                    e * A + f * C + E,
                    e * B + f * D + F,
                ]
            elif op == b"q":
                stack.append(list(ctm))
            elif op == b"Q":
                if stack:
                    ctm = stack.pop()
            elif op == b"Do" and operands:
                name = str(operands[0])
                xobj = xobjects.get(name)
                if xobj is None:
                    continue
                xobj = _resolve(xobj)
                try:
                    subtype = xobj.get("/Subtype")
                except Exception:
                    continue
                if subtype == "/Image":
                    ident = id(xobj)
                    if ident in seen:
                        continue
                    seen.add(ident)
                    a, b, c, d, e, f = ctm
                    ys = [b * x + d * y + f for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
                    out.append((max(ys), xobj))
                elif subtype == "/Form":
                    # Recurse with the form's matrix composed into the CTM.
                    try:
                        raw_mx = xobj.get("/Matrix", [1, 0, 0, 1, 0, 0])
                        mx = [float(v) for v in raw_mx]
                        sub_res = _resolve(xobj.get("/Resources")) or {}
                        sub_raw = sub_res.get("/XObject")
                        sub_xo = _resolve(sub_raw) if sub_raw is not None else {}
                        sub_ops = getattr(xobj, "operations", None)
                        if sub_ops is None:
                            try:
                                sub_ops = list(ContentStream(xobj, None))
                            except Exception:
                                sub_ops = []
                    except Exception:
                        continue
                    a, b, c, d, e, f = mx
                    A, B, C, D, E, F = ctm
                    form_ctm = [
                        a * A + b * C,
                        a * B + b * D,
                        c * A + d * C,
                        c * B + d * D,
                        e * A + f * C + E,
                        e * B + f * D + F,
                    ]
                    _walk_ops(list(sub_ops), sub_xo, form_ctm, out, seen)
        except Exception:
            continue


def _decodable(xobj) -> bool:
    """Dict-only pre-check mirroring _pil_from_xobject's supported formats.

    Returns True only for image XObjects _pil_from_xobject can actually turn
    into a PIL image. Reading the dict is free; a False result avoids paying
    for a full get_data() decode whose output would be discarded anyway
    (and whose bytes pypdf caches on the object).

    Note: _pil_from_xobject additionally decodes /ICCBased images, which is
    deliberately NOT mirrored here — Word conversion intentionally skips the
    full-page scan backgrounds (each would embed as a huge image).
    """
    try:
        filt = xobj.get("/Filter")
        filters = list(filt) if isinstance(filt, ArrayObject) else [filt]
        if any(str(f) == "/DCTDecode" for f in filters):
            return True
        bpc = int(xobj.get("/BitsPerComponent", 8))
        cs = xobj.get("/ColorSpace")
        cs_name = str(cs[0]) if isinstance(cs, ArrayObject) and cs else str(cs or "")
        return (
            (cs_name == "/DeviceRGB" and bpc == 8)
            or (cs_name == "/DeviceGray" and bpc in (1, 8))
            or (cs_name == "/DeviceCMYK" and bpc == 8)
        )
    except Exception:
        return False


def _drop_decode_cache(xobj) -> None:
    """Release pypdf's cached decoded bytes for this object.

    get_data() caches the full decoded stream on the object; without this a
    100MB+ decode stays resident for the whole run.
    """
    try:
        if getattr(xobj, "_data", None) is not None:
            xobj._data = None
    except Exception:
        pass


def _image_placements(page, reader) -> list[tuple[float, bytes]]:
    """Return (y_top_pt, img_bytes) for image XObjects via a CTM walk.

    Memory-safe: dimensions are read from the XObject dict (free) and images
    over _MAX_IMAGE_MP megapixels are never decoded. Decoded images are
    downscaled to _MAX_IMAGE_DIM px max dimension immediately, encoded as
    JPEG (opaque) or PNG (real alpha), and the full-size PIL image is freed
    before the next placement is processed.
    """
    from PIL import Image as PILImage
    try:
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return []
        xobjects = _resolve(xobjects)
    except Exception:
        return []
    found: list[tuple[float, object]] = []
    _walk_ops(
        _iter_ops(page, reader), xobjects,
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], found, set(),
    )
    placements: list[tuple[float, bytes]] = []
    for y_top, xobj in found:
        # Pre-decode gate: dimensions are free; never decode huge images.
        try:
            w = int(xobj.get("/Width") or 0)
            h = int(xobj.get("/Height") or 0)
        except Exception:
            w = h = 0
        if w > 0 and h > 0 and w * h > _MAX_IMAGE_MP:
            continue
        # Dict-only support check first: _pil_from_xobject would return None
        # for anything else, so skip before paying for a full decode (pypdf
        # also caches decoded bytes on the object, permanently).
        if not _decodable(xobj):
            continue
        try:
            pil_img = _pil_from_xobject(xobj)
        except Exception:
            continue
        if pil_img is None:
            _drop_decode_cache(xobj)
            continue
        try:
            if max(pil_img.width, pil_img.height) > _MAX_IMAGE_DIM:
                pil_img.thumbnail((_MAX_IMAGE_DIM, _MAX_IMAGE_DIM), PILImage.LANCZOS)
            has_alpha = pil_img.mode in ("RGBA", "LA")
            if not has_alpha:
                try:
                    has_alpha = _resolve(xobj.get("/SMask")) is not None
                except Exception:
                    has_alpha = False
            buf = io.BytesIO()
            if has_alpha:
                if pil_img.mode not in ("RGBA", "LA"):
                    pil_img = pil_img.convert("RGBA")
                pil_img.save(buf, format="PNG")
            else:
                if pil_img.mode == "CMYK":
                    pil_img = pil_img.convert("RGB")
                elif pil_img.mode not in ("RGB", "L"):
                    pil_img = pil_img.convert("RGB")
                pil_img.save(buf, format="JPEG", quality=80)
            placements.append((y_top, buf.getvalue()))
        except Exception:
            continue
        finally:
            # Free the full-size image and pypdf's cached decoded bytes NOW,
            # before the next placement is processed.
            _drop_decode_cache(xobj)
            try:
                pil_img.close()
            except Exception:
                pass
            del pil_img
    gc.collect()
    return placements



def _extract_page_blocks(data: bytes, page_index: int, page, include_images: bool = True) -> tuple[list, bool]:
    """Extract text blocks and images from one page.

    Returns (blocks, has_text) where blocks are dicts:
    {"y": y_top, "kind": "para", "text": str, "runs": [(text, bold)], "size": float}
    or {"y": y_top, "kind": "image", "img": bytes}.
    """
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    doc = pdfium.PdfDocument(data)
    blocks: list = []
    has_text = False
    try:
        pdfium_page = doc[page_index]
        tp = pdfium_page.get_textpage()
        n = tp.count_chars()
        if n:
            full = tp.get_text_range(0, n)
            chars = []
            for i in range(n):
                ch = full[i] if i < len(full) else ""
                if ch in ("\r", "\n"):
                    continue
                x0, y0, x1, y1 = tp.get_charbox(i)
                try:
                    size = float(raw.FPDFText_GetFontSize(tp, i))
                except Exception:
                    size = 0.0
                try:
                    weight = int(raw.FPDFText_GetFontWeight(tp, i))
                except Exception:
                    weight = 0
                chars.append({
                    "ch": ch, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "size": size, "bold": weight >= 600,
                })
            # Group chars into lines by vertical proximity, best-match on the
            # running mean y-center (not greedy first-match): on dense forms,
            # nearby rows otherwise steal each other's glyphs, and tiny
            # glyphs like '-' get stranded in neighboring lines.
            chars.sort(key=lambda c: (-(c["y0"] + c["y1"]) / 2, c["x0"]))
            line_objs: list[dict] = []
            for ch in chars:
                cy = (ch["y0"] + ch["y1"]) / 2
                ch_h = max(1.0, ch["y1"] - ch["y0"])
                best = None
                best_d = None
                for ln in line_objs:
                    tol = _LINE_TOL_FACTOR * max(ch_h, ln["h"])
                    d = abs(cy - ln["yc"])
                    if d <= tol and (best_d is None or d < best_d):
                        best, best_d = ln, d
                if best is None:
                    line_objs.append({"chars": [ch], "yc": cy, "h": ch_h})
                else:
                    best["chars"].append(ch)
                    n_ln = len(best["chars"])
                    best["yc"] += (cy - best["yc"]) / n_ln
            lines = [ln["chars"] for ln in line_objs]
            # Sort lines top-down, chars left-to-right; merge into paragraphs.
            for line in lines:
                line.sort(key=lambda c: c["x0"])
            lines.sort(key=lambda ln: -sum((c["y0"] + c["y1"]) / 2 for c in ln) / len(ln))

            def line_height(ln):
                return sum(c["y1"] - c["y0"] for c in ln) / len(ln)

            # Per-character advances for the spacing test, then per-line
            # tokens: word spaces from extra advance, column gutters as tabs.
            # Tiny glyphs stranded in neighboring lines are reattached first.
            lines = _reattach_tiny_glyphs(lines)
            advances = _estimate_advances(lines)
            line_items = [(ln, _line_tokens(ln, advances)) for ln in lines]

            paragraphs: list[list] = []  # list of (chars, tokens) line pairs
            prev_bottom = None
            prev_h = 0.0
            for ln, toks in line_items:
                top = max(c["y1"] for c in ln)
                bottom = min(c["y0"] for c in ln)
                h = line_height(ln)
                gap = (prev_bottom - top) if prev_bottom is not None else 0.0
                if paragraphs and gap > _PARA_GAP_FACTOR * min(h, prev_h or h):
                    paragraphs.append([])
                if not paragraphs:
                    paragraphs.append([])
                paragraphs[-1].append((ln, toks))
                prev_bottom = bottom
                prev_h = h

            for para_lines in paragraphs:
                para_chars = [c for ln, _ in para_lines for c in ln]
                # Join wrapped lines with a space so words don't merge;
                # column segments are already separated by tabs.
                para_tokens: list[tuple] = []
                for i, (_, toks) in enumerate(para_lines):
                    if i > 0 and toks and para_tokens:
                        para_tokens.append(("text", " ", False))
                    para_tokens.extend(toks)
                # Bold runs, trimming edge whitespace so runs/text agree.
                runs: list[tuple[str, bool]] = []
                for tok in para_tokens:
                    t, b = ("\t", False) if tok[0] == "tab" else (tok[1], tok[2])
                    if runs and runs[-1][1] == b:
                        runs[-1] = (runs[-1][0] + t, b)
                    else:
                        runs.append((t, b))
                while runs and not runs[0][0].strip():
                    runs.pop(0)
                while runs and not runs[-1][0].strip():
                    runs.pop()
                if runs:
                    runs[0] = (runs[0][0].lstrip(), runs[0][1])
                    runs[-1] = (runs[-1][0].rstrip(), runs[-1][1])
                text = "".join(t for t, _ in runs)
                if not text:
                    continue
                has_text = True
                sizes = [c["size"] for c in para_chars if c["size"] > 0]
                med_size = sorted(sizes)[len(sizes) // 2] if sizes else 0.0
                y_top = max(c["y1"] for c in para_chars)
                blocks.append({
                    "y": y_top, "kind": "para", "text": text,
                    "runs": runs, "size": med_size,
                })
    finally:
        doc.close()

    # Images with positions from the pypdf content stream. Skipped in the
    # text-only first pass so image bytes are never held across pages.
    if include_images:
        try:
            reader = PdfReader(io.BytesIO(data))
            for y_top, img in _image_placements(page, reader):
                blocks.append({"y": y_top, "kind": "image", "img": img})
        except Exception:
            pass
        gc.collect()

    blocks.sort(key=lambda b: -b["y"])
    return blocks, has_text


def run(ctx: ToolContext, options: dict) -> Path:
    """Rebuild the PDF as an editable .docx in reading order."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to Word needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    try:
        from docx import Document
        from docx.shared import Inches
    except ImportError as exc:
        raise ToolError(
            "Word export is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    try:
        import pypdfium2  # noqa: F401
    except ImportError as exc:
        raise ToolError(
            "Text extraction is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    tool_input = ctx.inputs[0]
    data = tool_input.path.read_bytes()
    filename = tool_input.filename
    reader = _open_reader(data, filename)
    page_count = len(reader.pages)
    if page_count > _PAGE_CAP:
        raise ToolError(
            f"PDF to Word supports at most {_PAGE_CAP} pages per job.",
            code="too_many_pages",
        )

    # First pass (text only, low memory): collect per-line sizes to identify
    # heading sizes. Images are extracted per page in the second pass so at
    # most one page's image bytes are held at a time.
    page_text_blocks: list[list] = []
    any_text = False
    for i, page in enumerate(reader.pages):
        blocks, has_text = _extract_page_blocks(data, i, page, include_images=False)
        page_text_blocks.append(blocks)
        any_text = any_text or has_text

    if not any_text:
        raise ToolError(
            f"'{filename}' has no extractable text — it may be scanned. "
            "Use the OCR tool first to make it searchable, then convert.",
            code="no_text",
        )

    sizes = sorted({round(b["size"], 1) for blocks in page_text_blocks for b in blocks
                    if b["kind"] == "para" and b["size"] > 0}, reverse=True)
    # Body size = the most common line size; headings = distinctly larger sizes.
    from collections import Counter
    size_counts = Counter(round(b["size"], 1) for blocks in page_text_blocks for b in blocks
                          if b["kind"] == "para" and b["size"] > 0)
    body_size = size_counts.most_common(1)[0][0] if size_counts else 0.0
    heading_sizes = [s for s in sizes if s >= body_size * _HEADING_RATIO]

    doc = Document()
    for pi, text_blocks in enumerate(page_text_blocks):
        # Second pass, one page at a time: extract that page's images and
        # assemble it into the document, then release everything before
        # moving to the next page.
        img_blocks = [
            {"y": y_top, "kind": "image", "img": img}
            for y_top, img in _image_placements(reader.pages[pi], reader)
        ]
        blocks = sorted(text_blocks + img_blocks, key=lambda b: -b["y"])
        if pi > 0 and blocks:
            doc.add_page_break()
        for b in blocks:
            if b["kind"] == "image":
                try:
                    from PIL import Image as PILImage
                    img = PILImage.open(io.BytesIO(b["img"]))
                    try:
                        w_in = min(6.0, max(1.0, img.width / 150.0))
                    finally:
                        img.close()
                    doc.add_picture(io.BytesIO(b["img"]), width=Inches(w_in))
                except Exception:
                    continue
            else:
                level = 0
                if b["size"] in heading_sizes:
                    level = heading_sizes.index(b["size"]) + 1
                    level = min(level, 2)
                if level:
                    doc.add_heading(b["text"], level=level)
                else:
                    p = doc.add_paragraph()
                    for text, bold in b["runs"]:
                        run_ = p.add_run(text)
                        if bold:
                            run_.bold = True
        # Release this page's blocks before the next page.
        page_text_blocks[pi] = []
        del blocks, img_blocks
        gc.collect()

    out = ctx.new_output_path("document.docx").with_suffix(".docx")
    doc.save(str(out))
    return out
