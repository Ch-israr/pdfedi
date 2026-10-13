# PDFEDI Phase 2 — Duplicate-Engine Audit

Date: 2026-10-13. Scope: `backend/` (read-only; nothing modified). Every finding cites `file:line`. "Verified" = read the source and compared bodies.

---

## 1. Operation × implementation × used-by matrix

### PDF parsing (open/validate)
| Operation | Implementation | Used by |
|---|---|---|
| Parse + validate PDF (header → PdfReader → encrypted → page count), return reader | `_open_reader` (AST-identical in all 12) | `tools/compare.py:56`, `compress.py:68`, `crop.py:80`, `delete_pages.py:48`, `extract_images.py:40`, `merge.py:34`, `n_up.py:85`, `pdf_to_word.py:267`, `reorder_pages.py:49`, `resize_pages.py:64`, `rotate_pages.py:58`, `split.py:64` |
| Same 3-step validation, inlined in `run()` | copy of the same pattern, tool-specific error strings | `tools/watermark.py:79-83`, `page_numbers.py:118-122`, `flatten.py:44-48`, `edit_metadata.py:105-112`, `metadata.py:58-64`, `unlock_pdf.py:53-57`, `password_protect.py:58-62`, `ocr.py:116`, `redact.py:193-197` |
| Parse + validate, return page count only | `_helpers.page_count_of_pdf` | `tools/_helpers.py:62`; called by `extract_text.py:53`, `pdf_to_images.py:103`, `thumbnails.py:102`, `grayscale.py:85` |
| Upload-time parse (header → PdfReader → page_count/None) | `jobs.ingest_upload` | `backend/pdfedi/jobs.py:65-96` |
| Stored-file encrypted check (header/trailer only, documented deliberate) | `jobs._stored_pdf_is_encrypted` | `backend/pdfedi/jobs.py:216-230` |
| Lenient parse for damaged files | `PdfReader(..., strict=False)` | `tools/repair.py:42,52,102` |

### Page rendering to raster (pdfium — only rasterizer; pypdf cannot rasterize)
| Operation | Implementation | Used by |
|---|---|---|
| Render pages → PIL (per-page open/close loop) | `page.render(scale=dpi/72).to_pil()` | `tools/pdf_to_images.py:104-130` (dpi 72–300, ZIP out), `tools/thumbnails.py:114-166` (2-pass: size pass then render, 50-cap), `tools/ocr.py:119-167` (200 DPI, disk spill + gc per page), `tools/grayscale.py:91-118` (72–600 DPI, **accumulates all page JPEGs in a list**) |
| Render one page pair at a time; **re-opens `PdfDocument` per page** | `compare._render_one` | `tools/compare.py:83-99` (150 DPI, 50-page cap) |
| Render char boxes + font metrics (raw API) | `pypdfium2.raw` FPDFText_* | `tools/pdf_to_word.py:514-517` |

### Text extraction (four different engines/APIs — see §6 R2)
| Operation | Implementation | Used by |
|---|---|---|
| Bulk plain text per page | pdfium `page.get_textpage()` + `get_text_range()` | `tools/extract_text.py:68-76` |
| Literal search + char rects (locate) | pdfium `textpage.search()` + `get_rect()` | `tools/redact.py:118` (`_find_rects`) |
| Literal search (verify absence) | pdfium `textpage.search()` | `tools/redact.py:152` (`_verify_removed`) |
| Cheap native-text heuristic | pypdf `page.extract_text()` | `tools/ocr.py:56` (`_page_needs_ocr`) |
| Typographic rebuild (boxes, sizes, weights) | pdfium raw char API | `tools/pdf_to_word.py:230-283` |

### Image XObject decode → PIL
| Operation | Implementation | Used by |
|---|---|---|
| Decode image XObject (DCT→PIL open; raw→frombytes w/ colorspace map) | `extract_images._pil_from_xobject` | `tools/extract_images.py:93`; **shared** via import in `tools/pdf_to_word.py:25` |
| **Identical decode logic, private copy** | `compress._pil_image_from_xobject` | `tools/compress.py:95` |
| Enumerate image XObjects (top-level /Resources only) | `extract_images._iter_image_xobjects` | `tools/extract_images.py:67` |
| **Identical iterator, private copy** (param named `writer` but only uses `.pages`) | `compress._iter_image_xobjects` | `tools/compress.py:201` |
| Enumerate with CTM tracking + Form XObject recursion (placements) | `pdf_to_word._walk_ops` / `_image_placements` | `tools/pdf_to_word.py:300-404` — different purpose, not a dup (see §6 R1) |
| In-place downsample + JPEG rewrite of XObject | `compress._downsample_image_object` | `tools/compress.py:147` |

### PDF creation (three engines — see §6 R3)
| Operation | Implementation | Used by |
|---|---|---|
| Assemble/manipulate PDF | pypdf `PdfWriter` | 20+ tools (merge, split, rotate, crop, …) |
| Draw new pages/overlays | reportlab `canvas` | `tools/grayscale.py:130`, `compare.py:198`, `ocr.py:155`, `watermark.py:93`, `page_numbers.py:141`, `redact.py:221` |
| Images → PDF | PIL `Image.save(..., save_all=True, append_images=...)` | `tools/images_to_pdf.py:70-74` |
| Structural rebuild (qpdf) | pikepdf | `tools/repair.py:88-95` only |

### OCR
| Operation | Implementation | Used by |
|---|---|---|
| Binary availability check (once per job) | `ocr._require_ocr` (import + `shutil.which`) | `tools/ocr.py:92-101`, called once at `ocr.py:111` |
| Per-page recognition | tesseract subprocess via `pytesseract.image_to_data` | `tools/ocr.py:188` |

### Analytics/geo (framework)
| Operation | Implementation | Used by |
|---|---|---|
| GeoIP lookup | `geoip2.database.Reader` **module singleton** (`_get_reader`) | `backend/pdfedi/analytics.py:199-225` — cached, no repeat init |
| Visit tracking middleware | per-request `SessionLocal()` + synchronous Turso write on hot path | `backend/main.py:96-122` |

---

## 2. Copied logic — verdicts

### D1 — CONFIRMED literal duplication: `_open_reader` × 12
Same name, AST-identical body in 12 tools: `compare.py:56`, `compress.py:68`, `crop.py:80`, `delete_pages.py:48`, `extract_images.py:40`, `merge.py:34`, `n_up.py:85`, `pdf_to_word.py:267`, `reorder_pages.py:49`, `resize_pages.py:64`, `rotate_pages.py:58`, `split.py:64`. Sequence: `%PDF-` header check → `PdfReader` → `is_encrypted` → page count → return reader (raises `ToolError` with `invalid_input`/`encrypted_pdf`).
Additionally, 9 tools re-implement the same 3 steps inline in `run()` with tool-specific error strings: `watermark.py:79-83`, `page_numbers.py:118-122`, `flatten.py:44-48`, `edit_metadata.py:105-112`, `metadata.py:58-64`, `unlock_pdf.py:53-57`, `password_protect.py:58-62`, `ocr.py:116`, `redact.py:193-197`.
Overlaps with `_helpers.page_count_of_pdf` (`_helpers.py:62`), which does the same validation but returns the count instead of the reader.
Consolidation candidate: one shared `open_pdf_reader(data, filename) -> PdfReader` in `_helpers.py`; the 12 copies and 9 inline sites collapse to a call. Behavior risk: low (error-code mapping must be preserved per tool).

### D2 — CONFIRMED functional duplication: compress's private image pipeline
- `compress._pil_image_from_xobject` (`compress.py:95`) vs `extract_images._pil_from_xobject` (`extract_images.py:93`): same decode semantics — `get_data()` → DCTDecode opens directly → raw pixel `Image.frombytes` with the same `/DeviceRGB→RGB`, `/DeviceGray 8→L`, `/DeviceGray 1→1`, `/DeviceCMYK→CMYK` map. Differences are cosmetic: function name, and `isinstance(filt, list)` vs `isinstance(filt, ArrayObject)` (equivalent in practice — pypdf's `ArrayObject` subclasses `list`; compress's form is strictly broader).
- `compress._iter_image_xobjects` (`compress.py:201`) vs `extract_images._iter_image_xobjects` (`extract_images.py:67`): identical iteration/dedup logic (top-level `/Resources` only, `idnum` dedup). Only differences: parameter name (`writer` vs `reader`; both only use `.pages`) and `IndirectObject` import location (module top vs function-local).
Consolidation candidate: compress imports both from `extract_images` (pdf_to_word already does this for `_pil_from_xobject` at `pdf_to_word.py:25`). One caveat to verify: compress's `_downsample_image_object` relies on reading `img_obj._data` for the *encoded* size comparison (`compress.py:177-180`); it must keep working after the import swap (it operates on the same object, so it will — benchmark B2 covers it).

### D3 — CONFIRMED literal duplication: page-size constant tables
`n_up.py:65-68` `_SHEET_SIZES = {"a4": (595.0, 842.0), "letter": (612.0, 792.0)}` is a strict subset of `resize_pages.py:56-60` `_SIZES = {"a4": (595.0, 842.0), "a5": (420.0, 595.0), "letter": (612.0, 792.0), "legal": (612.0, 1008.0)}` — identical point values. Consolidation candidate: single shared table (n_up imports it or both import from `_helpers`).

### D4 — CONFIRMED repeated engine init: `compare._render_one` re-opens the document per page
`tools/compare.py:83-99`: every page render constructs a new `pdfium.PdfDocument(data)` and closes it — for a 50-page comparison that's ~100 full document opens (2 per page pair) instead of 2. The module comment (`compare.py:199`) says "one page pair at a time to bound memory", which is the deliberate part; the per-page *re-open* is the wasteful part (pdfium document open parses the xref each time). Benchmark B4 decides whether open-once-per-file keeps the memory bound while cutting time.

### D5 — CONFIRMED repeated parsing across the job lifecycle
The same uploaded PDF is parsed 3×: `jobs.ingest_upload` (`jobs.py:85`, full parse for `page_count`) → `jobs._stored_pdf_is_encrypted` (`jobs.py:227`, header/trailer-only — code documents this as deliberate and cheap) → the tool's own `_open_reader` (full parse). On a 50MB upload this is 3 full pypdf parses (one is documented-cheap). Possible consolidation: thread the already-parsed reader/page-count through the job context so tools skip re-validation. Benchmark B5.

### D6 — CONFIRMED per-request init on the hot path: analytics middleware
`backend/main.py:96-122`: for every tracked request, the middleware constructs `SessionLocal()` (SQLAlchemy `sessionmaker` factory call, per request) and performs a **synchronous** analytics write to Turso *before returning the response* (response is built first at line 100, but the client still waits through the DB round-trip at 106-121). Measured context: warm TTFB ~2.4s. The geo reader itself is fine (module singleton, `analytics.py:199-225`). Benchmark B6: factory-hoist + write-behind (background) vs current.

### D7 — Similar-but-different: reportlab overlay + merge_page pattern
`watermark.py:93-103`, `page_numbers.py:141-153`, `redact.py:221-230` all do: `canvas.Canvas(buf, pagesize=(pw,ph))` → draw content → `c.save()` → `page.merge_page(PdfReader(buf).pages[0])`. Drawn content differs (rotated text / page numbers / black rects) and merge target differs (per-page vs redacted pages). Low-value consolidation (a 3-line helper); bodies are not duplicated, the *pattern* is.

### D8 — Similar-but-different: JPEG re-encode parameters
`compare.py:203` (quality=88), `grayscale.py:112` (quality=85, optimize=True), `pdf_to_images.py:128` (quality=85). Cosmetic variance, not a duplication.

---

## 3. Dependencies — overlap analysis (all load-bearing, none redundant)

| Lib | Role | Used by | Overlap verdict |
|---|---|---|---|
| pypdf 5.1.0 | Parse/manipulate/assemble PDFs | 21 tools + `jobs.py` | Backbone; no overlap (only parser) |
| pypdfium2 4.30.0 | Rasterize + text extraction | 8 tools (compare, extract_text, grayscale, ocr, pdf_to_images, pdf_to_word, redact, thumbnails) | **No overlap** — pypdf cannot rasterize; only engine that can |
| pillow 11.0.0 | Image ops | 8 tools | No overlap |
| reportlab 4.2.5 | Draw new PDF pages/overlays | 6 tools | No overlap with pypdf (pypdf edits, reportlab draws); `images_to_pdf` uses PIL-save instead, different domain |
| pikepdf 10.17.0 | qpdf structural rebuild | `repair.py` only | No overlap — pypdf's `strict=False` fallback is a lenient rewrite, not a rebuild (see §6 R4) |
| python-docx 1.1.0 | Word output | `pdf_to_word.py` only | No overlap |
| pytesseract 0.3.13 | OCR binding | `ocr.py` only | No overlap; degrades gracefully when tesseract absent |
| geoip2 4.8.0 | Local GeoIP lookup | `analytics.py` only | No overlap |

Code-level duplication (D2) is between modules, not dependencies — no dependency can be removed. Note: `pypdfium2.raw` is imported at `pdf_to_word.py:515` alongside the high-level API in the same file — same library, fine.

---

## 4. Repeated initialization summary

| Site | What repeats | Frequency | Assessment |
|---|---|---|---|
| `compare.py:83-99` | `PdfDocument` open/close per page | per page (≤100×/job) | Wasteful; benchmark B4 |
| `main.py:96-122` | `SessionLocal()` factory + sync Turso write | per tracked HTTP request | Hot-path cost; benchmark B6 |
| `compare.py:176` | `ImageFont.load_default(size=...)` | per added/removed page | Trivial cost; hoist if touching anyway |
| pdfium/pytesseract lazy imports in tools | `import pypdfium2` inside `run()` | per job | Fine — import machinery caches; no repeat init |
| `ocr.py:92-111` | tesseract availability check | once per job | Fine |
| `analytics.py:199-225` | geoip2 Reader | process-lifetime singleton | Fine |
| tesseract subprocess spawn | `image_to_data` per page | per OCR page | Inherent to OCR; not duplication |

---

## 5. Benchmark plans (NOT run — specified for Phase 2 comparison)

### B1 — `_open_reader` consolidation
- **Inputs:** healthy 10-page PDF; encrypted PDF (user password); file with corrupt `%PDF-` header; PDF with damaged xref (repairable); 0-page PDF; 50MB PDF (timing).
- **Compare:** current 12 copies + 9 inline sites vs one shared `_helpers.open_pdf_reader`.
- **Metrics:** identical `ToolError` code+message per input (or documented mapping); identical returned reader page count; wall-time delta on the 50MB file (≈0 expected).

### B2 — compress image-pipeline import swap
- **Inputs:** PDFs containing: DCTDecode JPEG photo; FlateDecode RGB 8bpc image; DeviceGray 1bpc mask; DeviceCMYK image; ICCBased image (both must return None); corrupt image stream (both None); indexed-color image (both None).
- **Compare:** `compress._pil_image_from_xobject`/`_iter_image_xobjects` vs imported `extract_images` versions, then full `compress.run` at quality low/med/high.
- **Metrics:** pixel-identical PIL output (or both None); identical output PDF bytes or byte-size within 1%; peak RSS; wall time. Must confirm the `_data` encoded-size comparison in `_downsample_image_object` still behaves.

### B3 — page-size table unification
- **Inputs:** `n_up` run with sheet=a4/letter; `resize_pages` with a4/a5/letter/legal.
- **Metrics:** output page boxes identical to current; trivial — assert constant equality, no perf dimension.

### B4 — compare: open-once vs per-page document open
- **Inputs:** 50-page PDF pair with 3 differing pages; 2-page pair; pair with different page counts (added/removed pages path).
- **Compare:** current per-page `PdfDocument` open vs one open per file held for the loop.
- **Metrics:** identical `_changed_boxes` output (box coordinates equal); wall time; peak RSS (must not regress — the current pattern exists to bound memory).

### B5 — job-lifecycle parse dedup
- **Inputs:** 50MB healthy PDF through `ingest_upload` → `create_job` → `merge.run`.
- **Compare:** current (parse in ingest + encrypted check + tool re-parse) vs threading the parsed page count/validation through.
- **Metrics:** total wall time for upload-to-result; peak RSS; identical job outcomes incl. encrypted/damaged edge cases.

### B6 — analytics middleware hot-path
- **Inputs:** 50 sequential GETs to `/` and `/tools/merge/` (warm instance).
- **Compare:** current per-request `SessionLocal()` + sync write vs hoisted factory + write-behind (background thread/queue).
- **Metrics:** p50/p95 TTFB; analytics rows still recorded (correctness); no dropped visits under the write-behind path.

---

## 6. Investigated and REJECTED (looked similar, actually different)

- **R1 — pdf_to_word's CTM/Form-recursion walk vs extract_images' iterator.** `pdf_to_word._walk_ops` (`pdf_to_word.py:300-404`) tracks the current transformation matrix and recurses into `/Form` XObjects to compute image *placements*; `extract_images._iter_image_xobjects` (`extract_images.py:67`) only enumerates top-level image XObjects. Different outputs (placement+CTM vs object list); not consolidatable.
- **R2 — four text-extraction approaches.** pdfium `get_text_range` (bulk text), pdfium raw char boxes (typographic rebuild), pdfium `search`+`get_rect` (rect locate/verify), pypdf `extract_text` (cheap OCR-need heuristic in `ocr.py:56`). Different purposes and output contracts; keep all.
- **R3 — three PDF-creation engines.** pypdf `PdfWriter` (manipulate), reportlab `canvas` (draw), PIL `Image.save`→PDF (`images_to_pdf.py:70-74`, natural for image→PDF). All load-bearing in their domains.
- **R4 — repair's two engines.** pikepdf/qpdf rebuild (`repair.py:88-95`) vs pypdf `strict=False` lenient rewrite (`repair.py:102`). Intentionally different (structural rebuild vs best-effort rewrite); the fallback is the design, verified by the earlier repair audit.
- **R5 — `_find_rects` vs `_verify_removed`** (`redact.py:118` vs `:152`). Same shape, but they run on different bytes (input vs redacted output) at different pipeline stages; both required.
- **R6 — `page_count_of_pdf` vs `_open_reader`.** Same validation sequence, but different contracts (count vs reader). Overlap noted in D1; not a drop-in replacement either way.
- **R7 — `get_option`/`require_option`** (`base.py:90-108`). Already shared; no duplication.
- **R8 — memory-bounding strategies** in thumbnails (2-pass), compare (pair-at-a-time), ocr (disk spill + gc), pdf_to_word (per-page assembly + cache release). Different strategies fit to different output shapes; all already bounded.
- **R9 — compress.py's get_data comment vs pdf_to_word's OOM finding.** Verified against pypdf 5.1.0 source: `EncodedStreamObject.get_data()` permanently caches the decoded object in `self.decoded_self`. compress's comment ("`_data` is never mutated by `get_data()`") is true of the `_data` attribute specifically, but the decoded bytes are retained via `decoded_self` — the comment understates the memory model. Not a behavior bug; flag for a comment fix in a later phase.
- **R10 — tesseract subprocess per OCR page** (`ocr.py:188`). Inherent to per-page OCR; not duplicate initialization.
- **R11 — per-page `get_textpage()` open/close** in extract_text/redact. Correct pdfium resource hygiene; required per page.

---

## 7. Ranked consolidation opportunities (for Phase 3/5 planning)

1. **D1** — 12 identical `_open_reader` + 9 inline copies → one shared helper. Largest line-count win, lowest risk.
2. **D2** — compress's private `_pil_image_from_xobject` + `_iter_image_xobjects` → import from `extract_images` (precedent: `pdf_to_word.py:25`).
3. **D4** — compare per-page `PdfDocument` reopen → open-once-per-file (pending B4 memory check).
4. **D3** — page-size tables → one shared table.
5. **D5/D6** — lifecycle parse dedup + middleware write-behind. Performance wins, need B5/B6 evidence; D6 also addresses the measured ~2.4s warm TTFB contributor.

Memory-risk note (observed, not a duplicate): `grayscale.py:104-118` accumulates every page's JPEG bytes in a list before writing — 50 pages at 600 DPI could exceed the 512MB budget the same way the old pdf_to_word did. Recommend a per-page write restructure in Phase 5.
