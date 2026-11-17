// Organizer state with undo/redo.
//
// Wraps the pure reducer (lib/canvas/organizer.ts) with a history
// stack (depth cap 50). Every document edit — move, remove/restore,
// rotate, mark, divider, mode — is undoable with Ctrl+Z / Ctrl+Y
// (and the Undo/Redo buttons). Selection is view state, kept outside
// the history, so undo never restores a stale selection.
"use client";

import { useCallback, useRef, useState } from "react";
import {
  makeDoc,
  organizerReducer,
  type OrganizerAction,
  type OrganizerDoc,
  type OrganizerItem,
} from "../lib/canvas/organizer";

const HISTORY_CAP = 50;

export function useOrganizer(initialItems: OrganizerItem[]) {
  const [past, setPast] = useState<OrganizerDoc[]>([]);
  const [present, setPresent] = useState<OrganizerDoc>(() => makeDoc(initialItems));
  const [future, setFuture] = useState<OrganizerDoc[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const initialRef = useRef<OrganizerItem[]>(initialItems);

  const dispatch = useCallback((action: OrganizerAction) => {
    setPresent((cur) => {
      const next = organizerReducer(cur, action);
      if (next === cur) return cur;
      setPast((p) => [...p.slice(-(HISTORY_CAP - 1)), cur]);
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setPresent((cur) => {
        setFuture((f) => [cur, ...f].slice(0, HISTORY_CAP));
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPresent((cur) => {
        setPast((p) => [...p.slice(-(HISTORY_CAP - 1)), cur]);
        return next;
      });
      return f.slice(1);
    });
  }, []);

  const reset = useCallback((items?: OrganizerItem[]) => {
    const fresh = makeDoc(items ?? initialRef.current);
    setPresent(fresh);
    setPast([]);
    setFuture([]);
    setSelected([]);
  }, []);

  /**
   * Append pages of newly picked files (Merge "add files") without
   * touching the existing order/marks/angles. Not a history entry —
   * loading files is not an edit; removal has its own explicit action.
   */
  const syncItems = useCallback((items: OrganizerItem[]) => {
    setPresent((cur) => {
      const known = new Set(cur.items.map((it) => it.id));
      const fresh = items.filter((it) => !known.has(it.id));
      if (fresh.length === 0) return cur;
      return { ...cur, items: [...cur.items, ...fresh] };
    });
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  /** Click selection: plain click replaces, shift-click extends a range. */
  const toggleSelect = useCallback(
    (id: string, range: boolean, allIds: string[]) => {
      setSelected((cur) => {
        if (!range) return cur.includes(id) && cur.length === 1 ? [] : [id];
        if (cur.length === 0) return [id];
        const last = cur[cur.length - 1];
        const a = allIds.indexOf(last);
        const b = allIds.indexOf(id);
        if (a === -1 || b === -1) return [...cur, id];
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const span = allIds.slice(lo, hi + 1);
        return [...new Set([...cur, ...span])];
      });
    },
    [],
  );

  const selectAll = useCallback((ids: string[]) => setSelected(ids), []);
  const clearSelection = useCallback(() => setSelected([]), []);

  return {
    doc: present,
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
    syncItems,
    selected,
    setSelected,
    toggleSelect,
    selectAll,
    clearSelection,
  };
}
