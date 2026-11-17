// Shared helpers for the organizer tool canvases.
"use client";

import { useEffect, useState } from "react";
import type { LoadedPdf } from "../../lib/canvas/loadPdf";
import type { GridCell } from "./ThumbnailGrid";

/**
 * Build a ThumbnailGrid loadThumb callback from the loaded documents.
 * Cell ids are `${fileIndex}:${page}` (see organizer.makeItem).
 */
export function thumbLoaderFor(
  pdfs: LoadedPdf[],
): (cell: GridCell) => Promise<string | null> {
  return async (cell) => {
    const [fi, pg] = cell.id.split(":").map(Number);
    const pdf = pdfs[fi];
    if (!pdf || Number.isNaN(pg)) return null;
    return pdf.renderThumb(pg, 180);
  };
}

/** Large-page preview modal (double-click a thumbnail). */
export function PagePreviewModal({
  pdf,
  page,
  label,
  onClose,
}: {
  pdf: LoadedPdf;
  page: number;
  label: string;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    void pdf.renderPage(page, 1.2).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [pdf, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] max-w-3xl overflow-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">{label}</p>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:border-brand-600 hover:text-brand-600"
          >
            Close ✕
          </button>
        </div>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="mx-auto block max-w-full" />
        ) : (
          <p className="py-16 text-center text-slate-400">Rendering…</p>
        )}
      </div>
    </div>
  );
}
