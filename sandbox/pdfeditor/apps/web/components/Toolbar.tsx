'use client';

import { useEditor, type ToolId } from '@/store/editor';

const TOOL_GROUPS: { id: ToolId; label: string; icon: string; shortcut?: string }[][] = [
  // Selection
  [{ id: 'select', label: 'Select / Move', icon: '↖', shortcut: 'V' }],
  // Annotate
  [
    { id: 'text', label: 'Text', icon: 'T', shortcut: 'T' },
    { id: 'image', label: 'Image', icon: '🖼' },
    { id: 'highlight', label: 'Highlight', icon: '🖍', shortcut: 'H' },
    { id: 'signature', label: 'Signature', icon: '✍' },
  ],
  // Shapes
  [
    { id: 'shape-rect', label: 'Rectangle', icon: '▭', shortcut: 'R' },
    { id: 'shape-ellipse', label: 'Ellipse', icon: '⬭' },
    { id: 'shape-line', label: 'Line', icon: '╱', shortcut: 'L' },
    { id: 'shape-arrow', label: 'Arrow', icon: '→', shortcut: 'A' },
  ],
];

function ToolButton({
  id,
  label,
  icon,
  shortcut,
  active,
  onSelect,
}: {
  id: ToolId;
  label: string;
  icon: string;
  shortcut?: string;
  active: boolean;
  onSelect: (id: ToolId) => void;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onSelect(id)}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors ${
        active
          ? 'bg-brand-500 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
      }`}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const download = useEditor((s) => s.download);
  const closeDocument = useEditor((s) => s.closeDocument);
  const fileName = useEditor((s) => s.fileName);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);

  return (
    <header className="pdfeditor-toolbar flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
      {/* Document identity */}
      <div className="mr-1 min-w-0 max-w-[180px] sm:max-w-[240px]">
        <div className="truncate text-sm font-semibold text-slate-800" title={fileName ?? ''}>
          {fileName ?? 'Untitled'}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <span aria-hidden>🔒</span> in-memory only
        </div>
      </div>

      <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />

      {/* Tool groups */}
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Annotation tools">
        {TOOL_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <div className="mx-1 h-6 w-px bg-slate-200" aria-hidden />}
            {group.map((t) => (
              <ToolButton
                key={t.id}
                id={t.id}
                label={t.label}
                icon={t.icon}
                shortcut={t.shortcut}
                active={tool === t.id}
                onSelect={setTool}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />

      {/* History */}
      <div className="flex items-center gap-0.5" role="group" aria-label="History">
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          onClick={undo}
          disabled={past.length === 0}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-600 transition-colors hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <span aria-hidden>↩</span>
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          onClick={redo}
          disabled={future.length === 0}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-600 transition-colors hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <span aria-hidden>↪</span>
        </button>
      </div>

      {/* Zoom */}
      <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 px-1" role="group" aria-label="Zoom">
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-base text-slate-600 hover:bg-slate-100"
        >
          −
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-slate-600" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-base text-slate-600 hover:bg-slate-100"
        >
          +
        </button>
      </div>

      {/* Primary actions */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => void download()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          <span aria-hidden>⬇</span> Download
        </button>
        <button
          type="button"
          onClick={closeDocument}
          title="Close document (discards everything)"
          className="flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
        >
          Close
        </button>
      </div>
    </header>
  );
}
