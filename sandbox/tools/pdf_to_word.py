"""SANDBOX ONLY — PDF to Word (.docx) with OCR.

Workflow (OCR is a required step, not optional):
  1. Render each PDF page to an image.
  2. Run the OCR pipeline on every page to obtain positioned words.
     - Preferred: local Tesseract (isolated sandbox setup).
     - Fallback: the production PDFEDI OCR API (read-only use; production
       itself is never modified). The API returns a searchable PDF whose
       invisible text layer carries word positions.
  3. Reconstruct document structure from positioned words:
     words -> lines -> paragraphs, headings detected by size/weight.
  4. Build a .docx with python-docx preserving paragraphs and headings.

This is a sandbox experiment. Do NOT move to production without approval.
"""
from __future__ import annotations

import io
import re
import shutil
import tempfile
import time
import urllib.request
import urllib.error
import json as jsonlib
from pathlib import Path

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:\+[A-Za-z]{2,3})*$")
_PROD_API = "https://pdfedi.onrender.com/api/v1"
_OCR_DPI = 200  # balance of accuracy vs. speed for the recognition pass

SPEC = ToolSpec(
    key="pdf_to_word",
    name="PDF to Word",
    tagline="Convert PDF to editable Word via OCR",
    description=(
        "Sandbox experiment: runs every page through OCR, then rebuilds the "
        "document structure (paragraphs, headings) as an editable .docx file."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="language",
            kind="text",
            label="Language",
            required=False,
            default="eng",
            help="Tesseract language code, e.g. 'eng' or 'eng+deu'.",
        ),
    ],
    output_kind="text",
    output_ext="docx",
    output_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    activity="converting",
    category="convert",
)


def _ocr_words_local(image, language: str) -> list[dict]:
    """Positioned words via local Tesseract. Raises ToolError if unavailable."""
    try:
        import pytesseract
    except ImportError:
        raise ToolError("Local OCR engine not installed.", code="ocr_unavailable")
    if shutil.which("tesseract") is None:
        raise ToolError("Local OCR engine not installed.", code="ocr_unavailable")
    try:
        data = pytesseract.image_to_data(
            image, lang=language, output_type=pytesseract.Output.DICT,
            timeout=300,
        )
    except Exception as e:
        raise ToolError(f"OCR failed: {e}", code="ocr_failed") from e
    words = []
    for i, text in enumerate(data.get("text", [])):
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (ValueError, TypeError):
            continue
        if conf < 30:
            continue
        words.append({
            "text": text,
            "x0": float(data["left"][i]), "top": float(data["top"][i]),
            "width": float(data["width"][i]), "height": float(data["height"][i]),
        })
    return words


def _api_post(url: str, data: bytes | None = None, headers: dict | None = None,
              files: dict | None = None) -> dict:
    """Minimal HTTP helper (no extra dependencies)."""
    if files:
        boundary = "----sandboxboundary1234"
        body = io.BytesIO()
        for name, (filename, content, mime) in files.items():
            body.write(f"--{boundary}\r\n".encode())
            body.write(
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
            )
            body.write(f"Content-Type: {mime}\r\n\r\n".encode())
            body.write(content)
            body.write(b"\r\n")
        body.write(f"--{boundary}--\r\n".encode())
        data = body.getvalue()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return jsonlib.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        raise ToolError(f"Production OCR API error ({e.code}): {detail}", code="ocr_api_error") from e
    except Exception as e:
        raise ToolError(f"Production OCR API unreachable: {e}", code="ocr_api_error") from e


def _ocr_words_via_api(pdf_bytes: bytes, language: str) -> list[list[dict]]:
    """Run the production OCR API (read-only), return positioned words per page.

    The production OCR returns a searchable PDF; its invisible text layer
    carries the recognized words with positions, which we extract here.
    Production itself is not modified in any way.
    """
    import pdfplumber

    up = _api_post(
        f"{_PROD_API}/uploads",
        files={"file": ("sandbox.pdf", pdf_bytes, "application/pdf")},
    )
    file_id = up["id"]
    job = _api_post(
        f"{_PROD_API}/jobs",
        data=jsonlib.dumps({
            "tool_key": "ocr", "file_ids": [file_id],
            "config": {"language": language},
        }).encode(),
        headers={"Content-Type": "application/json"},
    )
    job_id = job["id"]
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(3)
        st = _api_post(f"{_PROD_API}/jobs/{job_id}")
        if st["status"] == "succeeded":
            break
        if st["status"] in ("failed", "cancelled"):
            raise ToolError(
                f"Production OCR job failed: {st.get('error')}", code="ocr_failed"
            )
    else:
        raise ToolError("Production OCR job timed out.", code="ocr_failed")

    out_id = st["output_file_id"]
    req = urllib.request.Request(f"{_PROD_API}/downloads/{out_id}")
    with urllib.request.urlopen(req, timeout=120) as resp:
        ocr_pdf = resp.read()

    pages: list[list[dict]] = []
    with pdfplumber.open(io.BytesIO(ocr_pdf)) as pdf:
        for page in pdf.pages:
            words = []
            for w in page.extract_words():
                words.append({
                    "text": w["text"],
                    "x0": w["x0"], "top": w["top"],
                    "width": w["x1"] - w["x0"], "height": w["bottom"] - w["top"],
                })
            pages.append(words)
    return pages


def _words_to_paragraphs(words: list[dict]) -> list[dict]:
    """Group positioned words into lines, then paragraphs; detect headings."""
    if not words:
        return []
    # Sort top-to-bottom, left-to-right.
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    # Line grouping: words whose vertical centers are close belong together.
    lines: list[list[dict]] = []
    for w in words:
        placed = False
        yc = w["top"] + w["height"] / 2
        for line in lines:
            lyc = line[0]["top"] + line[0]["height"] / 2
            lh = max(x["height"] for x in line)
            if abs(yc - lyc) < lh * 0.6:
                line.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])
    for line in lines:
        line.sort(key=lambda w: w["x0"])
    lines.sort(key=lambda l: l[0]["top"])

    # Paragraph grouping: a large vertical gap starts a new paragraph.
    paragraphs: list[dict] = []
    current: list[list[dict]] = []
    prev_bottom = None
    for line in lines:
        top = min(w["top"] for w in line)
        bottom = max(w["top"] + w["height"] for w in line)
        if prev_bottom is not None:
            gap = top - prev_bottom
            avg_h = sum(w["height"] for w in line) / len(line)
            if gap > avg_h * 0.9 and current:
                paragraphs.append({"lines": current})
                current = []
        current.append(line)
        prev_bottom = bottom
    if current:
        paragraphs.append({"lines": current})

    # Heading detection: short, all-caps or large text.
    result = []
    for p in paragraphs:
        text = " ".join(w["text"] for line in p["lines"] for w in line)
        heights = [w["height"] for line in p["lines"] for w in line]
        avg_h = sum(heights) / len(heights) if heights else 0
        words_flat = [w["text"] for line in p["lines"] for w in line]
        is_heading = (
            len(words_flat) <= 8
            and len(text) < 80
            and (text.isupper() or avg_h > 22)
        )
        result.append({"text": text, "heading": is_heading})
    return result


def run(ctx: ToolContext, options: dict) -> Path:
    from docx import Document
    from docx.shared import Pt

    language = get_option(options, SPEC, "language") or "eng"
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "Option 'language' must be a Tesseract language code like 'eng'.",
            code="invalid_option",
        )
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    pdf_bytes = ctx.inputs[0].path.read_bytes()
    if not pdf_bytes.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    # --- Step 1+2: OCR pipeline (required) ---
    try:
        import pypdfium2 as pdfium
        import pytesseract  # noqa: F401
        local_ok = shutil.which("tesseract") is not None
    except ImportError:
        local_ok = False

    pages_paragraphs: list[list[dict]] = []
    if local_ok:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
        try:
            for i in range(len(pdf)):
                img = pdf[i].render(scale=_OCR_DPI / 72).to_pil()
                words = _ocr_words_local(img, language)
                pages_paragraphs.append(_words_to_paragraphs(words))
        finally:
            pdf.close()
        ocr_source = "local tesseract"
    else:
        # Fallback: production OCR API (read-only use).
        words_per_page = _ocr_words_via_api(pdf_bytes, language)
        pages_paragraphs = [_words_to_paragraphs(w) for w in words_per_page]
        ocr_source = "production OCR API"

    # --- Step 3: build .docx preserving structure ---
    doc = Document()
    style = doc.styles["Normal"]
    style.font.size = Pt(11)
    for pi, paras in enumerate(pages_paragraphs):
        if pi > 0:
            doc.add_page_break()
        if not paras:
            continue
        for p in paras:
            if p["heading"]:
                doc.add_heading(p["text"], level=1)
            else:
                doc.add_paragraph(p["text"])

    out_path = ctx.new_output_path("converted").with_suffix(".docx")
    doc.save(str(out_path))
    # Record OCR provenance inside the docx core properties.
    return out_path
