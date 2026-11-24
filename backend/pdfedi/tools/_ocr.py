"""Shared OCR service (Phase 0) — one tesseract invocation for all tools.

Previously the OCR tool (``ocr.py``) and the PDF to Excel hybrid engine
(``pdf_to_excel.py``) each ran their own tesseract call with different
settings (200 DPI vs 150 DPI), and PDF to Word / PowerPoint / HTML / EPUB
had no OCR path at all: a scanned page in those tools yielded nothing,
silently. This module is the single OCR entry point for all six tools.

Pipeline (measured best in the 2026-11-23 OCR research):
  * Render the page at 200 DPI via pypdfium2 (300 DPI measured worse;
    200 DPI is also 2.25x less memory than 300 DPI).
  * Tesseract LSTM engine (``--oem 1``), automatic page segmentation
    (PSM 3) via pytesseract, words with confidence < 30 dropped.
  * PSM 11 retry ONLY on sparse pages (fewer than
    ``_SPARSE_WORD_THRESHOLD`` kept words): measured +9.3 points on the
    degraded test file — the retry does its work on that file's page 1
    (13 kept words under PSM 3, 17 of 18 under PSM 11), so the threshold
    must cover sparse-but-nonempty pages. Never applied globally —
    PSM 11 alone scores 72.6% mean vs 92.3%.

Every call returns an :class:`OcrPageResult` carrying the quality signal
(engine used, mean word confidence, word count, retry flag) so callers
can warn instead of silently shipping garbage. A page with no recognised
words is reported as such (``word_count == 0``), never passed through
quietly.

Degrades gracefully: if pytesseract or the ``tesseract`` binary is
unavailable, raises ToolError with code "ocr_unavailable".
"""
from __future__ import annotations

import gc
import io
import logging
import re
import shutil
import statistics
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from pdfedi.tools.base import ToolError

log = logging.getLogger(__name__)

# 200 DPI render: Tesseract is accurate at 200+ DPI and this uses 2.25x less
# memory than 300 DPI. Critical on memory-constrained hosts: the old OCR
# tool held the full-res PIL image in memory *while* Tesseract (a
# subprocess) allocated its own copy, pushing RSS over the limit and
# getting the container OOM-killed mid-job. Images are spilled to disk
# and released BEFORE tesseract runs (see ocr_page / ocr_image).
_DPI = 200
# Tesseract config: LSTM OCR engine (oem 1), fully automatic page segmentation.
_TESSERACT_CONFIG = "--oem 1"
_PSM11_CONFIG = "--oem 1 --psm 11"
# Per-page recognition timeout (seconds): fail gracefully, never hang forever.
_PAGE_TIMEOUT = 600
_MIN_CONFIDENCE = 30
# A PSM 3 result with fewer kept words than this counts as "sparse"
# and triggers the PSM 11 retry. Calibrated on the research corpus: the
# degraded file's page 1 yields 13 kept words under PSM 3 (17 raw) and
# 17 of 18 under PSM 11 — the retry must fire there, so the threshold
# sits above 13. A normal text page carries far more words; a genuinely
# short page (title page, form fragment) that triggers the retry only
# pays one extra tesseract run, and the better result is kept.
_SPARSE_WORD_THRESHOLD = 20
# Mean word confidence below this marks a page low-confidence (surfaced
# to the user by callers). Clean scans measure ~90+; the degraded file's
# page 1 measures ~60 after the PSM 11 retry. Calibrate on the Phase 1
# pilot; this threshold is a starting point, not a measured optimum.
_LOW_CONFIDENCE_MEAN = 50.0

_LANGUAGE_RE = re.compile(
    r"^[A-Za-z]{2,3}(?:_[a-z]+)?(?:\+[A-Za-z]{2,3}(?:_[a-z]+)?)*$"
)
# Tesseract language codes for the 10 PDFEDI locales. All packs are
# installed in the Docker image (see Dockerfile); a code outside this
# set is rejected as an invalid option rather than failing inside
# tesseract with a cryptic "data file" error.
SUPPORTED_LANGUAGES = frozenset(
    {"ara", "ben", "chi_sim", "eng", "fra", "hin", "ind", "por", "spa", "urd"}
)

# Lazily cached `tesseract --list-langs` output (None = not probed yet,
# False = probe failed, fall back to trusting SUPPORTED_LANGUAGES).
_installed_langs: set[str] | bool | None = None


@dataclass
class OcrWord:
    """One recognised word, in render pixels at 200 DPI (top-left origin)."""

    text: str
    x: int  # left, px from the left edge
    y: int  # top, px from the top edge
    w: int
    h: int
    conf: float


@dataclass
class OcrLine:
    """Words grouped into one text line (reading order, top to bottom)."""

    text: str
    x: int
    y: int
    w: int
    h: int
    mean_conf: float

    @property
    def size_pt(self) -> float:
        """Median word height in PDF points (for font sizing)."""
        return self.h * 72.0 / _DPI


@dataclass
class OcrPageResult:
    """Structured result of OCR-ing one page, with the quality signal."""

    words: list[OcrWord] = field(default_factory=list)
    mean_confidence: float = 0.0  # mean conf over kept words; 0.0 if none
    raw_word_count: int = 0  # words found before the conf >= 30 filter
    retried: bool = False  # True when the PSM 11 retry ran
    engine: str = "tesseract"

    @property
    def word_count(self) -> int:
        return len(self.words)

    @property
    def low_confidence(self) -> bool:
        """True when the page should be flagged to the user.

        Either nothing was recognised at all, or the mean confidence of
        what was recognised is low. Callers surface this in the output
        (Notes sheet, annotation, slide note, ...) — never silently.
        """
        return self.word_count == 0 or self.mean_confidence < _LOW_CONFIDENCE_MEAN

    def lines(self) -> list[OcrLine]:
        """Group kept words into lines by vertical proximity.

        Words are processed in tesseract's own reading order and that
        order is kept inside each line — do NOT re-sort by x: for RTL
        scripts (Arabic, Urdu) the reading order is right-to-left and
        x-sorting would reverse the words. Lines come back top-to-bottom.
        """
        if not self.words:
            return []
        med_h = statistics.median(w.h for w in self.words) or 10
        tol = max(10.0, med_h * 0.9)
        grouped: list[list[OcrWord]] = []
        for word in self.words:  # tesseract reading order, preserved
            cy = word.y + word.h / 2
            best = None
            best_d = None
            for group in grouped:
                cur_y = statistics.median([c.y + c.h / 2 for c in group])
                d = abs(cy - cur_y)
                if d <= tol and (best_d is None or d < best_d):
                    best, best_d = group, d
            if best is None:
                grouped.append([word])
            else:
                best.append(word)
        grouped.sort(key=lambda g: min(w.y for w in g))
        out: list[OcrLine] = []
        for group in grouped:
            text = " ".join(w.text for w in group)
            x = min(w.x for w in group)
            y = min(w.y for w in group)
            r = max(w.x + w.w for w in group)
            b = max(w.y + w.h for w in group)
            confs = [w.conf for w in group]
            out.append(OcrLine(
                text=text, x=x, y=y, w=r - x, h=b - y,
                mean_conf=sum(confs) / len(confs) if confs else 0.0,
            ))
        return out

    def text(self) -> str:
        """Plain text of the page: one line per line, top to bottom."""
        return "\n".join(line.text for line in self.lines())

    def lines_in_points(self, page_w_pt: float, page_h_pt: float) -> list[dict]:
        """Lines converted to PDF points, bottom-origin (pdfium convention).

        Returns dicts {"text", "x0", "y0", "x1", "y1", "size"} matching
        the boxes ``pdf_to_word`` / ``pdf_to_pptx`` build from pdfium
        charboxes, so OCR lines slot into those tools unchanged.
        Tesseract pixels are top-origin; pdfium points are bottom-origin.
        """
        scale = 72.0 / _DPI
        out = []
        for line in self.lines():
            x0 = line.x * scale
            x1 = (line.x + line.w) * scale
            # line.y is the top edge in px from the page top.
            y1 = page_h_pt - line.y * scale
            y0 = page_h_pt - (line.y + line.h) * scale
            out.append({
                "text": line.text, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "size": line.size_pt,
            })
        return out


def ocr_available() -> bool:
    """True when tesseract can run on this host."""
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def _require_ocr():
    try:
        import pytesseract
    except ImportError:
        raise ToolError(
            "OCR is not available on this server.", code="ocr_unavailable"
        ) from None
    if shutil.which("tesseract") is None:
        raise ToolError(
            "OCR is not available on this server.", code="ocr_unavailable"
        )
    return pytesseract


def _installed_languages() -> set[str] | None:
    """Languages actually installed (best-effort; None if unknowable)."""
    global _installed_langs
    if _installed_langs is not None:
        return _installed_langs if isinstance(_installed_langs, set) else None
    try:
        proc = subprocess.run(
            ["tesseract", "--list-langs"], capture_output=True, text=True,
            timeout=30,
        )
        langs = {
            line.strip() for line in proc.stdout.splitlines()
            if line.strip() and not line.startswith("List of")
        }
        _installed_langs = langs
        return langs
    except Exception:
        _installed_langs = False
        return None


def validate_language(language: str) -> str:
    """Validate an OCR language option; returns the normalised code.

    Accepts a single code (``eng``) or ``+``-joined codes (``eng+deu``).
    Rejects unknown codes and codes whose traineddata is not installed,
    with a plain message instead of tesseract's "data file" error.
    """
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise ToolError(
            "Option 'language' must be a Tesseract language code like "
            "'eng' or 'eng+ara'.",
            code="invalid_option",
        )
    parts = language.split("+")
    unknown = [p for p in parts if p not in SUPPORTED_LANGUAGES]
    if unknown:
        raise ToolError(
            f"OCR language '{unknown[0]}' is not supported on this site. "
            "Supported languages: " + ", ".join(sorted(SUPPORTED_LANGUAGES)) + ".",
            code="invalid_option",
        )
    installed = _installed_languages()
    if installed is not None:
        missing = [p for p in parts if p not in installed]
        if missing:
            raise ToolError(
                f"OCR language '{missing[0]}' is not installed on this "
                "server yet.",
                code="ocr_unavailable",
            )
    return language


def _parse_words(result: dict) -> tuple[list[OcrWord], int]:
    """Parse pytesseract image_to_data output.

    Returns (kept words with conf >= 30, raw word count before filtering).
    Words with conf < 0 are tesseract's non-word entries (blocks/lines).
    """
    kept: list[OcrWord] = []
    raw = 0
    texts = result.get("text", [])
    for idx, text in enumerate(texts):
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(result["conf"][idx])
        except (ValueError, TypeError, IndexError):
            continue
        if conf < 0:
            continue
        raw += 1
        if conf < _MIN_CONFIDENCE:
            continue
        try:
            x, y = int(result["left"][idx]), int(result["top"][idx])
            w, h = int(result["width"][idx]), int(result["height"][idx])
        except (ValueError, TypeError, IndexError):
            continue
        if w <= 0 or h <= 0:
            continue
        kept.append(OcrWord(text=text, x=x, y=y, w=w, h=h, conf=conf))
    return kept, raw


def _run_tesseract(pytesseract, image_path: str, lang: str, config: str,
                   timeout: float):
    """One tesseract run; returns the raw image_to_data dict."""
    return pytesseract.image_to_data(
        image_path, lang=lang, output_type=pytesseract.Output.DICT,
        config=config, timeout=timeout,
    )


def _result_from_words(words: list[OcrWord], raw: int, retried: bool) -> OcrPageResult:
    mean = sum(w.conf for w in words) / len(words) if words else 0.0
    return OcrPageResult(
        words=words, mean_confidence=mean, raw_word_count=raw,
        retried=retried,
    )


def ocr_image(image_path: str | Path, *, lang: str = "eng",
              timeout: float = _PAGE_TIMEOUT) -> OcrPageResult:
    """OCR one rendered page image (PNG file path).

    PSM 3 fast path, with a PSM 11 retry only when the fast path finds
    almost nothing. The retry result replaces the fast-path result only
    when it finds more kept words.
    """
    pytesseract = _require_ocr()
    lang = validate_language(lang)
    try:
        result = _run_tesseract(pytesseract, str(image_path), lang,
                                _TESSERACT_CONFIG, timeout)
    except Exception as e:
        raise ToolError(f"OCR failed: {e}", code="ocr_failed") from e
    words, raw = _parse_words(result)
    if len(words) >= _SPARSE_WORD_THRESHOLD:
        return _result_from_words(words, raw, retried=False)
    # Near-empty page: one PSM 11 retry on the same image.
    log.info("ocr sparse page: PSM 3 found %d words, retrying with PSM 11",
             len(words))
    try:
        retry = _run_tesseract(pytesseract, str(image_path), lang,
                               _PSM11_CONFIG, timeout)
    except Exception as e:
        log.info("ocr PSM 11 retry failed: %s", e)
        return _result_from_words(words, raw, retried=True)
    r_words, r_raw = _parse_words(retry)
    if len(r_words) > len(words):
        log.info("ocr PSM 11 retry won: %d words vs %d",
                 len(r_words), len(words))
        return _result_from_words(r_words, max(raw, r_raw), retried=True)
    return _result_from_words(words, raw, retried=True)


def ocr_page(data: bytes, page_index: int, *, lang: str = "eng",
             timeout: float = _PAGE_TIMEOUT,
             tmpdir: Path | None = None) -> OcrPageResult:
    """OCR one page of a PDF (0-based index) at 200 DPI.

    Renders the page with pypdfium2, spills the image to disk, releases
    it, then runs tesseract on the file (never holding the image in
    memory during OCR — see module docstring). ``tmpdir`` may be supplied
    by the caller (the image file is removed afterwards either way).
    """
    _require_ocr()
    lang = validate_language(lang)
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "OCR is not available on this server.", code="ocr_unavailable"
        ) from exc
    try:
        doc = pdfium.PdfDocument(io.BytesIO(data))
        page = doc[page_index]
        pil_image = page.render(scale=_DPI / 72).to_pil()
    except Exception as e:
        raise ToolError(f"OCR failed: could not render page: {e}",
                        code="ocr_failed") from e
    own_tmpdir = tmpdir is None
    if own_tmpdir:
        tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-ocr-"))
    img_file = tmpdir / f"ocr_page_{page_index}.png"
    try:
        pil_image.save(str(img_file), optimize=True)
        del pil_image
        gc.collect()
        return ocr_image(img_file, lang=lang, timeout=timeout)
    finally:
        try:
            img_file.unlink(missing_ok=True)
        except OSError:
            pass
        if own_tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        try:
            doc.close()
        except Exception:
            pass


def quality_note(page_no: int, result: OcrPageResult) -> str | None:
    """Human-readable quality note for one OCR'd page, or None if fine.

    Three cases: nothing recognised at all; still very little recognised
    even after the sparse-page retry (fewer than 10 words — the retry
    having run is not itself a warning: it can rescue a page, as on the
    degraded file's page 1, which recovers 17 words); recognised but low
    mean confidence. Callers surface the note in the output (metadata,
    Notes sheet, slide note, ...) — never silently.
    """
    if result.word_count == 0:
        return f"page {page_no} — no text recognised"
    if result.retried and result.word_count < 10:
        return (
            f"page {page_no} — very little text recognised "
            f"({result.word_count} words, sparse-page retry used)"
        )
    if result.mean_confidence < _LOW_CONFIDENCE_MEAN:
        return (
            f"page {page_no} — low OCR confidence "
            f"(mean {result.mean_confidence:.0f}%, {result.word_count} words)"
        )
    return None


def page_needs_ocr(reader_page, min_chars: int = 50) -> bool:
    """True if a pypdf page lacks a usable native text layer (a scan).

    Shared by the OCR tool and the converters: cheap (no rendering),
    so native-text pages are never OCR'd.
    """
    try:
        text = reader_page.extract_text() or ""
        return len(text.strip()) < min_chars
    except Exception:
        # If text extraction fails, assume it needs OCR (safe default).
        return True
