"""Acceptance tests for the 5 new PDFEDI tools: crop, extract_images,
resize_pages, grayscale, n_up. Builds fixtures with reportlab/pypdf and runs
every tool through the real registry."""
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, "/home/hatch/workspace/pdfedi/backend")

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from pdfedi.tools import get_tool, list_specs
from pdfedi.tools.base import ToolContext, ToolInput, ToolError

TMP = Path("/tmp/new-tools-test")
TMP.mkdir(parents=True, exist_ok=True)

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


def make_input(pdf_bytes: bytes, name: str = "test.pdf"):
    p = TMP / name
    p.write_bytes(pdf_bytes)
    return ToolContext(inputs=[ToolInput(
        file_id="t", filename=name, path=p, size=len(pdf_bytes),
        sha256="x", page_count=None,
    )])


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


def pdf_rect(w, h, n_pages=3, text="Hello"):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    for i in range(n_pages):
        c.drawString(72, h / 2, f"{text} page {i + 1}")
        c.showPage()
    c.save()
    return buf.getvalue()


def pdf_with_image():
    img = Image.new("RGB", (60, 40), (200, 30, 30))
    ibuf = io.BytesIO()
    img.save(ibuf, "JPEG", quality=90)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.drawImage(ImageReader(io.BytesIO(ibuf.getvalue())), 100, 400, width=200, height=133)
    c.drawString(72, 700, "image page")
    c.showPage()
    c.save()
    return buf.getvalue()


def pdf_encrypted():
    w = PdfWriter()
    w.add_blank_page(595, 842)
    w.encrypt("secret")
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


# ---- fixtures ----
TEXT_PDF = pdf_rect(595, 842, 3)
IMG_PDF = pdf_with_image()
NOIMG_PDF = pdf_rect(595, 842, 1, text="no images here")
ENC_PDF = pdf_encrypted()
NOT_PDF = b"this is not a pdf at all"


# ---- registry sanity ----
def t_registry():
    specs = list_specs()
    assert len(specs) == 27, f"{len(specs)} tools"
    keys = [s.key for s in specs]
    assert len(set(keys)) == len(keys), "duplicate keys"
    for k in ("crop", "extract_images", "resize_pages", "grayscale", "n_up"):
        assert get_tool(k) is not None, f"missing {k}"
    ts = Path("/home/hatch/workspace/pdfedi/web/lib/tools.ts").read_text()
    for k in ("crop", "extract_images", "resize_pages", "grayscale", "n_up"):
        assert f'key: "{k}"' in ts, f"tools.ts missing {k}"
check("registry: 27 tools, no dupes, tools.ts entries", t_registry)


# ---- crop ----
def t_crop_happy():
    mod = get_tool("crop")
    out = mod.run(make_input(TEXT_PDF), {"top": 36, "bottom": 36, "left": 72, "right": 72})
    assert out.exists(), "no output"
    r = PdfReader(str(out))
    assert len(r.pages) == 3
    box = r.pages[0].cropbox
    w = float(box.right) - float(box.left)
    h = float(box.top) - float(box.bottom)
    assert abs(w - (595 - 144)) < 1, f"w={w}"
    assert abs(h - (842 - 72)) < 1, f"h={h}"
check("crop: margins shrink page rect", t_crop_happy)

def t_crop_pages_opt():
    mod = get_tool("crop")
    out = mod.run(make_input(TEXT_PDF), {"top": 50, "pages": "1"})
    r = PdfReader(str(out))
    h1 = float(r.pages[0].cropbox.top) - float(r.pages[0].cropbox.bottom)
    h2 = float(r.pages[1].cropbox.top) - float(r.pages[1].cropbox.bottom)
    assert abs(h1 - (842 - 50)) < 1, f"h1={h1}"
    assert abs(h2 - 842) < 1, f"h2={h2} (page 2 must be untouched)"
check("crop: pages option crops only page 1", t_crop_pages_opt)

expect_tool_error("crop: margins too large -> invalid_crop", "crop",
                  make_input(TEXT_PDF), {"left": 400, "right": 400}, code="invalid_crop")
expect_tool_error("crop: negative margin -> bad_option", "crop",
                  make_input(TEXT_PDF), {"top": -5}, code="bad_option")
expect_tool_error("crop: encrypted -> ToolError", "crop",
                  make_input(ENC_PDF, "enc.pdf"), {"top": 10})
expect_tool_error("crop: non-PDF -> ToolError", "crop",
                  make_input(NOT_PDF, "x.bin"), {"top": 10})


# ---- extract_images ----
def t_extract_happy():
    mod = get_tool("extract_images")
    out = mod.run(make_input(IMG_PDF), {})
    assert out.exists() and out.suffix == ".zip", "no zip"
    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
    assert len(names) >= 1, "zip empty"
    for n in names:
        assert n.rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "jp2"), n
check("extract_images: zip contains >=1 image", t_extract_happy)

expect_tool_error("extract_images: no images -> no_images", "extract_images",
                  make_input(NOIMG_PDF), {}, code="no_images")
expect_tool_error("extract_images: encrypted -> ToolError", "extract_images",
                  make_input(ENC_PDF, "enc.pdf"), {})
expect_tool_error("extract_images: non-PDF -> ToolError", "extract_images",
                  make_input(NOT_PDF, "x.bin"), {})


# ---- resize_pages ----
def t_resize_happy():
    mod = get_tool("resize_pages")
    out = mod.run(make_input(TEXT_PDF), {"size": "a5", "mode": "fit"})
    r = PdfReader(str(out))
    assert len(r.pages) == 3
    box = r.pages[0].mediabox
    assert abs(float(box.right) - 420) < 1 and abs(float(box.top) - 595) < 1, \
        f"{float(box.right)}x{float(box.top)}"
check("resize_pages: pages are A5", t_resize_happy)

def t_resize_stretch():
    mod = get_tool("resize_pages")
    out = mod.run(make_input(TEXT_PDF), {"size": "letter", "mode": "stretch"})
    r = PdfReader(str(out))
    box = r.pages[0].mediabox
    assert abs(float(box.right) - 612) < 1 and abs(float(box.top) - 792) < 1
check("resize_pages: stretch -> letter", t_resize_stretch)

expect_tool_error("resize_pages: bad size -> bad_option", "resize_pages",
                  make_input(TEXT_PDF), {"size": "a0"}, code="bad_option")
expect_tool_error("resize_pages: encrypted -> ToolError", "resize_pages",
                  make_input(ENC_PDF, "enc.pdf"), {"size": "a4"})
expect_tool_error("resize_pages: non-PDF -> ToolError", "resize_pages",
                  make_input(NOT_PDF, "x.bin"), {"size": "a4"})


# ---- grayscale ----
def t_grayscale_happy():
    mod = get_tool("grayscale")
    out = mod.run(make_input(TEXT_PDF), {"dpi": 100})
    assert out.exists()
    r = PdfReader(str(out))
    assert len(r.pages) == 3, f"{len(r.pages)} pages"
    box = r.pages[0].mediabox
    assert abs(float(box.right) - 595) < 1, "dimensions preserved"
check("grayscale: valid output, page count + dims match", t_grayscale_happy)

expect_tool_error("grayscale: dpi 9999 -> bad_option", "grayscale",
                  make_input(TEXT_PDF), {"dpi": 9999}, code="bad_option")
expect_tool_error("grayscale: dpi 10 -> bad_option", "grayscale",
                  make_input(TEXT_PDF), {"dpi": 10}, code="bad_option")
expect_tool_error("grayscale: encrypted -> ToolError", "grayscale",
                  make_input(ENC_PDF, "enc.pdf"), {})
expect_tool_error("grayscale: non-PDF -> ToolError", "grayscale",
                  make_input(NOT_PDF, "x.bin"), {})


# ---- n_up ----
def t_nup_happy():
    mod = get_tool("n_up")
    out = mod.run(make_input(TEXT_PDF), {"layout": "4", "sheet": "a4",
                                         "orientation": "portrait"})
    r = PdfReader(str(out))
    # 3 pages at 4-up -> 1 sheet
    assert len(r.pages) == 1, f"{len(r.pages)} sheets"
    box = r.pages[0].mediabox
    assert abs(float(box.right) - 595) < 1 and abs(float(box.top) - 842) < 1
check("n_up: 3 pages at 4-up -> 1 A4 sheet", t_nup_happy)

def t_nup_multi():
    mod = get_tool("n_up")
    five = pdf_rect(595, 842, 5)
    out = mod.run(make_input(five), {"layout": "2", "sheet": "letter",
                                     "orientation": "landscape"})
    r = PdfReader(str(out))
    assert len(r.pages) == 3, f"ceil(5/2)={len(r.pages)}"  # ceil(5/2)=3
    box = r.pages[0].mediabox
    assert abs(float(box.right) - 792) < 1 and abs(float(box.top) - 612) < 1, \
        "landscape letter"
check("n_up: 5 pages at 2-up landscape -> 3 sheets", t_nup_multi)

expect_tool_error("n_up: bad layout -> bad_option", "n_up",
                  make_input(TEXT_PDF), {"layout": "3"}, code="bad_option")
expect_tool_error("n_up: encrypted -> ToolError", "n_up",
                  make_input(ENC_PDF, "enc.pdf"), {"layout": "4"})
expect_tool_error("n_up: non-PDF -> ToolError", "n_up",
                  make_input(NOT_PDF, "x.bin"), {"layout": "4"})


print(f"\n==== RESULT: {passed} passed, {failed} failed ====")
sys.exit(1 if failed else 0)
