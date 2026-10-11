/**
 * @pdfeditor/pdf-core — true redaction.
 *
 * Unlike whiteout (a visual cover), redaction PERMANENTLY removes text
 * from the page content stream: every text-showing operation whose glyphs
 * intersect a redaction rectangle is deleted byte-wise, and the rectangle
 * is then painted black in the content stream itself.
 *
 * Safety rules (a wrong removal corrupts the document; a missed removal
 * leaks redacted content — both are refused, never faked):
 *   - a show is removed only when its glyph box (computed from the font's
 *     /Widths or /W metrics, with Tc/Tw/Tz and TJ adjustments applied)
 *     intersects the rectangle;
 *   - a show whose box cannot be computed (unknown font metrics, rotated
 *     text matrix, undecodable bytes) and whose conservative estimate
 *     touches the rectangle makes the WHOLE export refuse with
 *     RedactUnsafeError — the download is blocked with a clear message
 *     rather than shipping a black box over live text;
 *   - text inside Form XObjects is parsed recursively (with the Do
 *     placement matrix applied), so it cannot hide from redaction;
 *   - raster images and vector paths under the rectangle are covered by
 *     the black box but their bytes are NOT removed (disclosed in the UI).
 */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  tokenize,
  bytesToLatin1,
  latin1ToBytes,
  decodeWinAnsi,
  type Token,
} from './direct-text.js';
import { StandardFonts } from 'pdf-lib';

export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class RedactUnsafeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RedactUnsafeError';
  }
}

function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** [a b c d e f] row-vector matrix multiply: M1 × M2. */
function matMul(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function xformPt(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// ---------------------------------------------------------------------------
// Font metrics (glyph widths for box computation)
// ---------------------------------------------------------------------------

interface FontMetrics {
  /** charCode (byte for simple fonts, 16-bit for Type0) → width in thousandths of em */
  widths: Map<number, number>;
  /** Fallback width for codes missing from the map (Type0 /DW, spec default 1000) */
  defaultWidth: number | null;
  ascent: number; // thousandths of em
  descent: number; // thousandths of em (negative)
  isType0: boolean;
}

function numOf(v: unknown): number | null {
  const n = v as { asNumber?: () => number } | undefined;
  if (n && typeof n.asNumber === 'function') {
    const x = n.asNumber();
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function dictOf(doc: PDFDocument, obj: unknown): PDFDict | null {
  try {
    const looked = doc.context.lookup(obj as never) as PDFDict;
    return looked instanceof PDFDict ? looked : null;
  } catch {
    return null;
  }
}

/**
 * Standard 14 → pdf-lib font, longest names first so 'Helvetica-Bold'
 * does not shadow 'Helvetica-BoldOblique'.
 */
const STANDARD_FONTS: Array<[string, StandardFonts]> = [
  ['Helvetica-BoldOblique', StandardFonts.HelveticaBoldOblique],
  ['Helvetica-Bold', StandardFonts.HelveticaBold],
  ['Helvetica-Oblique', StandardFonts.HelveticaOblique],
  ['Helvetica', StandardFonts.Helvetica],
  ['Times-BoldItalic', StandardFonts.TimesRomanBoldItalic],
  ['Times-Bold', StandardFonts.TimesRomanBold],
  ['Times-Italic', StandardFonts.TimesRomanItalic],
  ['Times-Roman', StandardFonts.TimesRoman],
  ['Courier-BoldOblique', StandardFonts.CourierBoldOblique],
  ['Courier-Bold', StandardFonts.CourierBold],
  ['Courier-Oblique', StandardFonts.CourierOblique],
  ['Courier', StandardFonts.Courier],
  ['Symbol', StandardFonts.Symbol],
  ['ZapfDingbats', StandardFonts.ZapfDingbats],
];

function standardFontFor(baseFont: string): StandardFonts | null {
  for (const [name, sf] of STANDARD_FONTS) {
    if (baseFont === name || baseFont.startsWith(name + '-')) return sf;
  }
  return null;
}

/** Glyph metrics for every font in a resource dictionary. */
async function fontMetrics(doc: PDFDocument, resources: PDFDict | null): Promise<Map<string, FontMetrics>> {
  const out = new Map<string, FontMetrics>();
  try {
    if (!resources) return out;
    const fonts = dictOf(doc, resources.get(PDFName.of('Font')));
    if (!fonts) return out;
    for (const [nameObj, ref] of fonts.entries()) {
      const name = nameObj.toString().slice(1);
      const fontDict = dictOf(doc, ref);
      if (!fontDict) continue;
      const subtype = fontDict.get(PDFName.of('Subtype'))?.toString() ?? '';
      const isType0 = subtype === '/Type0';
      const m: FontMetrics = {
        widths: new Map(),
        defaultWidth: null,
        ascent: 800,
        descent: -200,
        isType0,
      };
      const desc = dictOf(doc, fontDict.get(PDFName.of('Descriptor')) ?? fontDict.get(PDFName.of('FontDescriptor')));
      if (desc) {
        const a = numOf(desc.get(PDFName.of('Ascent')));
        const d = numOf(desc.get(PDFName.of('Descent')));
        if (a !== null) m.ascent = a;
        if (d !== null) m.descent = d;
      }
      if (isType0) {
        const dw = numOf(fontDict.get(PDFName.of('DW')));
        m.defaultWidth = dw ?? 1000; // spec default
        const wObj = doc.context.lookup(fontDict.get(PDFName.of('W')));
        if (wObj instanceof PDFArray) {
          let i = 0;
          while (i < wObj.size()) {
            const c = numOf(wObj.lookup(i++));
            if (c === null) break;
            const nxt = wObj.lookup(i);
            if (nxt instanceof PDFArray) {
              for (let k = 0; k < nxt.size(); k++) {
                const w = numOf(nxt.lookup(k));
                if (w !== null) m.widths.set(c + k, w);
              }
              i++;
            } else {
              const clast = numOf(nxt);
              const w = numOf(wObj.lookup(i + 1));
              if (clast === null || w === null) break;
              for (let cc = c; cc <= clast; cc++) m.widths.set(cc, w);
              i += 2;
            }
          }
        }
        out.set(name, m);
      } else {
        const widthsObj = doc.context.lookup(fontDict.get(PDFName.of('Widths')));
        const firstChar = numOf(fontDict.get(PDFName.of('FirstChar')));
        if (widthsObj instanceof PDFArray && firstChar !== null) {
          for (let i = 0; i < widthsObj.size(); i++) {
            const w = numOf(widthsObj.lookup(i));
            if (w !== null) m.widths.set(firstChar + i, w);
          }
          out.set(name, m);
        } else {
          // No /Widths: standard 14 fonts are measurable via pdf-lib's
          // built-in metrics (producers and pdf-lib itself often omit
          // /Widths for them). Anything else stays unmeasurable — shows
          // using it take the conservative unknown path.
          const baseFont = fontDict.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '') ?? '';
          const sf = standardFontFor(baseFont);
          if (sf) {
            try {
              const f = await doc.embedFont(sf);
              for (let b = 0; b < 256; b++) {
                try {
                  // Map the byte through WinAnsi first: 0x92 is '’'
                  // (U+2019), not U+0092.
                  const ch = decodeWinAnsi(String.fromCharCode(b));
                  const w = f.widthOfTextAtSize(ch, 1000);
                  if (w > 0) m.widths.set(b, w);
                } catch {
                  // leave absent
                }
              }
              if (m.widths.size > 0) out.set(name, m);
            } catch {
              // unmeasurable
            }
          }
        }
      }
    }
  } catch {
    // No metrics — every show is unmeasurable (safe refusal path).
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redaction interpreter (separate from the matching interpreter: it
// simulates text-matrix advancement and computes glyph boxes)
// ---------------------------------------------------------------------------

interface RShow {
  /** Byte span of the show operation within its unit's content. */
  span: [number, number];
  /** User-space (page) glyph box, null when not measurable. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Baseline origin in page user space (for the conservative test). */
  originX: number;
  originY: number;
  /** Glyph count (for the conservative width estimate). */
  rawLen: number;
  fontSize: number;
}

interface RedactUnit {
  content: string;
  shows: RShow[];
  write: (content: string) => void;
}

type ShowPart = { bytes: string } | { adj: number };

/**
 * Advance (text-space units) and glyph count for show parts.
 * Returns null when any glyph width is unknown.
 */
function measureParts(
  m: FontMetrics,
  fontSize: number,
  tc: number,
  tw: number,
  tz: number,
  parts: ShowPart[],
): { adv: number; rawLen: number } | null {
  let adv = 0;
  let rawLen = 0;
  for (const p of parts) {
    if ('adj' in p) {
      adv -= (p.adj * fontSize) / 1000;
      continue;
    }
    const bytes = p.bytes;
    if (m.isType0) {
      if (bytes.length % 2 === 1) return null;
      for (let k = 0; k < bytes.length; k += 2) {
        const code = ((bytes.charCodeAt(k) & 0xff) << 8) | (bytes.charCodeAt(k + 1) & 0xff);
        const w = m.widths.get(code) ?? m.defaultWidth;
        if (w === null || w === undefined) return null;
        adv += (w * fontSize) / 1000 + tc + (code === 32 ? tw : 0);
        rawLen++;
      }
    } else {
      for (let k = 0; k < bytes.length; k++) {
        const code = bytes.charCodeAt(k) & 0xff;
        const w = m.widths.get(code);
        if (w === undefined) return null; // strict: unknown width, not 0
        adv += (w * fontSize) / 1000 + tc + (code === 32 ? tw : 0);
        rawLen++;
      }
    }
  }
  return { adv: adv * (tz / 100), rawLen };
}

function decodeStreamBytes(doc: PDFDocument, stream: PDFRawStream): string | null {
  try {
    return bytesToLatin1(decodePDFRawStream(stream).decode());
  } catch {
    try {
      return bytesToLatin1(stream.getContents());
    } catch {
      return null;
    }
  }
}

function writeFormStream(
  doc: PDFDocument,
  xobjDict: PDFDict,
  name: PDFName,
  oldStream: PDFRawStream,
  content: string,
): void {
  const fresh = doc.context.flateStream(latin1ToBytes(content));
  for (const [k, v] of oldStream.dict.entries()) {
    const ks = k.toString();
    if (ks === '/Length' || ks === '/Filter') continue;
    fresh.dict.set(k, v);
  }
  xobjDict.set(name, doc.context.register(fresh));
}

interface InterpCtx {
  doc: PDFDocument;
  resources: PDFDict | null;
  metrics: Map<string, FontMetrics>;
  /** Maps local space → page user space (identity for the page itself). */
  base: number[];
  shows: RShow[];
  /** Collected form units (for write-back). */
  formUnits: Array<{ xobjDict: PDFDict; name: PDFName; stream: PDFRawStream; content: string; shows: RShow[] }>;
  visited: Set<PDFRawStream>;
  depth: number;
}

async function interpretRedactContent(ctx: InterpCtx, content: string): Promise<void> {
  const { doc } = ctx;
  const tokens = tokenize(content);

  let inText = false;
  let fontName = '';
  let fontSize = 0;
  let tm = [...IDENTITY];
  let tlm = [...IDENTITY];
  let tc = 0;
  let tw = 0;
  let tz = 100;
  let leading = 0;
  let cm = [...IDENTITY];
  const cmStack: number[][] = [];
  let stack: Token[] = [];

  const nums = (count: number): number[] => {
    const vals: number[] = [];
    for (let k = stack.length - count; k < stack.length; k++) {
      const t = stack[k];
      vals.push(t && t.kind === 'num' ? (t.num as number) : NaN);
    }
    return vals;
  };

  /** Record a show; compute its page-space box when measurable. */
  const emitShow = (parts: ShowPart[], span: [number, number]) => {
    const m = ctx.metrics.get(fontName);
    const [ox, oy] = xformPt(ctx.base, ...xformPt(tm, 0, 0));
    const show: RShow = {
      span,
      box: null,
      originX: ox,
      originY: oy,
      rawLen: 0,
      fontSize,
    };
    if (m && fontSize > 0) {
      const measured = measureParts(m, fontSize, tc, tw, tz, parts);
      if (measured) {
        show.rawLen = measured.rawLen;
        const y0t = (m.descent * fontSize) / 1000;
        const y1t = (m.ascent * fontSize) / 1000;
        const corners: Array<[number, number]> = [
          [0, y0t],
          [measured.adv, y0t],
          [0, y1t],
          [measured.adv, y1t],
        ];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [cx, cy] of corners) {
          const [ux, uy] = xformPt(tm, cx, cy);
          const [wx, wy] = xformPt(ctx.base, ux, uy);
          if (wx < x0) x0 = wx;
          if (wy < y0) y0 = wy;
          if (wx > x1) x1 = wx;
          if (wy > y1) y1 = wy;
        }
        show.box = { x0, y0, x1, y1 };
        // Advance the text matrix for the next show (PDF 9.4.4).
        const adv = measured.adv;
        const [a, b, c, d, e, f] = tm;
        tm = [a, b, c, d, e + adv * a, f + adv * b];
      }
    }
    if (!show.box) {
      // Unmeasurable: still count glyphs for the conservative estimate.
      let n = 0;
      for (const p of parts) if (!('adj' in p)) n += m?.isType0 ? p.bytes.length / 2 : p.bytes.length;
      show.rawLen = Math.floor(n);
    }
    ctx.shows.push(show);
  };

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (tok.kind !== 'op') {
      if (tok.kind === 'arrStart') {
        const parts: Token[] = [];
        let depth = 1;
        let j = ti + 1;
        for (; j < tokens.length; j++) {
          const t2 = tokens[j];
          if (t2.kind === 'arrStart') depth++;
          if (t2.kind === 'arrEnd') { depth--; if (depth === 0) break; }
          parts.push(t2);
        }
        const arrTok: Token = { kind: 'dict', start: tok.start, end: tokens[j]?.end ?? tok.end, value: '' };
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
    // Graphics state (tracked so Form XObject placement is exact).
    if (op === 'q') { cmStack.push(cm); stack = []; continue; }
    if (op === 'Q') { const p = cmStack.pop(); if (p) cm = p; stack = []; continue; }
    if (op === 'cm') {
      const v = nums(6);
      if (v.every(Number.isFinite)) cm = matMul(v, cm);
      stack = [];
      continue;
    }
    if (op === 'Do' && ctx.depth < 8) {
      const nameTok = stack[stack.length - 1];
      stack = [];
      if (nameTok?.kind === 'name' && ctx.resources) {
        const xobjDict = dictOf(ctx.doc, ctx.resources.get(PDFName.of('XObject')));
        const ref = xobjDict?.get(PDFName.of(nameTok.value));
        // NB: PDFRawStream is NOT instanceof PDFDict — duck-type it.
        const looked = ref ? ctx.doc.context.lookup(ref) : null;
        const stream = looked && typeof (looked as PDFRawStream).getContents === 'function'
          ? (looked as PDFRawStream)
          : null;
        if (
          stream &&
          stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Form' &&
          !ctx.visited.has(stream)
        ) {
          ctx.visited.add(stream as PDFRawStream);
          const formContent = decodeStreamBytes(ctx.doc, stream as PDFRawStream);
          if (formContent !== null && xobjDict) {
            const matObj = ctx.doc.context.lookup(stream.dict.get(PDFName.of('Matrix')));
            let formMat = [...IDENTITY];
            if (matObj instanceof PDFArray && matObj.size() === 6) {
              const vs: number[] = [];
              for (let k = 0; k < 6; k++) { const n = numOf(matObj.lookup(k)); vs.push(n ?? (k % 3 === 0 ? 1 : 0)); }
              formMat = vs;
            }
            const childBase = matMul(cm, formMat);
            const formRes = dictOf(ctx.doc, stream.dict.get(PDFName.of('Resources'))) ?? ctx.resources;
            const child: InterpCtx = {
              ...ctx,
              resources: formRes,
              metrics: await fontMetrics(ctx.doc, formRes),
              base: childBase,
              shows: [],
              depth: ctx.depth + 1,
            };
            await interpretRedactContent(child, formContent);
            ctx.formUnits.push({
              xobjDict,
              name: PDFName.of(nameTok.value),
              stream: stream as PDFRawStream,
              content: formContent,
              shows: child.shows,
            });
          }
        }
      }
      continue;
    }
    if (op === 'BT') {
      inText = true;
      tm = [...IDENTITY]; tlm = [...IDENTITY];
      stack = [];
      continue;
    }
    if (op === 'ET') { inText = false; stack = []; continue; }
    if (!inText) { stack = []; continue; }
    switch (op) {
      case 'Tf': {
        const nameTok = stack[stack.length - 2];
        const sizeTok = stack[stack.length - 1];
        if (nameTok?.kind === 'name') fontName = nameTok.value;
        if (sizeTok?.kind === 'num') fontSize = sizeTok.num as number;
        break;
      }
      case 'Tm': {
        const v = nums(6);
        if (v.every(Number.isFinite)) { tm = [...v]; tlm = [...v]; }
        break;
      }
      case 'Td':
      case 'TD': {
        const v = nums(2);
        if (v.every(Number.isFinite)) {
          const [tx, ty] = v;
          const [a, b, c, d, e, f] = tlm;
          tlm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
          tm = [...tlm];
        }
        break;
      }
      case 'T*': {
        const [a, b, c, d, e, f] = tlm;
        tlm = [a, b, c, d, -leading * c + e, -leading * d + f];
        tm = [...tlm];
        break;
      }
      case 'TL': {
        const v = nums(1);
        if (Number.isFinite(v[0])) leading = v[0];
        break;
      }
      case 'Tc': { const v = nums(1); if (Number.isFinite(v[0])) tc = v[0]; break; }
      case 'Tw': { const v = nums(1); if (Number.isFinite(v[0])) tw = v[0]; break; }
      case 'Tz': { const v = nums(1); if (Number.isFinite(v[0])) tz = v[0]; break; }
      case 'Tj':
      case "'": {
        // "'" = T* then Tj
        if (op === "'") {
          const [a, b, c, d, e, f] = tlm;
          tlm = [a, b, c, d, -leading * c + e, -leading * d + f];
          tm = [...tlm];
        }
        const strTok = stack[stack.length - 1];
        if (strTok && (strTok.kind === 'str' || strTok.kind === 'hexstr')) {
          emitShow([{ bytes: strTok.value }], [strTok.start, tok.end]);
        }
        break;
      }
      case '"': {
        // '"' = aw Tw, ac Tc, then T* + Tj
        const aw = stack[stack.length - 3];
        const ac = stack[stack.length - 2];
        const strTok = stack[stack.length - 1];
        if (aw?.kind === 'num') tw = aw.num as number;
        if (ac?.kind === 'num') tc = ac.num as number;
        const [a, b, c, d, e, f] = tlm;
        tlm = [a, b, c, d, -leading * c + e, -leading * d + f];
        tm = [...tlm];
        if (strTok && (strTok.kind === 'str' || strTok.kind === 'hexstr')) {
          emitShow([{ bytes: strTok.value }], [strTok.start, tok.end]);
        }
        break;
      }
      case 'TJ': {
        const arrTok = stack[stack.length - 1] as (Token & { parts?: Token[] }) | undefined;
        if (arrTok?.parts) {
          const parts: ShowPart[] = [];
          for (const p of arrTok.parts) {
            if (p.kind === 'str' || p.kind === 'hexstr') parts.push({ bytes: p.value });
            else if (p.kind === 'num') parts.push({ adj: p.num as number });
          }
          emitShow(parts, [arrTok.start, tok.end]);
        }
        break;
      }
    }
    stack = [];
  }
}

/** Decode every content stream of a page into latin1 text, or null. */
function pageContent(doc: PDFDocument, pageDict: PDFDict): string | null {
  try {
    const contents = pageDict.get(PDFName.of('Contents'));
    if (!contents) return null;
    const looked = doc.context.lookup(contents);
    const parts: string[] = [];
    const decodeOne = (obj: unknown): boolean => {
      const stream = obj as PDFRawStream;
      const text = stream && typeof stream.getContents === 'function' ? decodeStreamBytes(doc, stream) : null;
      if (text === null) return false;
      parts.push(text);
      return true;
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

function removeByteSpans(content: string, spans: Array<[number, number]>): string {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const sp of sorted) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  for (let i = merged.length - 1; i >= 0; i--) {
    const [a, b] = merged[i];
    content = content.slice(0, a) + content.slice(b);
  }
  return content;
}

function boxesOverlap(
  b: { x0: number; y0: number; x1: number; y1: number },
  r: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const eps = 0.01;
  return b.x0 < r.x1 - eps && b.x1 > r.x0 + eps && b.y0 < r.y1 - eps && b.y1 > r.y0 + eps;
}

/**
 * Conservative overlap test for shows whose box is unknown. Uses a
 * generous width estimate so the test fails safe (refuse) rather than
 * leaking redacted text.
 */
function unknownMayHit(sh: RShow, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const fs = sh.fontSize;
  if (!(fs > 0)) return true;
  if (sh.originY < r.y0 - 1.2 * fs || sh.originY > r.y1 + 1.2 * fs) return false;
  const maxAdv = sh.rawLen * fs * 1.0 + 2;
  if (sh.originX > r.x1 + 1 || sh.originX + maxAdv < r.x0 - 1) return false;
  return true;
}

/**
 * Plan + apply redactions on a page: remove intersecting text runs from
 * the page and Form XObject content streams, then paint black boxes.
 * Throws RedactUnsafeError when safe removal cannot be verified.
 */
export async function applyRedactions(doc: PDFDocument, pageIndex: number, rects: RedactRect[]): Promise<void> {
  if (rects.length === 0) return;
  const page = doc.getPage(pageIndex);
  const pageDict = page.node;
  const content = pageContent(doc, pageDict);
  if (content === null) {
    throw new RedactUnsafeError('Redaction refused: the page content could not be read.');
  }
  const resources = dictOf(doc, pageDict.get(PDFName.of('Resources')));
  const units: RedactUnit[] = [];
  const pageShows: RShow[] = [];
  const formUnits: InterpCtx['formUnits'] = [];
  const ctx: InterpCtx = {
    doc,
    resources,
    metrics: await fontMetrics(doc, resources),
    base: [...IDENTITY],
    shows: pageShows,
    formUnits,
    visited: new Set(),
    depth: 0,
  };
  await interpretRedactContent(ctx, content);
  units.push({
    content,
    shows: pageShows,
    write: (c: string) => {
      pageDict.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(latin1ToBytes(c))));
    },
  });
  for (const fu of formUnits) {
    units.push({
      content: fu.content,
      shows: fu.shows,
      write: (c: string) => writeFormStream(doc, fu.xobjDict, fu.name, fu.stream, c),
    });
  }

  const perUnit = new Map<number, Array<[number, number]>>();
  const pushSpan = (ui: number, span: [number, number]) => {
    const arr = perUnit.get(ui) ?? [];
    arr.push(span);
    perUnit.set(ui, arr);
  };

  for (const r of rects) {
    const rect = { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height };
    units.forEach((unit, ui) => {
      for (const sh of unit.shows) {
        if (sh.box) {
          if (boxesOverlap(sh.box, rect)) pushSpan(ui, sh.span);
        } else if (unknownMayHit(sh, rect)) {
          throw new RedactUnsafeError(
            `Redaction refused: text at (${fmt(r.x)}, ${fmt(r.y)}) uses a font whose glyph widths are unavailable, so complete removal cannot be verified. ` +
              `Widen the rectangle to fully cover the text run, or remove the redaction.`,
          );
        }
      }
    });
  }

  units.forEach((unit, ui) => {
    let c = unit.content;
    const spans = perUnit.get(ui);
    if (spans && spans.length > 0) c = removeByteSpans(c, spans);
    if (ui === 0) {
      // Paint the black boxes in page space, over remaining content.
      for (const r of rects) {
        c += `\n0 g\n${fmt(r.x)} ${fmt(r.y)} ${fmt(r.width)} ${fmt(r.height)} re\nf\n`;
      }
    }
    unit.write(c);
  });
}
