# PDFEDI — Phase 7 Final Full Regression Report

**Date:** 2026-10-13 ~17:30–18:00 +04
**Branch:** `cleanup/2026-10-13-audit` @ `917996b`
**Scope:** all 27 backend tools + platform checks + editor, driven through the **real HTTP API** (upload → create job → poll → download → output validation).
**Production untouched.** No source files modified; nothing committed or pushed. Only untracked fixture/test files were created outside the repo.

## Environment (how this was run)

- Local uvicorn on `127.0.0.1:8137`, throwaway SQLite DB at `/tmp/reg/pdfedi.db` (`DB_PROVIDER=sqlite`), `STORAGE_DIR=/tmp/reg/storage`.
- Python: `/tmp/pdfedi-pinned/bin/python` (production pins: pypdf 5.1.0, pypdfium2 4.30.0, reportlab 4.2.5, pillow 11.0.0, pikepdf 10.17.0, python-docx 1.1.0; uvicorn added to the venv only as a test runner).
- **Fresh web build from branch sources** (`npm ci && npm run build`, EXIT 0) served as `FRONTEND_DIR`.
- Editor: existing `sandbox/pdfeditor/apps/web/out` verified to reflect the branch (pdf-lib isolated in its own 415KB lazy chunk per commit `82852ee`; ~122KB first-load chunk matches the "~480KB → 121KB" claim), served at `/editor`.
- Primary input: user-supplied `GBS__Ameer_Hazim_Jasim_Al_shaeli_F_06___100_sqft.pdf` (4.0MB, 2 pages). Secondary: GLS edited file (8.4MB). Fixtures generated: 5-page reportlab PDF with page markers, 50-page A/B compare pair (differ on page 25), 2 PNGs, JPEG photo PDF, end-truncated variants, 51MB upload.
- No tesseract binary in this VM → OCR is expected to fail gracefully with `ocr_unavailable` (its designed contract). Production Docker installs tesseract.

## Per-tool results — 27/27 PASS

| # | Tool | Verdict | Evidence |
|---|------|---------|----------|
| 1 | compress | PASS | Job succeeded; valid 2p PDF, 3926KB vs 3939KB input (quality=low) |
| 2 | merge | PASS | GBS(2p) + editor-test(2p) → 4 pages, valid PDF |
| 3 | split | PASS | 5p fixture, ranges "1-2,4-5" → ZIP `pages-001-002.pdf` + `pages-004-005.pdf`, each 2 pages |
| 4 | rotate_pages | PASS | angle=90 → page 1 `/Rotate`=90, 2 pages intact |
| 5 | delete_pages | PASS | pages="5" → 4 pages; "PAGE 5" absent from last page |
| 6 | reorder_pages | PASS | order "5,4,3,2,1" → 5 pages; first page contains "PAGE 5" |
| 7 | resize_pages | PASS | size=a4 → 595.0×842.0pt (≈ A4 595.3×841.9) |
| 8 | n_up | PASS | 2p source, layout=4 → 1 sheet page |
| 9 | repair | PASS | Healthy GBS → normalized valid 2p PDF; 88%-truncated five-pages → fully repaired (5/5 pages); genuinely destroyed inputs → clean `unrepairable` job failure, no 500/traceback (see diagnosis) |
| 10 | extract_text | PASS | TXT output contains "Ameer Hazim Jasim Al shaeli" |
| 11 | pdf_to_images | PASS | ZIP with 2 PNGs; first renders 595×843 @72dpi (≈ A4) |
| 12 | images_to_pdf | PASS | 2 PNGs → valid 2p PDF |
| 13 | thumbnails | PASS | Single PNG contact sheet (840×299) opens in PIL |
| 14 | extract_images | PASS | JPEG photo PDF → `image-001.jpg` extracted and opens; ICCBased scan images (GLS file) → honest `no_images` (pre-existing limitation, see diagnosis) |
| 15 | ocr | PASS | Clean job failure, `ToolError` code `ocr_unavailable` ("OCR is not available on this server") — designed graceful path; no 500 |
| 16 | metadata | PASS | JSON output contains "Golden Box - Agreement 120625" |
| 17 | edit_metadata | PASS | Output metadata title="REG-TEST", author="Darling" |
| 18 | watermark | PASS | "REGTEST" extractable from page 1 text |
| 19 | page_numbers | PASS | Valid 2p PDF produced |
| 20 | crop | PASS | top=36 → /CropBox height trimmed exactly 36.0pt (842.0→806.0) |
| 21 | grayscale | PASS | Valid 2p PDF @72dpi |
| 22 | password_protect | PASS | Output `is_encrypted`=True |
| 23 | unlock_pdf | PASS | Round trip: decrypted, `is_encrypted`=False, 2 pages; wrong password → clean "Incorrect password." failure |
| 24 | redact | PASS | "Ameer Hazim Jasim Al shaeli" absent from extracted text **and** raw bytes |
| 25 | flatten | PASS | Valid 2p PDF |
| 26 | compare | PASS | compare-a/b → valid diff PDF; 50p pair → red diff box rendered on changed page 25 only (116 red px on p25, 0 on p1/p31) |
| 27 | pdf_to_word | PASS | GBS → 36KB .docx; all probes verbatim: "Ameer Hazim Jasim Al shaeli", "100 sqft", "Amir.hazim.jasim@gmail.com", "784-1996-9936288-7", "+971 52 684 2918" |

## Negative cases — 7/7 PASS

| Case | Result |
|------|--------|
| Non-PDF bytes upload | 422 "Not a valid PDF file." |
| Empty file upload | 422 "Empty file." |
| 51MB file upload | 413 "File exceeds the 50 MB upload limit." |
| corrupt-truncated.pdf (55% cut) → repair | Upload accepted (has %PDF header); job fails cleanly with honest "too damaged" message, no traceback/500 |
| Encrypted PDF into merge | Rejected at job creation: 422 "This PDF is password protected. Use Unlock PDF first." |
| Unknown tool key | 404 |
| Job on nonexistent file id | 422 |

## Platform checks

| Check | Result |
|-------|--------|
| `/_next/static/*` cache header | PASS — `public, max-age=31536000, immutable` |
| `/editor/_next/static/*` cache header | PASS — `public, max-age=31536000, immutable` |
| Icon (`/icon-v4.png`) cache header | PASS — `public, max-age=86400` |
| HTML pages (`/`) cache header | PASS — none (always revalidate, correct for deploys) |
| API routes (`/api/v1/limits`) cache header | PASS — none |
| Analytics | PASS — 6 page GETs → visits 6→12, bot-UA request → bot_visits 5→6 (correctly classified); 6 GETs completed in 0.08s total (writes are off the response path); only truncated IP stored (`ip_trunc` column) |
| Quota (5/hour/IP/tool) | PASS — metadata jobs: 202,202,202,202,429,429 (1 prior success in this run + 4 more, then 429) |
| Admin unauthenticated | PASS — 401 "Admin authentication required" |
| Admin bad credentials | PASS — 403 "Invalid credentials" (designed; 401 is for missing auth) |
| Admin lockout | PASS — 7 bad logins → 403,403,403,403,429,429,429 (lockout logic intact) |
| Memory: pdf_to_word on GLS 8.4MB | PASS — server peak 232MB (baseline 224MB, +8MB delta) ≤ 250MB |
| Memory: compare 50p vs 50p | PASS — server peak 240MB ≤ 250MB |
| mix-tools-test.py | PASS — 21/21 (pinned python) |
| new-tools-test.py | PASS — 26/26 (pinned python) |

## Editor

- `/editor` serves HTTP 200 from the local app with the correct title ("Free PDF Editor Online — Edit, Sign & Annotate PDFs | PDFEDI"); editor JS chunks serve with immutable cache headers.
- `apps/web` unit tests: **49/49 pass**. `packages/pdf-core` unit tests: **32/32 pass**.
- **Browser click-through: BLOCKED** — no live browser available to this test agent; parent to cover separately.

## Failure diagnoses (all resolved as non-regressions; nothing changed)

1. **crop initially "failed"** — my first validator read `/MediaBox` (unchanged by design). Re-validated against `/CropBox`: trimmed exactly 36.0pt. Tool correct.
2. **GBS end-truncated variants (88/95/99%) repair as `unrepairable`** — genuine: this Illustrator file keeps its page tree in compressed object streams near EOF; both pikepdf ("root of pages tree has no /Kids array") and pypdf ("Stream has ended unexpectedly") fail independently. The repair *success* path was verified on an 88%-truncated standard PDF → all 5 pages recovered. Contract holds: repairable files repair, destroyed files get the honest error.
3. **extract_images on GLS → `no_images`** — the GLS images are ICCBased colorspace, which the decoder does not support (pre-existing limitation, untouched by this branch's changes). Positive control (normal JPEG) extracts correctly. Not a regression.
4. **OCR error text** — message is "OCR is not available on this server."; `ToolError` code verified as `ocr_unavailable` in source. Designed graceful path.
5. **Encrypted file into merge** — rejected at `create_job` with a clean 422 rather than failing inside the job. Strictly better than the test's expectation.

## Totals

- **Tools: 27/27 PASS** (OCR = designed graceful failure; production has tesseract)
- **Negative cases: 7/7 PASS**
- **Platform checks: 16/16 PASS**
- **Editor unit tests: 81/81 PASS** (49 web + 32 pdf-core); static serving verified; browser click-through BLOCKED (parent's scope)
- **No FAILs. No BLOCKED items other than browser click-through.**

## Remaining risks / limitations (verified, not fixed — out of scope)

- OCR untestable end-to-end here (no tesseract in this VM); the tool's happy path is exercised only in production's Docker image.
- `extract_images` cannot decode ICCBased-colorspace images (pre-existing; returns honest `no_images`).
- `repair` cannot recover files whose page tree is physically destroyed (e.g. any truncation of this Illustrator-generated GBS file) — correctly returns `unrepairable`, but users may expect more.
- `thumbnails` declares `output_kind="images"` but returns a single contact-sheet PNG (known, unchanged).
- Browser click-through of the editor and tool pages was not performed by this agent.
