'use client';

import { useState } from 'react';
import { useEditor, type ToolId } from '@/store/editor';
import { HistoryPanel } from './HistoryPanel';
import { FindReplaceDialog } from './FindReplaceDialog';
import { RedactConfirmDialog } from './RedactConfirmDialog';
import { DownloadDialog } from './DownloadDialog';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import { ToolIcon } from './ToolIcon';
import { ShapesDropdown } from './ShapesDropdown';
import { AnnotateDropdown } from './AnnotateDropdown';
import { FormsDropdown } from './FormsDropdown';

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

// Tools inside the grouped pill, in reference order. Forms fields live in
// the separate Forms dropdown below.
const PILL_TOOLS: { id: ToolId; label: string; shortcut?: string }[] = [
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'image', label: 'Image' },
  { id: 'signature', label: 'Sign' },
  { id: 'whiteout', label: 'Whiteout', shortcut: 'W' },
  { id: 'link', label: 'Link', shortcut: 'L' },
  { id: 'redact', label: 'Redact', shortcut: 'R' },
];

function PillToolButton({
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
      className={`flex h-9 items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors first:rounded-l-[10px] focus-visible:outline-2 focus-visible:outline-brand-500 ${
        active
          ? 'bg-brand-500 text-white shadow-sm'
          : 'text-slate-600 hover:bg-sky-50 hover:text-sky-800'
      }`}
    >
      <ToolIcon id={id} />
      <span aria-hidden>{label}</span>
    </button>
  );
}

function PillDivider() {
  return <div className="h-6 w-px shrink-0 bg-sky-100" aria-hidden />;
}

export function Toolbar() {
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showRedactConfirm, setShowRedactConfirm] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const redactCount = useEditor((s) => Object.values(s.elements).filter((e) => e.kind === 'redact').length);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const downloading = useEditor((s) => s.downloading);
  const downloadError = useEditor((s) => s.downloadError);
  const closeDocument = useEditor((s) => s.closeDocument);
  const fileName = useEditor((s) => s.fileName);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);

  return (
    <header className="pdfeditor-toolbar sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
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

      {/* Grouped tool pill (reference style): pointer tools, content tools,
          annotate/shapes dropdowns, and undo/redo in one outlined bar. */}
      <div
        className="flex flex-wrap items-center"
        role="toolbar"
        aria-label="Annotation tools"
      >
        <div className="flex items-center overflow-visible rounded-xl border border-sky-200 bg-white shadow-sm">
          <PillToolButton id="select" label="Select" shortcut="V" active={tool === 'select'} onSelect={setTool} />
          <PillToolButton id="move" label="Move" shortcut="M" active={tool === 'move'} onSelect={setTool} />
          <PillDivider />
          {PILL_TOOLS.map((t) => (
            <PillToolButton
              key={t.id}
              id={t.id}
              label={t.label}
              shortcut={t.shortcut}
              active={tool === t.id}
              onSelect={setTool}
            />
          ))}
          <PillDivider />
          <AnnotateDropdown inPill />
          <ShapesDropdown inPill />
          <FormsDropdown inPill />
          <PillDivider />
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            onClick={undo}
            disabled={past.length === 0}
            className="flex h-9 items-center justify-center gap-1.5 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <span aria-hidden className="text-sm">↩</span>
            <span aria-hidden>Undo</span>
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            onClick={redo}
            disabled={future.length === 0}
            className="flex h-9 w-9 items-center justify-center rounded-r-[10px] text-base text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <span aria-hidden>↪</span>
          </button>
        </div>
      </div>

      <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />

      {/* Find & replace + history log */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Search and history">
        <button
          type="button"
          title="Find & Replace (Ctrl+F)"
          aria-label="Find & Replace"
          onClick={() => setShowFindReplace(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-600 transition-colors hover:bg-slate-200/70"
        >
          <span aria-hidden>🔍</span>
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
          onClick={() => {
            if (redactCount > 0) setShowRedactConfirm(true);
            else setShowDownloadDialog(true);
          }}
          disabled={downloading}
          title={downloading ? 'Your PDF is being prepared. Please wait...' : 'Download PDF'}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? (
            <>
              <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Preparing...
            </>
          ) : (
            <>
              <span aria-hidden>⬇</span> Download
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            // Only prompt when there are unsaved changes; otherwise close
            // immediately with no annoyance.
            const hasChanges = useEditor.getState().past.length > 0;
            if (hasChanges) setShowCloseConfirm(true);
            else closeDocument();
          }}
          title="Close document"
          className="flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
        >
          Close
        </button>
      </div>
      {showFindReplace && <FindReplaceDialog onClose={() => setShowFindReplace(false)} />}
      {showRedactConfirm && (
        <RedactConfirmDialog
          count={redactCount}
          onCancel={() => setShowRedactConfirm(false)}
          onConfirm={() => {
            setShowRedactConfirm(false);
            setShowDownloadDialog(true);
          }}
        />
      )}
      {showDownloadDialog && (
        <DownloadDialog onClose={() => setShowDownloadDialog(false)} />
      )}
      {showCloseConfirm && (
        <CloseConfirmDialog
          onCancel={() => setShowCloseConfirm(false)}
          onDiscard={() => {
            setShowCloseConfirm(false);
            closeDocument();
          }}
          onSaveDownload={() => {
            setShowCloseConfirm(false);
            setShowDownloadDialog(true);
          }}
        />
      )}
    </header>
  );
}
