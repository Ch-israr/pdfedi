// Reorder Pages — Tier 2 page-organizer canvas.
//
// Centre: thumbnail grid with numbered position badges (1, 2, 3…)
// that update live as pages move. Drag thumbnails to reorder
// (pointer-based drag with a drop indicator line); keyboard
// alternative: select a page, then Ctrl+Arrow to move it; up/down
// buttons per selection in the toolbar. An order text field kept in
// sync with the grid is the typed fallback (and the screen-reader
// equivalent). Top toolbar: Reverse order, Reset to original.
//
// The grid order maps onto the existing `order` option ("3,1,2") —
// no backend change.
"use client";

import { useEffect, useMemo, useState } from "react";
import { buildReorderPayload } from "../../../lib/canvas/payloads";
import { makeItem, type OrganizerItem } from "../../../lib/canvas/organizer";
import { useOrganizer } from "../../../hooks/useOrganizer";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { PagePreviewModal, thumbLoaderFor } from "../canvasUtils";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, translatePayloadError, useUndoKeys, type ToolCanvasProps } from "./common";

export function ReorderCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
  const locale = useLocale();
  const t = useTranslations("canvas");
  const tTools = useTranslations("tools");
  const tContent = useTranslations("toolContent");
  const tErr = useTranslations("errors");
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
  const [orderText, setOrderText] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const loadThumb = useMemo(() => thumbLoaderFor(pdfs), [pdfs]);

  const pageCount = pdf?.pageCount ?? 0;
  const order = doc.items.map((it) => it.page);
  const original = initialItems.map((it) => it.page);
  const changed = order
    .map((page, idx) => ({ page, current: idx + 1, original: original.indexOf(page) + 1 }))
    .filter((c) => c.current !== c.original);

  const payload = useMemo(() => {
    try {
      const built = buildReorderPayload(order);
      return { ...built, error: null as string | null };
    } catch (e) {
      return { config: {}, error: translatePayloadError(e, tErr) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.items]);

  const summary =
    changed.length === 0
      ? t("reorder.summaryOriginal")
      : t("reorder.summaryMoved", {
          count: changed.length,
          list: changed
            .slice(0, 5)
            .map((c) => `p.${c.page} → ${t("reorder.position", { n: c.current })}`)
            .join(", "),
          more:
            changed.length > 5
              ? t("reorder.summaryMore", { count: changed.length - 5 })
              : "",
        });

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it, idx) => ({
        id: it.id,
        label: t("pageLabel", { n: it.page }),
        position: idx + 1,
      })),
    [doc.items],
  );
  const allIds = doc.items.map((it) => it.id);

  function moveSelected(delta: number) {
    if (org.selected.length === 0) return;
    const firstIdx = doc.items.findIndex((it) => it.id === org.selected[0]);
    const to = Math.max(0, Math.min(doc.items.length - org.selected.length, firstIdx + delta));
    dispatch({ type: "moveItems", ids: org.selected, toIndex: to });
  }

  function commitOrder(text: string) {
    setOrderText(null);
    try {
      const nums = text.split(",").map((t) => Number(t.trim()));
      if (
        nums.length !== pageCount ||
        nums.some((n) => !Number.isInteger(n) || n < 1 || n > pageCount) ||
        new Set(nums).size !== pageCount
      ) {
        setOrderError(
          t("reorder.orderError", { count: pageCount, example: original.join(",") }),
        );
        return;
      }
      setOrderError(null);
      dispatch({ type: "setOrder", order: nums });
    } catch (e) {
      setOrderError(translatePayloadError(e, tErr));
    }
  }

  return (
    <CanvasShell
      toolName={tTools("reorder_pages.name")}
      description={tContent("reorder_pages.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "reorder_pages", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error ?? orderError}
      processLabel={t("reorder.processLabel")}
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("reorder.activity")}
      error={job.error}
    >
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ToolButton onClick={org.undo} disabled={!org.canUndo} title={t("undoTitle")}>↩ {t("undo")}</ToolButton>
          <ToolButton onClick={org.redo} disabled={!org.canRedo} title={t("redoTitle")}>↪ {t("redo")}</ToolButton>
          <ToolButton onClick={() => dispatch({ type: "reverseOrder" })}>{t("reorder.reverseOrder")}</ToolButton>
          <ToolButton onClick={() => dispatch({ type: "setOrder", order: original })} disabled={changed.length === 0}>
            {t("reorder.resetOriginal")}
          </ToolButton>
          <ToolButton onClick={() => moveSelected(-1)} disabled={org.selected.length === 0} title={t("reorder.moveUpTitle")}>
            {t("reorder.moveUp")}
          </ToolButton>
          <ToolButton onClick={() => moveSelected(1)} disabled={org.selected.length === 0} title={t("reorder.moveDownTitle")}>
            {t("reorder.moveDown")}
          </ToolButton>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t("reorder.orderLabel")}
            <input
              type="text"
              value={orderText ?? order.join(",")}
              onChange={(e) => setOrderText(e.target.value)}
              onBlur={(e) => commitOrder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-52 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
              aria-label={t("reorder.orderAria")}
            />
          </label>
        </div>
        <ThumbnailGrid
          items={cells}
          loadThumb={loadThumb}
          selected={org.selected}
          onSelect={(id, range) => org.toggleSelect(id, range, allIds)}
          onMove={(id, to) => dispatch({ type: "moveItems", ids: [id], toIndex: to })}
          onMoveSelected={moveSelected}
          onPreview={(cell) => setPreview({ page: Number(cell.id.split(":")[1]) })}
          ariaLabel={t("reorder.gridAria")}
        />
        <p className="mt-2 text-xs text-slate-500">{t("reorder.hint")}</p>
      </div>
      {preview && pdf && (
        <PagePreviewModal
          pdf={pdf}
          page={preview.page}
          label={t("filePageLabel", { name: pdf.fileName, n: preview.page })}
          onClose={() => setPreview(null)}
        />
      )}
    </CanvasShell>
  );
}
