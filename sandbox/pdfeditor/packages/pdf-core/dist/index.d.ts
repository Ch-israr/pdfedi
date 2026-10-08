/**
 * @pdfeditor/pdf-core
 *
 * Pure, framework-free PDF helpers. No DOM, no Node APIs — safe to import
 * in the browser (apps/web) and in the Fastify service (apps/api).
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { EditorElement, Page } from '@pdfeditor/shared';
/** Rotate a page 90 degrees clockwise. */
export declare function rotatePage(page: Page): Page;
/** Remove a page by id. */
export declare function deletePage(pages: Page[], pageId: string): Page[];
/** Move a page to a new position (by id). */
export declare function reorderPage(pages: Page[], pageId: string, toIndex: number): Page[];
/** Duplicate a page — the copy gets a fresh UUID. */
export declare function duplicatePage(page: Page): Page;
export interface DrawContext {
    fontCache: Map<string, PDFFont>;
    imageCache: Map<string, PDFImage>;
    doc: PDFDocument;
}
export declare function createDrawContext(doc: PDFDocument): DrawContext;
/**
 * Draw a single editor element onto a pdf-lib page.
 * Coordinates: element x/y are in PDF points, origin bottom-left.
 */
export declare function drawElement(ctx: DrawContext, page: PDFPage, el: EditorElement): Promise<void>;
export interface ExportInput {
    /** Original PDF bytes (never mutated) */
    srcBytes: Uint8Array;
    /** Current page order (UUIDs may differ from source order) */
    pages: Page[];
    /** All elements keyed by id */
    elements: Record<string, EditorElement>;
}
/**
 * Build the edited PDF. Returns fresh bytes — the input is never modified.
 * Pages follow the current `pages` order; deleted pages are dropped.
 */
export declare function exportPdf(input: ExportInput): Promise<Uint8Array>;
//# sourceMappingURL=index.d.ts.map