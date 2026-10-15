/**
 * WinAnsi (CP1252) encodability — the character set the 14 standard PDF
 * fonts (Helvetica/Times/Courier families) can draw via pdf-lib.
 *
 * The editor writes replacement and added text with those standard
 * fonts, whose encoding is WinAnsi. A character outside this set cannot
 * be drawn at all: pdf-lib throws when encoding it. Callers must check
 * BEFORE committing an edit or removing original content, so unsupported
 * text is rejected with an explanation instead of being silently lost.
 *
 * Encodable code points:
 *  - printable ASCII (0x20–0x7E)
 *  - Latin-1 supplement printables (0xA0–0xFF)
 *  - the printable glyphs CP1252 assigns to bytes 0x80–0x9F (€ ‚ ƒ „ …
 *    † ‡ ˆ ‰ Š ‹ Œ Ž ' ' " " • – — ˜ ™ š › œ ž Ÿ)
 *  - '\n' (text is drawn line by line, so newlines are structural)
 * Everything else — Arabic, Hebrew, CJK, Cyrillic, Greek, emoji, most
 * symbols — is NOT encodable in the standard fonts.
 */

const WINANSI_SPECIALS: ReadonlySet<number> = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when `ch` (a single code point) can be drawn in a standard font. */
export function isWinAnsiEncodable(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp === 0x0a) return true; // newline: drawn line-wise
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return WINANSI_SPECIALS.has(cp);
}

/**
 * The distinct characters of `text` that the standard fonts cannot draw,
 * in order of first appearance. Empty array = the text is fully writable.
 */
export function findUnencodableChars(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (!isWinAnsiEncodable(ch) && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}
