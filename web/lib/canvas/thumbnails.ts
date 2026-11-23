// In-memory thumbnail cache with an LRU cap.
//
// Thumbnails are data URLs keyed by file + page + render width. A
// 200-page PDF at full thumbnail resolution would hold tens of MB of
// PNG data URLs in memory; the cap (~120 entries) keeps a phone-safe
// ceiling while still covering every page of a typical document.
// Entries are evicted oldest-first; a re-render on scroll-back is
// cheap because the pdf.js document stays loaded.
const MAX_ENTRIES = 120;
const cache = new Map<string, string>();

export function thumbKey(fileId: string, pageNum: number, widthPx: number): string {
  return `${fileId}:${pageNum}:${widthPx}`;
}

export function getThumb(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function setThumb(key: string, dataUrl: string): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, dataUrl);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

