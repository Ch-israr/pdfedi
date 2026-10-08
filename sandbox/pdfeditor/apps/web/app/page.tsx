'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { Dropzone } from '@/components/Dropzone';
import { Toolbar } from '@/components/Toolbar';
import { Thumbnails } from '@/components/Thumbnails';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { PageCanvas } from '@/components/PageCanvas';

export default function EditorPage() {
  const pdfBytes = useEditor((s) => s.pdfBytes);
  const pages = useEditor((s) => s.pages);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const docRef = useRef<never | null>(null);

  // Keep the pdf.js document in a ref (memory only, never in the store).
  // The store holds bytes + metadata; rendering handles live here.
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
      if (!cancelled) docRef.current = loaded.doc as never;
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
    return <Dropzone />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Thumbnails getDoc={getDoc} />
        <main className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-slate-200 p-6">
          {pages.map((page) => (
            <PageCanvas key={page.id} page={page} getDoc={getDoc} />
          ))}
        </main>
        <PropertiesPanel />
      </div>
    </div>
  );
}
