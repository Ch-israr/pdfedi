# OCR fix — LSTM engine + interleave output bug (branch `fix/ocr-lstm-engine`)

Date: 2026-10-13. Production base: `bc7ad1a`. Pinned venv: `~/workspace/.venvs/pdfedi-pinned`.

## Root cause (two verified bugs in `backend/pdfedi/tools/ocr.py`)

1. **Legacy tesseract engine (`--oem 0`) fails on stock traineddata.** The tool forced the
   legacy OCR engine, but modern `eng.traineddata` (tessdata, LSTM-only) ships no legacy
   components, so tesseract exits 1 on every OCR'd page:
   `Error: Tesseract (legacy) engine requested, but components are not present in
   /usr/share/tesseract-ocr/5/tessdata/eng.traineddata!!`
   Locally reproduced deterministically on `tool-audit/editor-audit-test.pdf` (page 2 has
   38 native-text chars < 50-char threshold → routed to tesseract) → `ToolError(ocr_failed)`.

2. **Mixed native-text/scanned documents deleted their own output.** In the interleave path,
   `final_path = ctx.new_output_path("ocr")` returns the *same* path as `out_path`
   (`workdir/"output_ocr"` — the helper is deterministic per suffix). The code then wrote
   the finished file and called `out_path.unlink(missing_ok=True)`, deleting it. The tool
   "succeeded" but returned a nonexistent path → `FileNotFoundError` in `jobs.py` → the
   generic job error `"Processing failed. Please try again."` — exactly the production
   symptom (generic message, ~11s duration, OCR controls on all-native and all-scanned files
   passing, since those never take the interleave path).

## Changes (2 lines + comment updates, `ocr.py` only)

- `_TESSERACT_CONFIG = "--oem 0"` → `"--oem 1"` (LSTM engine; comment updated).
- Interleave now writes to `ctx.new_output_path("ocr_final")` (distinct path), with a comment
  explaining why the same suffix must not be reused.

Not changed: the 50-char native-text routing/threshold, `ocr_unavailable` handling
(binary missing → same clean `ToolError`), per-page `ocr_failed` ToolError wrapping
(already present and retained).

## Validation

| Gate | Result |
|---|---|
| CLI A/B on rendered page 2 (200 DPI PNG) | `--oem 0`: exit 1 (legacy components missing). `--oem 1`: exit 0, reads "Page two content for multi-page tests." |
| a. `editor-audit-test.pdf` via registry | SUCCESS: 21,219B, 2 pages; p1 native text intact, p2 OCR text "Page two content for multi-page tests." |
| b. Controls | text-native PDF: SUCCESS (copy-through, text intact). Image-only scan PDF: SUCCESS (OCR text extracted). |
| c. `tool-audit/mix-tools-test.py` | 21/21 PASS (pinned venv) |
| c. `tool-audit/new-tools-test.py` | 26/26 PASS (pinned venv) |

Also verified: output PDF is a valid 2-page file that opens and extracts; no raw exception
escapes the tool (per-page failures still raise structured `ToolError(ocr_failed)` naming the page).
