// Rotate Pages — Tier 2 page-organizer canvas.
//
// Centre: thumbnail grid; each thumbnail has rotate buttons and a
// rotation badge showing the cumulative angle (0/90/180/270°), and the
// thumbnail itself re-renders rotated in place (CSS transform for the
// preview; the real rotation is server-side). Top toolbar: rotate the
// selection left/right, rotate all, reset all. A pages text field +
// angle selector + Apply button is the keyboard-accessible equivalent
// of clicking thumbnails.
//
// The canvas sends per-page angles as config.rotations (JSON
// {page: angle}) — a new optional backend option. The existing
// angle+pages options are untouched and still work from the generic
// ToolRunner / API.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildRotatePayload,
  pagesToRanges,
  rangesToPages,
} from "../../../lib/canvas/payloads";
import { makeItem, type OrganizerItem } from "../../../lib/canvas/organizer";
import { useOrganizer } from "../../../hooks/useOrganizer";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { PagePreviewModal, thumbLoaderFor } from "../canvasUtils";
import { ToolButton, useUndoKeys, type ToolCanvasProps } from "./common";

export function RotateCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
  const pdf = pdfs[0];
  const initialItems = useMemo<OrganizerItem[]>(
    () =>
      pdf
        ? Array.from({ length: pdf.pageCount }, (_, i) => makeItem(0, pdf.fileName, i + 1))
        : [],
    [pdf],
  );
  const org = useOrganizer(initialItems);
  const { doc, dispatch } = org;
  useUndoKeys(org.undo, org.redo, org.canUndo, org.canRedo);

  // Files arrive after mount (local pdf.js load): append the pages.
  useEffect(() => {
    org.syncItems(initialItems);
  }, [initialItems, org.syncItems]);

  const [preview, setPreview] = useState<{ page: number } | null>(null);
  const [pagesText, setPagesText] = useState("");
  const [applyAngle, setApplyAngle] = useState("90");
  const [applyError, setApplyError] = useState<string | null>(null);
  const loadThumb = useMemo(() => thumbLoaderFor(pdfs), [pdfs]);

  const pageCount = pdf?.pageCount ?? 0;
  const rotated = doc.items.filter((it) => it.angle % 360 !== 0);

  const payload = useMemo(() => {
    try {
      const map = new Map(rotated.map((it) => [it.page, it.angle]));
      const built = buildRotatePayload(map);
      return { ...built, error: null as string | null };
    } catch (e) {
      return { config: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rotated]);

  const summary =
    rotated.length > 0
      ? `${rotated.length} page${rotated.length === 1 ? "" : "s"} rotated: ` +
        rotated.map((it) => `p.${it.page} → ${it.angle}°`).join(", ")
      : "Select pages, then rotate them — or rotate all pages at once.";

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it) => ({
        id: it.id,
        label: `Page ${it.page}`,
        angle: it.angle,
      })),
    [doc.items],
  );
  const allIds = doc.items.map((it) => it.id);

  function rotateSelected(step: number) {
    const ids = org.selected.length > 0 ? org.selected : allIds;
    dispatch({ type: "rotateItems", ids, step });
  }

  function applyToPages() {
    try {
      const pages = rangesToPages(pagesText);
      const outOfRange = pages.filter((p) => p > pageCount);
      if (outOfRange.length > 0) {
        throw new Error(`Page(s) ${outOfRange.join(", ")} exceed the document page count (${pageCount}).`);
      }
      if (pages.length === 0) throw new Error("Type page numbers first, e.g. '1-3,5'.");
      const ids = pages.map((p) => `0:${p}`);
      dispatch({ type: "setAngles", ids, angle: Number(applyAngle) });
      setApplyError(null);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <CanvasShell
      toolName={job.spec?.name ?? "Rotate Pages"}
      description={job.spec?.description ?? ""}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "rotate_pages", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error ?? applyError}
      processLabel="Rotate now"
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      activityLabel="Rotating"
      error={job.error}
    >
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ToolButton onClick={org.undo} disabled={!org.canUndo} title="Undo (Ctrl+Z)">↩ Undo</ToolButton>
          <ToolButton onClick={org.redo} disabled={!org.canRedo} title="Redo (Ctrl+Y)">↪ Redo</ToolButton>
          <ToolButton onClick={() => rotateSelected(-90)} title="Rotate selection 90° counter-clockwise">
            ⟲ 90°
          </ToolButton>
          <ToolButton onClick={() => rotateSelected(90)} title="Rotate selection 90° clockwise">
            90° ⟳
          </ToolButton>
          <ToolButton onClick={() => dispatch({ type: "rotateItems", ids: allIds, step: 90 })}>
            Rotate all 90°
          </ToolButton>
          <ToolButton onClick={() => dispatch({ type: "resetAngles" })} disabled={rotated.length === 0}>
            Reset all
          </ToolButton>
          <ToolButton onClick={() => org.selectAll(allIds)}>Select all</ToolButton>
          <ToolButton onClick={org.clearSelection} disabled={org.selected.length === 0}>Clear selection</ToolButton>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            Pages
            <input
              type="text"
              value={pagesText}
              onChange={(e) => setPagesText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyToPages();
              }}
              className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
              placeholder="1-3,5"
              aria-label="Pages to rotate"
            />
          </label>
          <label className="flex items-center gap-2">
            Angle
            <select
              value={applyAngle}
              onChange={(e) => setApplyAngle(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
              aria-label="Rotation angle"
            >
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
          </label>
          <ToolButton onClick={applyToPages}>Apply to pages</ToolButton>
          {rotated.length > 0 && (
            <span className="text-xs text-slate-500">
              Selected pages with an angle: {pagesToRanges(rotated.map((it) => it.page))}
            </span>
          )}
        </div>
        <ThumbnailGrid
          items={cells}
          loadThumb={loadThumb}
          selected={org.selected}
          onSelect={(id, range) => org.toggleSelect(id, range, allIds)}
          onPreview={(cell) => setPreview({ page: Number(cell.id.split(":")[1]) })}
          renderCellExtra={(cell) => (
            <span className="mt-1 flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "rotateItems", ids: [cell.id], step: -90 });
                }}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:border-brand-600 hover:text-brand-600"
                title="Rotate 90° counter-clockwise"
                aria-label={`Rotate ${cell.label} 90 degrees counter-clockwise`}
              >
                ⟲
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "rotateItems", ids: [cell.id], step: 90 });
                }}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:border-brand-600 hover:text-brand-600"
                title="Rotate 90° clockwise"
                aria-label={`Rotate ${cell.label} 90 degrees clockwise`}
              >
                ⟳
              </button>
            </span>
          )}
          ariaLabel="Pages to rotate"
        />
        <p className="mt-2 text-xs text-slate-500">
          Click to select, Shift-click for a range · The ⟲ / ⟳ buttons on a
          page rotate just that page · Thumbnails show the rotated preview;
          the real rotation is applied server-side.
        </p>
      </div>
      {preview && pdf && (
        <PagePreviewModal
          pdf={pdf}
          page={preview.page}
          label={`${pdf.fileName} — page ${preview.page}`}
          onClose={() => setPreview(null)}
        />
      )}
    </CanvasShell>
  );
}
