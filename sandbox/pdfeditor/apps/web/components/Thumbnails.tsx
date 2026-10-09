'use client';

import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { renderPageToCanvas } from '@/lib/pdfjs';

/**
 * Left sidebar: page thumbnails with rotate / duplicate / delete actions.
 * Thumbnails render lazily at low scale. Collapses on small screens.
 */
export function Thumbnails({ getDoc, docVersion }: { getDoc: () => never; docVersion: number }) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const rotatePage = useEditor((s) => s.rotatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const insertBlankPage = useEditor((s) => s.insertBlankPage);
  const reorderPage = useEditor((s) => s.reorderPage);

  return (
    <aside
      aria-label="Pages"
      className="thin-scroll hidden w-40 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50 p-2 sm:flex md:w-44"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pages
        </h2>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] tabular-nums text-slate-600">
          {pages.length}
        </span>
      </div>
      <button
        type="button"
        onClick={() => insertBlankPage()}
        title="Insert blank page after current page"
        className="mb-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        <span aria-hidden>+</span> Blank page
      </button>
      <div className="flex flex-col gap-2">
        {pages.map((page, i) => (
          <Thumbnail
            key={page.id}
            pageId={page.id}
            sourceIndex={page.sourceIndex}
            label={i + 1}
            active={page.id === activePageId}
            rotation={page.rotation}
            getDoc={getDoc}
            docVersion={docVersion}
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
            onMoveUp={() => reorderPage(page.id, i - 1)}
            onMoveDown={() => reorderPage(page.id, i + 1)}
          />
        ))}
      </div>
    </aside>
  );
}

function ThumbAction({
  title,
  label,
  onClick,
}: {
  title: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-900"
    >
      <span aria-hidden>{label}</span>
    </button>
  );
}

function Thumbnail({
  pageId,
  sourceIndex,
  label,
  active,
  rotation,
  getDoc,
  docVersion,
  onSelect,
  onRotate,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  pageId: string;
  sourceIndex: number;
  label: number;
  active: boolean;
  rotation: number;
  getDoc: () => never;
  docVersion: number;
  onSelect: () => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Blank inserted pages (sourceIndex 0) have no PDF source — leave canvas blank white
    if (sourceIndex === 0) return;
    let done = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (done || !entries[0]?.isIntersecting) return;
        done = true;
        const doc = getDoc();
        const canvas = canvasRef.current;
        if (doc && canvas) {
          void renderPageToCanvas(doc, sourceIndex, canvas, 0.25, rotation).catch(() => {});
        }
        obs.disconnect();
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [sourceIndex, rotation, getDoc, docVersion]);

  return (
    <div
      ref={wrapRef}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Go to page ${label}${active ? ' (current)' : ''}`}
      aria-current={active}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-white p-1.5 transition-all ${
        active
          ? 'border-brand-500 shadow-md'
          : 'border-transparent shadow-sm hover:border-slate-300 hover:shadow'
      }`}
    >
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md bg-slate-100">
        <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
      </div>
      <div
        className={`mt-1.5 text-center text-xs tabular-nums ${
          active ? 'font-semibold text-brand-600' : 'text-slate-500'
        }`}
      >
        {label}
      </div>
      <div className="absolute left-1.5 top-1.5 hidden flex-col gap-1 group-hover:flex group-focus-within:flex">
        <ThumbAction
          title="Move page up"
          label="↑"
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
        />
        <ThumbAction
          title="Move page down"
          label="↓"
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
        />
      </div>
      <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex group-focus-within:flex">
        <ThumbAction
          title="Rotate page 90°"
          label="↻"
          onClick={(e) => {
            e.stopPropagation();
            onRotate();
          }}
        />
        <ThumbAction
          title="Duplicate page"
          label="⧉"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
        />
        <ThumbAction
          title="Delete page"
          label="✕"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </div>
  );
}
