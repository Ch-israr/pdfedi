// Thumbnail grid — the shared workspace for all five organizer tools.
//
// - Lazy thumbnails: each cell renders its page image only when it
//   scrolls into view (IntersectionObserver), through the shared LRU
//   cache, so a 200-page document never renders 200 pages up front.
// - Pointer-based drag to reorder (works on touch — HTML5 drag does
//   not). A drag starts after 6 px of movement so a tap still selects.
//   Up/down buttons (rendered by the tool) remain the fallback.
// - Click to select, shift-click for a range, arrow keys move the
//   selection, Delete triggers the tool's delete action, Ctrl+Arrow
//   moves the selected item (reorder).
// - State is never colour-only: deletion/removal marks get an icon +
//   a text label; rotation gets a numeric badge.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export interface GridCell {
  id: string;
  /** Primary label, e.g. "Page 3". */
  label: string;
  /** Secondary label, e.g. the source file name (Merge). */
  sublabel?: string;
  /** Cumulative rotation in degrees; the thumbnail is CSS-rotated. */
  angle?: number;
  markedDelete?: boolean;
  removed?: boolean;
  /** 1-based position badge (Reorder). */
  position?: number;
  /** Split group index, for the alternating group tint. */
  groupIndex?: number;
}

interface ThumbnailGridProps {
  items: GridCell[];
  loadThumb: (item: GridCell) => Promise<string | null>;
  selected: string[];
  onSelect: (id: string, range: boolean) => void;
  /** Commit a drag: move item `id` so it lands at `toIndex` in the
   *  array WITHOUT the dragged item (see organizerReducer moveItems). */
  onMove?: (id: string, toIndex: number) => void;
  /** Delete key pressed with a selection (Delete tool / Merge remove). */
  onDeleteKey?: () => void;
  /** Ctrl+Arrow pressed: move the selection by delta positions. */
  onMoveSelected?: (delta: number) => void;
  /** Extra content rendered between cells (Split divider slots). */
  renderBetween?: (afterIndex: number) => ReactNode;
  /** Extra badge/action content inside a cell (rotate buttons etc.). */
  renderCellExtra?: (item: GridCell) => ReactNode;
  /** Double-click a cell: open a large preview of that page. */
  onPreview?: (item: GridCell) => void;
  ariaLabel: string;
}

const GROUP_TINTS = [
  "border-brand-300 bg-brand-50",
  "border-amber-300 bg-amber-50",
  "border-emerald-300 bg-emerald-50",
  "border-violet-300 bg-violet-50",
];

function LazyThumb({
  item,
  loadThumb,
  angle,
}: {
  item: GridCell;
  loadThumb: (item: GridCell) => Promise<string | null>;
  angle: number;
}) {
  const t = useTranslations("canvas");
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          obs.disconnect();
          void loadThumb(item).then((url) => {
            if (alive) setSrc(url);
          });
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => {
      alive = false;
      obs.disconnect();
    };
  }, [item, loadThumb]);

  // A 90/270-degree rotation swaps width/height; scale the image down
  // so it stays inside its portrait cell (preview only — the real
  // rotation is server-side).
  const rotated = angle % 180 !== 0;
  return (
    <div ref={ref} className="flex h-36 items-center justify-center overflow-hidden bg-slate-100 sm:h-44">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={item.label}
          draggable={false}
          className="max-h-full max-w-full select-none"
          style={rotated ? { transform: `rotate(${angle}deg) scale(0.72)` } : undefined}
        />
      ) : (
        <span className="text-xs text-slate-400">{t("loadingThumb")}</span>
      )}
    </div>
  );
}

// In RTL locales the grid flows right-to-left: ArrowRight moves to the
// visually-right (earlier-index) cell, and the drop side flips too.
// The PDF thumbnails themselves are never mirrored.
function isRtlDoc(): boolean {
  return typeof document !== "undefined" && document.documentElement.dir === "rtl";
}

export function ThumbnailGrid({
  items,
  loadThumb,
  selected,
  onSelect,
  onMove,
  onDeleteKey,
  onMoveSelected,
  renderBetween,
  renderCellExtra,
  onPreview,
  ariaLabel,
}: ThumbnailGridProps) {
  const t = useTranslations("canvas");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragState = useRef<{
    id: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  // The drop target lives in a ref as well as state: the pointerup
  // handler commits the move directly (a state updater must stay pure
  // — StrictMode double-invokes it, which would fire the move twice).
  const dropIndexRef = useRef<number | null>(null);
  // A drag that just ended must not also toggle selection via the
  // click event that follows pointerup.
  const suppressClickRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Window-level pointer tracking: the drag survives leaving the cell.
  useEffect(() => {
    if (!dragId) return;
    const onMovePtr = (e: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 6) return;
        st.active = true;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.("[data-grid-cell]");
      let di: number | null = null;
      if (cell) {
        const idx = Number((cell as HTMLElement).dataset.index);
        const rect = cell.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        // In RTL, the right half of a cell is *before* it in reading order.
        const after = isRtlDoc() ? e.clientX < mid : e.clientX > mid;
        di = after ? idx + 1 : idx;
      }
      dropIndexRef.current = di;
      setDropIndex(di);
    };
    const onUp = () => {
      const st = dragState.current;
      dragState.current = null;
      setDragId(null);
      const di = dropIndexRef.current;
      dropIndexRef.current = null;
      setDropIndex(null);
      if (st?.active) {
        suppressClickRef.current = true;
        if (di !== null && onMove) {
          const origin = items.findIndex((it) => it.id === st.id);
          // Dropping before itself (di === origin) or right after
          // itself (di === origin + 1) leaves the order unchanged.
          if (di !== origin && di !== origin + 1) {
            // dropIndex is in full-array terms; the reducer wants the
            // index in the array without the dragged item.
            const to = di > origin ? di - 1 : di;
            onMove(st.id, to);
          }
        }
      }
    };
    window.addEventListener("pointermove", onMovePtr);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMovePtr);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragId, items, onMove]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selected.length > 0 && onDeleteKey) {
        e.preventDefault();
        onDeleteKey();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      if (selected.length > 0 && onMoveSelected) {
        e.preventDefault();
        // In RTL, ArrowRight moves toward the visually-right (earlier) position.
        const right = e.key === "ArrowRight";
        onMoveSelected(isRtlDoc() ? (right ? -1 : 1) : right ? 1 : -1);
      }
      return;
    }
    if (e.key.startsWith("Arrow")) {
      const ids = items.map((it) => it.id);
      const cur = selected.length > 0 ? ids.indexOf(selected[selected.length - 1]) : -1;
      const cols = Math.max(1, Math.floor((gridRef.current?.clientWidth ?? 600) / 160));
      let next = cur;
      const rtl = isRtlDoc();
      if (e.key === "ArrowRight") next = rtl ? Math.max(0, cur - 1) : Math.min(ids.length - 1, cur + 1);
      if (e.key === "ArrowLeft") next = rtl ? Math.min(ids.length - 1, cur + 1) : Math.max(0, cur - 1);
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, cur + cols);
      if (e.key === "ArrowUp") next = Math.max(0, cur - cols);
      if (next !== cur && next >= 0) {
        e.preventDefault();
        onSelect(ids[next], e.shiftKey);
      }
    }
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-stretch gap-3 rounded-2xl bg-white p-3 shadow-sm outline-none focus:ring-2 focus:ring-brand-500 sm:p-4"
    >
      {items.map((item, index) => {
        const isSelected = selected.includes(item.id);
        const isDragging = dragId === item.id && dragState.current?.active;
        const tint =
          item.groupIndex !== undefined
            ? GROUP_TINTS[item.groupIndex % GROUP_TINTS.length]
            : "border-slate-200 bg-white";
        return (
          <div key={item.id} className="contents">
            {dropIndex === index && dragId && (
              <div
                aria-hidden
                className="w-1.5 self-stretch rounded-full bg-brand-600"
              />
            )}
            <div
              data-grid-cell
              data-index={index}
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${item.label}${item.sublabel ? `, ${item.sublabel}` : ""}${item.markedDelete ? `, ${t("markedForDeletion")}` : ""}${item.removed ? `, ${t("removed")}` : ""}`}
              tabIndex={-1}
              onPointerDown={(e) => {
                // A stale suppression flag (drag ended outside the grid,
                // so no click followed) must not eat the next click.
                suppressClickRef.current = false;
                if (e.button !== 0 && e.pointerType === "mouse") return;
                if (!onMove) return;
                dragState.current = {
                  id: item.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  active: false,
                };
                setDragId(item.id);
              }}
              onClick={(e) => {
                // A drag that just ended is not a click.
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (dragState.current?.active) return;
                onSelect(item.id, e.shiftKey);
              }}
              onDoubleClick={() => onPreview?.(item)}
              className={`w-[132px] shrink-0 cursor-pointer touch-pan-y rounded-xl border-2 transition sm:w-[150px] ${
                isSelected ? "border-brand-600 ring-2 ring-brand-200" : tint
              } ${isDragging ? "opacity-40" : ""} ${
                item.removed ? "opacity-60" : ""
              }`}
            >
              <div className="relative">
                <LazyThumb item={item} loadThumb={loadThumb} angle={item.angle ?? 0} />
                {item.position !== undefined && (
                  <span className="absolute start-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                    {item.position}
                  </span>
                )}
                {item.angle !== undefined && item.angle % 360 !== 0 && (
                  <span className="absolute end-1 top-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
                    {item.angle}°
                  </span>
                )}
                {item.markedDelete && (
                  <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-red-600/90 px-2 py-1 text-center text-xs font-bold text-white">
                    {t("willBeDeleted")}
                  </span>
                )}
                {item.removed && (
                  <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-slate-700/90 px-2 py-1 text-center text-xs font-bold text-white">
                    {t("removed")}
                  </span>
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="truncate text-xs font-semibold text-slate-700">{item.label}</p>
                {item.sublabel && (
                  <p className="truncate text-[11px] text-slate-500">{item.sublabel}</p>
                )}
                {renderCellExtra?.(item)}
              </div>
            </div>
            {renderBetween?.(index + 1)}
          </div>
        );
      })}
      {dropIndex !== null && dropIndex >= items.length && dragId && (
        <div aria-hidden className="w-1.5 self-stretch rounded-full bg-brand-600" />
      )}
    </div>
  );
}
