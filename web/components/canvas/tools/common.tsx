// Shared props and helpers for the five organizer tool canvases.
"use client";

import { useEffect } from "react";
import type { LoadedPdf } from "../../../lib/canvas/loadPdf";
import type { OrganizerJob } from "../useOrganizerJob";

export interface ToolCanvasProps {
  job: OrganizerJob;
  pdfs: LoadedPdf[];
  localFiles: File[];
  onPick: (files: File[]) => void;
}

/** Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo/redo for a canvas. */
export function useUndoKeys(undo: () => void, redo: () => void, canUndo: boolean, canRedo: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never hijack typing in an input/textarea/select.
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          undo();
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        if (canRedo) {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, canUndo, canRedo]);
}

/** Small toolbar button used by the organizer toolbars. */
export function ToolButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-600 hover:text-brand-600 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
