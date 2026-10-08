'use client';

import { useEditor, type ToolId } from '@/store/editor';

const TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '↖' },
  { id: 'text', label: 'Text', icon: 'T' },
  { id: 'image', label: 'Image', icon: '🖼' },
  { id: 'highlight', label: 'Highlight', icon: '🖍' },
  { id: 'signature', label: 'Signature', icon: '✍' },
  { id: 'shape-rect', label: 'Rectangle', icon: '▭' },
  { id: 'shape-ellipse', label: 'Ellipse', icon: '⬭' },
  { id: 'shape-line', label: 'Line', icon: '╱' },
  { id: 'shape-arrow', label: 'Arrow', icon: '→' },
];

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
    <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
      <div className="mr-2 min-w-0">
        <div className="truncate text-sm font-semibold" title={fileName ?? ''}>
          {fileName ?? 'Untitled'}
        </div>
        <div className="text-[11px] text-slate-500">🔒 in-memory only</div>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => setTool(t.id)}
            className={`rounded px-2.5 py-1.5 text-sm ${
              tool === t.id ? 'bg-white shadow text-brand-600' : 'text-slate-600 hover:bg-white/60'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          title="Undo (Ctrl+Z)"
          onClick={undo}
          disabled={past.length === 0}
          className="rounded px-2 py-1.5 text-sm disabled:opacity-40 hover:bg-slate-100"
        >
          ↩
        </button>
        <button
          title="Redo (Ctrl+Y)"
          onClick={redo}
          disabled={future.length === 0}
          className="rounded px-2 py-1.5 text-sm disabled:opacity-40 hover:bg-slate-100"
        >
          ↪
        </button>
      </div>

      <div className="flex items-center gap-1 text-sm">
        <button onClick={() => setZoom(zoom - 0.25)} className="rounded px-2 py-1 hover:bg-slate-100">
          −
        </button>
        <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom + 0.25)} className="rounded px-2 py-1 hover:bg-slate-100">
          +
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => void download()}
          className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          ⬇ Download
        </button>
        <button
          onClick={closeDocument}
          title="Close document (discards everything)"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    </header>
  );
}
