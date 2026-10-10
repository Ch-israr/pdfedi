/**
 * @pdfeditor/pdf-core — PDFEDI embedded state package.
 *
 * Makes a downloaded PDF re-editable without any database or server storage:
 * the PDF carries its own editing state as embedded file attachments:
 *
 *   - PDFEDI_STATE.json        — manifest (current active objects, v1 schema)
 *   - PDFEDI_SOURCE.pdf        — the clean original source PDF
 *   - PDFEDI_ASSET_<id>.<ext>  — image / signature binaries
 *
 * Pure functions, no DOM. Uses pdf-lib's official `attach()` API and the
 * WebCrypto SHA-256 digest (available in browsers and Node 20+).
 */
import { PDFDocument } from 'pdf-lib';
import {
  PDFEDI_ASSET_PREFIX,
  PDFEDI_MANIFEST_NAME,
  PDFEDI_MANIFEST_VERSION,
  PDFEDI_SOURCE_NAME,
  type EditorElement,
  type ManifestElement,
  type Page,
  type PdfediManifest,
} from '@pdfeditor/shared';

export interface StateAsset {
  /** Attachment filename, e.g. "PDFEDI_ASSET_<uuid>.png" */
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** UUID of the element that references this asset */
  elementId: string;
}

/** SHA-256 hex digest (consistency check, not a security claim). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'bin';
}

export interface ManifestParts {
  elements: ManifestElement[];
  assets: StateAsset[];
  manifestAssets: PdfediManifest['assets'];
}

/**
 * Convert the live editor elements into manifest elements, extracting
 * image/signature binaries into separate attachments. The `src` of an
 * image/signature element may be a blob: URL (not downloadable) — the
 * caller resolves it to bytes via `resolveAsset`.
 */
export async function buildManifestParts(
  pages: Page[],
  elements: Record<string, EditorElement>,
  resolveAsset: (el: EditorElement) => Promise<{ bytes: Uint8Array; mime: string } | null>,
): Promise<ManifestParts> {
  const assets: StateAsset[] = [];
  const manifestElements: ManifestElement[] = [];
  const manifestAssets: PdfediManifest['assets'] = [];

  // Stable order: page order, then insertion order within a page.
  const pageOrder = new Map(pages.map((p, i) => [p.id, i]));
  const sorted = Object.values(elements).sort(
    (a, b) => (pageOrder.get(a.pageId) ?? 0) - (pageOrder.get(b.pageId) ?? 0),
  );

  for (const el of sorted) {
    // Deleted baked elements are tombstones for export masking only.
    // They must not reappear on re-upload.
    if ((el as any).deleted) continue;
    // Strip transient baked-state fields; restore re-derives them.
    const { baked: _baked, bakedBounds: _bb, deleted: _del, ...clean } = el as any;
    if (el.kind === 'image' || el.kind === 'signature') {
      const resolved = await resolveAsset(el);
      if (!resolved) {
        // Asset unreadable: skip the element rather than writing a
        // manifest entry that can never be restored.
        continue;
      }
      const name = `${PDFEDI_ASSET_PREFIX}${el.id}.${extForMime(resolved.mime)}`;
      assets.push({ name, mime: resolved.mime, bytes: resolved.bytes, elementId: el.id });
      manifestAssets.push({ name, elementId: el.id, mime: resolved.mime });
      const { src: _src, ...rest } = clean;
      manifestElements.push({ ...rest, assetRef: name } as ManifestElement);
    } else {
      manifestElements.push(clean as ManifestElement);
    }
  }

  return { elements: manifestElements, assets, manifestAssets };
}

/**
 * Assemble the manifest object (current active state only).
 */
export function createManifest(
  sourceHash: string,
  pages: Page[],
  manifestElements: ManifestElement[],
  manifestAssets: PdfediManifest['assets'],
): PdfediManifest {
  return {
    format: 'pdfedi-state',
    version: PDFEDI_MANIFEST_VERSION,
    sourceHash,
    exportedAt: new Date().toISOString(),
    pages: pages.map((p) => ({
      id: p.id,
      sourceIndex: p.sourceIndex,
      width: p.width,
      height: p.height,
      rotation: p.rotation,
    })),
    elements: manifestElements,
    assets: manifestAssets,
  };
}

/**
 * Attach the state package to an already-built PDFDocument.
 * Must be called before `doc.save()`.
 */
export async function embedStatePackage(
  doc: PDFDocument,
  manifest: PdfediManifest,
  sourceBytes: Uint8Array,
  assets: StateAsset[],
): Promise<void> {
  const manifestJson = JSON.stringify(manifest);
  await doc.attach(new TextEncoder().encode(manifestJson), PDFEDI_MANIFEST_NAME, {
    mimeType: 'application/json',
    description: 'PDFEDI editing state — re-upload this PDF to continue editing.',
  });
  await doc.attach(sourceBytes, PDFEDI_SOURCE_NAME, {
    mimeType: 'application/pdf',
    description: 'PDFEDI clean source document — original PDF before edits.',
  });
  for (const a of assets) {
    await doc.attach(a.bytes, a.name, {
      mimeType: a.mime,
      description: 'PDFEDI image asset.',
    });
  }
}

/**
 * Embed only the manifest + assets (no source PDF).
 * Used for additive-only edits where the elements are baked into page content
 * and the downloaded PDF's pages serve as the base on re-upload.
 */
export async function embedManifestOnly(
  doc: PDFDocument,
  manifest: PdfediManifest,
  assets: StateAsset[],
): Promise<void> {
  const manifestJson = JSON.stringify(manifest);
  await doc.attach(new TextEncoder().encode(manifestJson), PDFEDI_MANIFEST_NAME, {
    mimeType: 'application/json',
    description: 'PDFEDI editing state — re-upload this PDF to continue editing.',
  });
  for (const a of assets) {
    await doc.attach(a.bytes, a.name, {
      mimeType: a.mime,
      description: 'PDFEDI image asset.',
    });
  }
}
