"""Compare two PDFs and produce an annotated diff document.

The original and revised files are rendered page by page; changed regions are
boxed in red on the revised page. Pages that exist in only one file are
included with a red border and an added/removed label. If the files are
identical, a clean ``no_differences`` error is raised instead of a document.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont
from pypdf import PdfReader
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="compare",
    name="Compare PDF",
    tagline="Show differences between two PDFs",
    description=(
        "Compare an original and a revised PDF. Every changed region is boxed "
        "in red on the revised pages, and added or removed pages are marked. "
        "If the two files are identical, you'll be told so instead of getting "
        "a meaningless diff document."
    ),
    input_kinds=["pdf"],
    min_files=2,
    max_files=2,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="processing",
    category="edit",
)

_DPI = 150
_SCALE = _DPI / 72.0
_PAGE_CAP = 50
_PIXEL_THRESHOLD = 28      # per-channel difference that counts as changed
_GRID_COLS = 60            # diff-mask clustering grid width
_RED = (220, 38, 38)
_RED_PIL = (220, 38, 38)


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


def _render_one(data: bytes, index: int) -> tuple[Image.Image, float, float]:
    """Render a single page: (PIL image, width_pt, height_pt)."""
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Image rendering is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    doc = pdfium.PdfDocument(data)
    try:
        page = doc[index]
        w_pt = float(page.get_width())
        h_pt = float(page.get_height())
        bitmap = page.render(scale=_SCALE).to_pil().convert("RGB")
        return bitmap, w_pt, h_pt
    finally:
        doc.close()


def _changed_boxes(img_a: Image.Image, img_b: Image.Image) -> list[tuple[int, int, int, int]]:
    """Changed region boxes in pixel coordinates of the larger image.

    Uses grid-cell clustering with flood fill so scattered pixels from
    anti-aliasing merge into clean boxes, then pads each box by one cell.
    """
    w = max(img_a.width, img_b.width)
    h = max(img_a.height, img_b.height)
    if img_a.size != (w, h):
        base = Image.new("RGB", (w, h), (255, 255, 255))
        base.paste(img_a, (0, 0))
        img_a = base
    if img_b.size != (w, h):
        base = Image.new("RGB", (w, h), (255, 255, 255))
        base.paste(img_b, (0, 0))
        img_b = base

    diff = ImageChops.difference(img_a, img_b).convert("L")
    # Per-pixel changed mask, dilated so thin text strokes survive the
    # downsampling below (a 2px stroke would otherwise average away).
    from PIL import ImageFilter
    mask = diff.point(lambda v: 255 if v > _PIXEL_THRESHOLD else 0)
    mask = mask.filter(ImageFilter.MaxFilter(15))

    cols = _GRID_COLS
    rows = max(1, int(cols * h / w))
    small = mask.resize((cols, rows), Image.BILINEAR)
    grid = small.load()
    changed = [
        [grid[x, y] > 128 for x in range(cols)] for y in range(rows)
    ]

    # Connected components via flood fill on the small grid.
    seen = [[False] * cols for _ in range(rows)]
    boxes: list[tuple[int, int, int, int]] = []
    for sy in range(rows):
        for sx in range(cols):
            if not changed[sy][sx] or seen[sy][sx]:
                continue
            stack = [(sx, sy)]
            seen[sy][sx] = True
            x0 = x1 = sx
            y0 = y1 = sy
            while stack:
                cx, cy = stack.pop()
                x0, x1 = min(x0, cx), max(x0, cx)
                y0, y1 = min(y0, cy), max(y0, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < cols and 0 <= ny < rows and changed[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            # Pad by one grid cell on each side.
            x0 = max(0, x0 - 1)
            y0 = max(0, y0 - 1)
            x1 = min(cols - 1, x1 + 1)
            y1 = min(rows - 1, y1 + 1)
            boxes.append((
                int(x0 / cols * w),
                int(y0 / rows * h),
                int((x1 + 1) / cols * w),
                int((y1 + 1) / rows * h),
            ))
    return boxes


def _label_page(img: Image.Image, label: str) -> Image.Image:
    """Add a full-page red border and a centered label banner."""
    draw = ImageDraw.Draw(img)
    bw = max(6, img.width // 150)
    draw.rectangle([0, 0, img.width - 1, img.height - 1], outline=_RED_PIL, width=bw)
    # Banner at top.
    band_h = max(40, img.height // 14)
    draw.rectangle([0, 0, img.width, band_h], fill=_RED_PIL)
    font = ImageFont.load_default(size=max(24, band_h // 2))
    tw = draw.textlength(label, font=font)
    draw.text(((img.width - tw) / 2, (band_h - font.size) / 2), label, fill=(255, 255, 255), font=font)
    return img


def run(ctx: ToolContext, options: dict) -> Path:
    """Diff two PDFs; the second input is treated as the revised version."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 2:
        raise ToolError(
            f"Compare needs exactly 2 PDF files (original + revised); "
            f"got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    orig = ctx.inputs[0]
    rev = ctx.inputs[1]
    orig_data = orig.path.read_bytes()
    rev_data = rev.path.read_bytes()
    orig_reader = _open_reader(orig_data, orig.filename)
    rev_reader = _open_reader(rev_data, rev.filename)
    orig_n, rev_n = len(orig_reader.pages), len(rev_reader.pages)
    if orig_n > _PAGE_CAP or rev_n > _PAGE_CAP:
        raise ToolError(
            f"Compare supports at most {_PAGE_CAP} pages per file.",
            code="too_many_pages",
        )

    # Render and diff one page pair at a time to bound memory.
    sheets: list[tuple[Image.Image, float, float]] = []
    any_diff = False
    max_n = max(orig_n, rev_n)
    for i in range(max_n):
        if i < orig_n and i < rev_n:
            o_img, _ow, _oh = _render_one(orig_data, i)
            r_img, rw, rh = _render_one(rev_data, i)
            boxes = _changed_boxes(o_img, r_img)
            o_img.close()
            if boxes:
                any_diff = True
                draw = ImageDraw.Draw(r_img)
                lw = max(3, r_img.width // 400)
                for (x0, y0, x1, y1) in boxes:
                    draw.rectangle([x0, y0, x1, y1], outline=_RED_PIL, width=lw)
            sheets.append((r_img, rw, rh))
        elif i < rev_n:
            r_img, rw, rh = _render_one(rev_data, i)
            any_diff = True
            sheets.append((_label_page(r_img, "Page added"), rw, rh))
        else:
            o_img, ow, oh = _render_one(orig_data, i)
            any_diff = True
            sheets.append((_label_page(o_img, "Page removed"), ow, oh))

    if not any_diff:
        raise ToolError(
            "The two PDFs appear to be identical — no differences found.",
            code="no_differences",
        )

    out = ctx.new_output_path("compared.pdf").with_suffix(".pdf")
    c = canvas.Canvas(str(out))
    for img, w_pt, h_pt in sheets:
        c.setPageSize((w_pt, h_pt))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width=w_pt, height=h_pt)
        c.showPage()
        img.close()
    c.save()
    return out
