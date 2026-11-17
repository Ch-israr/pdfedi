// Organizer state machine — pure reducer, no DOM, no React.
// One model serves all five Phase 1 tools; each tool uses the actions
// it needs and ignores the rest:
//
//   Merge:    moveItems (pages + whole files), remove/restore items
//   Split:    dividers + mode (items stay in document order)
//   Rotate:   per-item angle (rotateSelected / setAngle)
//   Delete:   markedDelete flags (toggleMarkDelete)
//   Reorder:  moveItems + reverseOrder
//
// Selection is deliberately NOT part of this state: it is view state
// and is kept in the hook (useOrganizer), so undo/redo never restores
// a stale selection. Only document edits (order, marks, angles,
// dividers, mode) are undoable.

export interface OrganizerItem {
  /** Stable across moves: `${fileIndex}:${page}`. */
  id: string;
  fileIndex: number;
  fileName: string;
  /** 1-based page number within its file. */
  page: number;
  /** Cumulative rotation in degrees (Rotate tool): 0 | 90 | 180 | 270. */
  angle: number;
  /** Delete tool: marked for deletion (stays visible, struck through). */
  markedDelete: boolean;
  /** Merge tool: excluded from the merge set (stays visible, dimmed). */
  removed: boolean;
}

export type SplitMode = "ranges" | "every" | "extract";

export interface OrganizerDoc {
  items: OrganizerItem[];
  /** Split tool: split AFTER item index k (k in 1..n-1). */
  dividers: number[];
  mode: SplitMode;
}

export function makeItem(fileIndex: number, fileName: string, page: number): OrganizerItem {
  return {
    id: `${fileIndex}:${page}`,
    fileIndex,
    fileName,
    page,
    angle: 0,
    markedDelete: false,
    removed: false,
  };
}

export function makeDoc(items: OrganizerItem[]): OrganizerDoc {
  return { items, dividers: [], mode: "ranges" };
}

export type OrganizerAction =
  | { type: "init"; items: OrganizerItem[] }
  | { type: "appendItems"; items: OrganizerItem[] }
  | { type: "moveItems"; ids: string[]; toIndex: number }
  | { type: "removeItems"; ids: string[] }
  | { type: "restoreItems"; ids: string[] }
  | { type: "rotateItems"; ids: string[]; step: number }
  | { type: "setAngle"; id: string; angle: number }
  | { type: "setAngles"; ids: string[]; angle: number }
  | { type: "resetAngles" }
  | { type: "toggleMarkDelete"; ids: string[] }
  | { type: "setMarkDelete"; ids: string[]; marked: boolean }
  | { type: "setMarked"; ids: string[] }
  | { type: "clearMarks" }
  | { type: "toggleDivider"; afterIndex: number }
  | { type: "setDividers"; dividers: number[] }
  | { type: "clearDividers" }
  | { type: "setMode"; mode: SplitMode }
  | { type: "setOrder"; order: number[] }
  | { type: "reverseOrder" };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function organizerReducer(doc: OrganizerDoc, action: OrganizerAction): OrganizerDoc {
  switch (action.type) {
    case "init":
      return makeDoc(action.items);

    case "appendItems": {
      // Merge "add files": append pages of newly picked files, keeping
      // the existing order/marks/angles untouched. Undoable like any edit.
      const known = new Set(doc.items.map((it) => it.id));
      const fresh = action.items.filter((it) => !known.has(it.id));
      if (fresh.length === 0) return doc;
      return { ...doc, items: [...doc.items, ...fresh] };
    }

    case "moveItems": {
      const moving = doc.items.filter((it) => action.ids.includes(it.id));
      if (moving.length === 0) return doc;
      const rest = doc.items.filter((it) => !action.ids.includes(it.id));
      const to = clamp(action.toIndex, 0, rest.length);
      return {
        ...doc,
        items: [...rest.slice(0, to), ...moving, ...rest.slice(to)],
      };
    }

    case "removeItems":
      return {
        ...doc,
        items: doc.items.map((it) =>
          action.ids.includes(it.id) ? { ...it, removed: true } : it,
        ),
      };

    case "restoreItems":
      return {
        ...doc,
        items: doc.items.map((it) =>
          action.ids.includes(it.id) ? { ...it, removed: false } : it,
        ),
      };

    case "rotateItems":
      return {
        ...doc,
        items: doc.items.map((it) =>
          action.ids.includes(it.id)
            ? { ...it, angle: (((it.angle + action.step) % 360) + 360) % 360 }
            : it,
        ),
      };

    case "setAngle":
      return {
        ...doc,
        items: doc.items.map((it) =>
          it.id === action.id ? { ...it, angle: ((action.angle % 360) + 360) % 360 } : it,
        ),
      };

    case "setAngles":
      return {
        ...doc,
        items: doc.items.map((it) =>
          action.ids.includes(it.id)
            ? { ...it, angle: ((action.angle % 360) + 360) % 360 }
            : it,
        ),
      };

    case "resetAngles":
      return { ...doc, items: doc.items.map((it) => ({ ...it, angle: 0 })) };

    case "toggleMarkDelete": {
      const marked = new Set(
        doc.items.filter((it) => it.markedDelete).map((it) => it.id),
      );
      for (const id of action.ids) {
        if (marked.has(id)) marked.delete(id);
        else marked.add(id);
      }
      return {
        ...doc,
        items: doc.items.map((it) => ({ ...it, markedDelete: marked.has(it.id) })),
      };
    }

    case "setMarkDelete":
      return {
        ...doc,
        items: doc.items.map((it) =>
          action.ids.includes(it.id) ? { ...it, markedDelete: action.marked } : it,
        ),
      };

    case "setMarked": {
      const marked = new Set(action.ids);
      return {
        ...doc,
        items: doc.items.map((it) => ({ ...it, markedDelete: marked.has(it.id) })),
      };
    }

    case "clearMarks":
      return { ...doc, items: doc.items.map((it) => ({ ...it, markedDelete: false })) };

    case "toggleDivider": {
      const k = action.afterIndex;
      if (k < 1 || k >= doc.items.length) return doc;
      const has = doc.dividers.includes(k);
      return {
        ...doc,
        dividers: has
          ? doc.dividers.filter((d) => d !== k)
          : [...doc.dividers, k].sort((a, b) => a - b),
      };
    }

    case "setDividers":
      return {
        ...doc,
        dividers: [...new Set(action.dividers)]
          .filter((d) => d >= 1 && d < doc.items.length)
          .sort((a, b) => a - b),
      };

    case "clearDividers":
      return { ...doc, dividers: [] };

    case "setMode":
      return { ...doc, mode: action.mode };

    case "setOrder": {
      // Reorder items by 1-based page numbers (Reorder text fallback).
      // Invalid input (not a permutation) leaves the order untouched.
      const byPage = new Map(doc.items.map((it) => [it.page, it]));
      const next = action.order.map((p) => byPage.get(p)).filter(Boolean) as typeof doc.items;
      if (next.length !== doc.items.length) return doc;
      return { ...doc, items: next };
    }

    case "reverseOrder":
      return { ...doc, items: [...doc.items].reverse() };

    default:
      return doc;
  }
}

/** Split helper: group boundaries from dividers -> [start, end] page ranges (1-based). */
export function splitGroups(itemCount: number, dividers: number[]): Array<[number, number]> {
  const cuts = [...new Set(dividers)]
    .filter((d) => d >= 1 && d < itemCount)
    .sort((a, b) => a - b);
  const groups: Array<[number, number]> = [];
  let start = 1;
  for (const cut of cuts) {
    groups.push([start, cut]);
    start = cut + 1;
  }
  groups.push([start, itemCount]);
  return groups;
}
