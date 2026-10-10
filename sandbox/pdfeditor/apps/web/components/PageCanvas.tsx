'use client';

import { useEffect, useRef, useState } from 'react';
import type { Page } from '@pdfeditor/shared';
import { useEditor } from '@/store/editor';
import { renderPageToCanvas } from '@/lib/pdfjs';
import { ElementOverlay } from './ElementOverlay';

interface Props {
  page: Page;
  /** pdf.js document proxy — set once the PDF is loaded */
  getDoc: () => { getPage: (n: number) => Promise<unknown> } | null;
  /** Increments when doc is ready; triggers re-render */
  docVersion: number;
}

/**
 * Renders one PDF page to canvas (lazy via IntersectionObserver) and
 * overlays the editor elements for that page.
 */
export function PageCanvas({ page, getDoc, docVersion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoom = useEditor((s) => s.zoom);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Blank inserted pages have no PDF source — canvas stays white
    if (page.sourceIndex === 0) return;
    const doc = getDoc() as never;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    void (async () => {
      try {
        await renderPageToCanvas(doc as never, page.sourceIndex, canvas, zoom, page.rotation);
        if (cancelled) {
          const ctx = canvas.getContext('2d');
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
      } catch {
        /* page may have been disposed during zoom change */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, zoom, page.sourceIndex, page.rotation, getDoc, docVersion]);

  const isActive = activePageId === page.id;
  const setNativeText = useEditor((s) => s.setNativeText);

  // Extract native text positions for direct editing (reads the PDF's own
  // text operators — no OCR). Re-runs when the page or its rotation changes.
  useEffect(() => {
    if (!visible || !docVersion) return;
    const doc = getDoc() as unknown as import('pdfjs-dist').PDFDocumentProxy | null;
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      try {
        const { extractNativeText } = await import('@/lib/pdfjs');
        const items = await extractNativeText(doc, page);
        if (!cancelled) setNativeText(page.id, items);
      } catch {
        // Extraction never blocks the editor
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, docVersion, page, getDoc, setNativeText]);

  return (
    <div
      ref={wrapRef}
      data-page-id={page.id}
      onClick={() => setActivePage(page.id)}
      className={`relative mx-auto mb-6 shadow-lg ${isActive ? 'ring-2 ring-brand-500' : ''}`}
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 bg-white" />
      {visible && <ElementOverlay page={page} />}
    </div>
  );
}
