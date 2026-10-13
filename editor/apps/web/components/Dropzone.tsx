'use client';

import { useCallback, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';

export function Dropzone() {
  const loadPdf = useEditor((s) => s.loadPdf);
  const loading = useEditor((s) => s.loading);
  const error = useEditor((s) => s.error);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) void loadPdf(f);
    },
    [loadPdf],
  );

  return (
    <div className="pdfeditor-dropzone flex min-h-full flex-1 items-center justify-center bg-slate-100 p-4 sm:p-8">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            PDF Editor
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600 sm:text-base">
            Private by design — your PDF is processed in your browser and never stored.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a PDF file"
          aria-busy={loading}
          onClick={() => !loading && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !loading) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all sm:p-14 ${
            dragOver
              ? 'scale-[1.01] border-brand-500 bg-brand-50 shadow-lg'
              : 'border-slate-300 bg-white shadow-sm hover:border-brand-400 hover:shadow-md'
          } ${loading ? 'pointer-events-none opacity-70' : ''}`}
        >
          <div className="text-5xl transition-transform group-hover:scale-110" aria-hidden>
            {loading ? '⏳' : '📄'}
          </div>
          <p className="mt-4 text-lg font-semibold text-slate-800">
            {loading ? 'Loading your PDF…' : 'Drop a PDF here or click to choose'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Up to 50 MB · PDF files only · stays in your browser
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            <span aria-hidden className="mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="mx-auto mt-8 grid max-w-lg grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {[
            { icon: '🔒', title: 'Private', text: 'Files never leave this tab' },
            { icon: '⚡', title: 'Fast', text: 'Everything runs locally' },
            { icon: '🗑', title: 'No trace', text: 'Close the tab, it\'s gone' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="text-xl" aria-hidden>{f.icon}</div>
              <div className="mt-1 text-xs font-semibold text-slate-700">{f.title}</div>
              <div className="text-xs text-slate-500">{f.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
