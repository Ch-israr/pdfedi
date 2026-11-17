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
import { ToolButton, useUndoKeys, type ToolCanvasProps } from "./common";

export function DeleteCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
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
      return { config: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }, [pageCount, marked]);

  const summary =
    marked.length > 0
      ? `Deleting ${marked.length} of ${pageCount} pages · ${remaining} will remain.`
      : "Click pages to mark them for deletion. At least one page must remain.";

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it) => ({
        id: it.id,
        label: `Page ${it.page}`,
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
      setPagesError("Cannot delete every page; at least one page must remain.");
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
        throw new Error(`Page(s) ${outOfRange.join(", ")} exceed the document page count (${pageCount}).`);
      }
      if (pages.length >= pageCount) {
        throw new Error("Cannot delete every page; at least one page must remain.");
      }
      setPagesError(null);
      dispatch({ type: "setMarked", ids: pages.map((p) => `0:${p}`) });
    } catch (e) {
      setPagesError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <CanvasShell
      toolName={job.spec?.name ?? "Delete Pages"}
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
      payload={{ tool_key: "delete_pages", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error ?? pagesError}
      processLabel={`Delete ${marked.length} page${marked.length === 1 ? "" : "s"}`}
      canProcess={payload.error === null && job.files.length === 1}
      onProcess={() => void job.startJob(job.files, payload.config)}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      activityLabel="Deleting pages"
      error={job.error}
    >
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ToolButton onClick={org.undo} disabled={!org.canUndo} title="Undo (Ctrl+Z)">↩ Undo</ToolButton>
          <ToolButton onClick={org.redo} disabled={!org.canRedo} title="Redo (Ctrl+Y)">↪ Redo</ToolButton>
          <ToolButton onClick={() => org.selectAll(allIds)}>Select all</ToolButton>
          <ToolButton
            onClick={() => {
              const unselected = allIds.filter((id) => !org.selected.includes(id));
              org.setSelected(unselected);
            }}
          >
            Invert selection
          </ToolButton>
          <ToolButton onClick={org.clearSelection} disabled={org.selected.length === 0}>Clear selection</ToolButton>
          <ToolButton onClick={() => toggleMarks(org.selected)} disabled={org.selected.length === 0} title="Mark the selected pages for deletion (Delete key)">
            Mark selected ({org.selected.length})
          </ToolButton>
          <ToolButton onClick={() => dispatch({ type: "clearMarks" })} disabled={marked.length === 0}>
            Clear marks
          </ToolButton>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Pages to delete
            <input
              type="text"
              value={pagesText ?? pagesToRanges(marked.map((it) => it.page))}
              onChange={(e) => setPagesText(e.target.value)}
              onBlur={(e) => commitPages(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
              placeholder="1,3,5-7"
              aria-label="Pages to delete"
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
                aria-label={isMarked ? `Unmark ${cell.label} for deletion` : `Mark ${cell.label} for deletion`}
              >
                {isMarked ? "✕ Marked — undo" : "Mark for deletion"}
              </button>
            );
          }}
          ariaLabel="Pages to delete"
        />
        <p className="mt-2 text-xs text-slate-500">
          Click to select, Shift-click for a range · “Mark selected” or the
          Delete key marks the selection · The button on a page marks just
          that page · Marked pages stay visible until processing, and every
          mark is undoable.
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
