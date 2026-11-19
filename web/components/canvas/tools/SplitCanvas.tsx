// Split PDF — Tier 2 page-organizer canvas.
//
// Centre: thumbnail grid with divider insertion — click the gap
// between two thumbnails to drop a split marker (the Adobe
// divider-line pattern); each output group gets an alternating tint.
// Right of the toolbar: mode tabs (Ranges / Extract pages / Every
// page) and a ranges text input kept in sync with the visual
// dividers (the keyboard-accessible equivalent of clicking gaps).
//
// The visual state maps 1:1 onto the existing backend options —
// mode + ranges ("1-3,4-7") — so no backend change was needed.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSplitPayload,
  pagesToGroups,
  pagesToRanges,
  rangesToPages,
  PayloadError,
} from "../../../lib/canvas/payloads";
import { makeItem, splitGroups, type OrganizerItem } from "../../../lib/canvas/organizer";
import { useOrganizer } from "../../../hooks/useOrganizer";
import { CanvasShell } from "../CanvasShell";
import { ThumbnailGrid, type GridCell } from "../ThumbnailGrid";
import { PagePreviewModal, thumbLoaderFor } from "../canvasUtils";
import { useLocale, useTranslations } from "next-intl";
import { ToolButton, translatePayloadError, useUndoKeys, type ToolCanvasProps } from "./common";

export function SplitCanvas({ job, pdfs, localFiles, onPick }: ToolCanvasProps) {
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
  const [rangesText, setRangesText] = useState<string | null>(null);
  const [rangesError, setRangesError] = useState<string | null>(null);
  // Literal ranges the user typed when they contain a gap
  // ("1-3,8-10"). Dividers can only express a contiguous partition,
  // so the typed ranges are kept verbatim as the payload and the
  // pages between the runs are shown dimmed as excluded.
  const [gapRanges, setGapRanges] = useState<string | null>(null);
  const loadThumb = useMemo(() => thumbLoaderFor(pdfs), [pdfs]);

  const pageCount = pdf?.pageCount ?? 0;
  const mode = doc.mode;

  const groups = useMemo(
    () => (mode === "ranges" ? splitGroups(pageCount, doc.dividers) : []),
    [mode, pageCount, doc.dividers],
  );
  const groupOf = (pageNum: number) =>
    mode === "ranges" ? doc.dividers.filter((d) => d < pageNum).length : undefined;

  // A gap selection is live only while the dividers still match the
  // run boundaries of the typed ranges. Any divider edit, mode change
  // or undo that moves the dividers deactivates it by itself, so the
  // payload can never disagree with the visual state.
  const gapGroups = useMemo(
    () => (gapRanges ? pagesToGroups(rangesToPages(gapRanges)) : []),
    [gapRanges],
  );
  const gapActive = useMemo(() => {
    if (!gapRanges || gapGroups.length < 2) return false;
    const boundaries = gapGroups.map(([, e]) => e).filter((e) => e < pageCount);
    return (
      boundaries.length === doc.dividers.length &&
      boundaries.every((b, i) => b === doc.dividers[i])
    );
  }, [gapRanges, gapGroups, pageCount, doc.dividers]);
  const excludedPages = useMemo(() => {
    if (!gapActive) return new Set<number>();
    const included = new Set(gapGroups.flatMap(([s, e]) => Array.from({ length: e - s + 1 }, (_, i) => s + i)));
    const excluded = new Set<number>();
    for (let p = 1; p <= pageCount; p++) if (!included.has(p)) excluded.add(p);
    return excluded;
  }, [gapActive, gapGroups, pageCount]);
  const displayGroups = gapActive ? gapGroups : groups;

  const payload = useMemo(() => {
    try {
      const extractPages =
        mode === "extract"
          ? org.selected.map((id) => Number(id.split(":")[1])).sort((a, b) => a - b)
          : [];
      const built = buildSplitPayload(
        pageCount,
        mode,
        doc.dividers,
        extractPages,
        mode === "ranges" && gapActive ? gapRanges : null,
      );
      return { ...built, error: null as string | null };
    } catch (e) {
      return { config: {}, error: translatePayloadError(e, tErr) };
    }
  }, [pageCount, mode, doc.dividers, org.selected, gapActive, gapRanges]);

  const summary =
    mode === "every"
      ? t("split.summaryEvery", { count: pageCount })
      : mode === "extract"
        ? org.selected.length > 0
          ? t("split.summaryExtract", { count: org.selected.length })
          : t("split.summaryExtractEmpty")
        : displayGroups.length > 0
          ? t("split.summaryRanges", {
              count: displayGroups.length,
              groups: displayGroups
                .map(([s, e]) => (s === e ? `p. ${s}` : `pp. ${s}–${e}`))
                .join(", "),
            })
          : "";

  const cells: GridCell[] = useMemo(
    () =>
      doc.items.map((it) => ({
        id: it.id,
        label: t("pageLabel", { n: it.page }),
        groupIndex: groupOf(it.page),
        // Pages between the typed runs are excluded from every output
        // file: dim them (the grid's "Removed" badge) so the visual
        // state stays truthful about what will be sent.
        removed: excludedPages.has(it.page),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.items, doc.dividers, mode, excludedPages],
  );
  const allIds = doc.items.map((it) => it.id);

  // Ranges text field: shown value is the visual state unless the user
  // is editing; committing parses it back into dividers. While a gap
  // selection is live the field shows the literal typed ranges.
  const rangesValue =
    rangesText ??
    (mode === "ranges"
      ? gapActive && gapRanges
        ? gapRanges
        : displayGroups.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(",")
      : "");
  function commitRanges(text: string) {
    // Empty input is an error, never a silent fallback to the whole
    // document. The typed text stays visible while the error shows.
    if (!text.trim()) {
      setRangesError(t("split.rangesEmpty"));
      setRangesText(text);
      return;
    }
    let pages: number[];
    try {
      pages = rangesToPages(text);
    } catch (e) {
      // Reversed ranges get the real reason, not "starts at 1".
      if (e instanceof PayloadError && e.code === "reversed_range") {
        setRangesError(t("split.rangesReversed", { range: String(e.params.range ?? text) }));
      } else {
        setRangesError(translatePayloadError(e, tErr));
      }
      setRangesText(text);
      return;
    }
    if (pages.length === 0) {
      setRangesError(t("split.rangesEmpty"));
      setRangesText(text);
      return;
    }
    if (pages.some((p) => p > pageCount)) {
      setRangesError(t("split.pageRangeExceeds", { count: pageCount }));
      setRangesText(text);
      return;
    }
    const runs = pagesToGroups(pages);
    // Dividers at every run end (except the document end): the grid
    // then shows each run — and each excluded stretch between runs —
    // as its own tinted group.
    const dividers = runs.map(([, e]) => e).filter((e) => e < pageCount);
    setRangesError(null);
    setRangesText(null);
    // Preserve gaps: keep the literal typed ranges as the payload so
    // the backend returns one file per run instead of filling the gap.
    setGapRanges(runs.length > 1 ? pagesToRanges(pages) : null);
    // One undo step for the whole text commit.
    dispatch({ type: "setDividers", dividers });
  }

  return (
    <CanvasShell
      toolName={tTools("split.name")}
      description={tContent("split.description")}
      fileLabel={localFiles.map((f) => f.name).join(", ")}
      quota={job.quota}
      maxFiles={1}
      maxUploadMb={job.limits?.max_upload_mb ?? 50}
      phase={job.phase}
      busy={job.busy}
      uploadPending={job.files.length < localFiles.length}
      totalPages={pageCount}
      summary={summary}
      payload={{ tool_key: "split", file_ids: job.files.map((f) => f.id), config: payload.config }}
      payloadError={payload.error ?? rangesError}
      processLabel={
        mode === "every"
          ? t("split.processEvery")
          : mode === "extract"
            ? t("split.processExtract")
            : t("split.processRanges")
      }
      canProcess={payload.error === null && rangesError === null && job.files.length === 1}
      onProcess={() => {
        // Safety net: if the ranges field still holds an uncommitted
        // edit (blur normally commits it first), commit it now and
        // wait for the next click instead of running stale ranges.
        if (mode === "ranges" && rangesText !== null) {
          commitRanges(rangesText);
          return;
        }
        if (rangesError !== null) return;
        void job.startJob(job.files, payload.config);
      }}
      onPick={onPick}
      onReset={job.reset}
      onBackToOrganize={() => job.setPhase("organize")}
      onDownload={job.download}
      downloadPct={job.downloadPct}
      locale={locale}
      activityLabel={t("split.activity")}
      error={job.error}
    >
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ToolButton onClick={org.undo} disabled={!org.canUndo} title={t("undoTitle")}>↩ {t("undo")}</ToolButton>
          <ToolButton onClick={org.redo} disabled={!org.canRedo} title={t("redoTitle")}>↪ {t("redo")}</ToolButton>
          <div className="ms-1 flex rounded-lg border border-slate-300 bg-white p-0.5" role="tablist" aria-label={t("split.modeAria")}>
            {(["ranges", "extract", "every"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  dispatch({ type: "setMode", mode: m });
                  org.clearSelection();
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  mode === m ? "bg-brand-600 text-white" : "text-slate-600 hover:text-brand-600"
                }`}
              >
                {m === "ranges" ? t("split.modeRanges") : m === "extract" ? t("split.modeExtract") : t("split.modeEvery")}
              </button>
            ))}
          </div>
          {mode === "ranges" && (
            <>
              <ToolButton onClick={() => dispatch({ type: "clearDividers" })} disabled={doc.dividers.length === 0}>
                {t("split.clearDividers")}
              </ToolButton>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                {t("split.rangesLabel")}
                <input
                  type="text"
                  value={rangesValue}
                  aria-label={t("split.rangesAria")}
                  onChange={(e) => setRangesText(e.target.value)}
                  onBlur={(e) => commitRanges(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
                  placeholder={t("split.rangesPlaceholder")}
                />
              </label>
            </>
          )}
          {mode === "extract" && (
            <ToolButton onClick={() => org.selectAll(allIds)}>{t("split.selectAllPages")}</ToolButton>
          )}
        </div>
        {mode === "ranges" && (
          <p className="mb-2 text-sm text-slate-600">{t("split.rangesHint")}</p>
        )}
        {mode === "extract" && (
          <p className="mb-2 text-sm text-slate-600">{t("split.extractHint")}</p>
        )}
        <ThumbnailGrid
          items={cells}
          loadThumb={loadThumb}
          selected={org.selected}
          onSelect={(id, range) => org.toggleSelect(id, range, allIds)}
          onPreview={(cell) => setPreview({ page: Number(cell.id.split(":")[1]) })}
          renderBetween={
            mode === "ranges"
              ? (afterIndex) => {
                  if (afterIndex < 1 || afterIndex >= pageCount) return null;
                  const has = doc.dividers.includes(afterIndex);
                  return (
                    <button
                      key={`div-${afterIndex}`}
                      onClick={() => dispatch({ type: "toggleDivider", afterIndex })}
                      title={has ? t("split.removeSplitAfter", { n: afterIndex }) : t("split.splitAfter", { n: afterIndex })}
                      aria-label={has ? t("split.removeSplitAfter", { n: afterIndex }) : t("split.splitAfter", { n: afterIndex })}
                      className={`flex w-7 shrink-0 flex-col items-center justify-center self-stretch rounded-lg border-2 text-xs font-bold ${
                        has
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-dashed border-slate-300 bg-white text-slate-400 hover:border-brand-500 hover:text-brand-600"
                      }`}
                    >
                      {has ? "✂" : "+"}
                    </button>
                  );
                }
              : undefined
          }
          ariaLabel={t("split.gridAria")}
        />
        <p className="mt-2 text-xs text-slate-500">
          {mode === "ranges"
            ? t("split.rangesHintBottom")
            : mode === "extract"
              ? t("split.extractHintBottom")
              : t("split.everyHintBottom")}
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
