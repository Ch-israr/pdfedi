# PDFEDI Tool Audit Report

**Date:** 2026-10-12
**Scope:** All 19 PDF tools in `backend/pdfedi/tools/`
**Method:** Black-box testing of each tool's `run(ctx, options)` — happy paths, error paths, SPEC sanity.
**Environment:** Python 3.12 venv with `pypdf==5.1.0`, `pypdfium2==4.30.0`, `pillow==11.0.0`, `reportlab==4.2.5` (exact Render pins). No tesseract binary, no pytesseract installed (deliberate — tests OCR fallback).
**Test-only:** no source files modified, nothing committed or deployed.

## Verdict summary

| Tool | Happy path | Error paths | SPEC | Verdict |
|---|---|---|---|---|
| compress | ⚠️ partial (see ISSUE-1) | PASS (4/4) | PASS | **FAIL** — silent no-op on FlateDecode images |
| merge | PASS | PASS (3/3) | PASS | PASS |
| split | PASS | PASS (5/5) | PASS | PASS |
| rotate_pages | PASS | PASS (4/4) | PASS | PASS |
| delete_pages | PASS | PASS (3/3) | PASS | PASS |
| reorder_pages | PASS | PASS (4/4) | PASS | PASS |
| extract_text | PASS | PASS (2/2) | PASS | PASS |
| pdf_to_images | PASS | PASS (3/3) | PASS | PASS |
| images_to_pdf | PASS | PASS (3/3) | PASS | PASS |
| thumbnails | PASS | PASS (2/2) | PASS | PASS (see note N-3) |
| metadata | PASS | PASS (1/1) | PASS | PASS |
| edit_metadata | PASS | PASS (1/1) | PASS | PASS |
| password_protect | PASS | PASS (3/3) | PASS | PASS |
| unlock_pdf | PASS | PASS (4/4) | PASS | PASS |
| watermark | PASS (render-verified) | PASS (2/2) | PASS | PASS |
| page_numbers | PASS | PASS (3/3) | PASS | PASS |
| redact | PASS (true redaction) | PASS (2/2) | PASS | PASS |
| flatten | PASS (annots removed) | PASS (1/1) | PASS | PASS |
| ocr | PASS (graceful fallback) | PASS (1/1) | PASS | PASS |

**Totals: 106 tests — 105 PASS, 1 FAIL, 0 CRASHES (unhandled exceptions).**

Every error path across all 19 tools raised a clean `ToolError` with a user-facing message and code. Not a single unhandled exception was observed.

---

## Issues found

### ISSUE-1 (medium): `compress` silently skips FlateDecode/PNG images — quality setting misleading
**Evidence:**
- Test PDF with a 1600×1600 FlateDecode image, `quality="low"`: output image still 1600×1600, file size 3,920,278 → 3,919,790 bytes (**0.01% reduction** — structural/metadata savings only).
- Root cause: `_downsample_image_object()` calls `img_obj.get_data()`, which for FlateDecode images returns **raw RGB pixel bytes** (7,680,000 bytes, no image header). `PIL.Image.open()` cannot parse raw bytes → `UnidentifiedImageError` → caught by bare `except Exception: return False` → image silently left untouched.
- By contrast, JPEG-embedded (DCTDecode) images work correctly: 2,733,566 → 165,083 bytes (**94% reduction**), 1600→800 px at `quality="low"`.
- `quality="high"` correctly leaves images intact (verified).
- Metadata IS stripped on re-save (verified: Title/Author removed).

**Impact:** For the common case (PNG/Flate images, e.g. reportlab-generated PDFs, screenshots), a user selecting "Low quality" expecting real shrinkage gets ~0% reduction with no warning. The tool's headline promise ("Reduce PDF file size… Choose a quality level") is silently broken for these files.

**Suggested fix (not applied — test-only task):** reconstruct a PIL image from raw samples using the XObject's `/Width`, `/Height`, `/ColorSpace`, `/BitsPerComponent` instead of `Image.open()` on raw bytes; or at minimum surface a notice when zero images were actually downsampled.

### ISSUE-2 (cosmetic): `images_to_pdf` leaks an object repr in a user-facing error
`Input #1 is not a readable image: cannot identify image file <_io.BytesIO object at 0x7a172d647c90>` — the raw memory address is noise for end users. Still a clean `ToolError`, just ugly.

### N-3 (note): `thumbnails` output_kind says "images" but returns one file
SPEC declares `output_kind="images"`, `output_ext="png"`; `run()` returns a single contact-sheet PNG (verified opens in PIL, 264×497 for the test). Functionally fine; the plural kind label is slightly misleading. The API layer presumably handles it.

---

## Special-attention findings

### compress — memory claim PARTIALLY CONFIRMED
Memory said: "only re-saves + strips metadata (no real compression)". The code *intends* real downsampling and it **works for JPEG/DCTDecode images** (94% reduction measured). But for FlateDecode images it silently degrades to re-save + metadata strip (ISSUE-1). So the memory note is accurate for PNG-type images, outdated as a blanket statement.

### split — memory claim REFUTED ✅
Memory said: "returns only first requested range". **False — split works correctly.** `ranges="1-2,4-5"` on a 5-page PDF produced a ZIP with 2 PDFs (`pages-001-002.pdf`, `pages-004-005.pdf`), page counts [2, 2]. `mode="every"` produced 5 single-page PDFs. Single range `"2"` → one `page-002.pdf`. The memory note is stale; no bug present.

### ocr — graceful fallback verified ✅
With no tesseract binary and no pytesseract installed: `ToolError [ocr_unavailable] "OCR is not available on this server."` — clean, no crash, no traceback. Code checks in the right order (import → binary).

### unlock_pdf / password_protect — real round-trip verified ✅
- `password_protect` output: `is_encrypted=True`, decrypts with the password, 3 pages intact.
- `unlock_pdf` with correct password: output opens with no password, text intact.
- Wrong password → `ToolError [wrong_password] "Incorrect password."` (no crash, no timing weirdness observed).
- `unlock_pdf` on unencrypted PDF → `ToolError [invalid_input] "This PDF is not password protected."`
- Encrypted input to `compress` → `ToolError [encrypted_pdf]` (clean rejection).

### redact — TRUE redaction verified ✅
- Pattern `SECRET-XYZ-123` **absent from extracted text** AND **absent from raw output bytes** — not a visual cover-up; the text is deleted from content streams.
- Page count preserved (3), surrounding text intact.
- Pattern not found → `ToolError [no_matches] "No text matched the redaction patterns in this PDF."` (clean, not silent success).

### watermark / page_numbers — page counts preserved, visibility confirmed ✅
- Both preserve page count (5/5).
- Watermark text is **not** extractable via text extraction (drawn as graphics), so verified visually instead: rendered with pypdfium2, dark-pixel count 1,283 → 10,752 — watermark definitely visible.
- `page_numbers` custom options (top/right, start=10, prefix, font size) accepted; string `"5"` for `start_number` coerced without error.

---

## Per-tool detail

### compress
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy low (Flate image) | **FAIL** | image 1600×1600 → 1600×1600, bytes −0.01% (ISSUE-1) |
| happy low (JPEG image) | PASS | 2.73 MB → 165 KB, 1600 → 800 px |
| quality=high intact | PASS | image dimensions unchanged |
| metadata stripped | PASS | Title/Author removed on re-save |
| corrupt input | PASS | `[invalid_input]` |
| .txt input | PASS | `[invalid_input]` |
| bad quality value | PASS | `[bad_option]` |
| 2 files (max=1) | PASS | `[bad_input_count]` |

### merge
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy 3+2 pages | PASS | 5 pages, order preserved |
| single file (min=2) | PASS | `[bad_input_count] Merge needs between 2 and 20 PDF files; got 1.` |
| 21 files (max=20) | PASS | `[bad_input_count]` — max enforced in run() |
| corrupt 2nd file | PASS | `[invalid_input]` |
| .txt file | PASS | `[invalid_input]` |

### split
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| ranges "1-2,4-5" | PASS | ZIP with 2 PDFs, pages [2,2] — memory claim refuted |
| mode=every | PASS | 5 single-page PDFs |
| single range "2" | PASS | one `page-002.pdf` |
| ranges missing | PASS | `[missing_option]` |
| bad token "abc" | PASS | `[bad_option]` |
| out of range "1-99" | PASS | `[bad_option]` |
| reversed "3-1" | PASS | `[bad_option]` |
| corrupt input | PASS | `[invalid_input]` |

### rotate_pages
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| angle=90 pages 1-2 | PASS | `/Rotate` = [90,90,0,0,0] |
| missing angle | PASS | `[missing_option]` |
| bad angle "45" | PASS | `[bad_option]` |
| pages "99" | PASS | `[bad_option]` |
| corrupt input | PASS | `[invalid_input]` |

### delete_pages
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| delete "2,4" | PASS | 3 pages remain, markers 1/3/5 kept |
| missing pages | PASS | `[missing_option]` |
| out of range | PASS | `[bad_option]` |
| bad token "x" | PASS | `[bad_option]` |

### reorder_pages
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| order "3,1,2" | PASS | text order verified 3→1→2 |
| missing order | PASS | `[missing_option]` |
| duplicate "1,1,2" | PASS | `[bad_option]` permutation enforced |
| missing page "1,2" | PASS | `[bad_option]` |
| out of range "1,2,9" | PASS | `[bad_option]` |

### extract_text
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| pages "1-2" | PASS | markers 1,2 present; marker 3 absent |
| output non-empty | PASS | 93 chars for 2 pages |
| blank PDF (no text) | PASS | empty output, no crash |
| corrupt input | PASS | `[invalid_input]` |
| pages "99" | PASS | `[invalid_option]` |

### pdf_to_images
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| png dpi=72 pages 1-2 | PASS | `page-001.png`, `page-002.png`, both open in PIL |
| jpeg | PASS | `page-001.jpg`, `page-002.jpg` |
| corrupt input | PASS | `[invalid_input]` |
| bad format "gif" | PASS | `[invalid_option]` |
| pages "99" | PASS | `[invalid_option]` |

### images_to_pdf
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| 2 images → PDF | PASS | 2 pages |
| corrupt image | PASS | `[invalid_input]` (message contains BytesIO repr — ISSUE-2) |
| .txt as image | PASS | `[invalid_input]` |
| no files | PASS | `[invalid_input]` min enforced in run() |

### thumbnails
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy (columns=2, w=120) | PASS | single contact-sheet PNG opens in PIL |
| default options | PASS | works |
| corrupt input | PASS | `[invalid_input]` |
| pages "99" | PASS | `[invalid_option]` |

### metadata
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy | PASS | valid JSON, title/author/subject/page_count/encrypted keys |
| corrupt input | PASS | `[invalid_input]` |

### edit_metadata
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| title+author | PASS | written and re-readable; pages preserved |
| corrupt input | PASS | `[invalid_input]` |

### password_protect
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy | PASS | encrypted, decrypts with password, 3 pages |
| missing password | PASS | `[missing_option]` |
| empty password | PASS | `[missing_option]` |
| bad password + corrupt input | PASS | `[invalid_option]` (option validated first) |
| corrupt + valid password | PASS | `[invalid_input]` |

### unlock_pdf
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy (correct pw) | PASS | 3 pages, text intact, no password needed |
| wrong password | PASS | `[wrong_password]` |
| missing password | PASS | `[missing_option]` |
| not encrypted | PASS | `[invalid_input]` |
| corrupt input | PASS | `[invalid_input]` |

### watermark
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy | PASS | 5 pages, original text intact |
| visibility (rendered) | PASS | dark pixels 1,283 → 10,752 via pypdfium2 |
| unicode text "TöST ✓" | PASS | no crash |
| missing text | PASS | `[missing_option]` |
| corrupt input | PASS | `[invalid_input]` |

### page_numbers
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy defaults | PASS | 5 pages |
| custom opts | PASS | top/right, start=10, prefix, font_size=14 |
| string start_number | PASS | coerced, no crash |
| corrupt input | PASS | `[invalid_input]` |
| bad vertical | PASS | `[invalid_option]` |
| pages "99" | PASS | `[invalid_option]` |

### redact
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy | PASS | 3 pages; pattern gone from text AND raw bytes (true redaction) |
| surrounding text intact | PASS | |
| pattern not found | PASS | `[no_matches]` clean error |
| missing patterns | PASS | `[missing_option]` |
| corrupt input | PASS | `[invalid_input]` |

### flatten
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| happy | PASS | 5 pages, valid PDF |
| form field removed | PASS | AcroForm + annotation gone, field flattened |
| corrupt input | PASS | `[invalid_input]` |

### ocr
| Test | Result | Detail |
|---|---|---|
| SPEC sanity | PASS | |
| no tesseract/pytesseract | PASS | `ToolError [ocr_unavailable]`, no crash |
| corrupt input | PASS | `[ocr_unavailable]` (availability checked before input parsing) |

---

## Crash list (unhandled exceptions)

**None.** Zero crashes across 106 tests and every adversarial input (random bytes, wrong file types, out-of-range/malformed page specs, missing/invalid options, min/max violations, encrypted inputs, unicode).

## Test artifacts
- Harness: `/tmp/tool_audit.py` (ephemeral)
- Results JSON: `/tmp/tool_audit_results.json` (ephemeral)
- This report: `~/workspace/pdfedi/tool-audit/TOOL-AUDIT-REPORT.md`

## Bottom line
18 of 19 tools are fully healthy with excellent error hygiene — every bad input produces a clean, coded `ToolError`, never a traceback. The one real defect is **compress silently skipping FlateDecode images** (ISSUE-1): the quality selector is misleading for PNG-type images, which are extremely common. Everything else, including the previously-flagged split behavior and the redact/OCR/password paths, verified correct.
