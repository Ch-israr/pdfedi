/**
 * Find & Replace dialog for native PDF text.
 * Searches extracted native text (no OCR) across all pages.
 * Replacements rewrite the text directly in the page content stream
 * (no masks); matches whose run cannot be rewritten are skipped with
 * an explanation, never silently masked.
 */
'use client';

import { useState } from 'react';
import { useEditor } from '../store/editor';

export function FindReplaceDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const findTextMatches = useEditor((s) => s.findTextMatches);
  const replaceTextMatch = useEditor((s) => s.replaceTextMatch);
  const setActivePage = useEditor((s) => s.setActivePage);

  const matches = query ? findTextMatches(query, caseSensitive) : [];

  const handleReplace = async () => {
    if (matches.length === 0) {
      setMessage('No matches found.');
      return;
    }
    setBusy(true);
    try {
      const match = matches[currentIndex % matches.length];
      const result = await replaceTextMatch(match.pageId, match.item, query, replacement, caseSensitive);
      if (result === 'skipped') {
        setMessage('Skipped: this text cannot be edited directly in the document.');
      } else if (result) {
        setMessage(`Replaced on page ${match.pageNumber}.`);
        setActivePage(match.pageId);
      } else {
        setMessage('Replacement did not change the text.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceAll = async () => {
    if (matches.length === 0) {
      setMessage('No matches found.');
      return;
    }
    setBusy(true);
    try {
      let count = 0;
      let skipped = 0;
      for (const match of matches) {
        const result = await replaceTextMatch(match.pageId, match.item, query, replacement, caseSensitive);
        if (result === 'skipped') skipped++;
        else if (result) count++;
      }
      setMessage(
        `Replaced ${count} of ${matches.length} matches.` +
          (skipped > 0 ? ` ${skipped} could not be edited directly and were skipped.` : ''),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleNext = () => {
    if (matches.length === 0) return;
    const next = (currentIndex + 1) % matches.length;
    setCurrentIndex(next);
    const match = matches[next];
    setActivePage(match.pageId);
    setMessage(`Match ${next + 1} of ${matches.length} (page ${match.pageNumber}).`);
  };

  const handlePrev = () => {
    if (matches.length === 0) return;
    const prev = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prev);
    const match = matches[prev];
    setActivePage(match.pageId);
    setMessage(`Match ${prev + 1} of ${matches.length} (page ${match.pageNumber}).`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Find & Replace</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Find</label>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCurrentIndex(0);
                setMessage('');
              }}
              placeholder="Search native PDF text…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Replace with</label>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replacement text…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="rounded"
            />
            Case sensitive
          </label>

          {query && (
            <div className="text-sm text-slate-600">
              {matches.length === 0 ? (
                <span className="text-amber-600">No matches found.</span>
              ) : (
                <span>
                  {matches.length} match{matches.length === 1 ? '' : 'es'} found.
                  <span className="ml-2 text-xs text-slate-500">
                    Only natively extracted text is searchable (scanned images are not).
                  </span>
                </span>
              )}
            </div>
          )}

          {message && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={matches.length === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={matches.length === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
            >
              Next →
            </button>
            <button
              type="button"
              onClick={handleReplace}
              disabled={matches.length === 0 || !replacement || busy}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={matches.length === 0 || !replacement || busy}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Replace All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
