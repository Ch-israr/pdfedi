"""Convert a PDF to a standalone .html file (pypdfium2).

Text is extracted with its on-page position, so the HTML keeps the
rough visual layout: each page becomes a positioned block and each
line of text an absolutely positioned span. This preserves where
words sit on the page, but it is not a pixel-perfect rendering —
images, vector graphics and exact fonts are not reproduced. Scanned
image-only pages have no text layer and convert to empty pages;
run OCR first for those.
"""
from __future__ import annotations

import html as html_lib
from pathlib import Path

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="pdf_to_html",
    name="PDF to HTML",
    tagline="Turn a PDF into a web page",
    description=(
        "Convert a PDF into a standalone .html file. Text keeps its "
        "on-page position, so the layout looks close to the original. "
        "Images and vector graphics are not reproduced."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(name="include_page_numbers", kind="boolean",
                   label="Show page dividers", required=False, default=True,
                   help="Add a visible 'Page N' divider between pages."),
    ],
    output_kind="text",
    output_ext="html",
    output_mime="text/html",
    activity="converting",
    category="convert",
)


def _page_html(page, width: float, height: float, page_no: int, show_dividers: bool) -> str:
    """Render one PDF page as positioned text runs inside a page div.

    Uses PDFium's rect API: each rect already covers one run of text
    on a single line, so no char-level line grouping is needed (naive
    grouping by baseline breaks on descenders like 'p' and 'g').
    """
    textpage = page.get_textpage()
    try:
        parts: list[str] = []
        for i in range(textpage.count_rects()):
            try:
                left, bottom, right, top = textpage.get_rect(i)
                text = textpage.get_text_bounded(left, bottom, right, top)
            except Exception:
                continue
            if not text.strip():
                continue
            font_size = max(6.0, min(top - bottom, 72.0))
            left_pct = left / width * 100.0
            # PDF origin is bottom-left; HTML is top-left.
            top_pct = (height - top) / height * 100.0
            top_pct = max(0.0, min(top_pct, 99.0))
            parts.append(
                f'<span class="l" style="left:{left_pct:.2f}%;top:{top_pct:.2f}%;'
                f'font-size:{font_size:.1f}px">{html_lib.escape(text)}</span>'
            )
        body = "\n".join(parts)
    finally:
        textpage.close()
    divider = f'<div class="pg">Page {page_no}</div>\n' if show_dividers else ""
    return (
        f'{divider}<div class="page" style="width:{width:.0f}px;height:{height:.0f}px">\n'
        f"{body}\n</div>\n"
    )


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to HTML needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")
    show_dividers = bool(get_option(options, SPEC, "include_page_numbers"))

    data = read_input_bytes(ctx.inputs[0].path)
    page_count = page_count_of_pdf(data)
    if page_count > 500:
        raise ToolError(
            f"PDF to HTML supports at most 500 pages; this file has {page_count}.",
            code="invalid_input",
        )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "PDF to HTML is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    pdf = pdfium.PdfDocument(data)
    try:
        pages_html: list[str] = []
        for page_no in range(1, page_count + 1):
            page = pdf[page_no - 1]
            try:
                width, height = page.get_size()
                pages_html.append(_page_html(page, width, height, page_no, show_dividers))
            finally:
                page.close()
    finally:
        pdf.close()

    title = html_lib.escape(ctx.inputs[0].filename)
    doc = (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        f"<title>{title}</title>\n"
        "<style>\n"
        "body{margin:0 auto;max-width:900px;padding:24px;background:#f1f5f9;"
        "font-family:system-ui,sans-serif;color:#0f172a}\n"
        ".pg{margin:24px 0 8px;font-size:13px;font-weight:600;color:#64748b}\n"
        ".page{position:relative;background:#fff;margin:0 auto 24px;"
        "box-shadow:0 1px 4px rgba(0,0,0,.15);overflow:hidden}\n"
        ".l{position:absolute;white-space:pre;line-height:1.2}\n"
        "</style>\n</head>\n<body>\n"
        + "".join(pages_html)
        + "</body>\n</html>\n"
    )
    out = Path(str(ctx.new_output_path("converted")) + ".html")
    out.write_text(doc, encoding="utf-8")
    return out
