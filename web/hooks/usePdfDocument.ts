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
  | { status: "loading" }
  | { status: "ready"; pdfs: LoadedPdf[] }
  | { status: "error"; message: string };

/** Load several Files into pdf.js documents, in order. */
export function usePdfFiles(files: File[]): { state: PdfFilesState } {
  const tErr = useTranslations("errors");
  const [state, setState] = useState<PdfFilesState>({ status: "idle" });
  const pdfsRef = useRef<LoadedPdf[]>([]);
  const key = files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join("|");

  useEffect(() => {
    if (files.length === 0) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const loaded = await Promise.all(files.map((f) => loadPdfFile(f)));
        if (cancelled) {
          await Promise.all(loaded.map((p) => p.destroy()));
          return;
        }
        pdfsRef.current = loaded;
        setState({ status: "ready", pdfs: loaded });
      } catch (e) {
        if (!cancelled) {
          setState({ status: "error", message: tErr("pdf_unreadable_one") });
        }
      }
    })();
    return () => {
      cancelled = true;
      const loaded = pdfsRef.current;
      pdfsRef.current = [];
      void Promise.all(loaded.map((p) => p.destroy()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state };
}
