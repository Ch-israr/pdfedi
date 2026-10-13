# PDFEDI Universal Routing, API Pipeline & Tool Engine Audit

**Date:** 2026-10-13 · **Branch:** `audit/routing-2026-10-13` (from `main` @ `bc7ad1a`, = live production code)
**Scope:** all 27 backend tools, frontend routing, API pipeline, processing engines.
**Protection:** no deploy, push, merge, or production modification at any point in this audit.
**Pinned env:** `~/workspace/.venvs/pdfedi-pinned/bin/python` (production dependency parity) used for all runs.

---

## §1 — Tool → Route Inventory (verified programmatically)

**Counts (all parsed from source, not eyeballed):**
- Backend registry (`backend/pdfedi/tools/__init__.py`, `TOOLS` dict built from `_m.SPEC.key`): **27 keys**
- Frontend cards (`web/lib/tools.ts` `TOOL_CARDS`): **27 keys**
- Content entries (`web/lib/tool-content.ts`): **27 keys**
- Sitemap: `TOOL_SLUGS` is **derived from TOOL_CARDS** (`export const TOOL_SLUGS = TOOL_CARDS.map(...)`) → consistent by construction
- **Mismatches across registry ↔ cards ↔ content: 0**

Routing mechanics (verified in `web/app/tools/[slug]/page.tsx`):
- Single dynamic route `web/app/tools/[slug]/page.tsx`; homepage cards link via `` href={`/tools/${t.key}`} `` (`web/app/page.tsx:60`)
- `generateStaticParams()` builds exactly the 27 slugs; unknown slug → `notFound()` → real 404 (commit `3d1ca4c`)
- Canonical URLs emitted per tool in metadata (no trailing slash); trailing-slash canonicalisation: site links canonical non-slash form
- `/editor`: **separate static app** served at `/editor` from `sandbox/pdfeditor` — shares no route, no pipeline code, and no processing engine with any tool or with Compress. The only `/editor` link in the web app is the homepage banner card (`web/app/page.tsx:23`); the shared Header/Footer (`web/components/chrome.tsx`) link only to `/`
- `/admin`: separate route; unauthenticated → 401 (verified live today)

**Verdict §1: no broken routes, no misrouted cards. Every tool resolves to exactly one route; the editor and Compress do not share any route or pipeline.**

---

## §2 — Tool → API → Engine Mapping (verified from source)

**Single end-to-end pipeline for all tools (verified, no exceptions):**

```
URL slug → [slug]/page.tsx → <ToolRunner toolKey={params.slug}>
  → api.tool(toolKey)      [GET /api/v1/tools/<key>, runtime spec]
  → option inputs rendered FROM spec.options (keyed by o.name)
  → api.createJob(spec.key, fileIds, opts)   [POST /api/v1/jobs {tool_key, file_ids, config}]
  → backend/pdfedi/jobs.py create_job() → get_tool(tool_key)  (unknown key → 404 "Unknown tool")
  → tool.run(ctx, config) → output_file_id
  → api.downloadUrl(job.output_file_id)      [GET /api/v1/downloads/<id>]
```

**Config-key consistency (programmatic check, all 27 tools):** every config key read by a backend tool
(`get_option`/`require_option`/`options[...]`) is declared in that tool's own `SPEC.options`, and the
frontend renders inputs **only** from `spec.options` — so a UI↔backend key mismatch is **structurally
impossible** on the single ToolRunner path. Result: **0 undeclared config reads, 0 mismatches.**

**Engine mapping (actual imports per tool module):**
| Engine | Tools (count) |
|---|---|
| pypdf (page ops) | 22 |
| pypdfium2 (render/text) | 8 — extract_text, pdf_to_images, thumbnails, ocr, grayscale, compare, pdf_to_word, redact |
| reportlab (overlays) | 6 |
| pillow (images) | 6 |
| pikepdf (repair only) | 1 |
| python-docx (pdf_to_word only) | 1 |
| pytesseract (ocr only) | 1 |

Specialty-engine tools and their isolated use verified: `repair`→pikepdf/qpdf, `ocr`→pytesseract, `pdf_to_word`→python-docx.
No tool invokes the wrong engine; no tool shares the editor's code path.

**Verdict §2: no broken API connections, no key mismatches, no wrong engines.**

---

## §3 — Chunk-668 Root Cause (verified from live artifacts + source)

**Observed symptom (user's console):** `668-d6202e3563b1134b.js` 404 → `application/json` MIME refusal →
`Failed to fetch RSC payload for https://pdfedi.onrender.com/editor/` → `ChunkLoadError` → Next falls back to browser navigation.

**Verified facts:**
1. **Current build is fully consistent.** All 15 script chunks referenced by the live `/`, `/tools/compress/`, and `/editor` HTML return **HTTP 200 with `text/javascript`** (one transient connection blip on a webpack chunk re-verified clean on retry).
2. **Chunk 668 does not exist in the current build.** It returns **HTTP 404 with `Content-Type: application/json` and body `{"detail":"Not Found"}`** — the backend's API 404 handler answers for unknown static paths. With `x-content-type-options: nosniff`, the browser refuses to execute it as a script — that is exactly the user's MIME-type console error. (A missing file 404ing is correct behavior; the JSON body is what turns it into a confusing MIME error.)
3. **No routing error.** Tool pages render no `/editor` link (Header/Footer link only to `/`); the only `/editor` link in the web app is the homepage banner card. Next `<Link>` prefetches routes whose links enter the viewport — a prefetch of the `/editor` RSC payload from a stale page therefore explains an `/editor` RSC request without any click.
4. **Stale-page skew is possible: no Cache-Control headers exist on any HTML response** (verified: absent on `/` and `/tools/compress/`), so browsers heuristically cache pages across the redeploy.

**Root cause:** a browser tab holding a page from the **pre-redeploy build** (even though the commit was identical, the Docker rebuild renumbered chunks) issued a request for chunk 668, which exists only in the old build's graph. The redeploy created deployment skew between cached HTML and fresh static assets. **NOT a routing misconfiguration, NOT compress/editor coupling, NOT a missing current artifact.**

**Ruled in/out:** routing error — OUT (all 27 routes verified 1:1); prefetch — IN (mechanism that fires the RSC request without a click); stale cache — IN (no cache headers); missing artifact — OUT (all current chunks 200); editor-vs-compress coupling — OUT (separate routes, separate pipelines, no shared code).

**Fix status:** structural mitigations (immutable caching of hashed static assets) already exist in the pending `cleanup/2026-10-13-audit` branch; no code change made here (production protection, §8) — documented as recommendation in §9.9.

---

## §4 — Compress Pipeline Trace (this branch = production code)

**Trace verified from source:** UI quality selector ← `spec.options` (`quality`, default `medium`) →
`POST /api/v1/jobs {tool_key:"compress", config:{quality}}` → `compress.run()` reads via `get_option` →
`_QUALITY_SETTINGS` map → per-image `_downsample_image_object` → **output always written to a new file**
(`ctx.new_output_path`), never the input path. Invalid quality value → `ToolError` (no silent fallback).

**Measured results (SHA-256 + sizes, pinned env, this branch):**

| File | low | medium | high | output hash ≠ input? |
|---|---|---|---|---|
| jpeg-heavy.pdf (photo, 1960KB) | 103KB (**−94.7%**) | 501KB (−74.4%) | 1959KB (−0.0%) | yes, all |
| GBS form, vector/fonts (3938KB) | 3925KB (−0.3%) | 3925KB | 3925KB | yes, all |
| Kandan form, ICCBased scans (8231KB) | 8221KB (−0.1%) | 8221KB | 8221KB | yes, all |

**Findings:**
- `quality=high` **intentionally** skips image recompression: `_QUALITY_SETTINGS["high"] = (None, 0)` — "structural compression only, no downsampling" (documented in the option help). −0.0% at high is by design.
- **No code path returns the input file as output on error** — every outcome writes a fresh output file with a different SHA-256 (sizes differ by bytes even when content barely shrinks).
- **Same-size outputs are honest, not silent failures:** GBS is vector/font content with nothing to downsample; Kandan's scans are ICCBased, which the production decoder passes through. The ICCBased class is fixed in `fix/compress-icc-images` (c5bcef9: Kandan **8231KB → 83KB, −99.0%**, verified separately).
- Quality selection reaches the backend correctly (low/medium/high produce measurably different outputs on image-bearing files).

**Verdict §4: compress pipeline is correct end to end; same-size results are explained and legitimate.**

---

## §5 — Git History & Cleanup-Caused Problems

**Proof cleanup never shipped:** `git merge-base --is-ancestor cleanup/2026-10-13-audit main` → **NOT an ancestor — never merged**. Production commit `bc7ad1a` therefore contains none of its changes. No production issue in this audit can have been caused by the cleanup work.

**Last ~30 commits touching routes/registry/web/API (all on main, all additive/consistent):**
- `7ecab56` add Repair/Compare/PDF-to-Word (27 tools) · `5fcec18` fix 404 on 5 new tools (added missing TOOL_CONTENT entries) · `7bfaed6` add 5 tools (24 total)
- `3d1ca4c` real 404 for unknown tools · `ba55073` editor integration at `/editor` · `a511a16` /editor in sitemap
- `2ad933f` card redesign · `c160e97` admin Query import fix · `0075017` admin rate limiting
- No commit removed or renamed a route, endpoint, registry entry, or asset. No inconsistency between history and current code.

**Verdict §5: zero cleanup-caused problems (cleanup never shipped); route/registry history is clean.**

---

## §6 — Unused Code (evidence-based scan)

- **Backend:** all 27 tool modules on disk are registered 1:1 in `_MODULES` (none unregistered, none phantom);
  `base.py`/`_helpers.py` are shared infrastructure with live importers.
- **Frontend (`web/lib/`):** every export is used — `CATEGORIES` (homepage), `TOOL_SLUGS` (`[slug]` page + sitemap),
  `ToolFaq` (the `ToolContent` interface in the same file), `UploadedFile`/`ToolSpec`/`api` (ToolRunner).
- **Retired prototypes** (`sandbox/editor`, `sandbox/web`) and **untracked build output** (`web/out/`) are
  documented as out of scope and intentionally excluded — not audited as live source.
- **Result: nothing met the provably-unreferenced + zero-risk bar. Removed: none (report-only).**

No new bugs were surfaced by §§1–2 that required a fix on this branch — the issues found today
(ICCBased compress, OCR engine/interleave) already have their own validated fix branches. This branch therefore
contains **zero code changes** (report + evidence only), which is the safest possible outcome for an audit branch.

---

## §7 — Tests (local, this branch = production code)

**(a) Pinned regression suites:** `tool-audit/mix-tools-test.py` → **21 passed, 0 failed**;
`tool-audit/new-tools-test.py` → **26 passed, 0 failed**.

**(b) Local branch build E2E** (uvicorn on 127.0.0.1:8155, throwaway SQLite DB, pinned env, real HTTP API):
| Check | Result |
|---|---|
| compress jpeg-heavy low (pipeline: upload→job→download) | **PASS** 1960KB → 103KB |
| compress GBS low (honest same-size class) | **PASS** 3938KB → 3925KB (−0.3%) |
| merge five+ten-A | **PASS** 15 pages |
| ocr editor-audit-test.pdf | **expected failure** — page-specific ToolError naming page 2 (the legacy-engine defect; fixed in `fix/ocr-lstm-engine`) |
| pdf_to_word GBS | **PASS** 24 paragraphs, "100 sqft" present |
| repair 88%-truncated Kandan | **PASS** honest structured failure: "could not be repaired — the file is too damaged. Detail: Stream has ended unexpectedly" |
| metadata five-pages | **PASS** page_count=5 |

**(c) Static frontend verification (scripted):** all 27 TOOL_CARDS keys resolve to `/tools/<key>` via the single
dynamic `[slug]` route whose `generateStaticParams`/`notFound` logic is verified in source; every card slug is a
registry key and a content entry (27/27). `/editor` has **no** `web/app` route dir (separate static app —
route separation proven). `/admin` route exists.

**(d) Browser-level checks not verifiable from this environment** (Back/Forward per tool, refresh, per-tool console
watch in a real browser): marked UNVERIFIED locally. Mitigating evidence: a full browser sweep of the Compress
tool page on production was executed today (fresh load, end-to-end job, download — all PASS, zero errors); the
remaining tools' in-browser runs are marked pending-deploy. The automation browser in this environment cannot reach
private loopback addresses, so the local branch build could not be click-tested here.

---

## §9 — Final Report

### 1. Tool → route inventory
27 backend registry keys = 27 frontend cards = 27 content entries = 27 generated routes = 27 sitemap entries —
**0 mismatches** (programmatically verified). Unknown slugs → real 404. `/editor` is a separate static app with no
shared route; `/admin` separate and auth-gated.

### 2. Tool → API → engine mapping
One pipeline for all tools: URL slug → `[slug]/page.tsx` → `ToolRunner(toolKey=slug)` → spec from
`GET /api/v1/tools/<key>` → `POST /api/v1/jobs {tool_key, file_ids, config}` → `get_tool(tool_key)` (unknown →
404) → engine → `GET /api/v1/downloads/<output_file_id>`. Config keys are UI-consistent by construction
(**0 undeclared reads**). Engines: pypdf 22, pypdfium2 8, reportlab 6, pillow 6, pikepdf 1 (repair), python-docx 1
(pdf_to_word), pytesseract 1 (ocr). No wrong-engine invocations.

### 3. Broken routes / API connections found
**None.** No misrouted cards, no mismatched tool_keys, no renamed/missing endpoints, no broken imports, no
wrong-engine calls, no download returning the wrong file.

### 4. Root cause per confirmed issue
- **Chunk-668 console errors:** deployment skew — stale cached page from the pre-redeploy build requested a chunk
  that only existed in the old build's numbering; server correctly 404s (JSON body, hence the MIME complaint);
  Next prefetches linked routes (the homepage `/editor` banner) which can fire the RSC request without a click;
  absent Cache-Control on HTML makes stale pages possible. Current build: all chunks 200/JS. Not a routing bug.
- **Compress same-size:** two legitimate classes on production code — (a) vector/font PDFs (GBS: −0.3%, nothing to
  downsample), (b) ICCBased-scan PDFs (Kandan: −0.1%, decoder passes them through). Fixed in
  `fix/compress-icc-images` (c5bcef9): Kandan −99.0%, GLS −98.9%, memory-safe, suites green.
- **OCR generic failure:** mixed native/scanned documents hit an interleave path that deleted its own output file
  (`new_output_path("ocr")` deterministic collision → `FileNotFoundError` in jobs.py → generic message); plus the
  legacy `--oem 0` engine fails where only LSTM traineddata exists. Fixed in `fix/ocr-lstm-engine` (3e977e5).

### 5. Cleanup-caused problems
**None — proven.** `git merge-base --is-ancestor cleanup/2026-10-13-audit main` → not an ancestor: the cleanup
branch was **never merged**, so production commit `bc7ad1a` contains none of its changes. Git history of
routes/registry/API over the last ~30 commits shows only additive, consistent changes (no removed/renamed
routes, endpoints, or registry entries).

### 6. Code repaired on this branch
**None** — the audit surfaced no new bugs requiring repair; the issues found today already have validated,
committed fix branches (`fix/compress-icc-images` c5bcef9, `fix/ocr-lstm-engine` 3e977e5). This branch carries
only this report.

### 7. Code removed
**None** — the unused-code scan found nothing provably dead (report-only per the directive's caution).

### 8. Tests executed (exact results)
- Pinned suites on this branch: **21/21 + 26/26 PASS**
- Local branch-build E2E (real HTTP): 6 PASS, 1 expected-failure (OCR, known defect, fix branch exists), repair honest-failure PASS
- Static frontend verification: **27/27** card→route→registry→content consistency
- Live evidence (labeled, build `bc7ad1a`): all-tools API test **25/27 PASS** (OCR genuine FAIL with root cause, repair honest unrepairable), browser sweep of Compress **PASS** (fresh load, E2E job, download, zero errors), platform pages 200/admin 401/unknown-tool 404
- Not re-run here: full browser click-through per tool (environment limitation, documented in §7d)

### 9. Remaining failures & limitations
1. The two fix branches are validated but **unmerged and undeployed** — awaiting user approval (§8).
2. Chunk-668-class skew will recur on every rebuild until HTML carries cache directives and/or hashed static gets
   immutable caching — mitigations already pending in the never-merged cleanup branch (recommendation, not implemented here).
3. Per-tool browser click-through (Back/Forward/refresh/console) remains unverified locally for 26 tools (compress verified live).
4. The instance dropped for ~40s once during today's live testing and self-recovered; cause undetermined from outside.
5. OCR's happy path with tesseract present was validated locally in this VM (binary exists here); production Dockerfile installs tesseract-ocr.

### 10. Production modification statement
**Production was NOT modified by this audit.** No deploys, no pushes, no merges, no environment/config changes,
no repository mutations on `main`. All work is local/branch-only on `audit/routing-2026-10-13`, and the branch
itself contains no code changes — only this report.
