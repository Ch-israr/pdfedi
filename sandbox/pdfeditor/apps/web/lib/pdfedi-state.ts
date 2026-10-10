/**
 * PDFEDI state package — upload-side detection and restore.
 *
 * Uses the official PDF.js `getAttachments()` API (no new PDF stack).
 * Everything runs in the browser; nothing is sent anywhere.
 */
import {
  PDFEDI_MANIFEST_NAME,
  PDFEDI_SOURCE_NAME,
  PDFEDI_MAX_MANIFEST_BYTES,
  PdfediManifestSchema,
  type EditorElement,
  type Page,
  type PdfediManifest,
} from '@pdfeditor/shared';
import { sha256Hex } from '@pdfeditor/pdf-core';

/**
 * Measure text width in PDF points using a canvas. Used to compute accurate
 * baked bounds for text elements (which don't store width/height).
 * Falls back to a heuristic estimate if canvas is unavailable.
 */
function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
): number {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // Map PDF font names to CSS families
    const cssFamily = /courier/i.test(fontFamily)
      ? 'monospace'
      : /times/i.test(fontFamily)
        ? 'serif'
        : 'sans-serif';
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${cssFamily}`;
    const w = ctx.measureText(text).width;
    if (w > 0 && Number.isFinite(w)) return w;
  } catch {
    // fall through to heuristic
  }
  // Heuristic: average Latin glyph ≈ 0.55 × fontSize
  return text.length * fontSize * 0.55;
}

/**
 * Compute the baked bounds for a manifest element — the rectangle in PDF
 * points that the element occupies in the page content. Used to mask the
 * old baked content when the element is modified or deleted after restore.
 */
function computeBakedBounds(mel: {
  kind: string;
  x: number;
  y: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  width?: number;
  height?: number;
}): { x: number; y: number; width: number; height: number } {
  if (mel.kind === 'text') {
    const fontSize = mel.fontSize ?? 12;
    const width = measureTextWidth(
      mel.text ?? '',
      fontSize,
      mel.fontFamily ?? 'Helvetica',
      mel.bold ?? false,
      mel.italic ?? false,
    );
    // el.y is the text baseline. Extend below for descenders (g,j,p,q,y)
    // and above for ascenders. Add small padding for safety.
    const padX = fontSize * 0.1;
    const y = mel.y - fontSize * 0.3;
    const height = fontSize * 1.5;
    return { x: mel.x - padX, y, width: width + padX * 2, height };
  }
  // Image, signature, highlight, shape, native-text all store width/height
  const w = mel.width ?? 0;
  const h = mel.height ?? 0;
  return { x: mel.x, y: mel.y, width: Math.max(0, w), height: Math.max(0, h) };
}

export interface PdfediRestoreResult {
  /** Clean source bytes — becomes the session's pdfBytes (null if no source embedded) */
  sourceBytes: Uint8Array;
  pages: Page[];
  elements: Record<string, EditorElement>;
  manifest: PdfediManifest;
  /** True if no source was embedded (additive-only edits, elements baked into pages) */
  noSource?: boolean;
}

export type RestoreFailureReason =
  | 'manifest-corrupt'
  | 'manifest-unsupported'
  | 'source-missing'
  | 'source-mismatch'
  | 'asset-missing'
  | 'invalid-data';

export class RestoreError extends Error {
  reason: RestoreFailureReason;
  constructor(reason: RestoreFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

interface PdfAttachment {
  filename: string;
  content: Uint8Array;
}

async function getPdfAttachments(
  bytes: Uint8Array,
): Promise<Record<string, PdfAttachment>> {
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    const raw = (await doc.getAttachments()) as Record<
      string,
      { filename: string; content: Uint8Array }
    > | null;
    return raw ?? {};
  } finally {
    await doc.destroy();
  }
}

/** Quick check: does this PDF carry a PDFEDI manifest attachment? */
export async function hasPdfediPackage(bytes: Uint8Array): Promise<boolean> {
  try {
    const atts = await getPdfAttachments(bytes);
    return PDFEDI_MANIFEST_NAME in atts;
  } catch {
    return false;
  }
}

/**
 * Try to restore a PDFEDI state package.
 * @returns the restored session, or null when the PDF carries no manifest.
 * @throws RestoreError when a manifest is present but unusable.
 */
export async function tryRestorePdfediPackage(
  uploadedBytes: Uint8Array,
): Promise<PdfediRestoreResult | null> {
  let atts: Record<string, PdfAttachment>;
  try {
    atts = await getPdfAttachments(uploadedBytes);
  } catch {
    return null;
  }
  if (!(PDFEDI_MANIFEST_NAME in atts)) return null;
  return restoreFromAttachments(atts);
}

/**
 * Extract and validate a PDFEDI state package. Throws RestoreError with a
 * user-facing message when the package is unusable. Never invents data.
 */
export async function restorePdfediPackage(
  uploadedBytes: Uint8Array,
): Promise<PdfediRestoreResult> {
  const atts = await getPdfAttachments(uploadedBytes);
  const manifestFile = atts[PDFEDI_MANIFEST_NAME];
  if (!manifestFile) {
    throw new RestoreError('manifest-corrupt', 'No PDFEDI editing data found in this file.');
  }
  const result = await restoreFromAttachments(atts);
  if (!result) {
    // Additive-only manifest without source: nothing to restore (elements are
    // baked into the pages). Treat as unusable for the strict API.
    throw new RestoreError('source-missing', 'No restorable editing data found in this file.');
  }
  return result;
}

async function restoreFromAttachments(
  atts: Record<string, PdfAttachment>,
): Promise<PdfediRestoreResult | null> {
  const manifestFile = atts[PDFEDI_MANIFEST_NAME];
  if (!manifestFile) {
    throw new RestoreError('manifest-corrupt', 'No PDFEDI editing data found in this file.');
  }
  if (manifestFile.content.byteLength > PDFEDI_MAX_MANIFEST_BYTES) {
    throw new RestoreError(
      'manifest-corrupt',
      'The embedded editing data is too large to be trusted.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestFile.content));
  } catch {
    throw new RestoreError(
      'manifest-corrupt',
      'The embedded editing data is corrupt and cannot be read.',
    );
  }

  const parsed = PdfediManifestSchema.safeParse(raw);
  if (!parsed.success) {
    // Distinguish an unknown future version from malformed data
    const version =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>).version
        : undefined;
    if (version !== undefined && version !== 1) {
      throw new RestoreError(
        'manifest-unsupported',
        'This file was created by a newer version of PDFEDI and cannot be restored here.',
      );
    }
    throw new RestoreError(
      'manifest-corrupt',
      'The embedded editing data is invalid and cannot be restored.',
    );
  }
  const manifest = parsed.data;

  const sourceFile = atts[PDFEDI_SOURCE_NAME];
  if (!sourceFile) {
    // No source embedded: this happens for additive-only edits where elements
    // are baked into the page content. Restore the elements as editable objects
    // (marked as baked so they're not drawn twice on the next export).
    const hasDestructive = manifest.elements.some((el) => el.kind === 'native-text');
    if (!hasDestructive) {
      // Resolve image/signature assets to blob URLs (memory only)
      const elements: Record<string, EditorElement> = {};
      for (const mel of manifest.elements) {
        const nums = [mel.x, mel.y, mel.rotation];
        if (!nums.every(Number.isFinite)) continue;
        // Compute accurate baked bounds so the old baked content can be
        // masked if the element is modified or deleted after restore.
        const bakedBounds = computeBakedBounds(mel as any);
        if (mel.kind === 'image' || mel.kind === 'signature') {
          const assetMeta = manifest.assets.find((a) => a.name === mel.assetRef);
          const assetFile = atts[mel.assetRef];
          if (!assetMeta || !assetFile) continue;
          const blob = new Blob([assetFile.content as unknown as BlobPart], {
            type: assetMeta.mime,
          });
          const src = URL.createObjectURL(blob);
          const { assetRef: _ref, ...rest } = mel;
          // Mark as baked: already rendered into the page content
          elements[mel.id] = { ...rest, src, baked: true, bakedBounds } as unknown as EditorElement;
        } else {
          elements[mel.id] = { ...mel, baked: true, bakedBounds } as unknown as EditorElement;
        }
      }
      const pages: Page[] = manifest.pages.map((p) => ({ ...p }));
      // sourceBytes is null: caller uses the uploaded PDF bytes as the base
      return { sourceBytes: null as unknown as Uint8Array, pages, elements, manifest, noSource: true as const };
    }
    throw new RestoreError(
      'source-missing',
      'The original document is missing from this file, so previous edits cannot be restored.',
    );
  }
  const sourceBytes = new Uint8Array(
    sourceFile.content.buffer.slice(
      sourceFile.content.byteOffset,
      sourceFile.content.byteOffset + sourceFile.content.byteLength,
    ),
  );

  const actualHash = await sha256Hex(sourceBytes);
  if (actualHash !== manifest.sourceHash) {
    throw new RestoreError(
      'source-mismatch',
      'The embedded original document does not match its editing data. Nothing was restored.',
    );
  }

  // Resolve image/signature assets to blob URLs (memory only)
  const elements: Record<string, EditorElement> = {};
  for (const mel of manifest.elements) {
    // Finite-coordinate guard (zod allows Infinity for plain numbers)
    const nums = [mel.x, mel.y, mel.rotation];
    if (!nums.every(Number.isFinite)) {
      throw new RestoreError('invalid-data', 'The embedded editing data contains invalid positions.');
    }
    if (mel.kind === 'image' || mel.kind === 'signature') {
      const assetMeta = manifest.assets.find((a) => a.name === mel.assetRef);
      const assetFile = atts[mel.assetRef];
      if (!assetMeta || !assetFile) {
        throw new RestoreError(
          'asset-missing',
          'An image used in this document is missing, so previous edits cannot be fully restored.',
        );
      }
      const blob = new Blob([assetFile.content as unknown as BlobPart], {
        type: assetMeta.mime,
      });
      const src = URL.createObjectURL(blob);
      const { assetRef: _ref, ...rest } = mel;
      elements[mel.id] = { ...rest, src } as EditorElement;
    } else {
      elements[mel.id] = mel as EditorElement;
    }
  }

  // Pages keep their UUIDs so element pageIds stay linked
  const pages: Page[] = manifest.pages.map((p) => ({ ...p }));

  return { sourceBytes, pages, elements, manifest };
}

/**
 * Heuristic: does this PDF look scanned/flat? Checks extractable text on
 * the first few pages — no OCR is performed. Returns true when almost no
 * text is extractable (likely scanned images or flattened content).
 */
export async function looksScanned(bytes: Uint8Array): Promise<boolean> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    try {
      const checkPages = Math.min(3, doc.numPages);
      let chars = 0;
      for (let i = 1; i <= checkPages; i++) {
        const page = await doc.getPage(i);
        try {
          const tc = await page.getTextContent();
          for (const item of tc.items) {
            if ('str' in item && typeof item.str === 'string') chars += item.str.length;
          }
        } finally {
          page.cleanup();
        }
        if (chars >= 50) return false; // clearly has real text
      }
      return chars < 50;
    } finally {
      await doc.destroy();
    }
  } catch {
    return false; // never block loading on a heuristic failure
  }
}
