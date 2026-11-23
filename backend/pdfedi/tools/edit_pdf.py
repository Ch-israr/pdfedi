"""Add text annotations and whiteout rectangles to a PDF (the honest slice
of "edit PDF").

A full text editor — reflowing the original text, changing fonts, editing
existing words in place — is out of scope. This tool does what it says and
says what it does:

* **text** — draws new text on top of a page at a chosen position/size.
* **whiteout** — covers a rectangle with a solid white box (to hide text
  before adding replacement text, or to blank an area).

Annotations arrive as one JSON option (built by the canvas in the browser):
``[{"page": 1, "kind": "text", "x": 0.1, "y": 0.2, "text": "Hello",
"size": 12}, {"page": 1, "kind": "whiteout", "x": 0.1, "y": 0.3,
"w": 0.5, "h": 0.05}]`` — coordinates are fractions of the page measured
from the top-left corner.

Honest limits, stated in the tool copy: new text sits ON TOP of the page —
it does not reflow or replace the original text, and whiteout only covers
content visually (the text underneath is still in the file). To remove
content for real, use the Redact tool.
"""
from __future__ import annotations

import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import white
from reportlab.pdfgen import canvas as rl_canvas

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    require_option,
)

SPEC = ToolSpec(
    key="edit_pdf",
    name="Edit PDF",
    tagline="Add text and cover areas on your PDF",
    description=(
        "Add text annotations and whiteout rectangles to a PDF. New text is "
        "drawn on top of the page and whiteout covers an area with a white "
        "box — the original text is not reflowed or removed. To remove "
        "content for real, use the Redact tool."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="annotations",
            kind="text",
            label="Annotations (JSON)",
            required=True,
            help="A JSON list of annotations built by the editor canvas.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="edit",
)

_MAX_ANNOTATIONS = 200
_MAX_TEXT_LEN = 500
_MIN_SIZE = 6.0
_MAX_SIZE = 72.0


def _frac(value, name: str) -> float:
    if isinstance(value, bool):
        raise ToolError(f"Annotation '{name}' must be a number.", code="invalid_option")
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ToolError(f"Annotation '{name}' must be a number.", code="invalid_option")
    if not 0.0 <= v <= 1.0:
        raise ToolError(f"Annotation '{name}' must be between 0 and 1.", code="invalid_option")
    return v


def _validate_annotations(raw) -> list[dict]:
    """Parse and validate the annotations JSON into a normalized list."""
    if not isinstance(raw, str) or not raw.strip():
        raise ToolError(
            "Option 'annotations' is required: add at least one annotation.",
            code="invalid_option",
        )
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        raise ToolError("Option 'annotations' is not valid JSON.", code="invalid_option")
    if not isinstance(items, list) or not items:
        raise ToolError(
            "Option 'annotations' must be a non-empty list.",
            code="invalid_option",
        )
    if len(items) > _MAX_ANNOTATIONS:
        raise ToolError(
            f"At most {_MAX_ANNOTATIONS} annotations per job.",
            code="invalid_option",
        )
    out: list[dict] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ToolError(f"Annotation #{i + 1} must be an object.", code="invalid_option")
        kind = item.get("kind")
        if kind not in ("text", "whiteout"):
            raise ToolError(
                f"Annotation #{i + 1}: kind must be 'text' or 'whiteout'.",
                code="invalid_option",
            )
        page = item.get("page")
        if isinstance(page, bool) or not isinstance(page, int) or page < 1:
            raise ToolError(
                f"Annotation #{i + 1}: page must be a positive integer.",
                code="invalid_option",
            )
        ann: dict = {
            "kind": kind,
            "page": page,
            "x": _frac(item.get("x"), "x"),
            "y": _frac(item.get("y"), "y"),
        }
        if kind == "text":
            text = item.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ToolError(
                    f"Annotation #{i + 1}: text must be a non-empty string.",
                    code="invalid_option",
                )
            if len(text) > _MAX_TEXT_LEN:
                raise ToolError(
                    f"Annotation #{i + 1}: text must be at most {_MAX_TEXT_LEN} characters.",
                    code="invalid_option",
                )
            size = item.get("size", 12)
            if isinstance(size, bool):
                raise ToolError(f"Annotation #{i + 1}: size must be a number.", code="invalid_option")
            try:
                size_f = float(size)
            except (TypeError, ValueError):
                raise ToolError(f"Annotation #{i + 1}: size must be a number.", code="invalid_option")
            if not _MIN_SIZE <= size_f <= _MAX_SIZE:
                raise ToolError(
                    f"Annotation #{i + 1}: size must be between {_MIN_SIZE} and {_MAX_SIZE}.",
                    code="invalid_option",
                )
            ann["text"] = text
            ann["size"] = size_f
        else:
            ann["w"] = _frac(item.get("w"), "w")
            ann["h"] = _frac(item.get("h"), "h")
            if ann["w"] <= 0 or ann["h"] <= 0:
                raise ToolError(
                    f"Annotation #{i + 1}: whiteout width and height must be above 0.",
                    code="invalid_option",
                )
        out.append(ann)
    return out


def run(ctx: ToolContext, options: dict) -> Path:
    """Draw the annotations onto their pages (reportlab overlay + merge)."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Edit PDF needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    annotations = _validate_annotations(require_option(options, SPEC, "annotations"))

    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(data, ctx.inputs[0].filename)
    page_count = len(reader.pages)
    for ann in annotations:
        if ann["page"] > page_count:
            raise ToolError(
                f"Annotation page {ann['page']} exceeds the document page count "
                f"({page_count}).",
                code="invalid_option",
            )

    by_page: dict[int, list[dict]] = {}
    for ann in annotations:
        by_page.setdefault(ann["page"], []).append(ann)

    writer = PdfWriter()
    for idx, page in enumerate(reader.pages, start=1):
        anns = by_page.get(idx)
        if anns:
            mediabox = page.mediabox
            pw = float(mediabox.width)
            ph = float(mediabox.height)
            import io
            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(pw, ph))
            for ann in anns:
                left = ann["x"] * pw
                top = ann["y"] * ph
                if ann["kind"] == "whiteout":
                    w = ann["w"] * pw
                    h = ann["h"] * ph
                    c.setFillColor(white)
                    c.rect(left, ph - top - h, w, h, stroke=0, fill=1)
                else:
                    size = ann["size"]
                    c.setFillColorRGB(0, 0, 0)
                    c.setFont("Helvetica", size)
                    # drawString takes a baseline y; top is the top of the text.
                    c.drawString(left, ph - top - size, ann["text"])
            c.save()
            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_path = ctx.new_output_path("edited.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
