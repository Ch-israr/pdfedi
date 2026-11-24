"""Unicode text layer for the OCR tool (Arabic text-layer fix).

Background: reportlab's built-in Helvetica is a WinAnsi (Latin-1) Type1
font with no ToUnicode map. Any non-Latin word drawn with it collapses
— verified live 2026-11-24: OCR on an Arabic scan recognised the words
correctly, but the output PDF's text layer contained only the letter
"n" (0 Arabic codepoints). This module registers embedded TrueType Noto
fonts (``TTFont`` embeds a ToUnicode CMap, so extraction returns the
real codepoints) and picks the font per word by Unicode script.

Fonts (all SIL OFL, downloaded at Docker build time into ``/srv/fonts``
— never committed to the repo; see Dockerfile):
  NotoNaskhArabic-Regular.ttf     Arabic script (ara, urd) — RTL
  NotoSansDevanagari-Regular.ttf  Devanagari (hin)
  NotoSansBengali-Regular.ttf     Bengali (ben)
  NotoSansSC-Regular.ttf          CJK Simplified (chi_sim) + broad fallback
    (variable font, default instance = Regular; reportlab ``TTFont``
    only supports TrueType outlines, so the CFF-outlined OTF build of
    Noto Sans CJK SC cannot be used)

Latin words keep Helvetica, so English behaviour is byte-identical to
before. RTL words are stored in VISUAL order (characters reversed):
PDF content streams paint glyphs left-to-right, and extractors (pypdf
default mode, Acrobat, pdf.js) reverse RTL runs on extraction to
recover logical order — storing logical order would double-reverse
(verified: logical storage extracts as reversed words, visual storage
extracts as the correct logical words). The layer is invisible
(``setFillAlpha(0)`` in ``ocr.py``), so glyph shaping does not matter
visually; the extracted codepoints are what matters.

If a font file is missing (local dev without the Docker image), the
affected script falls back to Helvetica with a loud log warning —
degraded, never a crash. In production the Dockerfile guarantees the
fonts (size-checked downloads), so the fallback should never fire.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

# Font name -> file name under the fonts directory.
FONT_FILES: dict[str, str] = {
    "NotoNaskhArabic": "NotoNaskhArabic-Regular.ttf",
    "NotoSansDevanagari": "NotoSansDevanagari-Regular.ttf",
    "NotoSansBengali": "NotoSansBengali-Regular.ttf",
    "NotoSansSC": "NotoSansSC-Regular.ttf",
}

# Unicode ranges -> (font name, is_rtl). First matching character in the
# word decides the font for the whole word.
_SCRIPT_RANGES: list[tuple[int, int, str, bool]] = [
    # Arabic (ara, urd): Arabic, Arabic Supplement, Arabic Extended-A,
    # Arabic Presentation Forms-A/B.
    (0x0600, 0x06FF, "NotoNaskhArabic", True),
    (0x0750, 0x077F, "NotoNaskhArabic", True),
    (0x08A0, 0x08FF, "NotoNaskhArabic", True),
    (0xFB50, 0xFDFF, "NotoNaskhArabic", True),
    (0xFE70, 0xFEFF, "NotoNaskhArabic", True),
    # Devanagari (hin) + Devanagari Extended.
    (0x0900, 0x097F, "NotoSansDevanagari", False),
    (0xA8E0, 0xA8FF, "NotoSansDevanagari", False),
    # Bengali (ben).
    (0x0980, 0x09FF, "NotoSansBengali", False),
    # CJK (chi_sim): CJK Radicals/Symbols, Kangxi, Ideographic
    # Description, CJK Symbols and Punctuation, Hiragana/Katakana ranges
    # excluded (not a PDFEDI locale), CJK Unified Ext A, CJK Unified,
    # Compatibility Ideographs, Fullwidth Forms.
    (0x2E80, 0x2FFF, "NotoSansSC", False),
    (0x3000, 0x303F, "NotoSansSC", False),
    (0x3400, 0x4DBF, "NotoSansSC", False),
    (0x4E00, 0x9FFF, "NotoSansSC", False),
    (0xF900, 0xFAFF, "NotoSansSC", False),
    (0xFF00, 0xFFEF, "NotoSansSC", False),
]

# Fonts successfully registered in this process (module-level cache).
_REGISTERED: set[str] = set()
# Fonts already warned about as missing (warn once per font).
_WARNED_MISSING: set[str] = set()


def resolve_font_dir(font_dir: str | Path | None = None) -> Path | None:
    """Locate the directory holding the Noto TTFs, or None if unknown.

    Precedence: explicit argument > ``PDFEDI_OCR_FONTS`` env var >
    ``/srv/fonts`` (Docker image) > ``fonts/`` next to this module.
    """
    if font_dir is not None:
        return Path(font_dir)
    env = os.environ.get("PDFEDI_OCR_FONTS")
    if env:
        return Path(env)
    for candidate in (Path("/srv/fonts"), Path(__file__).resolve().parent / "fonts"):
        if candidate.is_dir():
            return candidate
    return None


def ensure_textlayer_fonts(font_dir: str | Path | None = None) -> dict[str, bool]:
    """Register the Noto fonts with reportlab (idempotent).

    Returns ``{font_name: registered}``. A missing file is a warning,
    not an error — ``font_for_word`` falls back to Helvetica for that
    script (degraded output, never a crash).
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    directory = resolve_font_dir(font_dir)
    result: dict[str, bool] = {}
    for name, filename in FONT_FILES.items():
        if name in _REGISTERED:
            result[name] = True
            continue
        path = (directory / filename) if directory is not None else None
        if path is None or not path.is_file():
            result[name] = False
            if name not in _WARNED_MISSING:
                _WARNED_MISSING.add(name)
                log.warning(
                    "ocr text-layer font %s not found in %s; "
                    "non-Latin words in that script will fall back to "
                    "Helvetica (unsearchable)",
                    filename, directory,
                )
            continue
        try:
            pdfmetrics.registerFont(TTFont(name, str(path)))
        except Exception as e:  # corrupt/unsupported file: degrade, don't crash
            result[name] = False
            if name not in _WARNED_MISSING:
                _WARNED_MISSING.add(name)
                log.warning("ocr text-layer font %s failed to register: %s",
                            filename, e)
            continue
        _REGISTERED.add(name)
        result[name] = True
    return result


def _script_font_for_char(ch: str) -> tuple[str, bool] | None:
    """(font name, is_rtl) for one character, or None if Latin/neutral."""
    code = ord(ch)
    for lo, hi, font, rtl in _SCRIPT_RANGES:
        if lo <= code <= hi:
            return font, rtl
    return None


def font_for_word(text: str) -> tuple[str, str]:
    """Pick the text-layer font for one OCR word.

    Returns ``(font_name, text_to_draw)``. RTL words are returned in
    VISUAL order (characters reversed) — see module docstring. Latin
    words return Helvetica and the text unchanged. Words in no covered
    script but outside WinAnsi (e.g. Cyrillic, Greek) use NotoSansSC,
    the broadest-coverage font shipped, so they survive as real
    codepoints instead of raising inside reportlab.
    """
    if not text:
        return "Helvetica", text
    chosen: tuple[str, bool] | None = None
    for ch in text:
        chosen = _script_font_for_char(ch)
        if chosen is not None:
            break
    if chosen is None:
        try:
            text.encode("cp1252")
        except UnicodeEncodeError:
            chosen = ("NotoSansSC", False)
        else:
            return "Helvetica", text
    font, rtl = chosen
    if font not in _REGISTERED:
        if font not in _WARNED_MISSING:
            _WARNED_MISSING.add(font)
            log.warning(
                "ocr text-layer font %s not registered; word %r falls "
                "back to Helvetica (unsearchable)", font, text)
        return "Helvetica", text
    if rtl:
        return font, text[::-1]
    return font, text
