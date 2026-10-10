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

export interface PdfediRestoreResult {
  /** Clean source bytes — becomes the session's pdfBytes */
  sourceBytes: Uint8Array;
  pages: Page[];
  elements: Record<string, EditorElement>;
  manifest: PdfediManifest;
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
    // are baked into the page content. Check if the manifest contains only
    // additive elements (no native-text masks, no page deletions).
    const hasDestructive = manifest.elements.some((el) => el.kind === 'native-text');
    // For additive-only, we don't restore elements (they're baked into the
    // pages and visible). Return null to load as a regular PDF — the user
    // can continue adding new edits.
    if (!hasDestructive) {
      return null;
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
