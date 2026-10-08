'use client';

import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { renderPageToCanvas } from '@/lib/pdfjs';

/**
 * Left sidebar: page thumbnails with rotate / duplicate / delete actions.
 * Thumbnails render lazily at low scale.
 */
export function Thumbnails({ getDoc }: { getDoc: () => never }) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const rotatePage = useEditor((s) => s.rotatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const duplicatePage = useEditor((s) => s.duplicatePage);

  return (
    <aside className="thin-scroll w-44 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2">
      {pages.map((page, i) => (
        <Thumbnail
          key={page.id}
          pageId={page.id}
          sourceIndex={page.sourceIndex}
          label={i + 1}
          active={page.id === activePageId}
          getDoc={getDoc}
          onSelect={() => {
            setActivePage(page.id);
            document
              .querySelector(`[data-page-id="${page.id}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onRotate={() => rotatePage(page.id)}
          onDuplicate={() => duplicatePage(page.id)}
          onDelete={() => {
            if (pages.length > 1 && window.confirm(`Delete page ${i + 1}?`)) {
              deletePage(page.id);
            }
          }}
        />
      ))}
    </aside>
  );
}

function Thumbnail({
  pageId,
  sourceIndex,
  label,
  active,
  getDoc,
  onSelect,
  onRotate,
  onDuplicate,
  onDelete,
}: {
  pageId: string;
  sourceIndex: number;
  label: number;
  active: boolean;
  getDoc: () => never;
  onSelect: () => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let done = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (done || !entries[0]?.isIntersecting) return;
        done = true;
        const doc = getDoc();
        const canvas = canvasRef.current;
        if (doc && canvas) {
          void renderPageToCanvas(doc, sourceIndex, canvas, 0.25).catch(() => {});
        }
        obs.disconnect();
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [sourceIndex, getDoc]);

  return (
    <div
      ref={wrapRef}
      onClick={onSelect}
      className={`group relative mb-3 cursor-pointer rounded-lg border p-1 ${
        active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <canvas ref={canvasRef} className="w-full rounded bg-white" />
      <div className="mt-1 text-center text-xs text-slate-500">{label}</div>
      <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
        <button title="Rotate" onClick={(e) => { e.stopPropagation(); onRotate(); }}
          className="rounded bg-white/90 px-1.5 text-xs shadow">↻</button>
        <button title="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="rounded bg-white/90 px-1.5 text-xs shadow">⧉</button>
        <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded bg-white/90 px-1.5 text-xs shadow">✕</button>
      </div>
    </div>
  );
}
