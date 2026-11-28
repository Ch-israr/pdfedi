// Sign PDF — placement canvas.
//
// Flow: pick one PDF → draw (pointer) or type a signature onto a pad →
// pick a page from the thumbnail grid → click the large preview to place
// the signature (drag to move, slider for width) → choose the pages →
// Sign. The signature PNG (data URL) travels in the job config; the
// server composites it onto the chosen pages. The signature is a visible
// image, NOT a cryptographic signature — the canvas says so plainly.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rangesToPages } from "../../../lib/canvas/payloads";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, translatePayloadError, type ToolCanvasProps } from "./common";

const PAD_W = 600;
const PAD_H = 200;

export function SignCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
  const locale = useLocale();
  const t = useTranslations("canvas");
  const tTools = useTranslations("tools");
  const tContent = useTranslations("toolContent");
  const tErr = useTranslations("errors");
  const pdf = pdfs[0];
  const pageCount = pdf?.pageCount ?? 0;

  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [hasSig, setHasSig] = useState(false);
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [place, setPlace] = useState({ x: 0.6, y: 0.8 });
  const [widthFrac, setWidthFrac] = useState(0.25);
  const [pagesText, setPagesText] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const padRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Large preview of the selected page.
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

  // Keep the pages field in sync when the user picks another page — but
  // only when it still holds a single page number, never when the user
  // typed a custom range like "1-3,5".
  useEffect(() => {
    setPagesText((cur) => (/^\d+$/.test(cur.trim()) ? String(page) : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function refreshSigUrl() {
    const pad = padRef.current;
    if (!pad) return;
    setSigUrl(pad.toDataURL("image/png"));
  }

  function padPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * PAD_W,
      y: ((e.clientY - rect.top) / rect.height) * PAD_H,
    };
  }

  function onPadDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = padPos(e);
  }
  function onPadMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || mode !== "draw") return;
    const pad = padRef.current;
    if (!pad) return;
    const ctx = pad.getContext("2d");
    if (!ctx || !last.current) return;
    const p = padPos(e);
    ctx.strokeStyle = "#1e40af";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasSig(true);
  }
  function onPadUp() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    refreshSigUrl();
  }

  function clearPad() {
    const pad = padRef.current;
    if (!pad) return;
    pad.getContext("2d")?.clearRect(0, 0, PAD_W, PAD_H);
    setHasSig(false);
    setSigUrl(null);
  }

  function applyTyped() {
    const pad = padRef.current;
    if (!pad || !typed.trim()) return;
    const ctx = pad.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.fillStyle = "#1e40af";
    ctx.font = `italic 72px 'Brush Script MT', 'Segoe Script', cursive`;
    ctx.textBaseline = "middle";
    ctx.fillText(typed.trim(), 20, PAD_H / 2, PAD_W - 40);
    setHasSig(true);
    refreshSigUrl();
  }

  function previewPos(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }
  function onPreviewClick(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging) return;
    setPlace(previewPos(e));
  }
  function onSigDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onSigMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setPlace(previewPos(e));
  }
  function onSigUp() {
    setDragging(false);
  }

  const payload = useMemo(() => {
    try {
      if (!hasSig || !sigUrl) return { config: {}, error: t("sign.noSignature") };
      const pages = pagesText.trim() === "" ? null : rangesToPages(pagesText);
      if (pages && pages.some((p) => p > pageCount)) {
        return { config: {}, error: t("sign.invalidPages") };
      }
      return {
        config: {
          signature_png: sigUrl,
          pages: pagesText.trim() === "" ? null : pagesText.trim(),
          x: Math.round(place.x * 1000) / 1000,
          y: Math.round(place.y * 1000) / 1000,
          width_frac: widthFrac,
        },
        error: null as string | null,
      };
    } catch (e) {
      return { config: {}, error: translatePayloadError(e, tErr) };
    }
  }, [hasSig, sigUrl, pagesText, pageCount, place, widthFrac, t, tErr]);

  const pos = {
    x: Math.round(place.x * 100),
    y: Math.round(place.y * 100),
    w: Math.round(widthFrac * 100),
  };
  const pagesLabel =
    pagesText.trim() === ""
      ? t("sign.summaryAll", pos)
      : t("sign.summary", { pages: pagesText.trim(), ...pos });
  const summary = hasSig ? pagesLabel : t("sign.summaryEmpty");

  const cells: GridCell[] = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, i) => ({
        id: `0:${i + 1}`,
        label: t("pageLabel", { n: i + 1 }),
      })),
    [pageCount, t],
  );

  return (
    <CanvasShell
      toolName={tTools("sign_pdf.name")}
      description={tContent("sign_pdf.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "sign_pdf", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error}
      processLabel={t("sign.processLabel")}
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("sign.activity")}
      error={job.error}
      transientNotice={job.transientNotice}
      queueWaitMs={job.queueWaitMs}
      jobStatus={job.job?.status ?? null}
    >
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: signature pad + placement controls */}
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <ToolButton onClick={() => setMode("draw")} disabled={mode === "draw"}>
              {t("sign.modeDraw")}
            </ToolButton>
            <ToolButton onClick={() => setMode("type")} disabled={mode === "type"}>
              {t("sign.modeType")}
            </ToolButton>
            <ToolButton onClick={clearPad} disabled={!hasSig}>
              {t("sign.clearPad")}
            </ToolButton>
          </div>
          {mode === "type" && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("sign.typePlaceholder")}
                aria-label={t("sign.typePlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
              />
              <ToolButton onClick={applyTyped} disabled={!typed.trim()}>
                {t("sign.typeApply")}
              </ToolButton>
            </div>
          )}
          <canvas
            ref={padRef}
            width={PAD_W}
            height={PAD_H}
            aria-label={t("sign.padLabel")}
            className="w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"
            style={{ cursor: mode === "draw" ? "crosshair" : "default" }}
            onPointerDown={onPadDown}
            onPointerMove={onPadMove}
            onPointerUp={onPadUp}
            onPointerLeave={onPadUp}
          />
          <p className="mt-2 text-xs text-slate-500">{t("sign.padHint")}</p>
          <p className="mt-1 text-xs text-amber-700">{t("sign.notDigital")}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              {t("sign.widthLabel")}
              <input
                type="range"
                min={0.1}
                max={0.5}
                step={0.05}
                value={widthFrac}
                onChange={(e) => setWidthFrac(Number(e.target.value))}
                aria-label={t("sign.widthLabel")}
              />
              <span className="font-mono">{Math.round(widthFrac * 100)}%</span>
            </label>
            <label className="flex items-center gap-2">
              {t("sign.pagesLabel")}
              <input
                type="text"
                value={pagesText}
                onChange={(e) => setPagesText(e.target.value)}
                placeholder={t("sign.pagesPlaceholder")}
                aria-label={t("sign.pagesLabel")}
                className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <ToolButton onClick={() => setPagesText("")}>{t("sign.pagesAll")}</ToolButton>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t("sign.clickToPlace")}</p>
        </div>

        {/* Right: page picker + large preview with placement overlay */}
        <div>
          <ThumbnailGrid
            items={cells}
            loadThumb={(cell) => {
              const pg = Number(cell.id.split(":")[1]);
              return pdf ? pdf.renderThumb(pg, 180) : Promise.resolve(null);
            }}
            selected={[`0:${page}`]}
            onSelect={(id) => setPage(Number(id.split(":")[1]))}
            ariaLabel={t("sign.selectPageHint")}
          />
          <div
            ref={previewRef}
            className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white"
            onPointerDown={onPreviewClick}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={t("sign.previewLabel", { n: page })} className="block w-full" draggable={false} />
            ) : (
              <p className="py-16 text-center text-slate-400">{t("previewRendering")}</p>
            )}
            {hasSig && sigUrl && preview && (
              <div
                className="absolute cursor-move"
                style={{
                  left: `${place.x * 100}%`,
                  top: `${place.y * 100}%`,
                  width: `${widthFrac * 100}%`,
                }}
                onPointerDown={onSigDown}
                onPointerMove={onSigMove}
                onPointerUp={onSigUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigUrl} alt="" className="block w-full" draggable={false} />
              </div>
            )}
          </div>
        </div>
      </div>
    </CanvasShell>
  );
}
