"""Flatten a PDF: render every page to an image so nothing stays editable.

Flattening here means a TRUE flatten: after the form/annotation baking
step below, each page is rendered to a full-page raster image with
pypdfium2 and the PDF is rebuilt with one image per page, at the original
page size. The output has no text layer, no annotations, no AcroForm and
no vector content — nothing is selectable, searchable or editable
anymore. That is what users mean when they say the old flatten "returned
the same file": the old tool only baked annotations into the page content
while text stayed selectable text and vectors stayed vectors.

How it works:

1. Bake first (pypdf only, no PyMuPDF): every annotation on every page
   is examined before it is removed. If the annotation has an appearance
   stream (``/AP /N``), that stream is copied into the page's
   ``/Resources /XObject`` as a Form XObject and drawn at the
   annotation's ``/Rect``. A widget (form field) with a filled value
   (``/V``) but no appearance stream gets a minimal appearance generated
   from the value and the field's default appearance (``/DA``). This
   step is what makes filled form values survive: pypdfium2 only renders
   widget values that have appearance streams, so baking first is what
   keeps "Alice Example" visible in the rendered output. A field type
   whose value cannot be rendered as text is rejected with a clear
   ``ToolError`` instead of silently destroying the data. Annotations
   with no appearance and no field value are simply removed, and
   ``/AcroForm`` is dropped from the document root.
2. Render each baked page to a JPEG image at the chosen quality
   (150 DPI standard / 300 DPI print, default 300) and rebuild the PDF
   with reportlab: one full-page image per page, same page count and
   same page size (rotation-aware).

Honest limits, stated on the tool page: the output is image-only, so
text is no longer selectable or searchable, and the file may get bigger
for text-heavy PDFs. Quality is a render resolution, not a magic
enhancer: a blurry scan stays blurry.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    IndirectObject,
    NameObject,
    NumberObject,
)

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="flatten",
    name="Flatten PDF",
    tagline="Turn every page into an image",
    description=(
        "Flatten a PDF for real: every page is rendered to a full-page "
        "image, so nothing in the document is editable, selectable or "
        "searchable anymore. Filled form values are baked in first, so "
        "they stay visible. Choose 300 DPI for print quality or 150 DPI "
        "for a smaller file. The output is image-only — text is no longer "
        "selectable, and text-heavy PDFs may get bigger."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="quality",
            kind="select",
            label="Output quality",
            required=False,
            default="300",
            choices=["150", "300"],
            help="Render resolution. 300 DPI is print quality; 150 DPI makes a smaller file. Either way the output is image-only: text is no longer selectable or searchable.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="security",
)

# Default-appearance (``/DA``) parsing: e.g. ``"0 0 0 rg /Helv 12 Tf"``.
_DA_FONT_RE = re.compile(r"/([A-Za-z0-9_]+)\s+(-?[\d.]+)\s+Tf")
_DA_RGB_RE = re.compile(r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg")
_DA_GRAY_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s+g")

# Field types whose value is plain text and can be drawn as text.
_TEXT_FIELD_TYPES = ("/Tx", "/Ch")


def _resolve(obj):
    """Return the object an indirect reference points to (or the object)."""
    try:
        if isinstance(obj, IndirectObject):
            return obj.get_object()
    except Exception:
        return None
    return obj


def _num(value) -> str:
    """Format a float for a content stream (short, no trailing zeros)."""
    text = f"{float(value):.4f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _floats(value) -> list[float] | None:
    """Resolve an array object to a list of floats, or None if unusable."""
    try:
        obj = _resolve(value)
        if obj is None:
            return None
        return [float(v) for v in obj]
    except Exception:
        return None


def _field_attr(annot, key):
    """Read ``key`` from a widget or any of its ``/Parent`` field dicts."""
    seen: set[int] = set()
    current = annot
    while current is not None:
        obj = _resolve(current)
        if obj is None or not isinstance(obj, dict):
            return None
        if id(obj) in seen:
            return None
        seen.add(id(obj))
        if key in obj:
            return obj[key]
        current = obj.get("/Parent")
    return None


def _appearance_stream(annot):
    """Return the annotation's normal appearance stream, or None.

    ``/AP`` may be a bare stream, or a dict whose ``/N`` entry is a
    stream or an appearance-state sub-dictionary (state name -> stream).
    For a state dictionary the stream matching the field's current value
    is used, falling back to ``/Off`` and then to any stream present.
    """
    try:
        ap = _resolve(annot.get("/AP"))
    except Exception:
        return None
    if ap is None:
        return None
    if hasattr(ap, "get_data"):
        return ap
    if not isinstance(ap, dict):
        return None
    normal = _resolve(ap.get("/N"))
    if normal is None:
        return None
    if hasattr(normal, "get_data"):
        return normal
    if isinstance(normal, dict):
        value = _field_attr(annot, "/V")
        candidates: list[str] = []
        if value is not None:
            candidates.append(str(value))
        candidates.append("/Off")
        for key in candidates:
            if key in normal:
                stream = _resolve(normal[key])
                if stream is not None and hasattr(stream, "get_data"):
                    return stream
        for key in normal:
            stream = _resolve(normal[key])
            if stream is not None and hasattr(stream, "get_data"):
                return stream
    return None


def _parse_default_appearance(da) -> tuple[float | None, str]:
    """Parse a ``/DA`` string into (font size or None, colour operator)."""
    size: float | None = None
    colour = "0 0 0 rg"
    if not isinstance(da, str):
        return size, colour
    match = _DA_RGB_RE.search(da)
    if match:
        colour = (
            f"{_num(match.group(1))} {_num(match.group(2))} "
            f"{_num(match.group(3))} rg"
        )
    else:
        match = _DA_GRAY_RE.search(da)
        if match:
            colour = f"{_num(match.group(1))} g"
    match = _DA_FONT_RE.search(da)
    if match:
        try:
            size = float(match.group(2))
        except ValueError:
            size = None
    return size, colour


def _encode_pdf_text(value: str) -> bytes:
    """Encode text as a PDF string operand.

    Latin-1 text becomes a literal string with ``(``/``)``/``\\`` escaped.
    Anything else becomes a UTF-16BE hex string (with BOM), which is the
    standard way to carry non-ASCII text in a PDF string.
    """
    try:
        value.encode("latin-1")
    except UnicodeEncodeError:
        hex_text = b"\xfe\xff" + value.encode("utf-16-be")
        return b"<" + hex_text.hex().encode("ascii") + b">"
    escaped = (
        value.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("\r", "\\r")
    )
    return ("(" + escaped + ")").encode("latin-1")


def _make_text_appearance(value: str, rect_w: float, rect_h: float, da) -> DecodedStreamObject:
    """Build a minimal appearance stream drawing ``value`` as plain text.

    The stream's BBox matches the field rectangle, so baking it at the
    rectangle draws it 1:1. Font size comes from the field's ``/DA``
    (auto-size ``0`` falls back to a size that fits the rectangle);
    the font is plain Helvetica, defined in the stream's own resources.
    """
    size, colour = _parse_default_appearance(da)
    if size is None or size <= 0:
        size = max(4.0, min(12.0, rect_h - 4.0)) if rect_h > 8 else 8.0
    # Shrink the font until the longest line roughly fits the rectangle.
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    longest = max((len(line) for line in lines), default=0)
    if longest and rect_w > 4:
        # Helvetica averages ~0.5 * size per character.
        fit = (rect_w - 4) / (0.5 * longest)
        if fit < size:
            size = max(4.0, fit)
    line_height = size * 1.2
    # First baseline: top-aligned with a 2 pt inset (or bottom if tiny).
    first_baseline = rect_h - 2 - size
    if first_baseline < 2:
        first_baseline = 2.0

    parts: list[bytes] = [f"{colour} BT /F1 {_num(size)} Tf ".encode("ascii")]
    parts.append(f"2 {_num(first_baseline)} Td ".encode("ascii"))
    for i, line in enumerate(lines):
        if i:
            parts.append(f"0 {_num(-line_height)} Td ".encode("ascii"))
        parts.append(_encode_pdf_text(line))
        parts.append(b" Tj ")
    parts.append(b"ET")

    stream = DecodedStreamObject()
    stream.set_data(b"".join(parts))
    stream[NameObject("/Type")] = NameObject("/XObject")
    stream[NameObject("/Subtype")] = NameObject("/Form")
    stream[NameObject("/BBox")] = ArrayObject(
        [
            NumberObject(0),
            NumberObject(0),
            NumberObject(int(rect_w)),
            NumberObject(int(rect_h)),
        ]
    )
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
            NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
        }
    )
    stream[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    return stream


def _bake_appearance(writer, page, ap_stream, rect: list[float], counter: list[int]) -> None:
    """Draw ``ap_stream`` into ``page`` at ``rect`` and keep it there.

    The appearance stream is registered as a Form XObject in the page's
    resources and a ``q <matrix> cm /Fm Do Q`` operation is appended to
    the page content. The matrix maps the appearance's ``/BBox`` onto
    ``rect``; the appearance stream's own ``/Matrix`` is applied by the
    ``Do`` operator itself.
    """
    rect_x0, rect_y0, rect_x1, rect_y1 = rect
    rect_w, rect_h = rect_x1 - rect_x0, rect_y1 - rect_y0
    bbox = _floats(ap_stream.get("/BBox")) if hasattr(ap_stream, "get") else None
    if not bbox or len(bbox) != 4:
        bbox = [0.0, 0.0, rect_w, rect_h]
    bbox_w, bbox_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    scale_x = rect_w / bbox_w if bbox_w > 0 else 1.0
    scale_y = rect_h / bbox_h if bbox_h > 0 else 1.0
    offset_x = rect_x0 - bbox[0] * scale_x
    offset_y = rect_y0 - bbox[1] * scale_y

    # --- register the appearance as a Form XObject on the page ---
    resources = _resolve(page.get("/Resources"))
    if resources is None or not isinstance(resources, dict):
        resources = DictionaryObject()
        page[NameObject("/Resources")] = resources
    xobjects = _resolve(resources.get("/XObject"))
    if xobjects is None or not isinstance(xobjects, dict):
        xobjects = DictionaryObject()
        resources[NameObject("/XObject")] = xobjects
    while True:
        counter[0] += 1
        name = NameObject(f"/FmFlat{counter[0]}")
        if name not in xobjects:
            break
    if isinstance(ap_stream, IndirectObject):
        xobjects[name] = ap_stream
    else:
        existing_ref = getattr(ap_stream, "indirect_reference", None)
        if existing_ref is not None:
            # Already an indirect object in this writer: reuse it instead
            # of writing a duplicate copy of the stream.
            xobjects[name] = existing_ref
        else:
            xobjects[name] = writer._add_object(ap_stream)

    # --- append the paint operation to the page content ---
    op = (
        f"q {_num(scale_x)} 0 0 {_num(scale_y)} "
        f"{_num(offset_x)} {_num(offset_y)} cm {name} Do Q\n"
    ).encode("ascii")
    paint = DecodedStreamObject()
    paint.set_data(op)
    paint_ref = writer._add_object(paint)
    contents = page.get("/Contents")
    if contents is None:
        page[NameObject("/Contents")] = paint_ref
    else:
        resolved = _resolve(contents)
        if isinstance(resolved, ArrayObject):
            resolved.append(paint_ref)
        else:
            page[NameObject("/Contents")] = ArrayObject([contents, paint_ref])


def _flatten_page_annotations(writer, page, counter: list[int]) -> None:
    """Bake every annotation on ``page`` into its content, then remove them.

    Raises ToolError(code="flatten_needs_appearance") if a filled form
    field has a value that cannot be baked (no appearance stream and no
    text rendering possible) — destroying the value silently would be
    worse than refusing the file.
    """
    try:
        annots = _resolve(page.get("/Annots"))
    except Exception:
        annots = None
    if not annots:
        return
    try:
        refs = list(annots)
    except TypeError:
        return

    for ref in refs:
        try:
            annot = _resolve(ref)
        except Exception:
            continue
        if annot is None or not isinstance(annot, dict):
            continue
        rect = _floats(annot.get("/Rect"))
        has_rect = rect is not None and len(rect) == 4 and rect[2] > rect[0] and rect[3] > rect[1]

        ap_stream = _appearance_stream(annot)
        if ap_stream is not None:
            if has_rect:
                _bake_appearance(writer, page, ap_stream, rect, counter)
            # No usable /Rect: the annotation was never visible on the
            # page, so there is nothing to bake — just drop it.
            continue

        if annot.get("/Subtype") != "/Widget":
            # Non-widget annotation without an appearance (sticky note,
            # highlight, link, popup, ...): its visual is viewer-generated
            # and there is nothing to bake — remove it.
            continue

        # Widget with no appearance stream: the value must be rendered.
        value = _field_attr(annot, "/V")
        if value is None or value == "":
            # Empty field: nothing to preserve.
            continue
        field_type = _field_attr(annot, "/FT")
        field_name = _field_attr(annot, "/T")
        if str(field_type) not in _TEXT_FIELD_TYPES or not (
            isinstance(value, str) and not isinstance(value, NameObject)
        ):
            label = f" field {str(field_name)!r}" if field_name is not None else ""
            raise ToolError(
                "This PDF contains a filled form"
                f"{label} (type {field_type}) with no appearance stream, "
                "so its value cannot be baked into the page. Flattening "
                "it would destroy the filled value, so the file was "
                "rejected instead. Fill the form in a PDF viewer that "
                "saves field appearances, then try again.",
                code="flatten_needs_appearance",
            )
        if not has_rect:
            label = f" field {str(field_name)!r}" if field_name is not None else ""
            raise ToolError(
                "This PDF contains a filled form"
                f"{label} with no rectangle on the page, so its value "
                "cannot be baked into the page. Flattening it would "
                "destroy the filled value, so the file was rejected "
                "instead.",
                code="flatten_needs_appearance",
            )
        generated = _make_text_appearance(
            str(value),
            rect[2] - rect[0],
            rect[3] - rect[1],
            _field_attr(annot, "/DA"),
        )
        _bake_appearance(writer, page, generated, rect, counter)

    # No live annotation is ever left in the output.
    if "/Annots" in page:
        del page[NameObject("/Annots")]


def run(ctx: ToolContext, options: dict) -> Path:
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    raw_quality = get_option(options, SPEC, "quality")
    try:
        quality_dpi = int(raw_quality)
    except (TypeError, ValueError):
        raise ToolError(
            "Option 'quality' must be 150 or 300 DPI.", code="invalid_option"
        )
    if str(quality_dpi) not in ("150", "300"):
        raise ToolError(
            "Option 'quality' must be 150 or 300 DPI.", code="invalid_option"
        )
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(
        data, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )

    # Step 1 — bake appearances first. pypdfium2 only renders widget
    # values that have appearance streams, so without this step filled
    # form values would vanish from the rendered pages. This also raises
    # ToolError for values that cannot be baked instead of destroying
    # them silently.
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    counter = [0]
    for page in writer.pages:
        _flatten_page_annotations(writer, page, counter)
    root = writer._root_object
    if "/AcroForm" in root:
        del root[NameObject("/AcroForm")]
    baked_buf = io.BytesIO()
    writer.write(baked_buf)
    baked_bytes = baked_buf.getvalue()

    # Page sizes (rotation-aware) come from the baked document.
    baked_reader = open_pdf_reader(
        baked_bytes, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Image rendering is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as rl_canvas

    scale = quality_dpi / 72.0
    jpeg_quality = 90 if quality_dpi >= 300 else 85
    out_path = ctx.new_output_path("flattened.pdf")

    pdf = pdfium.PdfDocument(baked_bytes)
    try:
        canvas = None
        for i in range(len(pdf)):
            page = pdf[i]
            try:
                pil_image = page.render(scale=scale).to_pil()
            finally:
                page.close()
            src = baked_reader.pages[i]
            try:
                w_pt = float(src.mediabox.width)
                h_pt = float(src.mediabox.height)
                rotation = int(src.get("/Rotate") or 0) % 360
            except Exception:
                w_pt, h_pt, rotation = 612.0, 792.0, 0
            if w_pt <= 0 or h_pt <= 0:
                raise ToolError(
                    f"Page {i + 1} has an invalid page size.",
                    code="invalid_input",
                )
            if rotation in (90, 270):
                w_pt, h_pt = h_pt, w_pt
            if pil_image.mode in ("RGBA", "LA", "PA"):
                pil_image = pil_image.convert("RGB")
            img_buf = io.BytesIO()
            pil_image.save(img_buf, format="JPEG", quality=jpeg_quality, optimize=True)
            pil_image.close()
            if canvas is None:
                canvas = rl_canvas.Canvas(str(out_path), pagesize=(w_pt, h_pt))
            else:
                canvas.setPageSize((w_pt, h_pt))
            canvas.drawImage(
                ImageReader(io.BytesIO(img_buf.getvalue())),
                0, 0, width=w_pt, height=h_pt,
            )
            canvas.showPage()
        if canvas is None:
            raise ToolError("No pages were rendered.", code="invalid_input")
        canvas.save()
    finally:
        pdf.close()
    return out_path
