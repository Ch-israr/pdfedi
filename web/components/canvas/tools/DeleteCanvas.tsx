// Delete Pages — Tier 2 page-organizer canvas.
//
// Centre: thumbnail grid; a page marked for deletion stays visible
// but struck through with a red "Will be deleted" band, so the action
// is reversible (unlike Foxit Delete, which has no undo). Mark via the
// button on a page, "Mark selected", or the Delete key on a selection.
// Top toolbar: Select all / Invert / Clear. A pages text field kept
// in sync with the marks is the keyboard-accessible equivalent. The
// guard "at least one page must remain" is enforced in the UI before
// processing.
//
// The marks map onto the existing `pages` option — no backend change.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildDeletePayload,
  pagesToRanges,
  rangesToPages,
} from "../../../lib/canvas/payloads";
import { makeItem, type OrganizerItem } from "../../../lib/canvas/organizer";
import { useOrganizer } from "../../../hooks/useOrganizer";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { PagePreviewModal, thumbLoaderFor } from "../canvasUtils";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, translatePayloadError, useUndoKeys, type ToolCanvasProps } from "./common";

export function DeleteCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
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
  const [pagesText, setPagesText] = useState<string | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const loadThumb = useMemo(() => thumbLoaderFor(pdfs), [pdfs]);

  const pageCount = pdf?.pageCount ?? 0;
  const marked = doc.items.filter((it) => it.markedDelete);
  const remaining = pageCount - marked.length;

  const payload = useMemo(() => {
    try {
      const built = buildDeletePayload(pageCount, marked.map((it) => it.page));
      return { ...built, error: null as string | null };
    } catch (e) {
      return { config: {}, error: translatePayloadError(e, tErr) };
    }
  }, [pageCount, marked]);

  const summary =
    marked.length > 0
      ? t("delete.summary", { marked: marked.length, total: pageCount, remaining })
      : t("delete.summaryEmpty");

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it) => ({
        id: it.id,
        label: t("pageLabel", { n: it.page }),
        markedDelete: it.markedDelete,
      })),
    [doc.items],
  );
  const allIds = doc.items.map((it) => it.id);

  function toggleMarks(ids: string[]) {
    // Guard: never mark every page (the backend refuses it too).
    const nextMarked = new Set(marked.map((it) => it.id));
    for (const id of ids) {
      if (nextMarked.has(id)) nextMarked.delete(id);
      else nextMarked.add(id);
    }
    if (nextMarked.size >= pageCount) {
      setPagesError(t("delete.cannotDeleteAll"));
      return;
    }
    setPagesError(null);
    dispatch({ type: "toggleMarkDelete", ids });
  }

  function commitPages(text: string) {
    setPagesText(null);
    try {
      const pages = rangesToPages(text);
      const outOfRange = pages.filter((p) => p > pageCount);
      if (outOfRange.length > 0) {
        setPagesError(t("delete.pageExceeds", { pages: outOfRange.join(", "), count: pageCount }));
        return;
      }
      if (pages.length >= pageCount) {
        setPagesError(t("delete.cannotDeleteAll"));
        return;
      }
      setPagesError(null);
      dispatch({ type: "setMarked", ids: pages.map((p) => `0:${p}`) });
    } catch (e) {
      setPagesError(translatePayloadError(e, tErr));
    }
  }

  return (
    <CanvasShell
      toolName={tTools("delete_pages.name")}
      description={tContent("delete_pages.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "delete_pages", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error ?? pagesError}
      processLabel={t("delete.processLabel", { count: marked.length })}
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("delete.activity")}
      error={job.error}
      transientNotice={job.transientNotice}
      queueWaitMs={job.queueWaitMs}
      jobStatus={job.job?.status ?? null}
    >
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ToolButton onClick={org.undo} disabled={!org.canUndo} title={t("undoTitle")}>↩ {t("undo")}</ToolButton>
          <ToolButton onClick={org.redo} disabled={!org.canRedo} title={t("redoTitle")}>↪ {t("redo")}</ToolButton>
          <ToolButton onClick={() => org.selectAll(allIds)}>{t("selectAll")}</ToolButton>
          <ToolButton
            onClick={() => {
              const unselected = allIds.filter((id) => !org.selected.includes(id));
              org.setSelected(unselected);
            }}
          >
            {t("delete.invertSelection")}
          </ToolButton>
          <ToolButton onClick={org.clearSelection} disabled={org.selected.length === 0}>{t("clearSelection")}</ToolButton>
          <ToolButton onClick={() => toggleMarks(org.selected)} disabled={org.selected.length === 0} title={t("delete.markSelectedTitle")}>
            {t("delete.markSelected", { count: org.selected.length })}
          </ToolButton>
          <ToolButton onClick={() => dispatch({ type: "clearMarks" })} disabled={marked.length === 0}>
            {t("delete.clearMarks")}
          </ToolButton>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t("delete.pagesToDelete")}
            <input
              type="text"
              value={pagesText ?? pagesToRanges(marked.map((it) => it.page))}
              onChange={(e) => setPagesText(e.target.value)}
              onBlur={(e) => commitPages(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
              placeholder={t("delete.pagesPlaceholder")}
              aria-label={t("delete.pagesToDeleteAria")}
            />
          </label>
        </div>
        <ThumbnailGrid
          items={cells}
          loadThumb={loadThumb}
          selected={org.selected}
          onSelect={(id, range) => org.toggleSelect(id, range, allIds)}
          onDeleteKey={() => toggleMarks(org.selected)}
          onPreview={(cell) => setPreview({ page: Number(cell.id.split(":")[1]) })}
          renderCellExtra={(cell) => {
            const isMarked = doc.items.find((it) => it.id === cell.id)?.markedDelete;
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMarks([cell.id]);
                }}
                className={`mt-1 w-full rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  isMarked
                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : "bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-700"
                }`}
                aria-label={isMarked ? t("delete.unmarkAria", { label: cell.label }) : t("delete.markAria", { label: cell.label })}
              >
                {isMarked ? t("delete.markedUndo") : t("delete.markForDeletion")}
              </button>
            );
          }}
          ariaLabel={t("delete.gridAria")}
        />
        <p className="mt-2 text-xs text-slate-500">{t("delete.hint")}</p>
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
