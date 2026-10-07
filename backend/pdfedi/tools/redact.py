"""Permanently redact literal text: delete it from content streams AND cover it.

A black rectangle alone is NOT redaction. This tool:
1. Locates literal text matches with pypdfium2 (character rects).
2. Deletes the matched text from the page content streams.
3. Overlays opaque black rectangles over the matched regions.
4. VERIFIES the redacted text cannot be extracted from the output.

If verification fails the run fails — a fake redaction is never returned.
"""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    require_option,
)

_RECT_PAD = 1.0  # points of extra coverage around each matched glyph box

SPEC = ToolSpec(
    key="redact",
    name="Redact PDF",
    tagline="Permanently black out sensitive text",
    description=(
        "Permanently removes sensitive text from a PDF: the text is deleted "
        "from the page content, covered with black rectangles, and the output "
        "is verified so the redacted text can no longer be extracted."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="patterns",
            kind="text",
            label="Text to redact",
            required=True,
            help="Comma-separated literal strings to black out, e.g. 'SSN, john@example.com'.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="security",
)


def _encoded_forms(text: str) -> list[bytes]:
    """Byte forms a literal string can take inside a decoded content stream."""
    forms: list[bytes] = []
    # PDF-escaped literal string, e.g. (caf\(e\)) — WinAnsi/UTF-8 identical for ASCII.
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    for enc in ("utf-8", "latin-1"):
        try:
            forms.append(escaped.encode(enc))
        except UnicodeEncodeError:
            pass
    # UTF-16BE with BOM (common for non-latin text in literal strings).
    forms.append(b"\xfe\xff" + text.encode("utf-16-be"))
    return forms


def _scrub_content_stream(page, literals: list[str]) -> None:
    """Replace literal occurrences of each string in the decoded content
    stream with spaces (same byte length keeps the stream valid)."""
    try:
        contents = page.get("/Contents")
    except Exception:
        return
    if contents is None:
        return
    try:
        obj = contents.get_object()
    except Exception:
        return

    is_array = isinstance(obj, ArrayObject)
    streams = list(obj) if is_array else [obj]
    new_streams: list = []
    changed = False
    for ref in streams:
        try:
            target = ref.get_object()
            data = target.get_data()
        except Exception:
            new_streams.append(ref)
            continue
        new_data = data
        for lit in literals:
            for form in _encoded_forms(lit):
                if form in new_data:
                    new_data = new_data.replace(form, b" " * len(form))
        if new_data != data:
            ns = DecodedStreamObject()
            ns.set_data(new_data)
            new_streams.append(ns)
            changed = True
        else:
            new_streams.append(ref)
    if changed:
        if len(new_streams) == 1 and not is_array:
            page[NameObject("/Contents")] = new_streams[0]
        else:
            page[NameObject("/Contents")] = ArrayObject(new_streams)


def _find_rects(pdf_bytes: bytes, literals: list[str]) -> dict[int, list[tuple]]:
    """{1-based page_no: [(x0, y0, x1, y1, literal)]} in PDF points."""
    import pypdfium2 as pdfium

    found: dict[int, list[tuple]] = {}
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        for page_no in range(1, len(pdf) + 1):
            page = pdf[page_no - 1]
            textpage = page.get_textpage()
            try:
                # Required once with defaults before get_rect() calls.
                textpage.count_rects()
                for lit in literals:
                    searcher = textpage.search(lit, match_case=True)
                    while True:
                        match = searcher.get_next()
                        if match is None:
                            break
                        start, count = match
                        n = textpage.count_rects(start, count)
                        rects = found.setdefault(page_no, [])
                        for i in range(n):
                            r = textpage.get_rect(i)
                            rects.append((r[0], r[1], r[2], r[3], lit))
                    searcher.close()
            finally:
                textpage.close()
            page.close()
    finally:
        pdf.close()
    return found


def _verify_removed(pdf_bytes: bytes, literals: list[str]) -> None:
    """Confirm no redacted literal is extractable from the output bytes."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        for page_no in range(1, len(pdf) + 1):
            page = pdf[page_no - 1]
            textpage = page.get_textpage()
            try:
                for lit in literals:
                    searcher = textpage.search(lit, match_case=True)
                    try:
                        if searcher.get_next() is not None:
                            raise ToolError(
                                "Redaction verification failed: redacted text is still "
                                "extractable from the output. The output was NOT returned.",
                                code="redaction_failed",
                            )
                    finally:
                        searcher.close()
            finally:
                textpage.close()
            page.close()
    finally:
        pdf.close()


def run(ctx: ToolContext, options: dict) -> Path:
    raw = require_option(options, SPEC, "patterns")
    if not isinstance(raw, str):
        raise ToolError("Option 'patterns' must be a comma-separated string.", code="invalid_option")
    literals = [p.strip() for p in raw.split(",") if p.strip()]
    if not literals:
        raise ToolError(
            "Option 'patterns' must contain at least one string to redact.", code="invalid_option"
        )

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ToolError("Input PDF is encrypted.", code="invalid_input")

    # --- Step 1: locate matches ---
    rects_by_page = _find_rects(data, literals)
    if not rects_by_page:
        raise ToolError(
            "No text matched the redaction patterns in this PDF.", code="no_matches"
        )

    # --- Step 2: scrub content streams + overlay black rectangles ---
    writer = PdfWriter()
    total_rects = 0
    for i, page in enumerate(reader.pages):
        page_no = i + 1
        rects = rects_by_page.get(page_no, [])
        if rects:
            page_literals = sorted({lit for _, _, _, _, lit in rects})
            _scrub_content_stream(page, page_literals)

            mediabox = page.mediabox
            pw = float(mediabox.width)
            ph = float(mediabox.height)
            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(pw, ph))
            c.setFillColor(black)
            c.setStrokeColor(black)
            for (x0, y0, x1, y1, _) in rects:
                c.rect(x0 - _RECT_PAD, y0 - _RECT_PAD,
                       (x1 - x0) + 2 * _RECT_PAD, (y1 - y0) + 2 * _RECT_PAD,
                       stroke=0, fill=1)
                total_rects += 1
            c.save()
            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out_bytes = out_buf.getvalue()

    # --- Step 3: verify ---
    _verify_removed(out_bytes, literals)

    out_path = ctx.new_output_path("redacted.pdf")
    out_path.write_bytes(out_bytes)
    return out_path
