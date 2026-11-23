"""Convert a PDF to a reflowable .epub ebook (stdlib only).

Text is extracted page by page and flowed into chapters (up to 10
pages per chapter). The ebook keeps the reading order, but the
original page layout is NOT preserved — text reflows to the reader's
font and screen size, which is the point of EPUB. Images, tables and
vector graphics are not carried over. Scanned image-only pages have
no text layer and produce empty chapters; run OCR first for those.
"""
from __future__ import annotations

import html as html_lib
import uuid
import zipfile
from pathlib import Path

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

PAGES_PER_CHAPTER = 10
MAX_PAGES = 500

SPEC = ToolSpec(
    key="pdf_to_epub",
    name="PDF to EPUB",
    tagline="Turn a PDF into an ebook",
    description=(
        "Convert a PDF into a reflowable .epub ebook for e-readers. Text "
        "flows to your reader's font and screen size; the original page "
        "layout is not preserved."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="text",
    output_ext="epub",
    output_mime="application/epub+zip",
    activity="converting",
    category="convert",
)

_CONTAINER_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    "  <rootfiles>\n"
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'
    "  </rootfiles>\n"
    "</container>\n"
)


def _chapter_xhtml(title: str, page_texts: list[tuple[int, str]]) -> str:
    parts = [f"<h1>{html_lib.escape(title)}</h1>"]
    for page_no, text in page_texts:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
        if paragraphs:
            parts.append(f'<p class="pg">Page {page_no}</p>')
            for para in paragraphs:
                parts.append(f"<p>{html_lib.escape(para)}</p>")
    body = "\n".join(parts)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en">\n'
        f"<head><title>{html_lib.escape(title)}</title>"
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        f"<body>\n{body}\n</body>\n</html>\n"
    )


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to EPUB needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")

    data = read_input_bytes(ctx.inputs[0].path)
    page_count = page_count_of_pdf(data)
    if page_count > MAX_PAGES:
        raise ToolError(
            f"PDF to EPUB supports at most {MAX_PAGES} pages; this file has {page_count}.",
            code="invalid_input",
        )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "PDF to EPUB is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    filename = ctx.inputs[0].filename
    stem = Path(filename).stem or "document"

    # Best-effort metadata from the PDF itself.
    title = stem
    author = "PDFEDI"
    try:
        from pypdf import PdfReader
        from io import BytesIO

        meta = PdfReader(BytesIO(data)).metadata
        if meta is not None:
            # reportlab-generated PDFs carry placeholder metadata
            # ("untitled"/"anonymous") — treat those as missing.
            if getattr(meta, "title", None) not in (None, "", "untitled"):
                title = str(meta.title)
            if getattr(meta, "author", None) not in (None, "", "anonymous"):
                author = str(meta.author)
    except Exception:
        pass

    pdf = pdfium.PdfDocument(data)
    try:
        page_texts: list[str] = []
        for page_no in range(1, page_count + 1):
            page = pdf[page_no - 1]
            try:
                textpage = page.get_textpage()
                try:
                    page_texts.append(textpage.get_text_range().strip())
                finally:
                    textpage.close()
            finally:
                page.close()
    finally:
        pdf.close()

    book_id = f"urn:uuid:{uuid.uuid4()}"
    chapters: list[tuple[str, str]] = []  # (href, title)
    chapter_files: dict[str, str] = {}
    for start in range(0, page_count, PAGES_PER_CHAPTER):
        chunk = list(enumerate(page_texts[start:start + PAGES_PER_CHAPTER], start=start + 1))
        idx = start // PAGES_PER_CHAPTER + 1
        href = f"chapter{idx}.xhtml"
        ctitle = f"Pages {chunk[0][0]}–{chunk[-1][0]}" if len(chunk) > 1 else f"Page {chunk[0][0]}"
        chapters.append((href, ctitle))
        chapter_files[href] = _chapter_xhtml(ctitle, chunk)

    style_css = (
        "body{font-family:serif;line-height:1.5;margin:5%}\n"
        "h1{font-size:1.4em}\n"
        ".pg{font-size:.8em;color:#666}\n"
    )

    manifest_items = ["<item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>"]
    spine_items = []
    for i, (href, _t) in enumerate(chapters, start=1):
        manifest_items.append(
            f"<item id=\"ch{i}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>"
        )
        spine_items.append(f"<itemref idref=\"ch{i}\"/>")
    manifest_items.append(
        "<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>"
    )
    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">\n'
        "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n"
        f"<dc:title>{html_lib.escape(title)}</dc:title>\n"
        f"<dc:creator>{html_lib.escape(author)}</dc:creator>\n"
        "<dc:language>en</dc:language>\n"
        f"<dc:identifier id=\"bookid\">{book_id}</dc:identifier>\n"
        "</metadata>\n"
        "<manifest>\n" + "\n".join(manifest_items) + "\n</manifest>\n"
        "<spine toc=\"ncx\">\n" + "\n".join(spine_items) + "\n</spine>\n"
        "</package>\n"
    )
    nav_points = []
    for i, (href, ctitle) in enumerate(chapters, start=1):
        nav_points.append(
            f"<navPoint id=\"np{i}\" playOrder=\"{i}\">"
            f"<navLabel><text>{html_lib.escape(ctitle)}</text></navLabel>"
            f"<content src=\"{href}\"/></navPoint>"
        )
    ncx = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        "<head>"
        f"<meta name=\"dtb:uid\" content=\"{book_id}\"/>"
        "</head>\n"
        f"<docTitle><text>{html_lib.escape(title)}</text></docTitle>\n"
        "<navMap>\n" + "\n".join(nav_points) + "\n</navMap>\n"
        "</ncx>\n"
    )

    out = Path(str(ctx.new_output_path("ebook")) + ".epub")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # EPUB spec: mimetype first, stored uncompressed.
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", _CONTAINER_XML)
        zf.writestr("OEBPS/content.opf", opf)
        zf.writestr("OEBPS/toc.ncx", ncx)
        zf.writestr("OEBPS/style.css", style_css)
        for href, content in chapter_files.items():
            zf.writestr(f"OEBPS/{href}", content)
    return out
