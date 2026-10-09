'use client';

import { useState } from 'react';
import { useEditor } from '@/store/editor';

/**
 * History panel: shows editing history with timestamps and allows
 * selective revert of individual actions.
 */
export function HistoryPanel() {
  const historyLog = useEditor((s) => s.historyLog);
  const [isOpen, setIsOpen] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

  const revertSelected = async (recordId: string) => {
    const record = historyLog.find((r) => r.id === recordId);
    if (!record) return;

    setReverting(recordId);
    try {
      // Find the command index and undo it selectively
      // For now, we undo the specific command by its index
      // This is a simplified version - full dependency tracking would be more complex
      const state = useEditor.getState();
      const cmd = state.past[record.commandIndex];
      if (cmd) {
        await cmd.undo();
        // Remove from past and add to future for redo capability
        useEditor.setState((s) => {
          s.past.splice(record.commandIndex, 1);
          s.future.unshift(cmd);
          // Mark the record as reverted
          const rec = s.historyLog.find((r) => r.id === recordId);
          if (rec) {
            (rec as any).reverted = true;
          }
        });
      }
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

  return (
    <div className="absolute right-4 top-16 z-40 w-80 max-h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Editing History</h3>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Close history"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-2">
        {historyLog.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-slate-500">
            No edits yet. Your changes will appear here.
          </p>
        ) : (
          <div className="space-y-1">
            {[...historyLog].reverse().map((record) => (
              <div
                key={record.id}
                className={`group flex items-start justify-between gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 ${
                  (record as any).reverted ? 'opacity-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {record.label}
                    {(record as any).reverted && (
                      <span className="ml-2 text-xs text-slate-500">(reverted)</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
                    {record.pageNumber && <span>Page {record.pageNumber}</span>}
                  </div>
                </div>
                {!(record as any).reverted && (
                  <button
                    type="button"
                    onClick={() => revertSelected(record.id)}
                    disabled={reverting === record.id}
                    title="Revert this action"
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-600 opacity-0 transition-opacity hover:bg-brand-50 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {reverting === record.id ? '...' : 'Revert'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
