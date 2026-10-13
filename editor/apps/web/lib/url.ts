/**
 * URL normalization shared by hyperlink features.
 * Accepts http/https only; bare domains get https://. Returns null for
 * empty, unsafe (javascript:/data:/vbscript:/file:) or invalid input.
 */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^(javascript|data|vbscript|file):/i.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
