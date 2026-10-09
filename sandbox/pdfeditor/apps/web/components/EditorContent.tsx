'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';
import { Dropzone } from '@/components/Dropzone';
import { Toolbar } from '@/components/Toolbar';
import { Thumbnails } from '@/components/Thumbnails';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { PageCanvas } from '@/components/PageCanvas';

/**
 * EditorContent — the pure editor interface, independent of any site
 * header/footer. Mount this directly inside the production website's
 * body/content area (between its existing header and footer) when
 * integrating. It renders only the editor: nothing else.
 */
export function EditorContent() {
  const pdfBytes = useEditor((s) => s.pdfBytes);
  const pages = useEditor((s) => s.pages);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const docRef = useRef<never | null>(null);

  // Keep the pdf.js document in a ref (memory only, never in the store).
  // The store holds bytes + metadata; rendering handles live here.
  // docVersion increments when the doc is ready, triggering PageCanvas re-render.
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    if (!pdfBytes) {
      docRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      const { default: getDoc } = await import('@/lib/pdfjs').then((m) => ({
        default: m.loadPdfDocument,
      }));
      const loaded = await getDoc(pdfBytes);
      if (!cancelled) {
        docRef.current = loaded.doc as never;
        setDocVersion((v) => v + 1);
      }
    })();
    return () => {
      cancelled = true;
      const d = docRef.current as unknown as { destroy?: () => void } | null;
      try {
        d?.destroy?.();
      } catch {
        /* noop */
      }
      docRef.current = null;
    };
  }, [pdfBytes]);

  const getDoc = useCallback(() => docRef.current as never, []);
  const mainRef = useRef<HTMLElement>(null);
  const setZoom = useEditor((s) => s.setZoom);
  const prevPageCount = useRef(0);

  // Fit-to-width on document load: set zoom so the first page fills the container
  useEffect(() => {
    const currentPages = useEditor.getState().pages;
    if (currentPages.length > 0 && prevPageCount.current === 0) {
      const page = currentPages[0];
      const containerW = mainRef.current ? mainRef.current.clientWidth - 32 : 800;
      const fitZoom = containerW / page.width;
      // Clamp between 0.5 and 2.0 for sensible defaults
      setZoom(Math.max(0.5, Math.min(2.0, fitZoom)));
    }
    prevPageCount.current = currentPages.length;
  });

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedId, deleteElement } = useEditor.getState();
        if (selectedId) {
          e.preventDefault();
          deleteElement(selectedId);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!pdfBytes) {
    return (
      <div className="pdfeditor-root flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
        <Dropzone />
      </div>
    );
  }

  return (
    <div className="pdfeditor-root flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Thumbnails getDoc={getDoc} docVersion={docVersion} />
        <main
          ref={mainRef}
          className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-slate-200 px-2 py-4 sm:px-4 sm:py-6"
        >
          {pages.map((page) => (
            <PageCanvas key={page.id} page={page} getDoc={getDoc} docVersion={docVersion} />
          ))}
        </main>
        <PropertiesPanel />
      </div>
    </div>
  );
}
