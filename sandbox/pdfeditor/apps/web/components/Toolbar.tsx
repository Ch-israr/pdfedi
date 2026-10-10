'use client';

import { useEditor, type ToolId } from '@/store/editor';
import { HistoryPanel } from './HistoryPanel';
import { ToolIcon } from './ToolIcon';

function SaveStatus() {
  const saveStatus = useEditor((s) => s.saveStatus);
  if (saveStatus === 'idle') return null;
  const config = {
    saved: { icon: '✓', text: 'Saved', cls: 'text-green-600' },
    saving: { icon: '…', text: 'Saving…', cls: 'text-slate-500' },
    error: { icon: '⚠', text: 'Save failed', cls: 'text-red-600' },
    idle: { icon: '', text: '', cls: '' },
  }[saveStatus];
  return (
    <span className={`flex items-center gap-1 px-2 text-xs font-medium ${config.cls}`} title="Local autosave status">
      <span aria-hidden>{config.icon}</span>
      <span className="hidden xl:inline">{config.text}</span>
    </span>
  );
}

const TOOL_GROUPS: { id: ToolId; label: string; shortcut?: string }[][] = [
  // Selection
  [{ id: 'select', label: 'Select', shortcut: 'V' }],
  // Annotate
  [
    { id: 'text', label: 'Text', shortcut: 'T' },
    { id: 'image', label: 'Image' },
    { id: 'highlight', label: 'Highlight', shortcut: 'H' },
    { id: 'signature', label: 'Signature' },
  ],
  // Shapes
  [
    { id: 'shape-rect', label: 'Rectangle', shortcut: 'R' },
    { id: 'shape-ellipse', label: 'Ellipse' },
    { id: 'shape-line', label: 'Line', shortcut: 'L' },
    { id: 'shape-arrow', label: 'Arrow', shortcut: 'A' },
  ],
];

function ToolButton({
  id,
  label,
  shortcut,
  active,
  onSelect,
}: {
  id: ToolId;
  label: string;
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
      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
        active
          ? 'bg-brand-500 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
      }`}
    >
      <ToolIcon id={id} />
      <span aria-hidden>{label}</span>
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
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);

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

      {/* Smart guides / snap toggle */}
      <button
        type="button"
        title={snapEnabled ? 'Snap to guides: on (hold Alt to bypass)' : 'Snap to guides: off'}
        aria-label="Toggle snap to alignment guides"
        aria-pressed={snapEnabled}
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
          snapEnabled
            ? 'bg-brand-50 text-brand-600 ring-1 ring-brand-500'
            : 'text-slate-500 hover:bg-slate-100'
        }`}
      >
        <span aria-hidden>🧲</span>
        <span className="hidden xl:inline">Snap</span>
      </button>

      {/* History panel */}
      <HistoryPanel />

      {/* Save status */}
      <SaveStatus />

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
