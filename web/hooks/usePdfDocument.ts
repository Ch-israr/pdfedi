// Loads local PDF files into pdf.js documents and renders their pages.
//
// One hook instance owns one file's document: page count, page sizes
// (PDF points), thumbnail rendering through the shared LRU cache, and
// cleanup (pdf.js document destroy on unmount / file change).
//
// Rendering is lazy and client-side only: no upload, no job, no quota
// is consumed by previewing a document.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadPdfFile, type LoadedPdf } from "../lib/canvas/loadPdf";

export type { LoadedPdf };

export type PdfLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; pdf: LoadedPdf }
  | { status: "error"; message: string };

/** Load one File into a pdf.js document. Returns load state + a reset. */
export function usePdfDocument(file: File | null): {
  state: PdfLoadState;
  reload: () => void;
} {
  const tErr = useTranslations("errors");
  const [state, setState] = useState<PdfLoadState>({ status: "idle" });
  const pdfRef = useRef<LoadedPdf | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async (f: File) => {
    cancelledRef.current = false;
    setState({ status: "loading" });
    try {
      const pdf = await loadPdfFile(f);
      if (cancelledRef.current) {
        await pdf.destroy();
        return;
      }
      pdfRef.current = pdf;
      setState({ status: "ready", pdf });
    } catch (e) {
      if (!cancelledRef.current) {
        // Log the stack: a failed load is otherwise a bare message.
        console.error("[usePdfDocument] load failed:", e instanceof Error ? e.stack : e);
        // pdf.js error text is English library detail; show the
        // translated generic message instead (the original stays in
        // the console log above for debugging).
        setState({ status: "error", message: tErr("pdf_unreadable") });
      }
    }
  }, [tErr]);

  useEffect(() => {
    if (!file) {
      setState({ status: "idle" });
      return;
    }
    load(file);
    return () => {
      cancelledRef.current = true;
      const pdf = pdfRef.current;
      pdfRef.current = null;
      if (pdf) void pdf.destroy();
    };
  }, [file, load]);

  const reload = useCallback(() => {
    if (file) load(file);
  }, [file, load]);

  return { state, reload };
}

export type PdfFilesState =
  | { status: "idle" }
  | { status: "loading"; pdfs: LoadedPdf[] }
  | { status: "ready"; pdfs: LoadedPdf[] }
  | { status: "error"; message: string };

/** Load several Files into pdf.js documents, in order.
 *
 * Incremental: adding a file loads ONLY the new file(s) and keeps the
 * already-loaded documents (and their ready state) in place. The old
 * behaviour reloaded the whole set on every change, which left a
 * window where `pdfs` was [] while the canvas still held items for
 * the previous files — MergeCanvas then crashed reading
 * `pdfs[fi].fileName` of an undefined entry. Documents for files that
 * disappear are destroyed; everything is destroyed on unmount.
 */
export function usePdfFiles(files: File[]): { state: PdfFilesState } {
  const tErr = useTranslations("errors");
  const [state, setState] = useState<PdfFilesState>({ status: "idle" });
  // Loaded docs keyed by file identity; the ref (not state) owns them
  // so a re-render never drops a document mid-load.
  const loadedRef = useRef<Map<string, LoadedPdf>>(new Map());
  const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
  const key = files.map(keyOf).join("|");

  // Destroy every loaded document on unmount.
  useEffect(
    () => () => {
      const loaded = [...loadedRef.current.values()];
      loadedRef.current.clear();
      void Promise.all(loaded.map((p) => p.destroy()));
    },
    [],
  );

  useEffect(() => {
    if (files.length === 0) {
      const loaded = [...loadedRef.current.values()];
      loadedRef.current.clear();
      void Promise.all(loaded.map((p) => p.destroy()));
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    const wanted = files.map(keyOf);
    // Drop documents for files no longer present.
    for (const [k, pdf] of [...loadedRef.current.entries()]) {
      if (!wanted.includes(k)) {
        loadedRef.current.delete(k);
        void pdf.destroy();
      }
    }
    const missing = files.filter((f) => !loadedRef.current.has(keyOf(f)));
    if (missing.length === 0) {
      // Nothing new: report the current set as ready without a
      // loading flash or a transient empty list for the canvas.
      const ordered = files.map((f) => loadedRef.current.get(keyOf(f))!);
      setState({ status: "ready", pdfs: ordered });
      return;
    }
    // Keep previously loaded docs visible while the new files load:
    // "loading" carries them, so the canvas never sees an empty list
    // mid-add — and the OrganizerTool promotion effect still fires on
    // the loading -> ready transition. Only flip to bare "loading"
    // when nothing is ready yet.
    const prevOrdered = files
      .filter((f) => loadedRef.current.has(keyOf(f)))
      .map((f) => loadedRef.current.get(keyOf(f))!);
    setState({ status: "loading", pdfs: prevOrdered });
    (async () => {
      try {
        const fresh = await Promise.all(missing.map((f) => loadPdfFile(f)));
        if (cancelled) {
          await Promise.all(fresh.map((p) => p.destroy()));
          return;
        }
        missing.forEach((f, i) => loadedRef.current.set(keyOf(f), fresh[i]));
        const ordered = files.map((f) => loadedRef.current.get(keyOf(f))!);
        setState({ status: "ready", pdfs: ordered });
      } catch (e) {
        if (!cancelled) {
          console.error("[usePdfFiles] load failed:", e instanceof Error ? e.stack : e);
          setState({ status: "error", message: tErr("pdf_unreadable_one") });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state };
}
