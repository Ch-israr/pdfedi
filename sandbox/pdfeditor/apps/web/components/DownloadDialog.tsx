'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';

/**
 * Download dialog: shows a rendered preview of the first page (with all
 * edits baked in), a filename field, and Download/Cancel. The export is
 * done once; the chosen filename is used for the actual download.
 */
export function DownloadDialog({ onClose }: { onClose: () => void }) {
  const exportBytes = useEditor((s) => s.exportBytes);
  const fileName = useEditor((s) => s.fileName);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState(() => {
    const base = (fileName ?? 'document.pdf').replace(/\.pdf$/i, '');
    return `${base}-edited.pdf`;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ destroy?: () => void } | null>(null);

  // Export once — the bytes back both the preview and the download.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = await exportBytes();
        if (!cancelled) setBytes(b);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(
            e instanceof Error ? e.message : 'Failed to prepare the PDF.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exportBytes]);

  // Render the first page of the exported bytes as the preview.
  useEffect(() => {
    if (!bytes) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadPdfDocument, renderPageToCanvas } = await import('@/lib/pdfjs');
        const loaded = await loadPdfDocument(bytes);
        if (cancelled) {
          loaded.doc.destroy();
          return;
        }
        docRef.current = loaded.doc as unknown as { destroy?: () => void };
        // Fit preview to ~320px wide
        const first = loaded.pages[0];
        const scale = first ? Math.min(1.5, 320 / first.width) : 1;
        await renderPageToCanvas(
          loaded.doc,
          first?.sourceIndex ?? 1,
          canvas,
          scale,
          first?.rotation ?? 0,
        );
      } catch (e) {
        if (!cancelled) {
          setPreviewError(
            e instanceof Error ? e.message : 'Failed to render preview.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        docRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      docRef.current = null;
    };
  }, [bytes]);

  const handleDownload = () => {
    if (!bytes) return;
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/pdf',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    let dlName = name.trim() || 'document.pdf';
    if (!dlName.toLowerCase().endsWith('.pdf')) dlName += '.pdf';
    // Strip path separators for safety
    dlName = dlName.replace(/[\\/]/g, '_');
    a.download = dlName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="download-dialog-title"
          className="text-base font-semibold text-slate-900"
        >
          Download PDF
        </h2>

        {/* Preview */}
        <div className="mt-3 flex items-start justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3">
          {previewError ? (
            <p className="py-8 text-sm text-red-600">{previewError}</p>
          ) : (
            <canvas
              ref={canvasRef}
              className="max-h-[40vh] shadow-md"
              aria-label="Preview of the first page"
            />
          )}
          {!bytes && !previewError && (
            <p className="py-8 text-sm text-slate-500">Preparing preview…</p>
          )}
        </div>

        {/* Filename */}
        <label
          htmlFor="download-filename"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          Filename
        </label>
        <input
          id="download-filename"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && bytes) handleDownload();
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!bytes}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {bytes ? 'Download' : 'Preparing…'}
          </button>
        </div>
      </div>
    </div>
  );
}
