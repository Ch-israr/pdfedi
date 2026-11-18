// Merge PDF — Tier 2 page-organizer canvas.
//
// Left rail: one card per file (first-page thumbnail, filename, page
// count, remove/restore, up/down to move the whole file). Centre:
// thumbnail grid of ALL pages across ALL files, grouped by file with
// a divider header; drag pages across files, click to select, Delete
// key removes selected pages from the merge set (undoable — pages stay
// visible, dimmed, until processing). Double-click a page for a large
// preview.
//
// The canvas only sends the final ordered page list: file_ids in
// canvas order + config.page_order (JSON list of [fileIndex, page]
// pairs). When nothing was reordered or removed, the config is empty
// and the job is byte-identical to a plain ToolRunner merge.
"use client";

import { useEffect, useMemo, useState } from "react";
import { buildMergePayload, type MergePageRef } from "../../../lib/canvas/payloads";
import { makeItem, type OrganizerItem } from "../../../lib/canvas/organizer";
import { useOrganizer } from "../../../hooks/useOrganizer";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { PagePreviewModal, thumbLoaderFor } from "../canvasUtils";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, translatePayloadError, useUndoKeys, type ToolCanvasProps } from "./common";

export function MergeCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
  const locale = useLocale();
  const t = useTranslations("canvas");
  const tTools = useTranslations("tools");
  const tContent = useTranslations("toolContent");
  const initialItems = useMemo<OrganizerItem[]>(
    () =>
      pdfs.flatMap((pdf, fi) =>
        Array.from({ length: pdf.pageCount }, (_, i) => makeItem(fi, pdf.fileName, i + 1)),
      ),
    [pdfs],
  );
  const org = useOrganizer(initialItems);
  const { doc, dispatch } = org;
  useUndoKeys(org.undo, org.redo, org.canUndo, org.canRedo);

  // Files arrive after mount (local pdf.js load) and can grow via
  // "Add files": append the new pages, keeping existing order/marks.
  useEffect(() => {
    org.syncItems(initialItems);
  }, [initialItems, org.syncItems]);

  const [preview, setPreview] = useState<{ pdfIndex: number; page: number; label: string } | null>(null);
  const loadThumb = useMemo(() => thumbLoaderFor(pdfs), [pdfs]);

  // Canvas file order = first-appearance order of non-removed items.
  const includedFileOrder = useMemo(() => {
    const order: number[] = [];
    for (const it of doc.items) {
      if (!it.removed && !order.includes(it.fileIndex)) order.push(it.fileIndex);
    }
    return order;
  }, [doc.items]);

  const payload = useMemo(() => {
    try {
      const fileIds = includedFileOrder.map((fi) => job.files[fi]?.id).filter(Boolean) as string[];
      if (fileIds.length < 2) return { fileIds, config: {}, error: "Add at least one more file." };
      const counts = includedFileOrder.map((fi) => pdfs[fi]?.pageCount ?? 0);
      const refs: MergePageRef[] = doc.items
        .filter((it) => !it.removed)
        .map((it) => ({ fileIndex: includedFileOrder.indexOf(it.fileIndex), page: it.page }));
      const built = buildMergePayload(fileIds, counts, refs);
      return { fileIds: built.file_ids, config: built.config, error: null as string | null };
    } catch (e) {
      return { fileIds: [], config: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }, [doc.items, includedFileOrder, job.files, pdfs]);

  const totalPages = doc.items.filter((it) => !it.removed).length;
  const removedCount = doc.items.length - totalPages;
  const summary =
    includedFileOrder.length >= 2
      ? t("merge.summary", {
          files: includedFileOrder.length,
          pages: totalPages,
          removed:
            removedCount > 0
              ? t("merge.summaryRemoved", { count: removedCount })
              : "",
        })
      : t("merge.addAtLeast2");

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it) => ({
        id: it.id,
        label: t("pageLabel", { n: it.page }),
        sublabel: it.fileName,
        removed: it.removed,
      })),
    [doc.items],
  );

  const allIds = doc.items.map((it) => it.id);
  const selectedItems = doc.items.filter((it) => org.selected.includes(it.id));

  function moveFileBlock(fileIndex: number, dir: -1 | 1) {
    // Move the whole file's pages before/after the neighbouring file.
    // The target index is computed in the array WITHOUT this file's
    // items, matching the reducer's moveItems contract.
    const order = includedFileOrder;
    const pos = order.indexOf(fileIndex);
    const neighbour = order[pos + dir];
    if (neighbour === undefined) return;
    const movingIds = doc.items.filter((it) => it.fileIndex === fileIndex).map((it) => it.id);
    const rest = doc.items.filter((it) => it.fileIndex !== fileIndex);
    const nItems = rest.filter((it) => it.fileIndex === neighbour);
    if (nItems.length === 0) return;
    const anchor = dir === 1 ? nItems[nItems.length - 1] : nItems[0];
    const anchorIdx = rest.findIndex((it) => it.id === anchor.id);
    dispatch({ type: "moveItems", ids: movingIds, toIndex: dir === 1 ? anchorIdx + 1 : anchorIdx });
  }

  function removeSelected() {
    if (selectedItems.length === 0) return;
    dispatch({ type: "removeItems", ids: selectedItems.map((it) => it.id) });
    org.clearSelection();
  }

  const fileCards = includedFileOrder.map((fi) => {
    const pdf = pdfs[fi];
    const count = doc.items.filter((it) => it.fileIndex === fi && !it.removed).length;
    const pos = includedFileOrder.indexOf(fi);
    return { fi, pdf, count, pos };
  });
  const removedFiles = pdfs
    .map((pdf, fi) => ({ fi, pdf }))
    .filter(({ fi }) => !includedFileOrder.includes(fi));

  return (
    <CanvasShell
      toolName={tTools("merge.name")}
      description={tContent("merge.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={job.spec?.max_files ?? 20}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={doc.items.length}
      summary={summary}
      payload={{ tool_key: "merge", file_ids: payload.fileIds, config: payload.config }}
      payloadError={payload.error}
      processLabel={t("merge.processLabel")}
      canProcess={payload.error === null && payload.fileIds.length >= 2}
      onProcess={() => {
        const ordered = payload.fileIds
          .map((id) => job.files.find((f) => f.id === id))
          .filter(Boolean) as typeof job.files;
        void job.startJob(ordered, payload.config);
      }}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("merge.activity")}
      error={job.error}
    >
      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        {/* File rail */}
        <aside className="w-full shrink-0 lg:w-60">
          <div className="space-y-2">
            {fileCards.map(({ fi, pdf, count, pos }) => (
              <div key={fi} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                <button
                  className="h-12 w-10 shrink-0 overflow-hidden rounded bg-slate-100"
                  onClick={() => setPreview({ pdfIndex: fi, page: 1, label: t("filePageLabel", { name: pdf.fileName, n: 1 }) })}
                  title={t("merge.previewFirstPage")}
                >
                  <FirstPageThumb pdf={pdf} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{pdf.fileName}</p>
                  <p className="text-[11px] text-slate-500">{t("merge.filePages", { count })}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    disabled={pos === 0}
                    onClick={() => moveFileBlock(fi, -1)}
                    className="rounded border border-slate-300 px-1.5 text-xs disabled:opacity-30"
                    title={t("merge.moveFileUp")}
                    aria-label={t("merge.moveFileUpAria", { name: pdf.fileName })}
                  >
                    ↑
                  </button>
                  <button
                    disabled={pos === includedFileOrder.length - 1}
                    onClick={() => moveFileBlock(fi, 1)}
                    className="rounded border border-slate-300 px-1.5 text-xs disabled:opacity-30"
                    title={t("merge.moveFileDown")}
                    aria-label={t("merge.moveFileDownAria", { name: pdf.fileName })}
                  >
                    ↓
                  </button>
                </div>
                <button
                  onClick={() =>
                    dispatch({
                      type: "removeItems",
                      ids: doc.items.filter((it) => it.fileIndex === fi).map((it) => it.id),
                    })
                  }
                  className="shrink-0 rounded border border-slate-300 px-1.5 py-1 text-xs text-red-600 hover:border-red-500"
                  title={t("merge.removeFileTitle")}
                  aria-label={t("merge.removeFileFromMerge", { name: pdf.fileName })}
                >
                  ✕
                </button>
              </div>
            ))}
            {removedFiles.map(({ fi, pdf }) => (
              <div key={fi} className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2 opacity-70">
                <p className="truncate text-xs text-slate-500">{t("merge.removedFileLabel", { name: pdf.fileName })}</p>
                <button
                  onClick={() =>
                    dispatch({
                      type: "restoreItems",
                      ids: doc.items.filter((it) => it.fileIndex === fi).map((it) => it.id),
                    })
                  }
                  className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:border-brand-600 hover:text-brand-600"
                >
                  {t("merge.restore")}
                </button>
              </div>
            ))}
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-3 text-center text-sm font-medium text-slate-600 hover:border-brand-500 hover:text-brand-600">
              + {t("merge.addFilesLabel")}
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  if (list.length > 0) onPick(list);
                }}
              />
            </label>
          </div>
        </aside>

        {/* Grid */}
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ToolButton onClick={org.undo} disabled={!org.canUndo} title={t("undoTitle")}>↩ {t("undo")}</ToolButton>
            <ToolButton onClick={org.redo} disabled={!org.canRedo} title={t("redoTitle")}>↪ {t("redo")}</ToolButton>
            <ToolButton onClick={() => org.selectAll(allIds)}>{t("selectAll")}</ToolButton>
            <ToolButton onClick={org.clearSelection} disabled={org.selected.length === 0}>{t("clearSelection")}</ToolButton>
            <ToolButton onClick={removeSelected} disabled={selectedItems.length === 0} title={t("merge.removeSelectedTitle")}>
              {t("merge.removeSelectedCount", { count: selectedItems.length })}
            </ToolButton>
            {removedCount > 0 && (
              <ToolButton
                onClick={() =>
                  dispatch({ type: "restoreItems", ids: doc.items.filter((it) => it.removed).map((it) => it.id) })
                }
              >
                {t("merge.restoreAllRemoved")}
              </ToolButton>
            )}
          </div>
          <ThumbnailGrid
            items={cells}
            loadThumb={loadThumb}
            selected={org.selected}
            onSelect={(id, range) => org.toggleSelect(id, range, allIds)}
            onMove={(id, to) => dispatch({ type: "moveItems", ids: [id], toIndex: to })}
            onDeleteKey={removeSelected}
            onPreview={(cell) => {
              const [fi, pg] = cell.id.split(":").map(Number);
              setPreview({ pdfIndex: fi, page: pg, label: t("filePageLabel", { name: pdfs[fi]?.fileName ?? "", n: pg }) });
            }}
            ariaLabel={t("merge.gridAriaOrder")}
          />
          <p className="mt-2 text-xs text-slate-500">{t("merge.gridHint")}</p>
        </div>
      </div>
      {preview && pdfs[preview.pdfIndex] && (
        <PagePreviewModal
          pdf={pdfs[preview.pdfIndex]}
          page={preview.page}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      )}
    </CanvasShell>
  );
}

function FirstPageThumb({ pdf }: { pdf: { renderThumb: (n: number, w?: number) => Promise<string | null> } }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void pdf.renderThumb(1, 80).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [pdf]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="flex h-full items-center justify-center text-[10px] text-slate-400">…</span>
  );
}
