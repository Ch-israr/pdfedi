/**
 * Upload-side restore for PDF-native annotation persistence.
 *
 * Downloads produced by the current editor carry their edits as standard
 * PDF annotations (see @pdfeditor/pdf-core annotations module) — no JSON
 * manifest and no embedded source PDF. This module turns the parsed
 * annotations back into editor elements:
 *   - binds pageIndex → the session's page UUIDs
 *   - converts extracted stamp images back into object URLs (JPEG bytes
 *     directly; raw Flate samples via DecompressionStream + canvas → PNG)
 *
 * Legacy downloads (with PDFEDI attachments) are handled separately by
 * pdfedi-state.ts and only when no pdfedi annotations are present.
 */
import type { EditorElement, Page } from '@pdfeditor/shared';
import type { ParsedAnnotationElement, ParsedImageData } from '@pdfeditor/pdf-core';

export async function parseAnnotations(
  bytes: Uint8Array,
): Promise<ParsedAnnotationElement[] | null> {
  try {
    const { parsePdfediAnnotations } = await import('@pdfeditor/pdf-core');
    const parsed = await parsePdfediAnnotations(bytes);
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
    if (!DS) return null;
    const stream = new Blob([data as unknown as BlobPart])
      .stream()
      .pipeThrough(new DS('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Convert an extracted stamp image into a displayable object URL. */
export async function imageDataToSrc(img: ParsedImageData): Promise<string | null> {
  if (img.jpegBytes) {
    return URL.createObjectURL(new Blob([img.jpegBytes as unknown as BlobPart], { type: 'image/jpeg' }));
  }
  const raw = img.rawSamples;
  if (!raw || raw.bitsPerComponent !== 8 || raw.width <= 0 || raw.height <= 0) return null;
  const pixels = await inflate(raw.compressed);
  if (!pixels) return null;
  const smask = raw.smaskCompressed ? await inflate(raw.smaskCompressed) : null;
  const isGray = /DeviceGray/.test(raw.colorSpace);
  const comps = isGray ? 1 : 3;
  const expected = raw.width * raw.height * comps;
  if (pixels.length < expected) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = raw.width;
    canvas.height = raw.height;
    const cx = canvas.getContext('2d');
    if (!cx) return null;
    const imageData = cx.createImageData(raw.width, raw.height);
    const pxCount = raw.width * raw.height;
    for (let i = 0; i < pxCount; i++) {
      const s = i * comps;
      const d = i * 4;
      if (isGray) {
        imageData.data[d] = pixels[s];
        imageData.data[d + 1] = pixels[s];
        imageData.data[d + 2] = pixels[s];
      } else {
        imageData.data[d] = pixels[s];
        imageData.data[d + 1] = pixels[s + 1];
        imageData.data[d + 2] = pixels[s + 2];
      }
      imageData.data[d + 3] = smask && smask.length >= pxCount ? smask[i] : 255;
    }
    cx.putImageData(imageData, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/**
 * Bind parsed annotations to the session's pages and materialise image
 * sources. Elements whose image data cannot be rasterised are skipped
 * (documented limitation for exotic colour spaces).
 */
export async function bindAnnotationElements(
  parsed: ParsedAnnotationElement[],
  pages: Page[],
): Promise<Record<string, EditorElement>> {
  const elements: Record<string, EditorElement> = {};
  for (const item of parsed) {
    const page = pages[item.pageIndex];
    if (!page) continue;
    const el = { ...item.element, pageId: page.id } as EditorElement;
    if (el.kind === 'native-text') {
      // Pin the original fragment position: the parsed box (x/y) is the
      // original location before any move in this session, so export's
      // direct-edit matching can still find the original run and convert
      // this restored edit to a direct rewrite.
      el.originX = el.x;
      el.originY = el.y;
    }
    if (el.kind === 'image' || el.kind === 'signature') {
      if (!item.image) continue;
      const src = await imageDataToSrc(item.image);
      if (!src) continue;
      (el as { src: string }).src = src;
      if (el.kind === 'image') {
        (el as { mime: string }).mime = item.image.jpegBytes ? 'image/jpeg' : 'image/png';
      }
    }
    elements[el.id] = el;
  }
  return elements;
}
