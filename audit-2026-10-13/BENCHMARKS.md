# PDFEDI Phase 2 — Benchmark Results

Date: 2026-10-13. All measurements run with the production-pinned venv
`/tmp/pdfedi-pinned/bin/python` (pypdf 5.1.0, pypdfium2 4.30.0, reportlab 4.2.5,
Pillow 11.0.0, pikepdf 10.17.0, python-docx 1.1.0). Peak RSS = `resource.getrusage`
`ru_maxrss` in a fresh process per run. Wall time = best of 3 (fresh process each).
No production code modified — compare variant prototyped in `/tmp/bench/` only.
PyMuPDF never used.

Fixtures (generated, deterministic seeds): `/tmp/bench/fixtures/`
- `compare50_a.pdf` / `compare50_b.pdf` — 50-page reportlab pair, identical except
  pages 10/25/40 (one differing line: "Weekly rate: 500 AED" vs "900 AED").
- `gray30.pdf` — 30 A4 pages, text + one 800×600 JPEG photo per page.
- `img_fixture.pdf` — 1 page, 8 controlled image XObjects (see B5).
- `big200.pdf` — 200 text+photo pages (0.4 MB, high object count).
- Existing: `tool-audit/compare-a.pdf` + `compare-b.pdf` (small pair).
- User files: `GLS_Rajeswari_Chittibabu_GL-MZA_01__100_sqft___-edited.pdf` (8.4 MB),
  `GBS__Ameer_Hazim_Jasim_Al_shaeli_F_06___100_sqft.pdf` (4.0 MB).

---

## B1 — compare: per-page `PdfDocument` reopen vs open-once-per-file (D4)

**Method.** Copied `tools/compare.py` to `/tmp/bench/compare_current.py` (unmodified)
and produced `/tmp/bench/compare_openonce.py` via programmatic patch: opens
`pdfium.PdfDocument` once per input file, holds both for the loop, closes in
`finally`; per-page renders go through an identical `_render_open(doc, index)`.
Everything else (diff algorithm, JPEG quality, reportlab assembly, error paths)
byte-identical by construction (see `/tmp/bench/variant.diff`). Full `run()`
executed in fresh subprocesses on the small pair and the 50-page pair; output
PDFs compared after normalizing reportlab metadata (`/CreationDate`, `/ID`).

**Results.**

| Fixture | Variant | Best time | Mean time | Peak RSS | Out pages | Output SHA (normalized) |
|---|---|---|---|---|---|---|
| 2-page | current (per-page open) | 2.251 s | 2.500 s | 76.7 MB | 1 | `6fca15ce5403` |
| 2-page | open-once | 2.593 s | 2.615 s | 76.6 MB | 1 | `6fca15ce5403` |
| 50-page | current (per-page open) | 73.073 s | 77.094 s | 589.6 MB | 50 | `a6c8f7214c1c` |
| 50-page | open-once | 71.583 s | 73.155 s | 549.6 MB | 50 | `a6c8f7214c1c` |

Outputs **byte-identical** (after metadata normalization) on both fixtures; no
errors in any run; SHA stable across all 3 runs per variant.

**Analysis.** Time delta: 0.87× on the small pair, 1.02× on the 50-page pair —
both within run-to-run variance (best-vs-mean spread is ~5% by itself, and fresh
subprocess startup dominates the small fixture). The `PdfDocument` open is
~ms-scale next to ~0.73 s/page rendering at 150 DPI; 100 opens cost a fraction
of a second out of 73 s. Memory delta (−40 MB, −7%) is within GC-timing noise
and is dwarfed by the real driver: **`sheets` accumulates all 50 rendered page
images** (~6.5 MB each at 150 DPI) → ~590 MB peak regardless of variant.

**SELECTION VERDICT: DO NOT CONSOLIDATE on performance grounds.** The per-page
re-open is not the bottleneck — rendering is. Open-once gives no measurable
time or memory win; the code churn is unjustified.

**New finding (actionable, separate from D4):** compare's sheets-accumulation
peaks at ~590 MB on a 50-page job — the same OOM class that killed the instance
for pdf_to_word (2026-10-13 16:32 +04) and that grayscale has (B2). On the
512 MB production instance (plus ~150 MB app baseline), a 50-page compare would
OOM-kill. **Recommend fix-in-place (Phase 5): stream pages to the reportlab
canvas one at a time** (render → diff → draw → release, `gc` per page), the same
pattern pdf_to_word's per-page assembly uses. Not a consolidation.

---

## B2 — grayscale memory profile (current state)

**Method.** `grayscale.run(ctx, {"dpi": 300})` on the 30-page text+photo fixture,
fresh process per run (3 runs); one additional run at the default 200 DPI.

**Results.**

| DPI | Time | Peak RSS | Output |
|---|---|---|---|
| 300 | 15.0 / 16.2 / 19.7 s | 447 / 449 / 454 MB | 19.8 MB, 30 pages |
| 200 (default) | 7.9 s | 228.5 MB | 11.6 MB, 30 pages |

**Analysis.** The tool accumulates every page's JPEG bytes (`pages` list,
`grayscale.py:104-118`) before writing, and each 300-DPI A4 render is ~8.7 MP
(≈35 MB transient RGBA bitmap + PIL copies). 450 MB peak on this VM +
~150 MB production app baseline **exceeds the 512 MB free-tier limit** — a
300-DPI grayscale job on a 30-page document would OOM-kill the instance exactly
like the old pdf_to_word did. Risk scales with DPI² (600 DPI ≈ 4× worse).
The 200-DPI default (229 MB) is borderline-survivable but leaves little headroom
with concurrent jobs (semaphore allows 2).

**SELECTION VERDICT: FIX IN PLACE (no consolidation involved).** Restructure to
per-page canvas writes (render → JPEG → `drawImage` → release, `gc` per page),
mirroring compare's recommended fix and pdf_to_word's per-page assembly.
Optionally gate: warn/cap when `pages × (dpi/72)²` exceeds a memory budget.

---

## B3 — job-lifecycle triple-parse overhead (D5)

**Method.** Replicated the three parse steps exactly (no DB/storage):
(1) ingest-style (`jobs.ingest_upload` block: `%PDF-` check → `PdfReader(BytesIO)`
→ `is_encrypted` → `len(pages)`); (2) `_stored_pdf_is_encrypted`-style
(`PdfReader(path).is_encrypted`, header/trailer only); (3) tool `_open_reader`
validation. Best of 5 each.

**Results.**

| File | Size | ingest parse | enc. check | tool re-parse | TOTAL/job |
|---|---|---|---|---|---|
| GLS (user) | 8.4 MB | 1 ms | 6 ms | 1 ms | **8 ms** |
| GBS (user) | 4.0 MB | 2 ms | 3 ms | 2 ms | **7 ms** |
| GlobeLink (user) | 12.8 MB | 1 ms | 8 ms | 0 ms | **9 ms** |
| synthetic 200-page | 0.4 MB | 25 ms | 2 ms | 32 ms | **59 ms** |

**Analysis.** pypdf parses lazily — `PdfReader()` + `len(pages)` does not decode
content streams, so cost scales with **object count, not file bytes** (the
0.4 MB / 200-page file costs more than the 12.8 MB / 2-page file). Even the
worst case here (59 ms) is a fraction of a percent of any real tool runtime
(seconds to minutes; compare alone is ~73 s for 50 pages). Consolidating to a
single parse would save ~2–30 ms per job — on production's 0.15 CPU, ~10–15×
that, still ≤ ~1 s in the pathological case and ~0.1 s typically.

**SELECTION VERDICT: KEEP AS IS.** Consolidating the parse across the job
lifecycle is not worth the API change (threading reader/page-count through
`jobs.py` → `ToolContext`). This does not affect the separate D1 code-hygiene
decision (B4): the 12 copied `_open_reader` bodies should still be consolidated
into one helper — that is about duplicated code, not parse performance.

---

## B4 — `_open_reader` AST-identicality (D1) + the 9 inline variants

**Method.** Parsed all 12 tool files with `ast`, extracted each `_open_reader`
`FunctionDef`, hashed `ast.dump(...)`.

**Results.**
- **12/12 `_open_reader` bodies are AST-identical** — one SHA-256
  (`748e834fda2dc0ac`) across compare, compress, crop, delete_pages,
  extract_images, merge, n_up, pdf_to_word, reorder_pages, resize_pages, split.
  Same signature `(data, filename)` everywhere. Body: `%PDF-` header check →
  `PdfReader(BytesIO)` → `is_encrypted` → `len(pages)` → 0-page check → return
  reader, with `invalid_input` / `encrypted_pdf` ToolError codes.
- **The 9 inline variants are NOT all the same.** Grouped by semantics:
  - *Same 3 steps, weaker mapping (5):* watermark, page_numbers, flatten,
    password_protect, redact — header check → **unguarded** `PdfReader(...)`
    (no try/except: a parse failure propagates as a raw pypdf exception rather
    than a clean `ToolError`; the earlier 19-tool adversarial audit found no
    such case on its corpus, but the mapping is absent by construction) →
    encrypted raises `invalid_input` (not `encrypted_pdf`) → no 0-page check.
  - *Genuinely different (4):* edit_metadata (encrypted → `encrypted_input`,
    tool-specific message), metadata (does NOT reject encrypted — read-only
    inspection), unlock_pdf (inverted: *requires* encrypted, `wrong_password`
    flow), ocr (validates via pdfium, not pypdf — needs the render path anyway).

**SELECTION VERDICT: CONSOLIDATE the 12 identical + the 5 same-shape sites**
into one shared `_helpers.open_pdf_reader(data, filename, *, encrypted_code=...)`
with a per-tool error-code mapping parameter (preserves `encrypted_pdf` where
the 12 use it, `invalid_input` where the 5 use it). Side benefit: the 5 inline
sites gain the missing parse-failure → `ToolError` mapping. **Keep the 4
genuinely-different sites as is** (unlock_pdf, metadata, edit_metadata, ocr).
Behavior risk: low; validation = B1-style ToolError code+message matrix on
healthy/encrypted/bad-header/damaged/0-page inputs.

---

## B5 — compress vs extract_images image pipeline (D2)

**Method.** Built `img_fixture.pdf` (pypdf, 1 page, 8 controlled image XObjects):
DCTDecode JPEG RGB8; FlateDecode RGB8 / Gray8 / Gray1 / CMYK8 / ICCBased /
Indexed(255) / corrupt-garbage. Ran `compress._pil_image_from_xobject` vs
`extract_images._pil_from_xobject` on each; compared mode/size/pixel-SHA256
(or both-None). Ran both `_iter_image_xobjects` on the fixture. Bonus:
GLS user file's real ICCBased scan image through both.

**Results — all 8 decode cases functionally identical:**

| Image | compress | extract_images | Match |
|---|---|---|---|
| DCTDecode RGB8 | RGB 64×48 pxsha `a6ea1f07…` | RGB 64×48 pxsha `a6ea1f07…` | pixel-identical |
| Flate RGB8 | RGB 64×48 `73c88865…` | RGB 64×48 `73c88865…` | pixel-identical |
| Flate Gray8 | L 64×48 `753412db…` | L 64×48 `753412db…` | pixel-identical |
| Flate Gray1 | 1 64×48 `424cd854…` | 1 64×48 `424cd854…` | pixel-identical |
| Flate CMYK8 | CMYK 64×48 `dc15e233…` | CMYK 64×48 `dc15e233…` | pixel-identical |
| Flate ICCBased | None | None | both-None |
| Flate Indexed | None | None | both-None |
| Flate corrupt | None | None | both-None |
| GLS real ICCBased scan | None | None | both-None |

Iterators: both yield the same 8-object set on the fixture.
Cosmetic-only differences verified harmless: `isinstance(filt, list)` (compress)
vs `isinstance(filt, ArrayObject)` (extract_images) — `ArrayObject` subclasses
`list` in pypdf 5.1.0 (verified), and both fall back to `[filt]` for a bare
`NameObject`; parameter named `writer` vs `reader` but both only touch `.pages`.

**SELECTION VERDICT: CONSOLIDATE.** compress imports `_pil_image_from_xobject`
and `_iter_image_xobjects` from `extract_images` (precedent: `pdf_to_word.py:25`
already imports the former). Caveat from DUPLICATES.md §2/D2 checked:
`_downsample_image_object`'s encoded-size comparison reads `img_obj._data` on
the *same object* the iterator yields, so it is unaffected by where the iterator
is defined. Validation: B2-style full `compress.run` at low/med/high on the
fixture + a JPEG-photo PDF (output size within 1%, pixel-identical).

---

## Cross-cutting observations

1. **The dominant memory pattern is page-accumulation, not engine duplication.**
   compare (590 MB @ 50 pp), grayscale (454 MB @ 300 DPI / 30 pp) both hold all
   rendered pages in RAM before writing. pdf_to_word's 2026-10-13 fix (per-page
   assembly + decode-cache release, 370 → 78 MB) is the template for both.
2. **pypdf `EncodedStreamObject.get_data()` permanently caches decoded bytes**
   in `self.decoded_self` (verified in pypdf 5.1.0 source, `_data_structures.py`
   lines 1101–1116) — any tool calling `get_data()` on large streams must
   release the cache afterwards. This is the mechanism behind the 2026-10-13
   pdf_to_word OOM.
3. **Parse cost is a red herring** (B3): pypdf's lazy parse makes lifecycle
   parse dedup worth ≤ ~1% of job time. Duplication worth fixing is in *code*
   (B4), not parse *calls*.
4. **Document-open cost is a red herring** (B1): pdfium open is ms-scale;
   rendering dominates. Don't "optimize" init patterns without measuring.

## Verdict summary

| # | Decision | Basis |
|---|---|---|
| D1 `_open_reader` ×12 + 5 inline | **Consolidate** (shared helper + per-tool code map) | B4: 12 AST-identical; 5 same-shape |
| D1 4 divergent inline sites | **Keep** | B4: genuinely different contracts |
| D2 compress image pipeline | **Consolidate** (import from extract_images) | B5: 8/8 functionally identical |
| D3 page-size tables | **Consolidate** (shared table) | DUPLICATES.md §2: strict subset, identical values |
| D4 compare per-page reopen | **Keep as is** (no perf win) | B1: 0.87×–1.02×, within noise |
| compare sheets accumulation | **Fix in place** (stream to canvas) | B1: 590 MB peak @ 50 pp → production OOM |
| grayscale page accumulation | **Fix in place** (per-page write) | B2: 454 MB peak @ 300 DPI → production OOM |
| D5 lifecycle parse dedup | **Keep as is** | B3: ≤ ~1% of job time |
