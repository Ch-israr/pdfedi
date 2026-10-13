'use client';

import { useState } from 'react';
import { useEditor } from '@/store/editor';

/**
 * History panel: shows editing history with timestamps, allows
 * multi-select and bulk revert (selective undo) of actions.
 *
 * Bulk revert selectively undoes each chosen command (newest first) and
 * removes it from the undo stack. The underlying undo/redo records are
 * preserved for non-selected commands.
 */
export function HistoryPanel() {
  const historyLog = useEditor((s) => s.historyLog);
  const [isOpen, setIsOpen] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);

  const toggleSelect = (recordId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(historyLog.map((r) => r.id)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const revertOne = async (recordId: string): Promise<boolean> => {
    const state = useEditor.getState();
    const record = state.historyLog.find((r) => r.id === recordId);
    if (!record) return false;
    // Find command by stable ID (not index, which shifts after splices)
    const cmdIdx = state.past.findIndex((c) => c.id === record.commandId);
    if (cmdIdx === -1) return false;
    const cmd = state.past[cmdIdx];
    await cmd.undo();
    useEditor.setState((s) => {
      // Remove the command from past[] by ID
      const idx = s.past.findIndex((c) => c.id === record.commandId);
      if (idx !== -1) s.past.splice(idx, 1);
      s.future.unshift(cmd);
      // Remove the log record
      const logIdx = s.historyLog.findIndex((r) => r.id === recordId);
      if (logIdx !== -1) s.historyLog.splice(logIdx, 1);
    });
    return true;
  };

  const revertSelected = async (recordId: string) => {
    setReverting(recordId);
    try {
      await revertOne(recordId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(recordId);
        return next;
      });
    } finally {
      setReverting(null);
    }
  };

  const bulkRevert = async () => {
    if (selected.size === 0) return;
    setReverting('bulk');
    try {
      // Process newest first (by timestamp desc) so undo order is sensible
      const ids = [...historyLog]
        .filter((r) => selected.has(r.id))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((r) => r.id);
      for (const id of ids) {
        await revertOne(id);
      }
      setSelected(new Set());
      setConfirmingBulk(false);
    } finally {
      setReverting(null);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Show editing history"
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
      >
        <span aria-hidden>🕘</span>
        <span className="hidden xl:inline">History</span>
        {historyLog.length > 0 && (
          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] tabular-nums">
            {historyLog.length}
          </span>
        )}
      </button>
    );
  }

  const allSelected = historyLog.length > 0 && selected.size === historyLog.length;
  const someSelected = selected.size > 0 && selected.size < historyLog.length;

  return (
    <div className="absolute right-4 top-16 z-40 w-80 max-h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Editing History</h3>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setSelected(new Set());
            setConfirmingBulk(false);
          }}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Close history"
        >
          ✕
        </button>
      </div>

      {historyLog.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={() => (allSelected ? deselectAll() : selectAll())}
              className="h-4 w-4 rounded border-slate-300"
              aria-label={allSelected ? 'Deselect all' : 'Select all'}
            />
            {allSelected ? 'Deselect all' : 'Select all'}
          </label>
          <span className="text-xs tabular-nums text-slate-500" aria-live="polite">
            {selected.size > 0 ? `${selected.size} selected` : `${historyLog.length} entries`}
          </span>
          {selected.size > 0 &&
            (confirmingBulk ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={bulkRevert}
                  disabled={reverting !== null}
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {reverting === 'bulk' ? '...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingBulk(false)}
                  disabled={reverting !== null}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingBulk(true)}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Revert {selected.size} selected
              </button>
            ))}
        </div>
      )}

      <div className="max-h-[55vh] overflow-y-auto p-2">
        {historyLog.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-slate-500">
            No edits yet. Your changes will appear here.
          </p>
        ) : (
          <div className="space-y-1">
            {[...historyLog].reverse().map((record) => {
              const isSel = selected.has(record.id);
              return (
                <div
                  key={record.id}
                  className={`group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 ${
                    isSel ? 'bg-brand-50/60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(record.id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                    aria-label={`Select "${record.label}"`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {record.label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
                      {record.pageNumber && <span>Page {record.pageNumber}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => revertSelected(record.id)}
                    disabled={reverting !== null}
                    title="Revert this action"
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-600 opacity-0 transition-opacity hover:bg-brand-50 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {reverting === record.id ? '...' : 'Revert'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
