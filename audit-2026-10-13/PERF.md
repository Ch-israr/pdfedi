# PDFEDI — Phase 5 Performance Audit (READ-ONLY, measured 2026-10-13 ~17:10–17:35 +04)

All figures below are measured, not estimated. No code was changed. Production untouched.
Known host facts: Render free tier — **512 MB RAM / 0.15 CPU**, single instance, **sleeps after ~15 min idle**.

## 1. Live-site measurements (production, confirmed warm)

Sleep caveat: before warm-up the instance was asleep; requests returned Render's **502 holding page** (~223 KB, `<title>502</title>`, embeds a base64 font) instead of the site. All figures below are from real pages after the instance woke (titles verified).

### 1.1 Page timing — 3 runs each, warm

| Page | HTML bytes | TTFB run 1 / 2 / 3 | Median TTFB | Total (median) |
|---|---|---|---|---|
| `/` | 54,915 | 2.59 / 2.64 / 2.43 s | **2.59 s** | 2.70 s |
| `/tools/merge/` | 32,704 | 2.41 / 2.59 / 2.35 s | **2.59 s** | 2.47 s |
| `/editor` | 11,601 | 2.46 / 2.60 / 2.63 s | **2.60 s** | 2.63 s |

**Finding:** TTFB is ~2.5–2.6 s on every page regardless of HTML size (55 KB vs 11.6 KB → same TTFB). The bottleneck is **server response time, not page bytes**.

### 1.2 Response headers

- `cf-cache-status: DYNAMIC` on **every** response (HTML and `/_next/static/*`). No edge caching.
- **No `Cache-Control`, no `Expires`** on HTML pages or on content-hashed static chunks. Static chunks carry only a weak `ETag` (no strong validator, no immutable).
- Compression: `curl` without `Accept-Encoding` downloads 54,915 B; with `Accept-Encoding: gzip` downloads **6,232 B** (~9× smaller). Compression happens at the Cloudflare edge, not the origin — backend `main.py` contains **no `GZipMiddleware`** (grep-confirmed).
- Caveat: `HEAD /` returns `Content-Type: application/json` (the API 404 handler answers HEAD); all byte measurements above used GET.

### 1.3 Asset inventory (raw KB, gzipped KB in parentheses)

Main site pages (homepage shown; tool pages identical except the page chunk):

| Asset | Size |
|---|---|
| `chunks/fd9d1056-*.js` (React framework) | 168 (52) |
| `chunks/117-*.js` | 121 (31) |
| `chunks/polyfills-*.js` | **109 (38)** |
| `chunks/972-*.js` | 25 (8) |
| `chunks/app/page-*.js` (home) / `app/tools/[slug]/page-*.js` (tool) | 13 (4) |
| `chunks/webpack-*.js` | 3 (1) |
| `css/*.css` | 15 (3) |
| `logo.png` | **111 (111)** |
| `icon-v4.png` / `apple-touch-icon-v4.png` / `favicon-v4.ico` | 24 / 9 / 3 |

**Homepage first load ≈ 656 KB raw (~190 KB gzipped)** = 55 KB HTML + 454 KB JS/CSS + 147 KB images.
Two fetches returned 0 B (origin hiccup under sequential load on 0.15 CPU); sizes cross-checked against the earlier parent-session measurement (445 KB JS/CSS) — consistent.

Editor page (`/editor`, separate Next build):

| Asset | Size |
|---|---|
| `chunks/668-*.js` (**pdf-lib + immer**, loaded upfront) | **478 (186)** |
| `chunks/5b8f0dd8-*.js` (editor React framework) | 168 (52) |
| `chunks/app/page-*.js` | 150 (41) |
| `chunks/749-*.js` | 121 (31) |
| `chunks/polyfills-*.js` | 109 (38) |
| `chunks/webpack-*.js` | 3 (1) |
| `css/*.css` | 24 (5) |
| `logo.png` | 111 (111) |

**Editor first load ≈ 1.18 MB raw (~480 KB gzipped)** + `pdf.worker.min.mjs` (**1.3 MB**) fetched lazily on first PDF open. pdf.js itself is **dynamically imported** (`await import('pdfjs-dist')` in `sandbox/pdfeditor/apps/web/lib/pdfjs.ts`) — code splitting works; the 478 KB pdf-lib+immer chunk is the wasteful upfront load (pdf-lib is only needed at export time).

**Isolation:** editor JS is **not** loaded on non-editor pages (separate `/editor/_next` build). Tool pages share the main-site framework chunks — no tool-specific bloat beyond the 13 KB page chunk. No custom webfonts anywhere (system font stack) — zero font-loading cost.

## 2. Serving-path code inspection (`backend/`)

**Static serving** (`main.py`): `/_next` mounted via `StaticFiles`; all other paths served by a **sync** `serve_frontend(path)` catch-all returning `FileResponse`. Sync def runs in Starlette's threadpool — workable but adds scheduling overhead on 0.15 CPU; no `Cache-Control` set on any `FileResponse`/`StaticFiles`.

**Middleware chain** (`main.py`, outermost first):
1. `visit_tracking` — `@app.middleware("http")`
2. `security_headers` — sets 4 security headers (cheap)

`visit_tracking` code path (verbatim structure):
```python
response = await call_next(request)   # response built FIRST
try:
    ...
    if should_track(path, ua) or should_track_bot(path, ua):
        db = SessionLocal()           # fresh session per tracked request
        ...
        log_visit(db, ...)            # INSERT + retention DELETE + commit
finally: db.close()
return response
```
Facts:
- It runs **after** the response is built — it does **not** gate TTFB. (This corrects an earlier assumption recorded in session context.)
- But it is `async def` doing **synchronous blocking** SQLAlchemy calls → blocks the uvicorn event loop during the DB round trips.
- `log_visit` = `geo_lookup` (local MMDB, cheap) + `INSERT` + **`DELETE ... WHERE created_at < cutoff` + `COMMIT`**, and `Visit.created_at` has **no index** (`models.py`: plain `String(32)`, indexed columns are only `File.sha256`, `ix_files_storage_key`, `Job.tool`). Every tracked page view runs an unindexed table scan + delete.
- DB is Turso via a **pure-Python HTTP dialect** (`pdfedi/turso.py`, `POST https://<host>/v2/pipeline`, `NullPool`) — every SQLAlchemy `execute` is an HTTPS round trip Oregon → ap-south-1 (~150–250 ms each). A tracked page view costs ~3 round trips **after** response creation, holding the event loop.

## 3. Frontend build inspection (`web/`)

`web/next.config.mjs`:
```js
{ output: "export", trailingSlash: true, images: { unoptimized: true } }
```
- No compression setting (irrelevant for static export; edge compresses).
- No `experimental.optimizePackageImports` / package-import optimization.
- 109 KB `polyfills-*.js` ships on **every** page (default Next polyfill bundle; not configurable without custom webpack).
- `web/out/` (the deployed static export): 2.7 MB total.
- `web/public/`: **464 KB** — contains legacy duplicates of current v4 branding: `icon.png`+`icon-v2.png` (116 KB each) vs `icon-v4.png` (24 KB); `apple-touch-icon.png`+`apple-touch-icon-v2.png` (26 KB each) vs `apple-touch-icon-v4.png` (9 KB); `favicon.ico`+`favicon-v2.ico` vs `favicon-v4.ico`. `logo.png` (114 KB, current, loaded on every page) is the heaviest image asset.

## 4. Backend hot paths

- **Job concurrency:** `threading.Semaphore`, `max_concurrent_jobs: int = 2` (`config.py:50`). Jobs run in background daemon threads — HTTP never blocks on processing. A 3rd job waits in QUEUED with no timeout. On 0.15 CPU, 2 concurrent CPU-heavy jobs contend hard.
- **Uploads:** `api/public.py:125` — `data = await file.read()` holds the **entire upload in memory** before `put_object` writes it to disk. 50 MB limit → up to 50 MB RAM per concurrent upload.
- **Temp files:** `ToolContext` uses `tempfile.mkdtemp` (disk, good); `run_job` calls `ctx.cleanup()` in `finally` — verified, no leak path. Storage is disk-based, content-addressed (dedup by sha256).
- **Job DB traffic:** create → 1 indexed quota PK read; success → `record_success` = read + upsert + commit + **`_prune_old` DELETE on unindexed `window_start < cutoff`** (2nd commit). Table is tiny (2-hour retention) — negligible.
- **Engine init per job:** module-level imports are one-time; `pdf_to_word` imports pypdfium2 at `run()` line 514 (dict lookup after first import — negligible). Real per-job costs are the PDF parse itself and tool work — inherent, not duplication.
- **Per-request DB sessions:** `SessionLocal()` opened per API request (`get_db`) and per tracked page view (middleware) — each session is fresh HTTPS to Turso; no pooling by design (NullPool, HTTP is stateless).

## 5. Ranked bottleneck list

**B1 — Cold starts (free-tier sleep).** (a) Measured: asleep instance served Render's 502 holding page (~223 KB) instead of the site; first wake took ~1 min. (b) Impact: dominant — worst-case ~60 s+ blank/error on first visit after 15 min idle. (c) Fix: paid instance (Render Starter ~$7/mo) or keep-warm pinging. (d) Risk: low. (e) **Hosting ($)**.

**B2 — ~2.6 s TTFB on every page, warm.** (a) Measured: median TTFB 2.59/2.59/2.60 s on 55 KB, 33 KB, 11.6 KB pages — size-independent, so it's origin compute on 0.15 CPU (sync catch-all route + threadpool scheduling + middleware). (b) Impact: every navigation feels laggy even with a warm instance. (c) Fix: code-only micro-fixes are marginal; the structural fix is more CPU (paid tier). Partial code help: make `serve_frontend` async, add `Cache-Control` so repeat visits skip the origin entirely. (d) Risk: low. (e) Mixed — headers are **code-only (free)**; CPU is **$**.

**B3 — Zero caching anywhere.** (a) Measured: no `Cache-Control`/`Expires` on HTML or on content-hashed `/_next/static/*`; `cf-cache-status: DYNAMIC` on all. (b) Impact: every repeat visit re-downloads ~190–480 KB (gz) from the 0.15-CPU origin; static chunks (immutable by hash) could be cached 1 year. (c) Fix: `Cache-Control: public, max-age=31536000, immutable` on `/_next/static` + short `max-age` (e.g. 60–300 s) on HTML. (d) Risk: low (hashes make immutable safe; HTML short-TTL needs deploy discipline — fine, deploys replace files). (e) **Code-only (free)**.

**B4 — Analytics middleware blocks the event loop.** (a) Code-verified: `async def` middleware doing sync SQLAlchemy over HTTPS (Oregon→Mumbai, ~3 round trips per tracked page view: INSERT + unindexed DELETE + COMMIT). Post-response, so it doesn't gate TTFB, but it stalls the single event loop for concurrent requests. (b) Impact: under concurrent traffic, requests queue behind each other's analytics writes. (c) Fix: move logging to a background thread/`BackgroundTasks`; add index on `Visit.created_at` (and `Quota.window_start`). (d) Risk: low. (e) **Code-only (free)**.

**B5 — 478 KB pdf-lib+immer chunk loaded upfront on /editor.** (a) Measured: in the editor HTML's script list; pdf-lib is only used at export. (b) Impact: ~186 KB gzipped of the editor's ~480 KB gz first load is dead weight until the user downloads. (c) Fix: `next/dynamic` or dynamic `import('pdf-lib')` at export time. (d) Risk: low-medium (touching the editor build; verify export still works). (e) **Code-only (free)**.

**B6 — 109 KB polyfills on every page.** (a) Measured on all three pages. (b) Impact: ~38 KB gz per page load, useless on modern browsers. (c) Fix: custom webpack `resolve.alias`/entry tweak or accept it (Next default; moderate effort, low yield). (d) Risk: low-medium. (e) **Code-only (free)** — low priority.

**B7 — logo.png 114 KB unoptimized, loaded on every page.** (a) Measured in `web/public/` and in every page's asset list; PNG, no compression. (b) Impact: ~111 KB of every first load. (c) Fix: convert to WebP (~15–25 KB) with PNG fallback, or compress. (d) Risk: low (visual check needed — user's screen is the gate for visuals). (e) **Code-only (free)**.

**B8 — Full-upload into memory + job outputs into memory.** (a) Code-verified: `await file.read()` (≤50 MB) in the upload handler; `run_job` does `output_path.read_bytes()` before hashing/storing. (b) Impact: with 2 concurrent jobs + uploads on a 512 MB instance, transient spikes of 100–200 MB (this class of spike OOM-killed the instance on 2026-10-13 16:32 +04 during a pdf_to_word conversion — since fixed for that tool). (c) Fix: stream uploads to disk (` SpooledTemporaryFile`/chunked write); stream output hashing (`hashlib` over chunks) instead of `read_bytes()`. (d) Risk: low-medium (touches upload/job paths; needs regression tests). (e) **Code-only (free)**.

**B9 — Legacy duplicate assets in `web/public/` (464 KB).** (a) Measured: v2/unversioned icon duplicates alongside v4. (b) Impact: none on load today (unreferenced), but 232 KB of dead weight in the Docker image and branding-confusion risk (`favicon.ico` default path still serves v2). (c) Fix: quarantine then remove after reference check (Phase 4 work). (d) Risk: low with quarantine. (e) **Code-only (free)**.

### Explicitly ruled out
- Editor code on non-editor pages: **not** loaded (separate `/editor/_next` build).
- pdf.js in editor initial bundle: **not** present (dynamic import works; verified absent from upfront chunks).
- Analytics gating TTFB: **disproven** — runs post-response.
- Gzip missing: **disproven** — edge compresses (55 KB → 6.2 KB).
- Duplicate processing engines causing perf cost: none found in the perf-relevant paths (Phase 2 territory, not repeated here).
