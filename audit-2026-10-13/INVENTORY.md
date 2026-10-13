# PDFEDI — Phase 1 Inventory (read-only audit)

**Date:** 2026-10-13
**Scope:** `~/workspace/pdfedi/` — architecture, tools, engines, dependencies, shared code, config, known issues.
**Method:** Static inspection only — nothing modified, built, committed, or deployed. Every claim cites a file path.

---

## 1. Architecture overview

### Backend — FastAPI (`backend/`)

- **Entry:** `backend/main.py` — defines `create_app()`, `app` is served by uvicorn via `Dockerfile` CMD: `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir /srv/backend`.
- **Structure** (`backend/pdfedi/`):
  - `api/public.py` — public JSON API `/api/v1`: `GET /tools`, `GET /tools/{tool_key}`, `POST /uploads`, `GET|DELETE /files/{file_id}`, `POST /jobs` (202), `GET /jobs/{job_id}`, `POST /jobs/{job_id}/cancel`, `POST /jobs/{job_id}/retry`, `GET /downloads/{file_id}`, `GET /quota/{tool_key}`, `GET /limits`.
  - `api/admin.py` — `/admin` dashboard + analytics endpoints (`/api/v1/admin/analytics`, `/api/v1/admin/digest` with `DIGEST_KEY`), CSV exports, login audit; JWT + httpOnly cookie auth.
  - `api/health.py` — `/api/v1/health/live` (Render health check), `/api/v1/health`.
  - `jobs.py` — job system: `ingest_upload()` (pypdf parse; page_count=None fallback for damaged files), dedup via `_find_duplicate_job()`, `create_job()`, `enqueue_job()` → `_run_in_thread()`; concurrency via `threading.Semaphore` (`max_concurrent_jobs=2` default, `MAX_CONCURRENT_JOBS` env). Orphaned jobs marked failed on restart (see `main.py` lifespan).
  - `storage.py` — local disk storage (`STORAGE_DIR`, sha256-keyed `put_object`/`get_object_path`).
  - `db.py` / `turso.py` / `models.py` / `migrate.py` — SQLAlchemy; SQLite primary (`./pdfedi.db`), Turso (libSQL) when `DB_PROVIDER=turso` via the pure-Python `tursohttp` dialect in `turso.py`. Supabase banned by design decision.
  - `analytics.py` — page-view logging (humans → `visits` with truncated IP + DB-IP City Lite geo lookup; bots → `bot_visits` name+country only), 7-day retention; invoked from the HTTP middleware in `main.py`.
  - `security.py` — argon2id + JWT admin auth; `quotas.py` — per-IP per-tool hourly quotas (DB-backed); `timeutil.py` — UTC ISO timestamps.
  - `config.py` — pydantic-settings `Settings`; see §5 for env vars.
- **Middleware** (`backend/main.py`): security-headers middleware; privacy-first page-view analytics middleware (records on `/`, `/editor`, `/tools/*`).
- **Tool contract:** `backend/pdfedi/tools/base.py` (`ToolSpec` dataclass: key, name, tagline, description, input_kinds, min/max_files, options, output_kind, output_ext, output_mime, activity, category; `ToolContext`, `ToolInput`, `ToolError`). Registry: `backend/pdfedi/tools/__init__.py` — **27 tools**, duplicate keys rejected at import.
- **Concurrency:** jobs run in threads, semaphore of 2; `run()` is synchronous.

### Frontend — Next.js static export (`web/`)

- `web/package.json`: next ^14.2.35, react ^18.3.1, tailwind ^3.4.13, typescript ^5.6.2. Build: `next build` (static export; `web/out/` copied to `/srv/static` by `Dockerfile`).
- **Routes** (`web/app/`): `/page.tsx` (homepage — 27 tool cards from `TOOL_CARDS`, category sections), `/tools/[slug]/page.tsx` (generic tool page; `TOOL_CONTENT[slug]` → `notFound()` for unknown), `/admin/page.tsx`, `sitemap.ts` (tool URLs automatic via `TOOL_SLUGS`; `/editor` manual entry), `robots.ts`, `llms.txt` implied, `layout.tsx`, `globals.css`.
- **Lib** (`web/lib/`): `api.ts` (162 lines — `ToolSpec`, `UploadedFile`, `Job` interfaces + `api` fetch wrapper for all `/api/v1` endpoints), `tools.ts` (56 lines — `TOOL_CARDS`, `CATEGORIES`, `TOOL_SLUGS`), `tool-content.ts` (1206 lines — per-tool SEO/marketing content, required for each tool or the page 404s).
- No framework beyond Next+React; all tool processing is server-side via the API. Frontend serves as static files from FastAPI (`FRONTEND_DIR=./static`).

### Editor (`sandbox/pdfeditor/` — PRODUCTION `/editor` SOURCE)

- Monorepo (pnpm + Turborepo): `apps/web` (Next.js 14 static export, basePath `/editor`, baked into the Docker image at `/srv/static/editor`), `packages/pdf-core`, `packages/shared`.
- Deps (`apps/web/package.json`): `pdf-lib` ^1.17.1 (export/writes content stream directly), `pdfjs-dist` ^4.8.69 (rendering), `zustand` ^5.0.2 + `immer` ^10.1.1 (undo/redo store), `zod` ^3.24.1, react ^18.3.1, next ^14.2.21.
- Features: text edit (content-stream rewrite, no masks), highlight/shapes/images/signatures as standard PDF annotations (`/NM` `pdfedi-<kind>-<uuid>`), page ops, close-confirm + download-preview dialogs (editor-only UX).
- **Do not delete** `sandbox/pdfeditor/` — production `/editor` builds from it.

### Testing sandbox separation (`sandbox/`)

- `sandbox/app.py` — standalone FastAPI harness: imports **only** `pdfedi.tools.base` (stable contract), never prod app/DB/quotas/admin. Own `Dockerfile` + `render.yaml`.
- `sandbox/tools/__init__.py` — `SANDBOX_TOOLS` opt-in registry (currently `{"pdf_to_word": "pdf_to_word", "word_to_pdf": "word_to_pdf"}`); only listed tools import.
- `sandbox/requirements.txt` — sandbox-only extras: `python-docx`, `pdfplumber`, `pytesseract` (plus the backend pin file for the framework).
- `sandbox/editor/`, `sandbox/web/` — legacy retired prototypes (the retired vanilla-JS editor, superseded by `pdfeditor/`). `sandbox/tools/_template.py` — tool template. `sandbox/EDITOR_PROPOSAL.md` — design doc.
- **Rule:** nothing moves sandbox→production without explicit approval (binding testing-sandbox rule).

---

## 2. Tool inventory — all 27 registered tools

Frontend route for every tool: `/tools/<slug>` (via `web/app/tools/[slug]/page.tsx`; card in `web/lib/tools.ts`; content in `web/lib/tool-content.ts`). Frontend card set verified 1:1 against backend registry — no backend-only or frontend-only tools.

Key per tool: **slug (category) — input → output; libraries + key mechanisms**.

### Organize (7)

1. **merge** — pdf → pdf (min 2, max 20 files). **pypdf** `PdfReader`/`PdfWriter` append. `backend/pdfedi/tools/merge.py`
2. **split** — pdf → zip (one PDF per range; ranges like `1-3,5`). **pypdf** reader/writer + stdlib `zipfile`. Range parsing from shared `_helpers.parse_page_ranges`. `split.py`
3. **rotate_pages** — pdf → pdf (90/180/270). **pypdf** (`page.rotation`). `rotate_pages.py`
4. **delete_pages** — pdf → pdf (range spec; ≥1 page must remain). **pypdf**. `delete_pages.py`
5. **reorder_pages** — pdf → pdf (permutation e.g. `3,1,2`). **pypdf**. `reorder_pages.py`
6. **resize_pages** — pdf → pdf (A4/A5/Letter/Legal; fit/stretch). **pypdf** `Transformation` scale + new mediabox. `resize_pages.py`
7. **n_up** — pdf → pdf (2/4/6/9 pages per sheet). **pypdf** `Transformation` + new-sheet pages composed in the writer. `n_up.py`

### Convert (7)

8. **extract_text** — pdf → text. **pypdfium2** (deferred import) — `PdfDocument`, `page.get_textpage()` (line 61); pypdf only for a cheap page count (`_helpers.page_count_of_pdf`). `extract_text.py`
9. **pdf_to_images** — pdf → zip (PNG per page). **pypdfium2** `page.render(scale)` → `to_pil()` → PIL PNG; stdlib `zipfile`. `pdf_to_images.py`
10. **images_to_pdf** — image(s, max 20) → pdf. **PIL only** — `Image.open`, `pages[0].save(..., save_all=True)` (line 70). No reportlab. `images_to_pdf.py`
11. **thumbnails** — pdf → png (single contact-sheet PNG despite `output_kind="images"`). **pypdfium2** render + **PIL** grid assembly. `thumbnails.py`
12. **extract_images** — pdf → zip. **pypdf** `img_obj.get_data()` + **PIL**: JPEG (DCTDecode) opened directly, raw FlateDecode reconstructed via `Image.frombytes` (`_pil_from_xobject`, line 93); shared by pdf_to_word. `extract_images.py`
13. **ocr** — pdf → pdf (searchable). **pypdfium2** render pages (deferred import, line 123) → **pytesseract** `image_to_data` (deferred, lines 94/99/188) → **reportlab** `Canvas` builds invisible-text overlay PDF → **pypdf** assembles with original pages. Pages with native text are copied as-is (pypdf text check). Graceful `ocr_unavailable` ToolError without tesseract (Dockerfile installs `tesseract-ocr` + `eng.traineddata`). No ocrmypdf anywhere (comment at line 3: "Pipeline (no ocrmypdf needed)"). `ocr.py`
14. **pdf_to_word** — pdf → docx. **pypdfium2** text extraction via raw `FPDFText_*` char boxes/font sizes (line 514-515, deferred) + **pypdf** content-stream image walk (`ContentStream`, line 434) → **python-docx** rebuild (Headings, paragraphs, bold runs, images; deferred import line 662). Fidelity layer (advance-based spacing, best-match lines, column gutters) + memory layer (pre-decode gates, decode-cache release, downscale→JPEG) in same module. `pdf_to_word.py`

### Edit (6)

15. **metadata** — pdf → json (read-only info). **pypdf** `PdfReader.metadata`. `metadata.py`
16. **edit_metadata** — pdf → pdf (title/author/subject/keywords). **pypdf** writer metadata. `edit_metadata.py`
17. **watermark** — pdf → pdf. **reportlab** `canvas` builds a transparent text overlay PDF → **pypdf** `merge_page` onto each page (line 103). `watermark.py`
18. **page_numbers** — pdf → pdf. **reportlab** `canvas` overlay (numbers) → **pypdf** `merge_page`. `page_numbers.py`
19. **crop** — pdf → pdf (adjust cropbox). **pypdf** `RectangleObject`. `crop.py`
20. **compare** — 2 pdfs → pdf (annotated diff). **pypdfium2** `_render_one` (150 DPI, line 86, deferred import) → **PIL** `ImageChops.difference` + `ImageDraw` red boxes (lines 120/170) → **reportlab** `Canvas` assembles the diff PDF. 50-page cap. `compare.py`

### Optimize (3)

21. **compress** — pdf → pdf. **pypdf** restructure + **PIL** image downsampling (`_downsample_image_object`, line 147; `_pil_image_from_xobject`, line 95): JPEG images downsampled 94% measured; FlateDecode/raw rebuilt via `Image.frombytes` (fixed 2026-10-12, commit `fbb540b`). `compress.py`
22. **grayscale** — pdf → pdf. **pypdfium2** render grayscale at chosen DPI (72–600, deferred import line 91) → **reportlab** `Canvas` + `ImageReader` rebuilds pages (lines 98-99) → **pypdf** assemble. Note: text becomes image (unselectable) — documented in SPEC. `grayscale.py`
23. **repair** — pdf → pdf. **pikepdf** (qpdf) `pikepdf.open` + `save` — rebuilds xref/object streams (deferred import, line 88); fallback: **pypdf** `PdfReader(strict=False)` lenient rewrite; `unrepairable` ToolError when both fail. `repair.py`

### Security (4)

24. **password_protect** — pdf → pdf. **pypdf** `writer.encrypt`. `password_protect.py`
25. **unlock_pdf** — pdf → pdf. **pypdf** `reader.decrypt` (`PasswordType`). `unlock_pdf.py`
26. **redact** — pdf → pdf (regions removed). **pypdf** content-stream surgery + **reportlab** `canvas` black boxes + **pypdfium2** (imported; verifies via render) — redaction removes text from content stream AND raw bytes (verified). `redact.py`
27. **flatten** — pdf → pdf (bake annotations/forms into static page). **pypdf**: strips widget annotations/AcroForm; appearance streams remain in page content (line 60-61). `flatten.py`

### Engine→tool map (precision core)

| Library | Used by |
|---|---|
| **pypdf** (5.1.0) | 24 of 27 tools (all except extract_text, images_to_pdf, pdf_to_images) — page ops, metadata, security, plus ingest in `jobs.py` and page counts in `_helpers.py` |
| **pypdfium2** (4.30.0) | extract_text, pdf_to_images, thumbnails, ocr, grayscale, compare, pdf_to_word, redact — all *rendering* and *text-extraction* workloads |
| **PIL/pillow** (11.0.0) | compress, pdf_to_images, images_to_pdf, thumbnails, extract_images, compare, pdf_to_word |
| **reportlab** (4.2.5) | watermark, page_numbers, redact, ocr, grayscale, compare — all *PDF-overlay/page-building* workloads |
| **pikepdf** (10.17.0) | repair only |
| **python-docx** (1.1.0) | pdf_to_word only |
| **pytesseract** (0.3.13) | ocr only |

Potential overlaps for Phase 2 to examine: (a) pypdf vs pikepdf for low-level PDF rewriting (repair is the only pikepdf consumer; its job needs qpdf's xref rebuild which pypdf cannot do); (b) pypdfium2-render vs PIL-from-XObject image paths in compress/extract_images/pdf_to_word (both decode images — different purposes: downsample in place vs extract bytes); (c) reportlab canvas overlay pattern duplicated in watermark/page_numbers/redact/ocr/grayscale/compare (candidates for a shared overlay helper); (d) pypdfium2 imported 8× deferred inside `run()` (no shared render helper).

---

## 3. Dependency inventory

### `backend/requirements-render.txt` (THE production file — used by `Dockerfile`)

Licenses verified via installed package metadata in the pinned venv where available; remainder are the widely documented upstream licenses.

| Package | Version | License | Imported by (grep-verified) |
|---|---|---|---|
| fastapi | 0.115.6 | MIT | `api/admin.py`, `api/health.py`, `api/public.py`, `security.py`, `sandbox/app.py` |
| uvicorn[standard] | 0.34.0 | BSD-3 | *No Python importer — invoked from `Dockerfile` CMD as the server process* |
| pydantic | 2.10.4 | MIT | `api/admin.py`, `api/public.py`, `config.py` |
| pydantic-settings | 2.7.0 | MIT | `config.py` |
| python-multipart | 0.0.20 | Apache-2.0 | *No direct importer — used implicitly by FastAPI `UploadFile`/`Form`* |
| sqlalchemy | 2.0.36 | MIT | `api/admin.py`, `api/health.py`, `api/public.py`, `db.py`, `jobs.py`, `migrate.py` |
| greenlet | 3.1.1 | MIT | *No direct importer — transitive dep of SQLAlchemy* |
| argon2-cffi | 23.1.0 | MIT | `security.py` |
| pyjwt | 2.10.1 | MIT | `security.py` |
| geoip2 | 4.8.0 | Apache-2.0 | `analytics.py` |
| pypdf | 5.1.0 | BSD-3-Clause | 24 tool modules + `jobs.py`, `tools/_helpers.py` (see engine map) |
| pypdfium2 | 4.30.0 | Apache-2.0 AND BSD-3-Clause + LicenseRef-PdfiumThirdParty | 8 tool modules (deferred imports) |
| pillow | 11.0.0 | MIT-CMU | 7 tool modules |
| reportlab | 4.2.5 | BSD | 6 tool modules |
| pikepdf | 10.17.0 | MPL-2.0 | `tools/repair.py` (deferred) |
| python-docx | 1.1.0 | MIT | `tools/pdf_to_word.py` (deferred) |
| pytesseract | 0.3.13 | Apache-2.0 | `tools/ocr.py` (deferred) |
| structlog | 24.4.0 | MIT | `backend/main.py` (`structlog.configure` + `get_logger`) |

**Result: every production dependency has a verified importer — NO unused production dependency.** (structlog initially appeared unused by a `pdfedi/`-only grep; it lives in `backend/main.py`. PyMuPDF/fitz is banned by policy — `requirements-render.txt` carries the AGPL warning comment.)
**System packages** in `Dockerfile`: `tesseract-ocr` + `eng.traineddata` (OCR), `curl`, `ca-certificates`; DB-IP City Lite MMDB downloaded at build time to `/srv/geoip/`.

### `sandbox/requirements.txt` (sandbox-only, never in production)

`python-docx`, `pdfplumber`, `pytesseract` — plus the backend pin file for the shared framework. **pdfplumber**: imported by sandbox experimental tools only (not in production). Note the sandbox experimental `word_to_pdf.py` — no production counterpart.

### `web/package.json`

deps: next ^14.2.35, react ^18.3.1, react-dom ^18.3.1. devDeps: typescript, tailwindcss, postcss, autoprefixer, @types/*. All used (Next.js build pipeline). No excess.

### `sandbox/pdfeditor/apps/web/package.json`

deps: next ^14.2.21, react ^18.3.1, react-dom ^18.3.1, `pdf-lib` ^1.17.1 (MIT — export + content-stream text rewrite), `pdfjs-dist` ^4.8.69 (Apache-2.0 — rendering), `zustand` ^5.0.2 (MIT), `immer` ^10.1.1 (MIT), `zod` ^3.24.1 (MIT), workspace `packages/pdf-core`, `packages/shared`. All used per the editor codebase.

---

## 4. Shared utilities

### Backend (`backend/pdfedi/`)

- `tools/base.py` — `ToolSpec`, `ToolContext`, `ToolInput`, `ToolError`, option helpers (`get_option`); imported by all 27 tools.
- `tools/_helpers.py` — `parse_page_ranges`, `resolve_pages` (range specs for split/rotate/delete), `read_input_bytes`, `page_count_of_pdf` (cheap pypdf page count).
- `jobs.py` — ingest/dedup/enqueue/run/retry/cancel; thread semaphore (2); storage-quota hooks.
- `storage.py` — sha256-keyed disk storage (`put_object`, `get_object_path`).
- `db.py`/`models.py`/`migrate.py`/`turso.py` — SQLAlchemy engine/sessions, models (File, Job, visits, bot_visits, login audits), migrations, Turso HTTP dialect.
- `analytics.py` — `should_track`/`should_track_bot`, `is_bot`, `log_visit`, `log_bot_visit`, geo lookup (geoip2); consumed by `main.py` middleware + `api/admin.py`.
- `security.py` — argon2id hashing, JWT issue/verify, admin auth dependency (argon2-cffi, pyjwt).
- `quotas.py` — per-IP per-tool hourly quota enforcement (5/hour default).
- `timeutil.py` — UTC ISO timestamps.

### Frontend (`web/lib/`)

- `api.ts` — API client: `ToolSpec`, `UploadedFile`, `Job` interfaces; `api` object wrapping every `/api/v1` endpoint (tools list, upload, job create/poll/cancel/retry, download, quota, limits).
- `tools.ts` — `TOOL_CARDS` (27 entries, 1:1 with backend), `CATEGORIES`, `TOOL_SLUGS`.
- `tool-content.ts` — per-tool SEO/UX content; **required** — `[slug]` page calls `notFound()` without it.

---

## 5. Config / env / deployment

**Env vars** (`backend/pdfedi/config.py` docstring + `Settings` fields; names only):
`DB_PROVIDER`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD` (one-time plaintext reset, remove after use), `STORAGE_DIR`, `MAX_UPLOAD_MB` (50), `MAX_DOWNLOAD_MB` (50), `QUOTA_PER_HOUR` (5), `MAX_CONCURRENT_JOBS` (2), `ENV`, `FRONTEND_DIR`, `DIGEST_KEY` (admin digest endpoint — referenced in `api/admin.py`); JWT expiry `jwt_expire_hours` (12).

**Dockerfile** (multi-stage): stage 1 (`node:20-slim`) builds `web/` → static export; stage 2 builds `sandbox/pdfeditor` (pnpm) with `NEXT_STATIC_EXPORT=1` + `NEXT_BASE_PATH=/editor`; stage 3 (`python:3.12-slim`) installs `requirements-render.txt`, apt packages (tesseract-ocr + eng.traineddata, curl), downloads DB-IP MMDB; copies both static outputs into `/srv/static`; serves via uvicorn. **Plan:** free (512MB RAM, 0.15 CPU) — see §6 for consequences.
**render.yaml**: single Docker web service `pdfedi`, health check `/api/v1/health/live`, env vars (secrets `sync: false`).

---

## 6. Known issues already documented (from `tool-audit/`, dated 2026-10-12)

Reports: `tool-audit/TOOL-AUDIT-REPORT.md` (106 tests, 19 tools) and `tool-audit/EDITOR-AUDIT-REPORT.md` (11 checks). Both predate the 2026-10-13 tool packs (their results cover only the original 19 tools).

**Status of every documented defect vs. current state:**

| Item | Report finding | Current status |
|---|---|---|
| ISSUE-1 (medium): compress silent no-op on FlateDecode/PNG images — quality selector misleading | `TOOL-AUDIT-REPORT.md` L41-51, L97 | **FIXED** 2026-10-12, commit `fbb540b` (raw RGB reconstruction via `Image.frombytes`) — but the full 106-test suite was **never rerun** after the fix; do not claim 106/106 |
| ISSUE-2 (cosmetic): `images_to_pdf` leaks a BytesIO object repr in an invalid-input error message | L53, L183 | **OPEN** (error-hygiene only, no functional impact) |
| thumbnails `output_kind="images"` returns a single contact-sheet PNG — label misleading | L57 | **OPEN** (cosmetic; verified functional) |
| Memory note: compress "only re-saves" — stale blanket statement | L64 | **STALE** — superseded: real downsampling works for JPEG and (post-fix) Flate images |
| Editor E-1…E-5: Escape discards edits; text overlap; highlight dead; image picker never opens; page delete hangs | `EDITOR-AUDIT-REPORT.md` | **ALL FIXED** 2026-10-12 (editor fixes batch; live-verified 6/6) — do not re-report as broken |
| Editor intermittent "Loading your PDF…" hang | observed in audit verification | **FIXED** 2026-10-12 (`e47d516` — PDF.js doc destruction, 30s timeout) |
| OCR fails gracefully without tesseract (`ocr_unavailable`) | audit env had no tesseract | By design — production Dockerfile installs tesseract-ocr |

**Known limitations confirmed live 2026-10-13 (not in the audits, for Phase 2/5 awareness):**
- pdf_to_word crashed the free-tier instance with a 502 on the user's 8.4MB scan-heavy PDF (Render OOM event 2026-10-13 16:32 +04): root cause pypdf `get_data()` permanently caches decoded streams (~104MB × 2 for ICCBased scan backgrounds, then discarded). **FIXED** live commit `bc7ad1a`: dict-only decodability pre-check, >60MP gate, decode-cache release, downscale→1600px + JPEG placements, per-page assembly — peak RSS 370MB → 78MB, output byte-identical, both user files (GLS 8.4MB, GBS 4.0MB) convert + download clean. Lesson: any tool decoding image XObjects must pre-check size/colorspace from the dict before `get_data()`.
- Website "feels heavy": measured 2026-10-13 — cold starts (free tier sleeps after ~15 min idle; ~30-60s wake, sometimes a 502 holding page), ~2.4s TTFB even warm (0.15 CPU + per-request analytics→Turso round-trip in the page-response path), zero cache headers (445KB JS/CSS re-downloaded every visit), ~500KB first load incl. 109KB polyfills.

---

## Appendix: file-role index (key paths)

- `backend/main.py` — entry, lifespan, middleware, structlog setup
- `backend/pdfedi/{config,jobs,db,models,migrate,turso,storage,security,quotas,analytics,timeutil}.py` — shared backend
- `backend/pdfedi/tools/` — 27 tools + `base.py` + `_helpers.py` + `__init__.py` (registry)
- `backend/requirements-render.txt` — production pins; `Dockerfile`; `render.yaml`
- `web/app/{page.tsx,tools/[slug]/page.tsx,admin/page.tsx,sitemap.ts,robots.ts}` — frontend routes
- `web/lib/{api.ts,tools.ts,tool-content.ts}` — frontend shared
- `sandbox/pdfeditor/` — editor source (production `/editor`); `sandbox/app.py` + `sandbox/tools/` (SANDBOX_TOOLS) + `sandbox/requirements.txt` — testing harness; `sandbox/editor/`, `sandbox/web/` — retired prototypes (superseded)
- `tool-audit/` — 2026-10-12 audit reports, fixtures, `mix-tools-test.py`, `new-tools-test.py`; `seo-audit/` — SEO report (not inventoried here); `logo-options/` — branding candidates (~1MB, not production assets)
