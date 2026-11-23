"""Convert HTML to PDF (stdlib html.parser + reportlab Platypus).

Input is either pasted HTML (the "HTML code" box on the tool page)
or an uploaded .html/.htm file. Web addresses (URLs) are NOT fetched:
fetching arbitrary URLs server-side is a request-forgery risk, so
this tool only converts HTML you supply directly.

Rendering is intentionally simple and dependency-free: common HTML
tags (headings, paragraphs, lists, tables, links, bold/italic) are
converted to a formatted PDF. CSS styling, JavaScript and images are
NOT supported — a styled page renders as plain formatted text.
Non-Latin scripts (Arabic, CJK, etc.) also do not render correctly,
because the built-in Helvetica font only covers Latin text.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

MAX_HTML_BYTES = 500_000  # 500 KB of HTML
_VALID_PAGE_SIZE = ("A4", "Letter")
_VALID_ORIENTATION = ("portrait", "landscape")

SPEC = ToolSpec(
    key="html_to_pdf",
    name="HTML to PDF",
    tagline="Turn HTML code into a PDF",
    description=(
        "Convert HTML code into a PDF file. Paste your HTML or upload an "
        ".html file. Basic HTML tags are supported; CSS styling, "
        "JavaScript and images are not."
    ),
    input_kinds=["html"],
    min_files=0,
    max_files=1,
    options=[
        ToolOption(name="html", kind="textarea", label="HTML code",
                   required=False, default="",
                   help="Paste your HTML here. Leave empty to use the uploaded .html file instead."),
        ToolOption(name="page_size", kind="select", label="Page size",
                   required=False, default="A4", choices=["A4", "Letter"]),
        ToolOption(name="orientation", kind="select", label="Orientation",
                   required=False, default="portrait", choices=["portrait", "landscape"]),
        ToolOption(name="margin_mm", kind="number", label="Margin (mm)",
                   required=False, default=15, help="0 to 50."),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="converting",
    category="convert",
)

# Tags whose content is dropped entirely.
_SKIP_TAGS = {"script", "style", "head", "meta", "link", "title", "img",
              "input", "button", "select", "noscript", "svg", "video", "audio"}
_HEADING_SIZES = {"h1": 20, "h2": 16, "h3": 14, "h4": 12, "h5": 11, "h6": 10}


class _HtmlToFlowables(HTMLParser):
    """Minimal HTML -> Platypus flowables converter.

    Only structure and inline emphasis survive; CSS is ignored.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.story: list = []
        self._skip_depth = 0
        self._inline: list[str] = []      # open inline markup for current block
        self._buf: list[str] = []         # text of the current block
        self._block: str | None = None    # current block tag
        self._list_stack: list[str] = []  # "ul"/"ol" nesting
        self._li_index: list[int] = []    # running numbers for ol levels
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell_buf: list[str] | None = None

    # -- styles ---------------------------------------------------------
    @staticmethod
    def _style(name: str, **kw) -> ParagraphStyle:
        base = dict(fontName="Helvetica", fontSize=11, leading=15,
                    alignment=TA_JUSTIFY, spaceAfter=6)
        base.update(kw)
        return ParagraphStyle(name, **base)

    def _body_style(self) -> ParagraphStyle:
        return self._style("body")

    def _heading_style(self, tag: str) -> ParagraphStyle:
        return self._style(
            f"heading-{tag}", fontName="Helvetica-Bold",
            fontSize=_HEADING_SIZES[tag], leading=_HEADING_SIZES[tag] + 4,
            alignment=TA_LEFT, spaceBefore=10, spaceAfter=6,
        )

    # -- block handling ---------------------------------------------------
    def _flush_block(self) -> None:
        text = "".join(self._buf).strip()
        self._buf = []
        if not text:
            self._block = None
            return
        tag = self._block
        if tag in _HEADING_SIZES:
            self.story.append(Paragraph(text, self._heading_style(tag)))
        elif tag == "li":
            bullet = "•"
            if self._list_stack and self._list_stack[-1] == "ol":
                bullet = f"{self._li_index[-1]}."
            style = self._style("li", leftIndent=18, bulletIndent=6,
                                alignment=TA_LEFT)
            self.story.append(Paragraph(text, style, bulletText=bullet))
        elif tag == "pre":
            self.story.append(Paragraph(
                text.replace("\n", "<br/>"),
                self._style("pre", fontName="Courier", fontSize=9, leading=12,
                            alignment=TA_LEFT)))
        elif tag == "blockquote":
            self.story.append(Paragraph(
                text, self._style("quote", leftIndent=18, alignment=TA_LEFT,
                                  textColor="#475569")))
        else:
            self.story.append(Paragraph(text, self._body_style()))
        self._block = None

    def _flush_table(self) -> None:
        if not self._table:
            return
        rows = [[Paragraph(c or " ", self._body_style()) for c in row]
                for row in self._table if any(c.strip() for c in row)]
        self._table = None
        if not rows:
            return
        table = Table(rows, repeatRows=1)
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, "#94a3b8"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        self.story.append(table)
        self.story.append(Spacer(1, 6))

    # -- parser events ----------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag in ("p", "div", "section", "article", "pre", "blockquote",
                   "h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_block()
            self._block = tag
        elif tag == "li":
            self._flush_block()
            self._block = "li"
            if self._list_stack and self._list_stack[-1] == "ol":
                self._li_index[-1] += 1
        elif tag in ("ul", "ol"):
            self._flush_block()
            self._list_stack.append(tag)
            self._li_index.append(0)
        elif tag == "table":
            self._flush_block()
            self._table = []
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell_buf = []
        elif tag == "br":
            self._buf.append("<br/>")
        elif tag == "hr":
            self._flush_block()
            self.story.append(HRFlowable(width="100%", thickness=0.5, color="#94a3b8"))
        elif tag in ("b", "strong"):
            self._buf.append("<b>")
            self._inline.append("b")
        elif tag in ("i", "em"):
            self._buf.append("<i>")
            self._inline.append("i")
        elif tag == "u":
            self._buf.append("<u>")
            self._inline.append("u")
        elif tag == "code":
            self._buf.append('<font face="Courier">')
            self._inline.append("code")
        elif tag == "a":
            href = dict(attrs).get("href", "")
            self._buf.append(f'<a href="{href}">' if href else "")
            self._inline.append("a")
        elif tag == "font":
            attrs_d = dict(attrs)
            color = attrs_d.get("color", "")
            self._buf.append(f'<font color="{color}">' if color else "")
            self._inline.append("font")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag in ("p", "div", "section", "article", "pre", "blockquote",
                   "h1", "h2", "h3", "h4", "h5", "h6", "li"):
            self._flush_block()
        elif tag in ("ul", "ol"):
            self._flush_block()
            if self._list_stack:
                self._list_stack.pop()
                self._li_index.pop()
        elif tag == "table":
            self._flush_table()
        elif tag == "tr":
            if self._table is not None and self._row is not None:
                self._table.append(self._row)
            self._row = None
        elif tag in ("td", "th"):
            if self._row is not None and self._cell_buf is not None:
                self._row.append("".join(self._cell_buf))
            self._cell_buf = None
        elif tag in ("b", "strong"):
            self._buf.append("</b>")
        elif tag in ("i", "em"):
            self._buf.append("</i>")
        elif tag == "u":
            self._buf.append("</u>")
        elif tag == "code":
            self._buf.append("</font>")
        elif tag == "a":
            self._buf.append("</a>")
        elif tag == "font":
            self._buf.append("</font>")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._cell_buf is not None:
            self._cell_buf.append(data)
            return
        if self._block is None:
            # Bare text outside any block: treat as a paragraph.
            if not data.strip():
                return
            self._block = "p"
        # Escape markup characters. Tags emitted by handle_starttag /
        # handle_endtag are appended to _buf separately and are untouched.
        text = (data.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        self._buf.append(text)

    def finish(self) -> list:
        self._flush_block()
        self._flush_table()
        return self.story


def _coerce_int(value, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    if isinstance(value, float) and not value.is_integer():
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    if ivalue < minimum or ivalue > maximum:
        raise ToolError(f"Option '{name}' must be between {minimum} and {maximum}.", code="invalid_option")
    return ivalue


def run(ctx: ToolContext, options: dict) -> Path:
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")
    page_size = get_option(options, SPEC, "page_size")
    orientation = get_option(options, SPEC, "orientation")
    if page_size not in _VALID_PAGE_SIZE:
        raise ToolError(f"Option 'page_size' must be one of {_VALID_PAGE_SIZE}.", code="invalid_option")
    if orientation not in _VALID_ORIENTATION:
        raise ToolError(f"Option 'orientation' must be one of {_VALID_ORIENTATION}.", code="invalid_option")
    margin_mm = _coerce_int(get_option(options, SPEC, "margin_mm"), "margin_mm", 0, 50)

    pasted = get_option(options, SPEC, "html")
    html_text: str | None = None
    if isinstance(pasted, str) and pasted.strip():
        html_text = pasted
    elif ctx.inputs:
        raw = ctx.inputs[0].path.read_bytes()
        if len(raw) > MAX_HTML_BYTES:
            raise ToolError(
                f"HTML file is too large ({len(raw)} bytes; max {MAX_HTML_BYTES}).",
                code="invalid_input",
            )
        try:
            html_text = raw.decode("utf-8")
        except UnicodeDecodeError:
            html_text = raw.decode("latin-1")
    if html_text is None or not html_text.strip():
        raise ToolError(
            "Paste HTML code or upload an .html file first.",
            code="missing_input",
        )
    if len(html_text.encode("utf-8")) > MAX_HTML_BYTES:
        raise ToolError(
            f"HTML is too large (max {MAX_HTML_BYTES} bytes).",
            code="invalid_input",
        )

    parser = _HtmlToFlowables()
    try:
        parser.feed(html_text)
    except Exception as exc:
        raise ToolError(f"Could not parse this HTML: {exc}", code="invalid_input") from exc
    story = parser.finish()
    if not story:
        raise ToolError(
            "No readable content found in this HTML.",
            code="invalid_input",
        )

    base_size = A4 if page_size == "A4" else LETTER
    pagesize = landscape(base_size) if orientation == "landscape" else base_size
    out_path = Path(str(ctx.new_output_path("webpage")) + ".pdf")
    doc = SimpleDocTemplate(
        str(out_path), pagesize=pagesize,
        leftMargin=margin_mm * mm, rightMargin=margin_mm * mm,
        topMargin=margin_mm * mm, bottomMargin=margin_mm * mm,
        title="HTML to PDF", author="PDFEDI",
    )
    try:
        doc.build(story)
    except Exception as exc:
        raise ToolError(f"Could not convert this HTML: {exc}", code="tool_error") from exc
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise ToolError("Conversion produced an empty PDF.", code="tool_error")
    return out_path
