# PDFEDI Browser-First Hybrid PDF Editor — Architecture Proposal

**Status:** PROPOSAL — awaiting explicit approval before any implementation (Phase 5 STOP)
**Date:** 2026-10-07
**Scope:** Testing Sandbox only. Zero production changes.

---

## Phase 3 — Reuse vs Gaps Analysis

### What already exists and can be reused

| Existing asset | Reuse plan |
|---|---|
| Sandbox isolation (own FastAPI app, Dockerfile, Render service) | Editor lives as a new sandbox route/page; no new infrastructure |
| Backend pypdf | Fallback finalization path if browser finalization proves insufficient |
| Backend reportlab | Already used for text stamping in OCR — pattern reusable for backend manifest interpreter |
| 50MB upload limit, quota concepts | Apply same guards to editor file intake |
| Existing OCR (server, page-skip optimized) | Stays the path for producing searchable PDFs; editor uses Tesseract.js only for in-editor search assist |

### Gaps — nothing exists today

- No PDF.js, no pdf-lib, no interactive canvas layer anywhere in the codebase
- No editor state management, no undo/redo
- Sandbox web UI is a simple upload→run→download form; the editor needs a dedicated full-page app
- No coordinate mapping, no overlay architecture, no edit manifest

**Conclusion:** The editor is ~90% new code, but it will be built as self-contained modules under `sandbox/editor/` so the core (state, manifest, finalization) can move to production later without the sandbox shell.

---

## Recommended Stack

| Layer | Choice | License | Why |
|---|---|---|---|
| PDF rendering | **PDF.js** (Mozilla) | Apache-2.0 | Battle-tested, Web Worker rendering, text layer with coordinates, canonical viewport math for overlays |
| Browser finalization | **pdf-lib** (evaluate `modern-pdf-lib` fork) | MIT | Only mature JS lib for *modifying* existing PDFs; preserves original objects (no rasterization); same API works in Node if finalization ever moves server-side |
| Interactive overlay | **Konva.js** + react-konva | MIT | Declarative React fit (PDFEDI frontend is Next.js); Stage→Layer→Node maps to page/editor/selection layers; 55KB |
| Undo/redo | Command pattern, renderer-agnostic | — | Undo stack IS the finalization manifest — one model serves both (§6 + §17 of spec) |
| Redaction | Rasterize redacted pages + mandatory verify | — | pdf-lib cannot do surgical content-stream redaction; rasterize-and-rebuild is the proven browser-safe pattern |
| OCR (search assist) | Tesseract.js, lazy-loaded | Apache-2.0 | In-editor search on scanned pages only; server OCR stays the production path for searchable PDFs |
| Fonts | Standard-14 + 2–3 subset custom fonts | OFL | Zero-cost Latin text; honest UI limitation notice for CJK/Arabic |

**Explicitly avoided:** Ghostscript WASM (AGPL), MuPDF (AGPL), commercial SDKs, heavy infra (no Redis/queues/microservices).

**Lazy-load budget:** ~1.5–2 MB for the editor route (PDF.js ~1 MB + pdf-lib 250 KB + Konva 55 KB + app code). Fonts and OCR models load on demand. The editor is a dedicated route most visitors never load.

---

## Architecture

### Browser-first hybrid pipeline

```
User uploads PDF (sandbox page)
  → Browser-side validation (size, type, encryption check)
  → PDF.js loads document (Web Worker; virtualized rendering —
    only visible pages hold canvases)
  → Konva overlay per visible page (editor objects layer)
  → All editing happens locally; ZERO backend calls during editing
  → Edit manifest accumulates (renderer-agnostic operations)
  → User clicks "Download PDF"
  → Finalization router decides per operation:
      ├── Browser (pdf-lib): add text/image/shape, annotations,
      │   page ops, whiteout, redaction (rasterize+rebuild+verify)
      └── Backend (existing sandbox API): OCR-to-searchable,
          encrypted sources, >memory-cap fallback
  → pdf-lib assembles final PDF in browser → Blob → download
  → Post-verification (page count, text presence, redaction check)
```

### Edit manifest (the core abstraction)

Single source of truth, plain JSON, geometry in **PDF points, bottom-left origin**:

```json
{
  "sourceHash": "sha256-of-original",
  "operations": [
    {"op": "add_text", "page": 0, "x": 72, "y": 700, "text": "...",
     "font": "Helvetica", "size": 12, "color": "#000000"},
    {"op": "add_image", "page": 1, "x": 100, "y": 100, "w": 200, "h": 150,
     "assetId": "img-3"},
    {"op": "move_page", "from": 2, "to": 0},
    {"op": "redact_rects", "page": 0, "rects": [{"x":72,"y":700,"w":200,"h":14}]}
  ],
  "assets": {"img-3": "<blob-ref>"}
}
```

This one structure drives: (1) Konva overlay rendering, (2) undo/redo (each op carries its inverse), (3) browser finalization via pdf-lib, and (4) a future backend finalization via a Python manifest interpreter. **This is what makes sandbox→production migration cheap** — the backend only needs the interpreter, not a second editor.

### Module layout (migration-friendly)

```
sandbox/editor/
  core/            ← PRODUCTION-CANDIDATE (no DOM, no sandbox imports)
    manifest.ts        # operation types, validation
    history.ts         # undo/redo (command pattern)
    coordinates.ts     # PDF points ↔ screen pixels
  render/
    pdfjs-loader.ts    # lazy PDF.js, virtualized page rendering
    overlay.ts         # Konva stage/layer management per page
  tools/             ← one module per editor tool (text, image, draw…)
    text.ts, image.ts, draw.ts, shapes.ts, ...
  finalize/
    browser.ts         # pdf-lib manifest → PDF
    redact.ts          # rasterize + rebuild + verify
    verify.ts          # post-generation checks
    backend.ts         # escape hatch: POST manifest to sandbox API
  ui/                ← SANDBOX-ONLY shell
    EditorPage.tsx     # layout: header/toolbar/panels/workspace
    ...
  backend/
    manifest_api.py    # sandbox-only: manifest interpreter (pypdf/reportlab)
```

**Rule:** `core/`, `render/`, `tools/`, `finalize/browser.ts` must never import sandbox UI or sandbox server code. Only `ui/` and `backend/` are sandbox-specific.

### UI structure (per spec §§10–16)

- **Top header:** filename, undo/redo, zoom, search, page info
- **Main toolbar:** Select, Text, Image, Draw, Highlight, Signature + "More" (Shapes, Underline, Strikeout, Whiteout, Redact, Link)
- **Left panel:** page thumbnails (virtualized), drag-reorder, hover actions (rotate/delete/duplicate/extract)
- **Center:** PDF.js canvas + Konva overlay, pan/zoom, fit page/width
- **Right panel:** context-aware properties (text/image/shape/document)
- **Contextual toolbar** on selection; **quick actions** for first-time users
- **Mobile:** view + simple annotate; full toolbar is desktop-primary

### Undo/redo

Command pattern: each operation is `{do(), undo(), manifestOp}`. Continuous gestures (drag/resize) coalesce into one history entry on pointer-up. Cap 100 entries. Keyboard: Ctrl+Z / Ctrl+Y.

### Redaction (true, not fake)

1. User marks rects → stored in manifest as `redact_rects`
2. At finalization: render affected pages at 300 DPI via PDF.js → paint black boxes on pixels → rebuild **only those pages** from images in a fresh pdf-lib document (nothing copied from source = nothing leaks)
3. **Mandatory verification:** re-open output in PDF.js, assert zero extractable text on redacted pages; block download on failure
4. Non-redacted pages copied untouched (vector quality preserved)

Whiteout remains a separate honest "visual cover" (white rect in content stream, not claimed as redaction).

### Performance & memory guards

- Virtualized rendering: only visible pages hold canvases (IntersectionObserver)
- Explicit canvas disposal on scroll-away; render debounced at `devicePixelRatio × zoom`
- `navigator.deviceMemory` caps: warn/refuse above 50 MB on mobile, 150 MB on desktop
- Never hold PDF.js doc + pdf-lib doc + all page canvases simultaneously
- Practical ceiling: 50 MB workable on desktop; marginal on phones — UI says so instead of crashing

### Backend's role (minimal)

The sandbox backend gains **one** endpoint: `POST /api/editor/finalize` accepting `{manifest, assets}` for the escape-hatch cases (encrypted source, over-memory-cap, OCR-to-searchable). Implemented with existing pypdf/reportlab. Everything else stays in the browser.

---

## Sandbox Integration Plan

1. New route `/editor` in sandbox web (separate HTML/TS app, lazy-loaded libs via CDN pinned versions)
2. New sandbox backend module `editor/manifest_api.py` (escape-hatch finalization only)
3. Register nothing in `SANDBOX_TOOLS` (editor is not a batch tool — it gets its own page, not a dropdown entry)
4. No changes to existing sandbox tools, no changes to production

---

## Production Migration Plan (for later approval — NOT now)

| Step | Action |
|---|---|
| 1 | Move `sandbox/editor/core|render|tools|finalize/browser.ts` → production frontend as an `/editor` route (they have zero sandbox imports by construction) |
| 2 | Add production API endpoint for the backend escape hatch (mirrors sandbox `manifest_api.py`) |
| 3 | Wire editor into production nav (one link) |
| 4 | Reuse production auth/quota/storage patterns for the finalize endpoint |

**No database changes needed.** **No changes to existing tools.** Risk: pdf-lib maintenance (mitigated by pinned version + fork evaluation in sandbox).

---

## Risks & Limitations (honest)

1. **Editing existing text** (reflow) is out of scope for v1 — genuinely hard (Sejda's is flaky); sandbox covers *added* objects + annotations + page ops
2. **pdf-lib maintenance:** 4+ years since release; evaluate `modern-pdf-lib` fork in sandbox
3. **CJK/Arabic user-added text:** limited by font subsetting; honest UI notice
4. **Mobile:** view + annotate only; full editor is desktop-primary
5. **Encrypted PDFs:** must go through existing backend unlock flow first (pdf-lib can't decrypt)
6. **Large PDFs:** browser physics; backend escape hatch exists for a reason

---

## Testing Strategy (per spec §§29–32)

- **PDF types:** text, multi-page, scanned, image-heavy, tables, mixed page sizes, rotated, large (50 MB), password-protected (expect graceful refusal), complex
- **Editing:** every tool in §11 + all page ops + undo/redo + search + download
- **Final validation:** automated — output opens, page count/order correct, edits embedded, redactions unverifiable via extraction, not corrupted
- **Visual QA:** side-by-side original vs edited (positioning, fonts, images, rotation, no unwanted rasterization)
- **Benchmarks:** load time, first render, memory peak, finalization time, output size, large-PDF stability

---

## What I Need From You (Phase 5)

**Approve / adjust / reject:**

1. **Stack:** PDF.js + pdf-lib (+ Konva overlay). Any objections to these libraries?
2. **Scope v1:** added objects + annotations + page ops + true redaction. Confirm existing-text editing stays out of v1.
3. **Redaction approach:** rasterize-and-rebuild redacted pages (destructive to vectors on those pages only) with mandatory verification. Acceptable trade-off?
4. **Mobile scope:** view + simple annotate (not full toolbar). OK?
5. **Sandbox location:** new `/editor` page in sandbox web + one backend escape-hatch endpoint. OK?

**I will not write any implementation code until you explicitly approve.**
