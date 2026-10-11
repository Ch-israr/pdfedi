'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor, type ToolId } from '@/store/editor';
import { SHAPE_TOOLS } from '@/lib/shape-tools';
import { ToolIcon } from './ToolIcon';

const SHAPE_IDS = new Set<ToolId>(SHAPE_TOOLS.map((t) => t.id));

/**
 * One compact Shapes button replacing the four separate shape toolbar
 * buttons. Opens a menu listing every supported shape; selecting one
 * activates its existing drawing workflow and closes the menu.
 */
export function ShapesDropdown() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeShape = SHAPE_IDS.has(tool)
    ? SHAPE_TOOLS.find((t) => t.id === tool)!
    : null;
  // Button shows the active shape, or the generic Shapes entry otherwise.
  const buttonTool: ToolId = activeShape ? activeShape.id : 'shape-rect';
  const buttonLabel = activeShape ? activeShape.label : 'Shapes';

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open ]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Shapes"
        aria-label="Shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
          activeShape
            ? 'bg-brand-500 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
        }`}
      >
        <ToolIcon id={buttonTool} />
        <span aria-hidden>{buttonLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-outside layer (also covers touch) */}
          <button
            type="button"
            aria-label="Close shapes menu"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label="Shapes"
            className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          >
            {SHAPE_TOOLS.map((t) => {
              const selected = tool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setTool(t.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className={selected ? 'text-brand-600' : 'text-slate-500'}>
                    <ToolIcon id={t.id} />
                  </span>
                  <span className="flex-1">{t.label}</span>
                  {t.shortcut && (
                    <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      {t.shortcut}
                    </kbd>
                  )}
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-brand-600">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
