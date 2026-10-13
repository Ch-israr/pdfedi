# PDFEDI Cleanup Audit 2026-10-13 — Implementation Changelog

All changes on branch `cleanup/2026-10-13-audit`. **Production unchanged; nothing
deployed.** Sections are appended per workstream; do not reorder.

---

## Frontend/Assets (subagent, 2026-10-13 ~17:30–18:00 +04)

### Change F1 — Asset quarantine (plain `mv`, reversible)

**Problem:** `web/public/` carried byte-identical legacy duplicates of the
production v4 icon set (v2 set + unversioned fallbacks), and repo root carried
`logo-options/` — 13 design-generation working files (~1 MB), zero references.

**Evidence (audit-2026-10-13/ASSETS.md §1–4):**
- `md5sum`: `icon-v2.png` ≡ `icon.png`, `apple-touch-icon-v2.png` ≡
  `apple-touch-icon.png`, `favicon-v2.ico` ≡ `favicon.ico`.
- Post-move `grep -rn` over `web/`, `sandbox/`, `backend/` (code, metadata, CSS,
  Dockerfile) for `icon-v2|apple-touch-icon-v2|favicon-v2|logo-options`:
  **zero references**. Remaining hits are audit docs + `.git/index` only.
- `layout.tsx` metadata (single source of truth) references only the v4 set +
  `logo.png`.

**Files (moved, not deleted):**
- `web/public/icon-v2.png` (113.6 KB) → `quarantine/assets-2026-10-13/`
- `web/public/apple-touch-icon-v2.png` (25.7 KB) → `quarantine/assets-2026-10-13/`
- `web/public/favicon-v2.ico` (5.6 KB) → `quarantine/assets-2026-10-13/`
- `logo-options/` (13 files, ~980 KB) → `quarantine/assets-2026-10-13/logo-options/`

**Benefit:** ~1.10 MB removed from the served `web/public` tree (and from future
Docker images — the build copies `web/public` into the static export). No
request-path impact: nothing referenced these files.

**Risk:** Low. Reversible — plain `mv` back. Deliberately NOT moved:
`icon-v4.png`, `favicon-v4.ico`, `apple-touch-icon-v4.png`, `logo.png`,
`llms.txt`, the unversioned `icon.png`/`apple-touch-icon.png`/`favicon.ico`
(browser/iOS conventional fallbacks), anything in `sandbox/pdfeditor`.

**Validation:** post-move grep (above) + `ls web/public/` confirms the
production set intact. Note: stale copies of the v2 files also exist inside the
tracked `web/out/` build dir — intentionally left alone (see F2); the Docker
build regenerates `out/` fresh.

**Rollback:** `mv quarantine/assets-2026-10-13/icon-v2.png web/public/` etc.;
`mv quarantine/assets-2026-10-13/logo-options ./`.

### Change F2 — `web/out/` untracking (RECOMMENDATION, no action taken)

**Problem:** `.gitignore` contains `/out/` (repo-root only). The static-export
build artifact `web/out/` (76 files, ~2.7 MB, stale) is **tracked in git**.

**Evidence:**
- `git ls-files web/out | wc -l` → 76.
- `Dockerfile` Stage 1 runs `npm run build` in `web/` and Stage 1b rebuilds the
  editor export — both `out/` trees are regenerated from source on every deploy.
  The tracked copies are never consumed by the build.

**Recommendation for the parent (git operations — not run by me):**
1. Add one line to `.gitignore`: `web/out/`
   (alternatively `**/out/` if future build dirs should also be ignored; the
   narrower `web/out/` is the minimal change).
2. `git rm -r --cached web/out` to untrack the 76 stale files (keeps the local
   working copies).
3. Commit. After this, the stale v2-asset copies in `web/out` disappear from
   the repo automatically on the next local rebuild; production is unaffected
   (Docker builds fresh).

**Risk:** Low. Build-verified artifact; removing from version control cannot
affect production. Rollback: `git checkout <commit> -- web/out` (or rebuild).

### Change F3 — Editor lazy pdf-lib (PERF.md B5)

**Problem:** `/editor`'s initial bundle shipped a **478 KB** `pdf-lib + immer`
chunk upfront, though pdf-lib is only used at export/probe/restore time —
never at initial render. Measured: First Load JS 121 KB *after* the fix vs the
~480 KB gzipped / ~1.18 MB raw editor first load in the audit.

**Evidence (root cause):** the editor never imported `pdf-lib` directly in app
code. pdf-lib entered the upfront bundle transitively: `store/editor.ts` (in
the initial page graph) statically imported `{ deletePage, duplicatePage,
reorderPage, rotatePage }` from `@pdfeditor/pdf-core`, whose `index.ts`
re-exports pdf-lib-heavy modules (`annotations.ts`, `direct-text.ts`,
`redact.ts`). Two more static value imports pulled the same package in:
`lib/direct-probe.ts` (`probeDirectTextEdit`, used on text-fragment click) and
`lib/pdfedi-state.ts` (`sha256Hex`, used during snapshot restore).

**Files:**
- `sandbox/pdfeditor/apps/web/store/editor.ts`
  - Removed the static `import { deletePage, duplicatePage, reorderPage,
    rotatePage } from '@pdfeditor/pdf-core'`.
  - Added a cached module-level lazy loader: `loadPdfCore()` → single
    `Promise<typeof import('@pdfeditor/pdf-core')>` (one shared chunk request).
  - `rotatePage`, `deletePage`, `duplicatePage`, `insertBlankPage`,
    `reorderPage` are now `async` and `await loadPdfCore()` first; the zustand
    `set()` updaters and undo/redo callbacks stay **synchronous**, using the
    already-loaded module from the closure (no semantics change).
  - `EditorState` interface: the five actions now return `Promise<void>`.
  - Existing export-time dynamic import (`exportAnnotatedPdf`) now reuses
    `loadPdfCore()` (same chunk, no duplicate request).
- `sandbox/pdfeditor/apps/web/lib/direct-probe.ts`
  - Removed static import; `probeDirectTextEdit` is dynamically imported
    inside `probeDirectEdit` (already async). Error messages and the
    per-fragment result cache preserved exactly.
- `sandbox/pdfeditor/apps/web/lib/pdfedi-state.ts`
  - Removed static import; `sha256Hex` dynamically imported at its (already
    async) call site.

**Not changed:** `immer` still loads upfront (the zustand store needs it at
init — legitimate). `apps/api` server-side pdf-lib usage untouched. No `web/`
changes. Export bytes/output behavior untouched — same pdf-core functions, just
loaded later.

**Benefit:** pdf-lib + pdf-core now load as on-demand chunks on first page-op /
probe / restore / export instead of at page load. Measured from a real
`next build` (NEXT_STATIC_EXPORT=1, NEXT_BASE_PATH=/editor, same as Docker):
- First Load JS: **121 kB** (was the 478 KB pdf-lib chunk + rest, ~480 KB gz).
- Initial HTML script list contains **zero** chunks with pdf-lib markers;
  pdf-lib code verified present only in lazy chunks (`587.*.js` 425 KB,
  `42e4ba7a.*.js` 333 KB — fetched on first interaction, not on page load).

**Risk:** Low-medium. Touches editor interaction paths (page ops now async).
Mitigations: all callers (`Thumbnails.tsx`) are fire-and-forget click handlers
— no caller awaited the old sync return; undo/redo callbacks remain
synchronous; lazy chunk load failure mode is identical to the pre-existing
export-time dynamic import. Callers verified: `grep` shows only
`Thumbnails.tsx` consumes these five actions.

**Validation:**
- `npx tsc --noEmit`: **zero** errors in the three changed files (24 errors
  remain, all pre-existing in untouched `test/*.test.ts` files — verified via
  `git diff` that I did not modify them).
- Full production `next build` (static export, editor base path): **succeeds**;
  chunk analysis above is from the real build output.
- Build produced no tracked-file noise: `git status --short -- sandbox/`
  shows only the 3 intended `.ts` modifications (`.next/`/`out/` build output
  is not tracked here).
- NOT yet validated: click-through of page ops / export in a running editor
  (needs a browser session). Recommended before merge: open `/editor`, rotate +
  delete + undo a page, then download — export bytes must be unchanged.

**Rollback:** `git checkout -- sandbox/pdfeditor/apps/web/store/editor.ts
sandbox/pdfeditor/apps/web/lib/direct-probe.ts
sandbox/pdfeditor/apps/web/lib/pdfedi-state.ts` (restores static imports; the
478 KB chunk returns to the upfront bundle, no other effects).

---

---

## Backend (subagent, 2026-10-13 ~17:35–19:00 +04)

All work on branch `cleanup/2026-10-13-audit`. **Nothing committed, pushed, or
deployed; no `web/` or `sandbox/` files touched; nothing staged.** All test
runs with the production-pinned venv (rebuilt at `/tmp/pdfedi-pinned` after a
VM restart wiped `/tmp`: pypdf 5.1.0, pypdfium2 4.30.0, pillow 11.0.0,
reportlab 4.2.5, pikepdf 10.17.0, python-docx 1.1.0).

### Change B1 — D1: shared `open_pdf_reader` in `_helpers.py` (12 copies + 5 inline sites)

**Problem:** 12 tools each carried a byte-identical private `_open_reader`
(header check → PdfReader → encrypted → page count → 0-page check), and 5 more
tools inlined the same 3-step validation with weaker error mapping
(DUPLICATES.md D1, BENCHMARKS.md B4).

**Evidence:** `ast.dump` SHA-256 identical (`748e834fda2d`) across all 12
copies; byte-level diff confirmed (one SHA across all 12 bodies). The 5 inline
sites (watermark, page_numbers, flatten, password_protect, redact) had:
unguarded `PdfReader(...)` (corrupt PDFs raised raw pypdf exceptions, not
ToolError), encrypted → `invalid_input`, no 0-page check. The 4 genuinely
different sites (unlock_pdf, metadata, edit_metadata, ocr) verified different
and left untouched.

**Files:**
- `backend/pdfedi/tools/_helpers.py`: added `open_pdf_reader(data, filename,
  *, encrypted_code="encrypted_pdf")` (identical body to the 12 copies) and
  `PAGE_SIZES_PT` (see B3).
- 12 tools (compare, compress, crop, delete_pages, extract_images, merge,
  n_up, pdf_to_word, reorder_pages, resize_pages, rotate_pages, split):
  local `_open_reader` deleted (~30 lines each), call sites renamed to the
  shared import. crop.py's existing `_helpers` import extended.
- 5 inline sites (watermark, page_numbers, flatten, password_protect, redact):
  inline block replaced with
  `open_pdf_reader(data, ctx.inputs[0].filename, encrypted_code="invalid_input")`.
- Cleanup: removed now-unused `PdfReader`/`io` imports in flatten.py and
  password_protect.py.

**Behavior contract (deliberate):**
- Error **codes** preserved exactly per tool: the 12 keep `encrypted_pdf` for
  encrypted inputs; the 5 inline sites keep `invalid_input`.
- **DELIBERATE CONSISTENCY FIX (flagged):** the 5 inline sites previously let
  corrupt-PDF parse failures propagate as raw pypdf exceptions; they now raise
  `ToolError(code="invalid_input")` like every other tool. Error *messages*
  changed from tool-specific strings to the shared helper's filename-based
  strings (tests assert codes, not messages).

**Benefit:** ~370 duplicated lines removed; one place to fix/extend
validation; 5 tools gain clean corrupt-PDF errors.

**Risk:** Low. Body was byte-identical; codes preserved. New surface:
`open_pdf_reader`'s `encrypted_code` kwarg.

**Validation:**
- D1 error matrix on pinned venv, all PASS: the 12 → encrypted=`encrypted_pdf`,
  bad header=`invalid_input`; the 5 inline → encrypted=`invalid_input`,
  corrupt parse=`invalid_input` (previously raw exception); healthy file still
  processes through the shared path.
- `mix-tools-test.py` 21/21, `new-tools-test.py` 26/26 (includes encrypted/bad
  input cases for compare, compress, crop, n_up, pdf_to_word).
- All 27 tool modules import; `main` app imports (`create_app()` runs).

**Rollback:** `git checkout HEAD -- backend/pdfedi/tools/_helpers.py
backend/pdfedi/tools/{compare,compress,crop,delete_pages,extract_images,merge,n_up,pdf_to_word,reorder_pages,resize_pages,rotate_pages,split,watermark,page_numbers,flatten,password_protect,redact}.py`

### Change B2 — D2: compress imports its image pipeline from `extract_images`

**Problem:** `compress._pil_image_from_xobject` / `compress._iter_image_xobjects`
were functional duplicates of `extract_images._pil_from_xobject` /
`_iter_image_xobjects` (DUPLICATES.md D2, BENCHMARKS.md B5: 8/8 decode cases
pixel-identical incl. ICCBased/indexed/corrupt → both-None).

**Evidence:** B5 audit table (8 controlled XObjects + the GLS file's real
ICCBased scan): pixel-identical or both-None in all cases; iterators yield the
same 8-object set. `isinstance(filt, list)` vs `isinstance(filt, ArrayObject)`
verified equivalent (ArrayObject subclasses list in pypdf 5.1.0); both fall back
to `[filt]` for a bare NameObject. The `writer` vs `reader` param name was
cosmetic (both only touch `.pages`).

**Files:** `backend/pdfedi/tools/compress.py` — deleted both private functions
(52 + 24 lines); added
`from pdfedi.tools.extract_images import _iter_image_xobjects, _pil_from_xobject`
(precedent: `pdfedi.tools.pdf_to_word` already imports `_pil_from_xobject` the
same way); `_downsample_image_object` now calls `_pil_from_xobject`; removed
now-unused `IndirectObject` import. No external importers of the removed
privates exist (grep-verified).

**Caveat checked:** `_downsample_image_object`'s encoded-size comparison reads
`img_obj._data` on the *same object* the imported iterator yields — unaffected
by where the iterator is defined. Verified by the byte-identical gate below.

**Not changed (flagged):** the comment in `_downsample_image_object` stating
"`_data` is never mutated by `get_data()`" understates pypdf 5.1.0's model
(`EncodedStreamObject.get_data()` caches decoded bytes in `decoded_self` —
see BENCHMARKS.md observation 2 / DUPLICATES.md R9). Left as-is per scope;
recommend a comment correction in a follow-up.

**Benefit:** −76 lines; one decode implementation to maintain.

**Risk:** Low. Verified identical semantics; same-object guarantee preserved.

**Validation:** before/after gate on a JPEG(DCT)+PNG(Flate) reportlab fixture,
`compress.run` at low/medium/high — outputs **byte-identical** at all three
qualities (34,711 / 45,850 / 192,870 bytes, delta +0.000%, gate was ±1%).
Before-version loaded from `git show HEAD:backend/pdfedi/tools/compress.py`.

**Rollback:** `git checkout HEAD -- backend/pdfedi/tools/compress.py`

### Change B3 — D3: shared `PAGE_SIZES_PT` table

**Problem:** `n_up._SHEET_SIZES` {a4, letter} was a strict subset of
`resize_pages._SIZES` {a4, a5, letter, legal} with identical point values
(DUPLICATES.md D3).

**Files:** superset table added as `PAGE_SIZES_PT` in
`backend/pdfedi/tools/_helpers.py`; `n_up.py` and `resize_pages.py` import it
and their local tables were deleted (no external references — grep-verified).

**Benefit:** one source of truth for page sizes; values verified identical so
no behavior change.

**Risk:** Negligible.

**Validation:** import-time identity assertions (`n_up.PAGE_SIZES_PT is
_helpers.PAGE_SIZES_PT`); SPEC `choices` unchanged (n_up still a4/letter,
resize_pages still a4/a5/letter/legal); covered by 26/26 suite.

**Rollback:** `git checkout HEAD -- backend/pdfedi/tools/_helpers.py
backend/pdfedi/tools/n_up.py backend/pdfedi/tools/resize_pages.py`

### Change B4 — compare: stream pages to the output canvas (memory fix)

**Problem:** `compare.py` accumulated every rendered page image in a `sheets`
list before writing — B1 measured **589.6 MB peak on a 50-page pair** at
150 DPI (~6.5 MB/page bitmap × 50, plus reportlab's retained JPEGs). On the
512 MB production instance (+ ~150 MB app baseline) a 50-page compare would
OOM-kill the worker — the same failure class as the 2026-10-13 pdf_to_word OOM.
(B1 also proved the per-page `PdfDocument` re-open is NOT the bottleneck —
0.87×–1.02×, within noise — so the re-open pattern was deliberately kept.)

**Files:** `backend/pdfedi/tools/compare.py`:
- New `_write_page(canvas, img, w_pt, h_pt)` helper (JPEG q88 + showPage +
  img.close(), byte-identical settings to the old write loop).
- The render/diff loop now writes each page immediately and releases the PIL
  images; added `gc.collect()` per page (same pattern as pdf_to_word's
  per-page assembly). `sheets` list deleted.
- `no_differences`, red-box annotation, added/removed labeling, page cap, and
  error codes unchanged. Canvas is created before the diff loop but only
  `save()`d on success — a `no_differences` raise writes no output file, as
  before.

**Benefit:** 50-page peak **561 MB → 97–98 MB** (measured, fresh processes);
production-safe on 512 MB.

**Risk:** Low. Diff algorithm, JPEG settings, and page flow untouched; only
the write timing changed.

**Validation:**
- Small fixture (`tool-audit/compare-a.pdf`/`compare-b.pdf`): still flags
  exactly page 1 (1-page output).
- 50-page synthetic pair (diffs on pages 10/25/40): peak ≤ 220 MB gate →
  **97 MB**; output 50 pages; **all 50 output page images pixel-identical**
  old-vs-new (pypdf-extracted JPEGs, SHA of decoded pixels); normalized byte
  comparison differs only in reportlab document metadata (CreationDate/ID —
  normalization couldn't fully equalize; pixel identity is the semantic
  proof that the same pages are flagged with the same boxes).
- Before-version from `git show HEAD:backend/pdfedi/tools/compare.py`.

**Rollback:** `git checkout HEAD -- backend/pdfedi/tools/compare.py`

### Change B5 — grayscale: per-page canvas writes (memory fix)

**Problem:** `grayscale.py` accumulated every page's JPEG bytes in a `pages`
list — B2 measured **~450 MB peak for 30 pages at 300 DPI** (~8.7 MP render
each). The 600-DPI option is ~4× worse. A 300-DPI 30-page job would OOM-kill
the production instance.

**Files:** `backend/pdfedi/tools/grayscale.py`:
- Canvas created before the render loop; each page is rendered → JPEG q85 →
  drawn → released in the same iteration (`del` + `gc.collect()` per page).
  `pages` list deleted. reportlab retains only the embedded JPEGs (~1–2 MB
  per page) until `save()`.
- `pdf.save()` moved after the loop on the success path only (render failure
  still raises `ToolError(invalid_input)` with no partial output file, as
  before). DPI validation, 50-page cap, error codes unchanged.

**Benefit:** 30 pages @300 DPI peak **501 MB → 125 MB** (measured); gate was
≤ 220 MB. Default 200 DPI and the 600-DPI ceiling scale proportionally.

**Risk:** Low. Render settings (DPI, JPEG q85, draw params) untouched.

**Validation:**
- 30-page text+photo fixture @300 DPI: 30 pages out, output byte-size
  identical old-vs-new (10,226,093 B); **all 30 page images pixel-identical**,
  all mode `L` (genuinely grayscale).
- Before-version from `git show HEAD:backend/pdfedi/tools/grayscale.py`.

**Rollback:** `git checkout HEAD -- backend/pdfedi/tools/grayscale.py`

### Change B6 — analytics: fire-and-forget visit logging + `Visit.created_at` index

**Problem (PERF.md B4):** the `visit_tracking` middleware in `main.py` ran
`SessionLocal()` + a synchronous Turso write (INSERT + unindexed
`DELETE ... WHERE created_at < cutoff` + COMMIT, ~3 HTTPS round trips
Oregon→Mumbai) inside the async request handler — blocking the uvicorn event
loop for every tracked page view. `Visit.created_at` had no index, so the
retention prune did an unindexed table scan on every page view.

**Files:**
- `backend/main.py`:
  - New module-level `_log_visit_sync(path, user_agent, referer, headers,
    is_bot)` — the exact same `log_visit`/`log_bot_visit` calls with the
    same fields (humans: truncated IP/country/city/device/browser/source/
    path; bots: name+country), same retention pruning, wrapped in
    try/except-pass so analytics can never break a request.
  - Middleware rewritten: builds the response first (unchanged), then
    captures plain values (path, UA, headers dict, referer — not the request
    object) and dispatches
    `asyncio.get_running_loop().create_task(run_in_threadpool(_log_visit_sync,
    ...))` **without awaiting** — the event loop is free immediately.
- `backend/pdfedi/models.py`: `Visit.created_at` gained `index=True`
  (SQLAlchemy default index name `ix_visits_created_at`).
- `backend/pdfedi/migrate.py`: after `Base.metadata.create_all`, runs
  `CREATE INDEX IF NOT EXISTS ix_visits_created_at ON visits (created_at)`
  — idempotent, SQLite- and Turso/libSQL-compatible, covers pre-existing
  databases that `create_all(checkfirst=True)` alone would not fix.

**Benefit:** analytics writes no longer occupy the event loop (concurrent
requests stop queueing behind each other's Turso round trips); the retention
prune becomes an indexed range delete instead of a full scan.

**Risk:** Low-medium. Fire-and-forget means a visit row could theoretically be
lost if the process dies mid-write — acceptable for best-effort analytics
(the old code already swallowed all logging errors). No fields, tables,
retention, or bot/human separation changed.

**Validation:**
- Fresh SQLite DB: `run_migrations` creates `ix_visits_created_at`;
  simulated pre-existing DB (index dropped) regains it; second run idempotent.
- End-to-end via httpx ASGI: GET `/` (human UA) → response in 0.06 s, row in
  `visits` with correct path/browser; GET `/tools/merge/` (Googlebot UA) →
  row in `bot_visits` with name `Googlebot`. Response returned before the
  background write completed (fire-and-forget confirmed).

**Rollback:** `git checkout HEAD -- backend/main.py backend/pdfedi/models.py
backend/pdfedi/migrate.py`

### Change B7 — cache headers for static frontend assets

**Problem (PERF.md B3):** no `Cache-Control`/`Expires` on any response
(`cf-cache-status: DYNAMIC` everywhere), so every repeat visit re-downloaded
~190–480 KB (gz) of content-hashed JS/CSS from the 0.15-CPU origin.

**Evidence:** live-measured headers (no Cache-Control on HTML or
`/_next/static/*`; only a weak ETag on static chunks).

**Files:** `backend/main.py`:
- `_ImmutableNextStatic(StaticFiles)` subclass for the root `/_next` mount:
  adds `Cache-Control: public, max-age=31536000, immutable` to responses
  whose path contains `/_next/static/` (hash-fingerprinted chunks/CSS/media).
- `_frontend_cache_headers(path)` + `_frontend_file(path, candidate)` used by
  the `serve_frontend` catch-all (this path also serves `/editor/_next/...`,
  which is NOT under the root mount):
  - `/_next/static/*` (incl. `/editor/_next/static/*`) →
    `public, max-age=31536000, immutable`
  - HTML pages (`""`, trailing `/`, `*.html`, incl. 404 fallback) → **no**
    cache headers (deploys replace them)
  - other static assets (icons, logo, `llms.txt`, `sitemap.xml`) →
    `public, max-age=86400`
  - `/api/*` and download responses: untouched (separate routes).

**Benefit:** repeat visits skip re-downloading immutable build output for a
year; icons/logo cached a day; HTML always revalidated so deploys take effect
immediately.

**Risk:** Low. Hashed filenames make `immutable` safe (new deploy = new
hashes); HTML explicitly excluded; API/download paths untouched.

**Validation:** end-to-end via httpx ASGI against a mock frontend tree:
`/_next/static/chunks/app-abc123.js` → immutable 1yr;
`/editor/_next/static/chunks/x-def456.js` → immutable 1yr;
`/icon-v4.png`, `/llms.txt` → 1 day; `/`, `/tools/merge/` → no cache header;
`/api/v1/health/live` → no cache header. All 200.

**Rollback:** `git checkout HEAD -- backend/main.py`

---

### Overall backend validation (this workstream)

- `tool-audit/mix-tools-test.py`: **21/21 pass** (pinned venv)
- `tool-audit/new-tools-test.py`: **26/26 pass** (pinned venv)
- D1 error-code matrix (12 tools + 5 inline sites, encrypted/bad-header/
  corrupt inputs): all PASS, codes preserved
- D2 gate: compress low/medium/high before-vs-after **byte-identical**
- D3: shared-table identity assertions + suite coverage
- B4 gate: compare 50pp **97 MB peak** (was 561 MB), 50 page images
  pixel-identical old-vs-new
- B5 gate: grayscale 30pp @300 DPI **125 MB peak** (was 501 MB), 30 page
  images pixel-identical, all mode L
- B6: migration index on fresh + pre-existing DBs (idempotent); middleware
  records human + bot rows fire-and-forget
- B7: cache-header matrix on mock frontend — exact policy per path class
- `main` app imports; `create_app()` runs; all 27 tool modules import
- unlock_pdf / metadata / edit_metadata / ocr: verified untouched
  (`git diff --stat` shows only the files listed above under `backend/`;
  no `web/` or `sandbox/` changes; nothing staged)
