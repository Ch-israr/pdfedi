// Edit PDF — annotation canvas (the honest slice of editing).
//
// Click a page to drop a text note, or drag a whiteout rectangle over
// something to cover it. Annotations are drawn ON TOP of the page by the
// server — the original text is never reflowed or removed, and the canvas
// says so plainly. Up to 200 annotations per job (server cap).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, type ToolCanvasProps } from "./common";

interface Ann {
  page: number;
  kind: "text" | "whiteout";
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  size?: number;
}

export function EditCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
  const locale = useLocale();
  const t = useTranslations("canvas");
  const tTools = useTranslations("tools");
  const tContent = useTranslations("toolContent");
  const pdf = pdfs[0];
  const pageCount = pdf?.pageCount ?? 0;

  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"text" | "whiteout">("text");
  const [text, setText] = useState("");
  const [size, setSize] = useState(12);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewW, setPreviewW] = useState(0);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    setPreview(null);
    void pdf.renderPage(page, 1.2).then((url) => {
      if (alive) setPreview(url);
    });
    return () => {
      alive = false;
    };
  }, [pdf, page]);

  // Track the preview's displayed width so text annotations render at the
  // right size (font pt → px via the page's point width).
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewW(el.clientWidth));
    ro.observe(el);
    setPreviewW(el.clientWidth);
    return () => ro.disconnect();
  }, [preview]);

  function frac(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPreviewDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = frac(e);
    if (mode === "whiteout") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else {
      if (!text.trim()) {
        textInputRef.current?.focus();
        return;
      }
      setAnns((cur) => [...cur, { page, kind: "text", x: p.x, y: p.y, text: text.trim(), size }]);
    }
  }
  function onPreviewMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const p = frac(e);
    setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  }
  function onPreviewUp() {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w > 0.01 && h > 0.01) {
      setAnns((cur) => [...cur, { page, kind: "whiteout", x, y, w, h }]);
    }
    setDrag(null);
  }

  const pageAnns = anns.filter((a) => a.page === page);
  const pageWidthPt = pdf?.pageSizes[page - 1]?.width ?? 612;

  const payload = useMemo(() => {
    if (anns.length === 0) return { config: {}, error: t("edit.noAnnotations") };
    return { config: { annotations: JSON.stringify(anns) }, error: null as string | null };
  }, [anns, t]);

  const pagesTouched = new Set(anns.map((a) => a.page)).size;
  const summary =
    anns.length > 0
      ? t("edit.summary", { count: anns.length, pages: pagesTouched })
      : t("edit.summaryEmpty");

  const cells: GridCell[] = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, i) => ({
        id: `0:${i + 1}`,
        label: t("pageLabel", { n: i + 1 }),
      })),
    [pageCount, t],
  );

  function fontPx(a: Ann) {
    return Math.max(6, ((a.size ?? 12) * previewW) / pageWidthPt);
  }

  return (
    <CanvasShell
      toolName={tTools("edit_pdf.name")}
      description={tContent("edit_pdf.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "edit_pdf", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error}
      processLabel={t("edit.processLabel")}
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("edit.activity")}
      error={job.error}
      transientNotice={job.transientNotice}
      queueWaitMs={job.queueWaitMs}
      jobStatus={job.job?.status ?? null}
    >
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <ToolButton onClick={() => setMode("text")} disabled={mode === "text"}>
              {t("edit.modeText")}
            </ToolButton>
            <ToolButton onClick={() => setMode("whiteout")} disabled={mode === "whiteout"}>
              {t("edit.modeWhiteout")}
            </ToolButton>
            <ToolButton onClick={() => setAnns([])} disabled={anns.length === 0}>
              {t("edit.clearAll")}
            </ToolButton>
          </div>
          {mode === "text" && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                ref={textInputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("edit.textPlaceholder")}
                aria-label={t("edit.textPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
              />
              <label className="flex items-center gap-2 text-sm">
                {t("edit.sizeLabel")}
                <input
                  type="number"
                  min={6}
                  max={72}
                  value={size}
                  onChange={(e) => setSize(Math.min(72, Math.max(6, Number(e.target.value) || 12)))}
                  aria-label={t("edit.sizeLabel")}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1.5"
                />
              </label>
            </div>
          )}
          <p className="mb-2 text-xs text-slate-500">
            {mode === "text" ? t("edit.addTextHint") : t("edit.drawHint")}
          </p>
          <p className="mb-3 text-xs text-amber-700">{t("edit.notRealEdit")}</p>

          {anns.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold">{t("edit.annotationsLabel")}</p>
              <ul className="space-y-1 text-sm">
                {anns.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm">
                    <span className="min-w-0 truncate">
                      {t("edit.annotationItem", {
                        n: i + 1,
                        page: a.page,
                        kind: a.kind === "text" ? a.text ?? "" : t("edit.whiteoutLabel"),
                      })}
                    </span>
                    <button
                      onClick={() => setAnns((cur) => cur.filter((_, j) => j !== i))}
                      className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:border-red-500 hover:text-red-600"
                      aria-label={t("edit.deleteAnnotation", { n: i + 1 })}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <ThumbnailGrid
            items={cells}
            loadThumb={(cell) => {
              const pg = Number(cell.id.split(":")[1]);
              return pdf ? pdf.renderThumb(pg, 180) : Promise.resolve(null);
            }}
            selected={[`0:${page}`]}
            onSelect={(id) => setPage(Number(id.split(":")[1]))}
            ariaLabel={t("edit.selectPageHint")}
          />
          <div
            ref={previewRef}
            className="relative mt-3 touch-none overflow-hidden rounded-xl border border-slate-200 bg-white"
            style={{ cursor: mode === "whiteout" ? "crosshair" : "text" }}
            onPointerDown={onPreviewDown}
            onPointerMove={onPreviewMove}
            onPointerUp={onPreviewUp}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={t("edit.previewLabel", { n: page })} className="block w-full" draggable={false} />
            ) : (
              <p className="py-16 text-center text-slate-400">{t("previewRendering")}</p>
            )}
            {pageAnns.map((a, i) =>
              a.kind === "text" ? (
                <div
                  key={i}
                  className="pointer-events-none absolute whitespace-nowrap font-semibold text-black"
                  style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, fontSize: `${fontPx(a)}px`, lineHeight: 1.2 }}
                >
                  {a.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="pointer-events-none absolute border border-slate-400 bg-white"
                  style={{
                    left: `${a.x * 100}%`,
                    top: `${a.y * 100}%`,
                    width: `${(a.w ?? 0) * 100}%`,
                    height: `${(a.h ?? 0) * 100}%`,
                  }}
                />
              ),
            )}
            {drag && (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-brand-600 bg-brand-600/10"
                style={{
                  left: `${Math.min(drag.x0, drag.x1) * 100}%`,
                  top: `${Math.min(drag.y0, drag.y1) * 100}%`,
                  width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
                  height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </CanvasShell>
  );
}
