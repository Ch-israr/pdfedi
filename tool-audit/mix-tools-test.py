"""Mix-tools test suite: repair, compare, pdf_to_word (27 tools total).

Fixtures are built with reportlab/pypdf (NO PyMuPDF — AGPL-banned). Run:
    python3 tool-audit/mix-tools-test.py
from ~/workspace/pdfedi (backend on sys.path).
"""
from __future__ import annotations

import io
import random
import re
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, "/home/hatch/workspace/pdfedi/backend")

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from pdfedi.tools import get_tool, list_specs
from pdfedi.tools.base import ToolContext, ToolError, ToolInput

TMP = Path(tempfile.mkdtemp(prefix="mix-tools-test-"))
passed = failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
    except AssertionError as e:
        failed += 1
        print(f"FAIL  {name}: {e}")
    except Exception as e:
        failed += 1
        print(f"FAIL  {name}: unexpected {type(e).__name__}: {e}")
    else:
        passed += 1
        print(f"PASS  {name}")


def make_ctx(files: list[tuple[bytes, str]]) -> ToolContext:
    inputs = []
    for i, (data, name) in enumerate(files):
        p = TMP / f"{i}_{name}"
        p.write_bytes(data)
        inputs.append(ToolInput(
            file_id=f"t{i}", filename=name, path=p, size=len(data),
            sha256="x", page_count=None,
        ))
    return ToolContext(inputs=inputs)


def expect_tool_error(name, tool_key, ctx, options, code=None):
    def _t():
        mod = get_tool(tool_key)
        try:
            out = mod.run(ctx, options)
        except ToolError as e:
            if code and e.code != code:
                raise AssertionError(f"code={e.code!r}, expected {code!r}")
            return
        raise AssertionError(f"expected ToolError, got output {out}")
    check(name, _t)


def valid_pdf(data: bytes, min_pages: int = 1) -> int:
    r = PdfReader(io.BytesIO(data))
    n = len(r.pages)
    assert n >= min_pages, f"expected >= {min_pages} pages, got {n}"
    return n


# ---------------------------------------------------------------- fixtures

def text_pdf(pages: int = 2, prefix: str = "Line") -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i in range(pages):
        c.setFont("Helvetica", 12)
        c.drawString(72, 780, f"{prefix} page {i + 1}")
        c.drawString(72, 750, "Second line of body text here.")
        c.showPage()
    c.save()
    return buf.getvalue()


def word_fixture() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(72, 780, "Report Title")
    c.setFont("Helvetica", 12)
    c.drawString(72, 748, "First paragraph opening sentence.")
    c.drawString(72, 732, "First paragraph second sentence.")
    c.drawString(72, 700, "Second paragraph starts here.")
    c.showPage()
    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, 780, "Section Two")
    c.setFont("Helvetica", 12)
    c.drawString(72, 748, "Another paragraph of content.")
    c.showPage()
    c.save()
    return buf.getvalue()


def image_fixture() -> bytes:
    img = Image.new("RGB", (120, 80), (30, 120, 200))
    ibuf = io.BytesIO()
    img.save(ibuf, "JPEG", quality=90)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.drawImage(ImageReader(io.BytesIO(ibuf.getvalue())), 100, 500, width=240, height=160)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "Caption above the image.")
    c.showPage()
    c.save()
    return buf.getvalue()


def image_only_pdf() -> bytes:
    img = Image.new("RGB", (300, 400), (90, 90, 90))
    buf = io.BytesIO()
    img.save(buf, "PDF")
    return buf.getvalue()


def encrypted_pdf() -> bytes:
    buf = io.BytesIO()
    w = PdfWriter()
    r = PdfReader(io.BytesIO(text_pdf(1)))
    w.add_page(r.pages[0])
    w.encrypt("secret")
    w.write(buf)
    return buf.getvalue()


def truncated_pdf() -> bytes:
    data = text_pdf(3)
    return data[: int(len(data) * 0.6)]


def xref_scrambled_pdf() -> bytes:
    """Scramble some digits inside the xref table of a copy."""
    data = text_pdf(2)
    idx = data.find(b"xref")
    assert idx != -1, "fixture has no xref table"
    tail = data[idx:]
    # Replace digits in byte offsets with other digits.
    scrambled = re.sub(
        rb"\d{10}",
        lambda m: b"".join(bytes([(b - 48 + 3) % 10 + 48]) for b in m.group(0)),
        tail,
        count=12,
    )
    return data[:idx] + scrambled


# ---------------------------------------------------------------- repair

def t_repair_healthy():
    data = text_pdf(2)
    out = get_tool("repair").run(make_ctx([(data, "ok.pdf")]), {})
    assert valid_pdf(out.read_bytes(), 2) == 2


def t_repair_truncated():
    out = get_tool("repair").run(make_ctx([(truncated_pdf(), "cut.pdf")]), {})
    n = valid_pdf(out.read_bytes(), 1)
    assert n >= 1, "truncated repair lost all pages"


def t_repair_xref_scrambled():
    mod = get_tool("repair")
    try:
        out = mod.run(make_ctx([(xref_scrambled_pdf(), "scr.pdf")]), {})
    except ToolError as e:
        assert e.code == "unrepairable", f"unexpected code {e.code}"
        return
    # If it repaired, the output must be a valid PDF.
    valid_pdf(out.read_bytes(), 1)


def t_repair_encrypted():
    expect_tool_error("repair: encrypted", "repair",
                      make_ctx([(encrypted_pdf(), "enc.pdf")]), {}, "encrypted_pdf")


def t_repair_garbage():
    expect_tool_error("repair: garbage", "repair",
                      make_ctx([(b"\x00\x01not a pdf at all\xff", "junk.pdf")]),
                      {}, "unrepairable")


check("repair: healthy -> valid copy", t_repair_healthy)
check("repair: truncated -> readable", t_repair_truncated)
check("repair: xref scrambled -> repaired or clean error", t_repair_xref_scrambled)
check("repair: encrypted -> clean ToolError", lambda: t_repair_encrypted())
check("repair: garbage -> unrepairable", lambda: t_repair_garbage())

# ---------------------------------------------------------------- compare

def t_compare_identical():
    expect_tool_error("compare: identical", "compare",
                      make_ctx([(text_pdf(2), "a.pdf"), (text_pdf(2), "b.pdf")]),
                      {}, "no_differences")


def t_compare_changed_line():
    a = text_pdf(2, prefix="Line")
    b = text_pdf(2, prefix="Line")
    # Change one line in b by rebuilding with a different prefix on page 1.
    b = text_pdf(2, prefix="CHANGED-LINE")
    out = get_tool("compare").run(make_ctx([(a, "orig.pdf"), (b, "rev.pdf")]), {})
    n = valid_pdf(out.read_bytes(), 2)
    assert n == 2, f"expected 2 pages, got {n}"
    # Re-render output page 1 and count red-ish pixels (the boxes).
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(out.read_bytes())
    try:
        img = doc[0].render(scale=1.0).to_pil().convert("RGB")
    finally:
        doc.close()
    px = img.load()
    reds = sum(
        1 for x in range(0, img.width, 2) for y in range(0, img.height, 2)
        if px[x, y][0] > 180 and px[x, y][1] < 110 and px[x, y][2] < 110
    )
    assert reds > 0, "no red annotation pixels found on changed page"


def t_compare_page_counts():
    a = text_pdf(2)
    b = text_pdf(3)
    out = get_tool("compare").run(make_ctx([(a, "orig.pdf"), (b, "rev.pdf")]), {})
    n = valid_pdf(out.read_bytes(), 1)
    assert n == 3, f"expected 3 sheets (added page included), got {n}"


def t_compare_non_pdf():
    expect_tool_error("compare: non-PDF", "compare",
                      make_ctx([(text_pdf(1), "a.pdf"), (b"nope", "b.pdf")]),
                      {}, "invalid_input")


check("compare: identical -> no_differences", t_compare_identical)
check("compare: changed line -> red boxes", t_compare_changed_line)
check("compare: 2 vs 3 pages -> extra page included", t_compare_page_counts)
check("compare: non-PDF -> clean ToolError", t_compare_non_pdf)

# ---------------------------------------------------------------- pdf_to_word

def t_word_basic():
    from docx import Document
    out = get_tool("pdf_to_word").run(make_ctx([(word_fixture(), "doc.pdf")]), {})
    data = out.read_bytes()
    assert out.suffix == ".docx", f"wrong suffix {out.suffix}"
    doc = Document(io.BytesIO(data))
    texts = [p.text for p in doc.paragraphs]
    joined = "\n".join(texts)
    assert "Report Title" in joined, "heading text missing"
    assert "First paragraph opening sentence." in joined, "body text missing"
    styles = {p.text: p.style.name for p in doc.paragraphs}
    assert styles.get("Report Title", "").startswith("Heading"), \
        f"heading style missing: {styles.get('Report Title')!r}"


def t_word_image():
    from docx import Document
    out = get_tool("pdf_to_word").run(make_ctx([(image_fixture(), "img.pdf")]), {})
    doc = Document(io.BytesIO(out.read_bytes()))
    assert "Caption above the image." in "\n".join(p.text for p in doc.paragraphs)
    # docx is a zip — check for an embedded image part.
    z = zipfile.ZipFile(io.BytesIO(out.read_bytes()))
    media = [n for n in z.namelist() if n.startswith("word/media/")]
    assert media, "no image part in docx package"


def t_word_no_text():
    expect_tool_error("word: image-only -> no_text", "pdf_to_word",
                      make_ctx([(image_only_pdf(), "scan.pdf")]), {}, "no_text")


def t_word_encrypted():
    expect_tool_error("word: encrypted -> clean ToolError", "pdf_to_word",
                      make_ctx([(encrypted_pdf(), "enc.pdf")]), {}, "encrypted_pdf")


check("word: heading+paragraphs -> styled docx", t_word_basic)
check("word: embedded image -> image part", t_word_image)
check("word: image-only -> no_text", t_word_no_text)
check("word: encrypted -> clean ToolError", t_word_encrypted)

# ---------------------------------------------------------------- registry sanity

def t_registry():
    specs = list_specs()
    assert len(specs) == 27, f"expected 27 specs, got {len(specs)}"
    keys = [s.key for s in specs]
    assert len(set(keys)) == 27, "duplicate keys"
    for k in ("repair", "compare", "pdf_to_word"):
        assert k in keys, f"{k} missing from registry"


def t_frontend_entries():
    tools_ts = Path("/home/hatch/workspace/pdfedi/web/lib/tools.ts").read_text()
    content_ts = Path("/home/hatch/workspace/pdfedi/web/lib/tool-content.ts").read_text()
    keys = {s.key for s in list_specs()}
    for k in ("repair", "compare", "pdf_to_word"):
        assert f'key: "{k}"' in tools_ts, f"{k} missing from tools.ts"
        assert f"{k}: {{" in content_ts, f"{k} missing from tool-content.ts"
    # every "related" key in our 3 entries must be an existing tool key
    for k in ("repair", "compare", "pdf_to_word"):
        start = content_ts.index(f"  {k}: {{")
        window = content_ts[start:start + 6000]
        m = re.search(r"related:\s*\[(.*?)\]", window, re.S)
        assert m, f"no related in {k}"
        for rk in re.findall(r'"([^"]+)"', m.group(1)):
            assert rk in keys, f"related key {rk!r} in {k} is not a real tool"


check("registry: 27 specs, no dupes", t_registry)
check("frontend: entries + valid related keys", t_frontend_entries)

print(f"\n==== RESULT: {passed} passed, {failed} failed ====")
sys.exit(1 if failed else 0)
