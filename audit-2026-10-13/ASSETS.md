# PDFEDI Asset Audit — 2026-10-13 (READ-ONLY, no changes made)

Scope: inventory + reference verification only. **Nothing was deleted, moved, or quarantined.**

## 1. Full asset inventory

### 1a. `web/public/` (served at site root by backend catch-all → `FileResponse`)

| Path | Size | Type | Referenced by |
|---|---|---|---|
| `web/public/icon-v4.png` | 24.2 KB | PNG icon | `web/app/layout.tsx` metadata `icons.icon` |
| `web/public/favicon-v4.ico` | 3.3 KB | ICO favicon | `web/app/layout.tsx` metadata `icons.shortcut` |
| `web/public/apple-touch-icon-v4.png` | 9.0 KB | PNG touch icon | `web/app/layout.tsx` metadata `icons.apple` |
| `web/public/logo.png` | 111.6 KB | PNG logo | header + footer (`web/components/chrome.tsx` `<img src="/logo.png">`), OG/Twitter/JSON-LD (`web/app/layout.tsx`, `web/app/tools/[slug]/page.tsx`) |
| `web/public/llms.txt` | 2.9 KB | text (AI crawler guide) | served at `/llms.txt`; sitemap/robots context |
| `web/public/icon-v2.png` | 113.6 KB | PNG icon (legacy) | NO REFERENCE FOUND — byte-identical duplicate of `icon.png` (md5 `44fa9369…`) |
| `web/public/apple-touch-icon-v2.png` | 25.7 KB | PNG touch icon (legacy) | NO REFERENCE FOUND — byte-identical duplicate of `apple-touch-icon.png` (md5 `8503c8ea…`) |
| `web/public/favicon-v2.ico` | 5.6 KB | ICO favicon (legacy) | NO REFERENCE FOUND — byte-identical duplicate of `favicon.ico` (md5 `897ff124…`) |
| `web/public/icon.png` | 113.6 KB | PNG icon (legacy root) | NO REFERENCE FOUND in source; conventional browser fallback path only |
| `web/public/apple-touch-icon.png` | 25.7 KB | PNG touch icon (legacy root) | NO REFERENCE FOUND in source; conventional iOS fallback path only |
| `web/public/favicon.ico` | 5.6 KB | ICO favicon (legacy root) | NO REFERENCE FOUND in source; conventional browser fallback path only |

### 1b. `sandbox/pdfeditor/apps/web/public/`

| Path | Size | Type | Referenced by |
|---|---|---|---|
| `sandbox/pdfeditor/apps/web/public/pdf.worker.min.mjs` | 1.34 MB | PDF.js worker (JS module) | `lib/pdfjs.ts:92`, `lib/pdfedi-state.ts:125,329` — `workerSrc = ${NEXT_BASE_PATH}/pdf.worker.min.mjs`. In the Docker build this file is copied into the editor's static export (`out/`) and served at `/editor/pdf.worker.min.mjs`. **DO NOT TOUCH.** |

No other images/fonts exist in the editor source (only inline React/SVG; no `*.png/*.svg/*.ico` outside `node_modules`).

### 1c. `logo-options/` (repo root — design working files, NOT served)

| Path | Size | Type |
|---|---|---|
| `logo-options/monogram-master-1600.png` | 294.2 KB | PNG master artwork |
| `logo-options/favicon-source-fullbleed.png` | 282.4 KB | PNG favicon source |
| `logo-options/icon-from-scratch-1024.png` | 49.3 KB | PNG icon source |
| `logo-options/icon4-from-scratch-1024.png` | 69.6 KB | PNG icon source |
| `logo-options/media-generation-logo-1-doc-pencil-0-36acf618-…webp` | 56.4 KB | generated candidate |
| `logo-options/media-generation-logo-1-doc-pencil-1791808717.json` | 0.6 KB | generation prompt JSON |
| `logo-options/media-generation-logo-2-fullbleed-0-7294efab-…webp` | 64.8 KB | generated candidate |
| `logo-options/media-generation-logo-2-fullbleed-1791809081.json` | 0.6 KB | generation prompt JSON |
| `logo-options/media-generation-logo-2-pdf-monogram-0-8d3a2b31-…webp` | 65.1 KB | generated candidate |
| `logo-options/media-generation-logo-2-pdf-monogram-1791808726.json` | 0.6 KB | generation prompt JSON |
| `logo-options/media-generation-logo-3-edit-lines-0-baf5c0df-…webp` | 26.1 KB | generated candidate |
| `logo-options/media-generation-logo-3-edit-lines-1791808723.json` | 0.6 KB | generation prompt JSON |
| `logo-options/media-generation-logo-4-stacked-pages-0-79c39fd2-…webp` | 68.8 KB | generated candidate |
| `logo-options/media-generation-logo-4-stacked-pages-1791808728.json` | 0.6 KB | generation prompt JSON |

**Total: 979.7 KB. Zero references** in web/, backend/, sandbox/ code, CSS, metadata, or Docker scripts.

### 1d. Other findings (not assets, documented for completeness)
- **Backend static/templates:** none — backend has no static/ or templates/ dirs; all frontend files served from `FRONTEND_DIR` via `StaticFiles` (`/_next`) + catch-all `FileResponse` (`backend/main.py:129-158`).
- **No PWA manifest** (`manifest.json` / `.webmanifest`): none found, so no manifest icon set to keep in sync.
- **No static image imports** in `web/app`/`web/components` (no `import x from './y.png'`); **no `url()` image references** in CSS.
- **`web/out/` (2.7 MB, 76 files) is committed to git** despite `.gitignore` containing `/out/` (that pattern only matches repo-root `out/`, not `web/out/`). It is a stale local build artifact — Docker rebuilds both stages fresh. Repo-hygiene note only; production unaffected.
- Test fixtures in `tool-audit/` (`compare-a.pdf`, `corrupt-truncated.pdf`, `audit-test-image.png`, …) and `seo-audit/` are test material, excluded from cleanup.

## 2. Duplicate analysis (md5sum)

- `icon-v2.png` ≡ `icon.png` — byte-identical (md5 `44fa936975752dc909b6a336135aebf9`)
- `apple-touch-icon-v2.png` ≡ `apple-touch-icon.png` — byte-identical (md5 `8503c8ea16eed852b6c6c6c0205e04c8`)
- `favicon-v2.ico` ≡ `favicon.ico` — byte-identical (md5 `897ff124cfeda9afc896b88d4013d070`)
- The v4 set (`icon-v4.png`, `favicon-v4.ico`, `apple-touch-icon-v4.png`) are all distinct files and the only icon files referenced by code.
- `logo.png` is unique (no duplicates).

History: the v2/root files are leftovers from the pre-2026-10-12 icon generations; v4 ("PDF monogram") is the production set per `layout.tsx`.

## 3. Branding verification (production set — confirmed live in code)

From `web/app/layout.tsx` (Next metadata → rendered `<link>` tags on every page):
- `icon: "/icon-v4.png"`, `shortcut: "/favicon-v4.ico"`, `apple: "/apple-touch-icon-v4.png"`
- OG/Twitter/JSON-LD logo: `/logo.png`

The v4 files + `logo.png` are the only branding files with in-code references. ✔ matches the standing "PDF monogram everywhere" rule.

## 4. Candidate list for quarantine (all evidence-based, none classified on a single grep)

| # | Path | Size | Evidence of non-use | Risk note |
|---|---|---|---|---|
| 1 | `web/public/icon-v2.png` | 113.6 KB | Zero references in code/metadata/CSS/Docker; byte-identical to `icon.png`, which itself is only a conventional fallback | **Low.** Quarantine-safe. |
| 2 | `web/public/apple-touch-icon-v2.png` | 25.7 KB | Zero references; byte-identical to `apple-touch-icon.png` | **Low.** Quarantine-safe. |
| 3 | `web/public/favicon-v2.ico` | 5.6 KB | Zero references; byte-identical to `favicon.ico` | **Low.** Quarantine-safe. |
| 4 | `logo-options/*` (13 files) | 979.7 KB | Zero references anywhere; design-generation working files outside the web root | **Low.** Already outside the served tree; move to an archive dir. Archival value only (sources for future icon regeneration). |

**Total reclaimable if all 4 confirmed: ≈ 1,124.6 KB (~1.10 MB).**

Notes:
- The legacy root files (`icon.png`, `apple-touch-icon.png`, `favicon.ico`, 144.9 KB combined) are NOT on the candidate list: browsers/iOS request `/favicon.ico` and `/apple-touch-icon.png` by convention even when link tags point elsewhere; removing them risks a fallback regression. Cheap to keep.
- Rebuild note: these candidates exist in `web/out/` (tracked build output) too, but production builds fresh in Docker — removing from `web/public` + rebuilding is sufficient; the `web/out` copies only affect the repo.

## 5. DO-NOT-TOUCH list

| Path | Why |
|---|---|
| `web/public/icon-v4.png` | Production icon — metadata `icons.icon` |
| `web/public/favicon-v4.ico` | Production favicon — metadata `icons.shortcut` |
| `web/public/apple-touch-icon-v4.png` | Production touch icon — metadata `icons.apple` |
| `web/public/logo.png` | Header/footer `<img>`, OG/Twitter/JSON-LD |
| `web/public/llms.txt` | AI-crawler guide served at `/llms.txt` |
| `sandbox/pdfeditor/apps/web/public/pdf.worker.min.mjs` | PDF.js worker; referenced with base-aware path in 3 places (`lib/pdfjs.ts`, `lib/pdfedi-state.ts`); editor fails to render pages without it |
| `web/public/icon.png`, `apple-touch-icon.png`, `favicon.ico` | Conventional fallback paths (see §4 note); harmless 144.9 KB |
| `web/out/*` | Build artifact dir (committed, stale) — do not hand-edit; it is regenerated by `npm run build`; repo-hygiene item for a separate decision (`git rm` + fix `.gitignore`), not an asset-quarantine action |

## 6. Verification methods used

- `grep -rn` across `web/app`, `web/components`, `web/lib`, `sandbox/pdfeditor/apps/web` (excluding `node_modules`, `.next`, `out/`) for filenames and patterns: `icon-v[24]`, `icon\.png`, `apple-touch-icon`, `favicon`, `logo\.png`, `pdf.worker`, `logo-options`, `manifest`, static `url()` in CSS, static image imports.
- Next metadata read directly from `web/app/layout.tsx` (single source of truth for `<link rel=icon>` rendering).
- Docker build stages inspected (`Dockerfile`): confirms `web/public` → `web/out` → `/srv/static` and editor `public/` → editor `out/` → `/srv/static/editor`; no extra asset copying scripts.
- Backend serving confirmed in `backend/main.py:129-158` (any file in `FRONTEND_DIR` is URL-reachable, so reachability ≠ referenced).
- `md5sum` for byte-identical duplicates; `stat`/`du` for sizes; `git ls-files` to distinguish tracked vs build-artifact files.
- Not classified as unused on a single grep: metadata, robots/sitemap, Docker, editor base-path construction (`${NEXT_BASE_PATH}/pdf.worker.min.mjs`), and browser-convention fallbacks were all checked.
