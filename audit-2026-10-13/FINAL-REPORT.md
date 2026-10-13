# PDFEDI — Phase 8 Final Report (2026-10-13)

**Scope:** duplicate-engine audit, code cleanup, asset cleanup, performance optimization, final full regression.
**Golden rule honored:** existing project improved in place; production (`main`, live at commit `bc7ad1a`) **unchanged**. All work is on branch `cleanup/2026-10-13-audit` (6 commits), undeployed, awaiting explicit user approval.
**Detail files:** INVENTORY.md · DUPLICATES.md · ASSETS.md · PERF.md · BENCHMARKS.md · CHANGELOG.md · REGRESSION.md (same directory).

## 1. Architecture & engine inventory (verified)
FastAPI backend (`backend/main.py` + `backend/pdfedi/`), Next.js static-export frontend (`web/`), editor from `sandbox/pdfeditor/` (production `/editor` source), jobs with thread semaphore (2), SQLite primary / Turso hosted, argon2/JWT admin, 5/hour per-IP per-tool quotas. **27 tools.**
Engines by role — pypdf: page ops (24 tools) · pypdfium2: render/text (8) · reportlab: overlays (6) · PIL: images (7) · pikepdf: repair only (qpdf xref rebuild — load-bearing) · python-docx: pdf_to_word only · pytesseract: ocr only. Frontend registry matches backend 1:1. **Zero unused dependencies** among all 18 backend pins.

## 2. Duplicates discovered (evidence in DUPLICATES.md)
- D1: identical `_open_reader` copy-pasted in 12 tools; same validation inlined in 9 more (5 weaker, 4 genuinely different).
- D2: compress.py carried a private copy of extract_images' image-decode pipeline (~76 lines).
- D3: page-size table in resize_pages superset of n_up's duplicate table.
- D4/D5 investigated and **rejected as worth changing** (see §3).
- 11 suspected duplicates investigated and rejected with reasons (repair pikepdf↔pypdf fallback is intentional design, etc.).

## 3. Comparison results & selection decisions (measured, BENCHMARKS.md)
| Item | Measurement | Decision |
|---|---|---|
| D1 reader copies | 12/12 AST-identical (single hash) | **Consolidate** to shared `open_pdf_reader()`; 5 weaker inline sites folded with per-tool error codes preserved; 4 different tools untouched |
| D2 image pipeline | 8/8 decode cases pixel-identical incl. pixel-SHA | **Consolidate** — compress imports from extract_images |
| D3 size tables | strict subset, identical values | **Consolidate** to shared `PAGE_SIZES_PT` |
| D4 compare re-opens PdfDocument per page | 73.07s vs 71.58s (1.02×, noise); outputs identical | **Keep as is** — rendering dominates |
| D5 triple PDF parse per job | 7–9ms total on real user files | **Keep as is** — not worth an API change |
| Dependencies | every pin has a verified importer | **None removed** |

## 4. Code removed / consolidated (branch commits e779d4d, df50a50, c478db0)
- 12 duplicate reader functions + 5 inline validations → 1 shared helper (net −555 lines across the change set at implementation time).
- compress private image pipeline deleted (76 lines); **outputs byte-identical** at low/medium/high (gate ±1%, actual 0.000%).
- Shared page-size table.
- **One deliberate behavior change, flagged:** corrupt-PDF parse failures in watermark, page_numbers, flatten, password_protect, redact now raise a clean `ToolError(invalid_input)` instead of a raw pypdf exception (consistency fix; error codes for encrypted inputs preserved per tool).
- compare streaming rewrite: rendered pages written per page instead of accumulated.
- grayscale streaming rewrite: per-page render → encode → write → release.

## 5. Assets quarantined (ASSETS.md; commit b41bafa)
Moved (reversible, plain move) to `quarantine/assets-2026-10-13/`: `icon-v2.png` (113.6KB), `apple-touch-icon-v2.png` (25.7KB), `favicon-v2.ico` (5.6KB) — all byte-identical duplicates of other legacy files with zero references — and `logo-options/` (~980KB design working files). **Total ≈1.10MB out of the served tree.** Live branding (v4 set, logo.png, unversioned fallbacks, pdf.worker) verified referenced and untouched. Repo hygiene: `web/out/` (76 tracked stale build files, 2.7MB) untracked + `.gitignore` fixed (Docker rebuilds it every deploy).

## 6. Performance bottlenecks & improvements (PERF.md; measured warm on production)
| Bottleneck | Before | After (branch, locally verified) |
|---|---|---|
| Compare peak RAM (50 pages) | 561–590 MB (would OOM prod) | **97 MB**, output pages pixel-identical |
| Grayscale peak RAM (30p @300 DPI) | 447–501 MB (would OOM prod) | **125 MB**, pages pixel-identical |
| Editor first-load JS | ~480 KB (pdf-lib upfront) | **121 KB**; pdf-lib in lazy chunks fetched on first use (build-verified) |
| Static asset caching | none (every visit re-downloads ~445KB) | `immutable, max-age=31536000` for hashed `/_next/static`, 1 day for icons/logo; HTML/API unchanged |
| Analytics middleware | sync DB write blocking the event loop per page view; unindexed retention DELETE | write moved to background threadpool; `Visit.created_at` index added (model + startup CREATE INDEX IF NOT EXISTS for existing DBs) |
| Warm TTFB ~2.6s; cold starts | measured | **Not fixable in code** — 0.15 CPU + free-tier sleep; requires paid instance (§11) |

## 7. Before/after measurements
Above, plus: pdf_to_word peak on the 8.4MB GLS file inside the server process 232MB (post-fix, regression-measured); compress output delta 0.000%; editor build First Load JS 121KB.

## 8. Final regression (Phase 7 — REGRESSION.md; ran AFTER all changes, branch build served locally, real HTTP API)
- **Tools: 27/27 PASS** (upload → job → download → output validated per contract; your supplied GBS file as primary input; GLS as secondary).
- **Negative cases: 7/7 PASS** (non-PDF 422, empty 422, 51MB 413, corrupt clean failure, encrypted rejected, unknown tool 404, missing file 422; no 500s).
- **Platform: 16/16 PASS** (cache headers exact; analytics records humans/bots separately, responses unblocked; quota 429 at 5/hr; admin 401/403/429 lockout intact; memory peaks ≤250MB).
- **Suites: 21/21 + 26/26** on pinned production dependencies.
- **Editor: 81/81 unit tests PASS**; branch build serves `/editor` 200.
- **BLOCKED: editor browser click-through** (rotate/text/export in a real browser). The automation browser runs on a separate machine and refuses navigation to private/loopback addresses (verified on 127.0.0.1, localhost, and the LAN address). To be executed against the live site as part of deploy verification after approval, before the deploy is declared complete.

## 9. Failures, root causes, fixes, retests
No tool failures in the final regression. Diagnoses recorded: GBS end-truncated variants are genuinely unrecoverable (page tree destroyed in compressed object streams; pikepdf and pypdf agree) — repair's success path verified on a standard PDF; extract_images cannot decode ICCBased images (pre-existing, untouched); OCR happy path untestable in this VM (no tesseract) — its designed `ocr_unavailable` graceful failure verified; `thumbnails` returns one contact-sheet PNG despite `output_kind="images"` (pre-existing quirk, unchanged).

## 10. Remaining risks & limitations
- Cold starts and ~2.6s warm TTFB persist on the free tier (hosting, not code).
- PERF B8 not implemented: uploads are still read fully into memory at ingest (50MB cap bounds the blast radius; the OOM class is mitigated by the tool-level fixes). Recommended as a follow-up, not bundled here.
- Polyfills chunk (109KB) left as is — low yield vs config risk.
- logo.png (114KB on every page) left as is — a WebP swap needs a visual check on the real site first (branding gate).
- The 5 tools' corrupt-file error change (§4) is the only intentional behavior change in the set.

## 11. Required from the user
- **Decision: approve merging/deploying branch `cleanup/2026-10-13-audit`** (deploy includes the editor click-through verification before being declared complete). Rollback = redeploy `bc7ad1a` or revert the merge; every change group is a separate commit and independently revertible (CHANGELOG.md).
- Optional, previously deferred: paid hosting (~$7/mo) to remove cold starts + most TTFB.
- Reminder (standing): rotate the Turso auth token pasted in chat on 2026-10-12.

## 12. Recommended next steps
1. Approve (or amend) this branch for deployment.
2. Post-deploy: live verification incl. editor click-through + your visual check of homepage/editor.
3. Follow-ups, in order: B8 upload streaming; full 106-test tools-audit rerun (still outstanding from 2026-10-12); Google Search Console sitemap resubmission (29 URLs now); decide on the leftover Editor 2.0 GitHub repo/Blueprint deletion.
