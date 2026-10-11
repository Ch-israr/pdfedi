/**
 * @pdfeditor/pdf-core — direct content-stream text editing.
 *
 * Instead of covering original text with a white mask and drawing a
 * replacement on top, this module rewrites the page's content stream:
 * the original text-showing operation (Tj/TJ) for a matched fragment is
 * REMOVED, and the replacement text is written as a new text operation
 * (for an unchanged-but-moved text, the original operator block is
 * re-emitted verbatim at the new position with its original font, so
 * appearance is bit-exact). Nothing is left underneath — there is no
 * mask and no duplicate layer.
 *
 * Matching is deliberately strict, because a wrong removal would corrupt
 * the document. A fragment is directly editable only when:
 *   - its text run can be decoded (WinAnsi simple fonts, or Type0/CID
 *     fonts with a ToUnicode CMap),
 *   - the run lives in a self-contained BT…ET block with exactly one
 *     show operation that sets its own font (Tf) — so removing the
 *     block cannot disturb neighbouring runs,
 *   - exactly one run on the page matches the fragment's decoded text
 *     and baseline origin (within tolerance).
 * Anything else reports 'not-editable' with a reason and the caller must
 * surface the limitation rather than silently falling back to a mask.
 */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

/** Byte-exact ISO-8859-1 conversion (char code === byte value). */
export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// WinAnsi decoding
// ---------------------------------------------------------------------------

const WINANSI_80_9F: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†',
  0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ',
  0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeWinAnsi(bytes: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes.charCodeAt(i) & 0xff;
    out += WINANSI_80_9F[c] ?? String.fromCharCode(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Font decoders
// ---------------------------------------------------------------------------

type FontDecoder = (bytes: string) => string | null;

function parseToUnicode(doc: PDFDocument, fontDict: PDFDict): Map<number, string> | null {
  try {
    const tu = fontDict.get(PDFName.of('ToUnicode'));
    if (!tu) return null;
    const stream = doc.context.lookup(tu) as PDFRawStream;
    if (!stream || typeof stream.getContents !== 'function') return null;
    let raw: Uint8Array;
    try {
      raw = decodePDFRawStream(stream).decode();
    } catch {
      raw = stream.getContents();
    }
    const text = bytesToLatin1(raw);
    const map = new Map<number, string>();
    const hexToStr = (hex: string): string => {
      let s = '';
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      }
      return s;
    };
    const charRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    const rangeRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    // bfrange with array destinations is rare in ToUnicode; support the
    // sequential form used by Word/pdf producers.
    while ((m = rangeRe.exec(text))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 4096) continue;
      const base = parseInt(m[3], 16);
      for (let c = lo; c <= hi; c++) {
        map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
    while ((m = charRe.exec(text))) {
      // Skip pairs already consumed as range bounds is unnecessary: bfchar
      // pairs and bfrange triples coexist; a 3-group match above already
      // added its entries. bfchar pairs appear as two groups only, but the
      // regex also matches the first two groups of a range line — the
      // values coincide at the range start, so overwriting is harmless.
      const code = parseInt(m[1], 16);
      if (!map.has(code)) map.set(code, hexToStr(m[2]));
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function fontDecoders(doc: PDFDocument, pageDict: PDFDict): Map<string, FontDecoder> {
  const out = new Map<string, FontDecoder>();
  try {
    const resources = doc.context.lookup(pageDict.get(PDFName.of('Resources'))) as PDFDict;
    const fonts = resources ? (doc.context.lookup(resources.get(PDFName.of('Font'))) as PDFDict) : null;
    if (!fonts) return out;
    for (const [nameObj, ref] of fonts.entries()) {
      const name = nameObj.toString().slice(1);
      const fontDict = doc.context.lookup(ref) as PDFDict;
      if (!(fontDict instanceof PDFDict)) continue;
      const subtype = fontDict.get(PDFName.of('Subtype'))?.toString() ?? '';
      if (subtype === '/Type0') {
        const cmap = parseToUnicode(doc, fontDict);
        if (!cmap) continue;
        out.set(name, (bytes: string) => {
          let s = '';
          for (let i = 0; i + 1 < bytes.length; i += 2) {
            const code = ((bytes.charCodeAt(i) & 0xff) << 8) | (bytes.charCodeAt(i + 1) & 0xff);
            const mapped = cmap.get(code);
            if (mapped === undefined) return null;
            s += mapped;
          }
          return s;
        });
      } else {
        // Simple font: WinAnsi when the encoding says so, when a dict
        // names WinAnsi as base, or when absent (base-14 built-in
        // encoding is WinAnsi-compatible for Latin text; any decode
        // mismatch simply fails the strict match — the safe direction).
        const enc = fontDict.get(PDFName.of('Encoding'));
        let winAnsi = false;
        if (!enc) winAnsi = true;
        else if (enc.toString() === '/WinAnsiEncoding') winAnsi = true;
        else {
          const encDict = doc.context.lookup(enc) as PDFDict;
          if (encDict instanceof PDFDict) {
            const base = encDict.get(PDFName.of('BaseEncoding'))?.toString();
            // A Differences array reassigns codes — decoding would be
            // unreliable, so only accept a plain WinAnsi base.
            if (base === '/WinAnsiEncoding' && !encDict.get(PDFName.of('Differences'))) {
              winAnsi = true;
            }
          }
        }
        if (winAnsi) out.set(name, (bytes: string) => decodeWinAnsi(bytes));
      }
    }
  } catch {
    // No decoders — every probe reports not-editable.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content stream tokenizer + light interpreter
// ---------------------------------------------------------------------------

interface Token {
  kind: 'str' | 'hexstr' | 'num' | 'name' | 'op' | 'arrStart' | 'arrEnd' | 'dict';
  start: number;
  end: number;
  /** str/hexstr: raw byte string (latin1). name: without '/'. num: parsed. op: keyword. */
  value: string;
  num?: number;
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const n = content.length;
  let i = 0;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0';
  const isDelim = (c: string) => '()<>[]{}/%'.includes(c);
  while (i < n) {
    const c = content[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%') { // comment to EOL
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      // Literal string: balanced parens, backslash escapes
      const start = i;
      i++;
      let depth = 1;
      let value = '';
      while (i < n && depth > 0) {
        const ch = content[i];
        if (ch === '\\' && i + 1 < n) {
          const esc = content[i + 1];
          if (esc === 'n') { value += '\n'; i += 2; }
          else if (esc === 'r') { value += '\r'; i += 2; }
          else if (esc === 't') { value += '\t'; i += 2; }
          else if (esc === 'b') { value += '\b'; i += 2; }
          else if (esc === 'f') { value += '\f'; i += 2; }
          else if (esc === '(' || esc === ')' || esc === '\\') { value += esc; i += 2; }
          else if (esc >= '0' && esc <= '7') {
            let oct = esc;
            i += 2;
            for (let k = 0; k < 2 && i < n && content[i] >= '0' && content[i] <= '7'; k++) { oct += content[i]; i++; }
            value += String.fromCharCode(parseInt(oct, 8) & 0xff);
          } else if (esc === '\n') { i += 2; }
          else if (esc === '\r') { i += 2; if (content[i] === '\n') i++; }
          else { value += esc; i += 2; }
          continue;
        }
        if (ch === '(') { depth++; value += ch; i++; continue; }
        if (ch === ')') {
          depth--;
          if (depth > 0) value += ch;
          i++;
          continue;
        }
        value += ch;
        i++;
      }
      tokens.push({ kind: 'str', start, end: i, value });
      continue;
    }
    if (c === '<' && content[i + 1] === '<') {
      // Inline dict: skip to '>>' (operands we never interpret)
      const start = i;
      const close = content.indexOf('>>', i + 2);
      i = close === -1 ? n : close + 2;
      tokens.push({ kind: 'dict', start, end: i, value: '' });
      continue;
    }
    if (c === '<') {
      const start = i;
      const close = content.indexOf('>', i + 1);
      const hex = (close === -1 ? content.slice(i + 1) : content.slice(i + 1, close)).replace(/\s+/g, '');
      let value = '';
      for (let k = 0; k + 2 <= hex.length; k += 2) value += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      if (hex.length % 2 === 1) value += String.fromCharCode(parseInt(hex[hex.length - 1] + '0', 16));
      i = close === -1 ? n : close + 1;
      tokens.push({ kind: 'hexstr', start, end: i, value });
      continue;
    }
    if (c === '[') { tokens.push({ kind: 'arrStart', start: i, end: i + 1, value: '[' }); i++; continue; }
    if (c === ']') { tokens.push({ kind: 'arrEnd', start: i, end: i + 1, value: ']' }); i++; continue; }
    if (c === '/') {
      const start = i;
      i++;
      let name = '';
      while (i < n && !isWs(content[i]) && !isDelim(content[i])) { name += content[i]; i++; }
      tokens.push({ kind: 'name', start, end: i, value: name });
      continue;
    }
    // Bare word: number or operator
    const start = i;
    let word = '';
    while (i < n && !isWs(content[i]) && !isDelim(content[i])) { word += content[i]; i++; }
    if (word === '') { i++; continue; }
    const num = Number(word);
    if (word !== '' && !Number.isNaN(num) && /^[+-]?[\d.]+$/.test(word)) {
      tokens.push({ kind: 'num', start, end: i, value: word, num });
    } else {
      tokens.push({ kind: 'op', start, end: i, value: word });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface TextRun {
  start: number;
  end: number;
  /** Byte spans to remove from the content stream (single-show runs: one span = the block). */
  spans: Array<[number, number]>;
  raw: string;
  decodedText: string;
  originX: number;
  originY: number;
  fontResource: string;
  fontSize: number;
  colorHex: string;
  /** Whether the block can be re-emitted verbatim at a new position. */
  movable: boolean;
  /** Span of the Tm operator inside `raw` (for moveRunRaw). */
  tmSpan: [number, number] | null;
}

interface ShowInfo {
  text: string;
  originX: number;
  originY: number;
  fontResource: string;
  fontSize: number;
  colorHex: string;
  /** Byte span of the show operation itself (operands + operator). */
  span: [number, number];
}

interface BlockInfo {
  start: number;
  end: number;
  shows: ShowInfo[];
  fontSetInBlock: boolean;
  tmCount: number;
  tdCount: number;
  tmSpanAbs: [number, number] | null;
  tmRotationZero: boolean;
}

function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function pageContentText(doc: PDFDocument, pageDict: PDFDict): string | null {
  try {
    const contents = pageDict.get(PDFName.of('Contents'));
    if (!contents) return null;
    const looked = doc.context.lookup(contents);
    const parts: string[] = [];
    const decodeOne = (obj: unknown): boolean => {
      const stream = obj as PDFRawStream;
      if (!stream || typeof stream.getContents !== 'function') return false;
      try {
        parts.push(bytesToLatin1(decodePDFRawStream(stream).decode()));
        return true;
      } catch {
        return false;
      }
    };
    if (looked instanceof PDFArray) {
      for (let i = 0; i < looked.size(); i++) {
        if (!decodeOne(doc.context.lookup(looked.get(i)))) return null;
      }
    } else if (!decodeOne(looked)) {
      return null;
    }
    return parts.join('\n');
  } catch {
    return null;
  }
}

/** Parse a page's content stream and return its text blocks. */
export function collectTextBlocks(doc: PDFDocument, pageIndex: number): { content: string; blocks: BlockInfo[] } | null {
  const page = doc.getPage(pageIndex);
  const content = pageContentText(doc, page.node);
  if (content === null) return null;
  const decoders = fontDecoders(doc, page.node);
  const tokens = tokenize(content);
  const blocks: BlockInfo[] = [];

  let inText = false;
  let block: BlockInfo | null = null;
  let fontName = '';
  let fontSize = 0;
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let leading = 0; // TL operator
  let color = '#000000';
  let stack: Token[] = [];

  const nums = (count: number): number[] => {
    const vals: number[] = [];
    for (let k = stack.length - count; k < stack.length; k++) {
      const t = stack[k];
      vals.push(t && t.kind === 'num' ? (t.num as number) : NaN);
    }
    return vals;
  };

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (tok.kind !== 'op') {
      if (tok.kind === 'arrStart') {
        // Collect the array as a single pseudo-operand token
        const arrTok: Token = { kind: 'dict', start: tok.start, end: tok.end, value: '' };
        const parts: Token[] = [];
        let depth = 1;
        let j = ti + 1;
        for (; j < tokens.length; j++) {
          const t2 = tokens[j];
          if (t2.kind === 'arrStart') depth++;
          if (t2.kind === 'arrEnd') { depth--; if (depth === 0) break; }
          parts.push(t2);
        }
        arrTok.end = tokens[j]?.end ?? tok.end;
        (arrTok as unknown as { parts: Token[] }).parts = parts;
        stack.push(arrTok);
        ti = j;
        continue;
      }
      if (tok.kind === 'arrEnd') continue;
      stack.push(tok);
      continue;
    }
    const op = tok.value;
    if (op === 'BT') {
      inText = true;
      block = { start: tok.start, end: tok.end, shows: [], fontSetInBlock: false, tmCount: 0, tdCount: 0, tmSpanAbs: null, tmRotationZero: false };
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
      leading = 0;
      stack = [];
      continue;
    }
    if (op === 'ET') {
      if (inText && block) {
        block.end = tok.end;
        blocks.push(block);
      }
      inText = false;
      block = null;
      stack = [];
      continue;
    }
    if (!inText || !block) { stack = []; continue; }
    switch (op) {
      case 'Tf': {
        const nameTok = stack[stack.length - 2];
        const sizeTok = stack[stack.length - 1];
        if (nameTok?.kind === 'name') fontName = nameTok.value;
        if (sizeTok?.kind === 'num') fontSize = sizeTok.num as number;
        block.fontSetInBlock = true;
        break;
      }
      case 'Tm': {
        const v = nums(6);
        if (v.every((x) => Number.isFinite(x))) {
          tm = [...v];
          tlm = [...v];
          block.tmCount++;
          const first = stack[stack.length - 6];
          if (first) block.tmSpanAbs = [first.start, tok.end];
          block.tmRotationZero = v[1] === 0 && v[2] === 0;
        }
        break;
      }
      case 'Td':
      case 'TD': {
        const v = nums(2);
        if (v.every((x) => Number.isFinite(x))) {
          const [tx, ty] = v;
          // tlm = translate(tx, ty) * tlm  (PDF text positioning)
          const [a, b, c, d, e, f] = tlm;
          tlm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
          tm = [...tlm];
          block.tdCount++;
        }
        break;
      }
      case 'TL': {
        const v = nums(1);
        if (Number.isFinite(v[0])) leading = v[0];
        break;
      }
      case 'T*': {
        // Move to the start of the next line: Td(0, -leading)
        const [a, b, c, d, e, f] = tlm;
        tlm = [a, b, c, d, -leading * c + e, -leading * d + f];
        tm = [...tlm];
        block.tdCount++;
        break;
      }
      case 'rg': {
        const v = nums(3);
        if (v.every((x) => Number.isFinite(x))) color = rgbHex(v[0], v[1], v[2]);
        break;
      }
      case 'g': {
        const v = nums(1);
        if (Number.isFinite(v[0])) color = rgbHex(v[0], v[0], v[0]);
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        const strTok = stack[stack.length - 1];
        if (strTok && (strTok.kind === 'str' || strTok.kind === 'hexstr')) {
          const decode = decoders.get(fontName);
          const decoded = decode ? decode(strTok.value) : null;
          block.shows.push({
            text: decoded ?? '\u0001UNDECODABLE\u0001',
            originX: tm[4],
            originY: tm[5],
            fontResource: fontName,
            fontSize,
            colorHex: color,
            span: [strTok.start, tok.end],
          });
        }
        break;
      }
      case 'TJ': {
        const arrTok = stack[stack.length - 1] as (Token & { parts?: Token[] }) | undefined;
        if (arrTok?.parts) {
          const decode = decoders.get(fontName);
          let decoded = '';
          let ok = !!decode;
          for (const p of arrTok.parts) {
            if (p.kind === 'str' || p.kind === 'hexstr') {
              const d = decode ? decode(p.value) : null;
              if (d === null) { ok = false; break; }
              decoded += d;
            }
          }
          block.shows.push({
            text: ok ? decoded : '\u0001UNDECODABLE\u0001',
            originX: tm[4],
            originY: tm[5],
            fontResource: fontName,
            fontSize,
            colorHex: color,
            span: [arrTok.start, tok.end],
          });
        }
        break;
      }
      default:
        break;
    }
    stack = [];
  }
  return { content, blocks };
}

// ---------------------------------------------------------------------------
// Matching + rewriting
// ---------------------------------------------------------------------------

export interface DirectRunQuery {
  text: string;
  baselineX: number;
  baselineY: number;
  tolerance?: number;
}

export type DirectRunResult =
  | { status: 'ok'; run: TextRun }
  | { status: 'not-editable'; reason: string };

function blockToRun(content: string, block: BlockInfo): TextRun {
  const show = block.shows[0];
  const movable =
    block.shows.length === 1 && block.tmCount === 1 && block.tdCount === 0 && block.tmRotationZero && block.tmSpanAbs !== null;
  return {
    start: block.start,
    end: block.end,
    spans: [[block.start, block.end]],
    raw: content.slice(block.start, block.end),
    decodedText: show.text,
    originX: show.originX,
    originY: show.originY,
    fontResource: show.fontResource,
    fontSize: show.fontSize,
    colorHex: show.colorHex,
    movable,
    tmSpan: block.tmSpanAbs ? [block.tmSpanAbs[0] - block.start, block.tmSpanAbs[1] - block.start] : null,
  };
}

const UNDECODABLE = '\u0001UNDECODABLE\u0001';

/**
 * Build a TextRun from a window of consecutive show operations whose
 * concatenated text equals the fragment. Multi-show runs are editable
 * but never movable: only the show operations themselves are removed
 * (surrounding state ops are untouched), and the replacement is drawn
 * by the export's element renderer.
 */
function multiShowToRun(content: string, shows: ShowInfo[]): TextRun {
  const first = shows[0];
  const last = shows[shows.length - 1];
  const spans = shows.map((sh) => sh.span as [number, number]);
  return {
    start: spans[0][0],
    end: spans[spans.length - 1][1],
    spans,
    raw: content.slice(spans[0][0], spans[spans.length - 1][1]),
    decodedText: shows.map((sh) => sh.text).join(''),
    originX: first.originX,
    originY: first.originY,
    fontResource: first.fontResource,
    fontSize: first.fontSize,
    colorHex: first.colorHex,
    movable: false,
    tmSpan: null,
  };
}

/**
 * Match a fragment against consecutive show operations. Guards (all must
 * hold for every show in the window):
 *   - decodable text, identical font resource, size and colour,
 *   - baseline Y within 1pt of the window's first show (a Y-moving
 *     positioning op between shows breaks the window),
 *   - X positions monotonically non-decreasing in stream order,
 *   - concatenated text exactly equals the fragment text.
 * Returns the matching windows (in stream order); the caller requires
 * exactly one whose first show sits at the expected baseline origin.
 */
function findMultiShowWindows(blocks: BlockInfo[], text: string): ShowInfo[][] {
  const flat: ShowInfo[] = [];
  for (const b of blocks) for (const sh of b.shows) flat.push(sh);
  const windows: ShowInfo[][] = [];
  for (let i = 0; i < flat.length; i++) {
    const first = flat[i];
    if (first.text === UNDECODABLE || first.text === '') continue;
    const win: ShowInfo[] = [first];
    let concat = first.text;
    if (concat === text) windows.push([...win]);
    for (let j = i + 1; j < flat.length; j++) {
      const sh = flat[j];
      if (sh.text === UNDECODABLE || sh.text === '') break;
      const prev = win[win.length - 1];
      if (
        sh.fontResource !== first.fontResource ||
        sh.fontSize !== first.fontSize ||
        sh.colorHex !== first.colorHex ||
        Math.abs(sh.originY - first.originY) > 1 ||
        sh.originX < prev.originX - 0.01
      ) {
        break;
      }
      win.push(sh);
      concat += sh.text;
      if (concat === text) windows.push([...win]);
      if (concat.length >= text.length) break;
    }
  }
  return windows;
}

/**
 * Find the content-stream run for a native text fragment. Strict: the
 * fragment must match exactly one decodable run at the expected baseline
 * origin — either a self-contained single-show block (fast path), or a
 * run of consecutive show operations with identical font, size, colour
 * and baseline (multi-show path for text split across operations).
 */
export function findDirectRun(doc: PDFDocument, pageIndex: number, query: DirectRunQuery): DirectRunResult {
  const parsed = collectTextBlocks(doc, pageIndex);
  if (!parsed) return { status: 'not-editable', reason: 'The page content could not be read.' };
  const tol = query.tolerance ?? 3;
  const { content, blocks } = parsed;
  const textMatches = blocks.filter((b) => b.shows.some((s) => s.text === query.text));
  const candidates = textMatches.filter((b) => {
    if (b.shows.length !== 1 || !b.fontSetInBlock) return false;
    const s = b.shows[0];
    return Math.abs(s.originX - query.baselineX) <= tol && Math.abs(s.originY - query.baselineY) <= tol;
  });
  if (candidates.length === 1) {
    return { status: 'ok', run: blockToRun(content, candidates[0]) };
  }
  if (candidates.length > 1) {
    return { status: 'not-editable', reason: 'Several identical text runs match — editing could affect the wrong one.' };
  }
  // Multi-show path: the fragment's text may be split across consecutive
  // show operations (common in producer and round-tripped output).
  const windows = findMultiShowWindows(blocks, query.text).filter((w) => {
    const f = w[0];
    return Math.abs(f.originX - query.baselineX) <= tol && Math.abs(f.originY - query.baselineY) <= tol;
  });
  if (windows.length === 1) {
    return { status: 'ok', run: multiShowToRun(content, windows[0]) };
  }
  if (windows.length > 1) {
    return { status: 'not-editable', reason: 'Several identical text runs match — editing could affect the wrong one.' };
  }
  if (textMatches.length === 0) {
    const anyText = blocks.some((b) => b.shows.some((s) => s.text !== UNDECODABLE));
    return {
      status: 'not-editable',
      reason: anyText
        ? 'This text run could not be located exactly in the page content (it may be split across operations).'
        : 'This text uses a font encoding that cannot be decoded safely.',
    };
  }
  return {
    status: 'not-editable',
    reason: 'This text is drawn by a complex operation sequence and cannot be rewritten safely.',
  };
}

/** Probe used by the editor before opening a native edit. */
export async function probeDirectTextEdit(
  bytes: Uint8Array,
  pageIndex: number,
  query: DirectRunQuery,
): Promise<{ editable: boolean; colorHex?: string; fontSize?: number; reason?: string }> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const result = findDirectRun(doc, pageIndex, query);
    if (result.status === 'ok') {
      return { editable: true, colorHex: result.run.colorHex, fontSize: result.run.fontSize };
    }
    return { editable: false, reason: result.reason };
  } catch {
    return { editable: false, reason: 'The document could not be inspected for direct editing.' };
  }
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Re-emit a matched run's original block verbatim at a new baseline
 * position (pure move — same font, same encoded string, same colour).
 * Returns null when the block is not safely movable.
 */
export function moveRunRaw(run: TextRun, newBaselineX: number, newBaselineY: number): string | null {
  if (!run.movable || !run.tmSpan) return null;
  const [s, e] = run.tmSpan;
  return `${run.raw.slice(0, s)}1 0 0 1 ${fmt(newBaselineX)} ${fmt(newBaselineY)} Tm${run.raw.slice(e)}`;
}

/**
 * Rewrite a page's content stream: remove the given runs' spans and
 * append extra operations (e.g. moved runs) at the end. Spans are merged
 * so overlapping removals from different runs stay safe.
 */
export function rewritePageContent(doc: PDFDocument, pageIndex: number, removals: TextRun[], append: string): void {
  const page = doc.getPage(pageIndex);
  const parsed = collectTextBlocks(doc, pageIndex);
  if (!parsed) throw new Error('Cannot rewrite unreadable page content.');
  let content = parsed.content;
  const spans: Array<[number, number]> = [];
  for (const run of removals) spans.push(...run.spans);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  for (let i = merged.length - 1; i >= 0; i--) {
    const [a, b] = merged[i];
    content = content.slice(0, a) + content.slice(b);
  }
  if (append) content += `\n${append}\n`;
  const stream = doc.context.flateStream(latin1ToBytes(content));
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
}
