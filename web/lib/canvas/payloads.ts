// Pure payload builders: canvas state -> the exact `config` object the
// existing FastAPI jobs accept. No DOM, no React — these are unit-tested
// in Node (see tests/payloads-test.mjs) and reused by the canvas UI,
// so what the UI shows in "What will be sent" is what the job gets.
//
// Backend contracts (unchanged tools, no new endpoints):
//   merge:         config.page_order — JSON list of [fileIndex, page]
//                  pairs; absent/empty means "all pages, upload order".
//   split:         config.mode ("ranges" | "every") + config.ranges
//                  ("1-3,4-7"); "extract" is ranges with one page per group.
//   rotate_pages:  config.rotations — JSON object {page: angle}; the
//                  existing angle+pages options are untouched (generic
//                  ToolRunner still uses them).
//   delete_pages:  config.pages — ranges string ("1,3,5-7").
//   reorder_pages: config.order — permutation string ("3,1,2").

/** [1,2,3,5] -> "1-3,5". Input need not be sorted; duplicates dropped. */
export function pagesToRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(",");
}

/** Sorted unique page list -> contiguous runs, e.g. [1,2,3,8,9,10] -> [[1,3],[8,10]]. */
export function pagesToGroups(pages: number[]): Array<[number, number]> {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const groups: Array<[number, number]> = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else groups.push([p, p]);
  }
  return groups;
}

/** "1-3,5" -> [1,2,3,5]. Throws on malformed tokens (mirrors the backend). */
// Errors with a stable code so the UI can translate them instead of
// showing the English message text. `params` feeds the ICU message.
export class PayloadError extends Error {
  code: string;
  params: Record<string, string | number>;
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.name = "PayloadError";
    this.code = code;
    this.params = params;
  }
}

export function rangesToPages(spec: string): number[] {
  if (!spec.trim()) return [];
  const pages = new Set<number>();
  for (const rawToken of spec.split(",")) {
    const token = rawToken.trim();
    const m = /^(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);
    if (!m) throw new PayloadError("invalid_page_range", `Invalid page range token ${token}.`, { token });
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1) {
      throw new PayloadError("invalid_range_start", `Invalid range ${start}-${end}.`, { range: `${start}-${end}` });
    }
    // Reversed ranges get their own code so the UI can state the real
    // reason ("start after end") instead of blaming page 1.
    if (end < start) {
      throw new PayloadError("reversed_range", `Invalid range ${start}-${end}: end is before start.`, {
        range: `${start}-${end}`,
      });
    }
    for (let p = start; p <= end; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

export interface MergePageRef {
  /** Index into the file_ids array the job will be created with. */
  fileIndex: number;
  /** 1-based page number within that file. */
  page: number;
}

export interface MergePayload {
  file_ids: string[];
  config: Record<string, unknown>;
}

/**
 * Build a Merge job payload. `refs` is the ordered page list from the
 * canvas (across files); `fileIds` is in the same (canvas) file order.
 * When refs cover every page of every file in order, the config is
 * empty — the backend's default behaviour (all pages, upload order)
 * already does the right thing, so the job is byte-identical to a
 * plain ToolRunner merge.
 */
export function buildMergePayload(
  fileIds: string[],
  filePageCounts: number[],
  refs: MergePageRef[],
): MergePayload {
  const expected: MergePageRef[] = [];
  filePageCounts.forEach((count, f) => {
    for (let p = 1; p <= count; p++) expected.push({ fileIndex: f, page: p });
  });
  const isIdentity =
    refs.length === expected.length &&
    refs.every((r, i) => r.fileIndex === expected[i].fileIndex && r.page === expected[i].page);
  if (isIdentity) return { file_ids: fileIds, config: {} };
  return {
    file_ids: fileIds,
    config: { page_order: JSON.stringify(refs.map((r) => [r.fileIndex, r.page])) },
  };
}

export interface SplitPayload {
  config: { mode: "ranges" | "every"; ranges?: string };
}

/**
 * Build a Split job payload from divider positions. `dividers` are
 * 1-based page numbers AFTER which a split occurs (e.g. [3, 7] on a
 * 12-page doc -> "1-3,4-7,8-12"). `mode` "every" ignores dividers.
 * `extractPages` (Extract mode) makes one single-page group per
 * selected page.
 * `explicitRanges` is the literal ranges string the user typed when it
 * contains gaps ("1-3,8-10"): dividers can only express a contiguous
 * partition, so the typed ranges are sent verbatim and the backend
 * (which groups per comma token) returns one file per run.
 */
export function buildSplitPayload(
  pageCount: number,
  mode: "ranges" | "every" | "extract",
  dividers: number[],
  extractPages: number[] = [],
  explicitRanges?: string | null,
): SplitPayload {
  if (mode === "every") return { config: { mode: "every" } };
  if (mode === "extract") {
    if (extractPages.length === 0) throw new PayloadError("select_at_least_one_page", "Select at least one page to extract.");
    return { config: { mode: "ranges", ranges: pagesToRanges(extractPages) } };
  }
  if (explicitRanges) return { config: { mode: "ranges", ranges: explicitRanges } };
  const cuts = [...new Set(dividers)]
    .filter((d) => d >= 1 && d < pageCount)
    .sort((a, b) => a - b);
  const groups: Array<[number, number]> = [];
  let start = 1;
  for (const cut of cuts) {
    groups.push([start, cut]);
    start = cut + 1;
  }
  groups.push([start, pageCount]);
  const ranges = groups
    .map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`))
    .join(",");
  return { config: { mode: "ranges", ranges } };
}

export interface RotatePayload {
  config: { rotations: string };
}

/** Build a Rotate job payload from per-page angles (0 = unrotated, skipped). */
export function buildRotatePayload(rotations: Map<number, number>): RotatePayload {
  const obj: Record<string, number> = {};
  for (const [page, angle] of [...rotations.entries()].sort((a, b) => a[0] - b[0])) {
    if (angle % 360 !== 0) obj[String(page)] = ((angle % 360) + 360) % 360;
  }
  if (Object.keys(obj).length === 0) throw new PayloadError("rotate_at_least_one_page", "Rotate at least one page.");
  return { config: { rotations: JSON.stringify(obj) } };
}

export interface DeletePayload {
  config: { pages: string };
}

/** Build a Delete job payload from the marked pages. Guards the backend's rule. */
export function buildDeletePayload(pageCount: number, marked: number[]): DeletePayload {
  const pages = [...new Set(marked)].sort((a, b) => a - b);
  if (pages.length === 0) throw new PayloadError("select_at_least_one_page", "Select at least one page to delete.");
  if (pages.length >= pageCount) {
    throw new PayloadError("cannot_delete_all", "Cannot delete every page; at least one page must remain.");
  }
  return { config: { pages: pagesToRanges(pages) } };
}

export interface ReorderPayload {
  config: { order: string };
}

/** Build a Reorder job payload from the current page order (permutation). */
export function buildReorderPayload(order: number[]): ReorderPayload {
  if (order.length === 0) throw new PayloadError("nothing_to_reorder", "Nothing to reorder.");
  return { config: { order: order.join(",") } };
}
