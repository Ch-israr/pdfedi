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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-slate-900">PDF Editor</h1>
          <p className="mt-2 text-sm text-slate-600">
            Private by design — your PDF is processed in your browser and never stored.
          </p>
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a PDF"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
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
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${
            dragOver
              ? 'border-brand-500 bg-brand-50'
              : 'border-slate-300 bg-white hover:border-brand-500'
          }`}
        >
          <div className="text-5xl">📄</div>
          <p className="mt-4 text-lg font-medium">
            {loading ? 'Loading…' : 'Drop a PDF here or click to choose'}
          </p>
          <p className="mt-1 text-sm text-slate-500">Up to 50 MB · stays in your browser</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">
          🔒 Files exist only in this tab&apos;s memory. Closing or refreshing discards everything.
        </p>
      </div>
    </div>
  );
}
