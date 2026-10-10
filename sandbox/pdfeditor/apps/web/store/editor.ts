/**
 * Editor store — the single source of truth.
 *
 * Privacy rules enforced here:
 * - `pdfBytes` lives only in memory. It is never written to localStorage,
 *   sessionStorage, IndexedDB, or sent to FastAPI.
 * - Export produces FRESH bytes via pdf-core; the original is never mutated.
 */
'use client';

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  deletePage as coreDeletePage,
  duplicatePage as coreDuplicatePage,
  reorderPage as coreReorderPage,
  rotatePage as coreRotatePage,
} from '@pdfeditor/pdf-core';
import type {
  EditorElement,
  HistoryCommand,
  HistoryRecord,
  NativeTextItem,
  Page,
} from '@pdfeditor/shared';
import { loadPdfDocument } from '@/lib/pdfjs';

export type ToolId =
  | 'select'
  | 'move'
  | 'text'
  | 'image'
  | 'highlight'
  | 'signature'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'shape-arrow';

interface EditorState {
  // Document (memory only)
  fileName: string | null;
  fileSize: number;
  pdfBytes: Uint8Array | null;
  pageCount: number;

  // Pages & elements (UUID-keyed)
  pages: Page[];
  elements: Record<string, EditorElement>;
  activePageId: string | null;

  // UI
  tool: ToolId;
  selectedId: string | null;
  zoom: number;
  loading: boolean;
  error: string | null;
  /** Dismissible informational banner (restore status, scanned notice, …) */
  notice: { kind: 'info' | 'success' | 'warning'; message: string } | null;
  /** Native text fragments extracted per page (for direct text editing) */
  nativeText: Record<string, NativeTextItem[]>;
  /** One-time warning shown when native editing is attempted on flat content */
  nativeEditWarned: boolean;
  // Smart guides + snapping (user-controlled, never forced)
  snapEnabled: boolean;
  snapThreshold: number; // PDF points

  // History (command-based)
  past: HistoryCommand[];
  future: HistoryCommand[];
  /** Serializable metadata log parallel to past[] (for history panel) */
  historyLog: HistoryRecord[];
  /** Local autosave status */
  saveStatus: 'saved' | 'saving' | 'error' | 'idle';

  // Actions
  loadPdf: (file: File) => Promise<void>;
  closeDocument: () => void;
  setTool: (tool: ToolId) => void;
  setZoom: (zoom: number) => void;
  setActivePage: (pageId: string) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapThreshold: (pt: number) => void;
  addElement: (el: EditorElement, label?: string) => void;
  updateElement: (id: string, patch: Partial<EditorElement>, label?: string, opts?: { mergeKey?: string }) => void;
  deleteElement: (id: string) => void;
  duplicateElement: (id: string) => void;
  select: (id: string | null) => void;
  rotatePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  duplicatePage: (pageId: string) => void;
  insertBlankPage: (afterPageId?: string | null) => void;
  reorderPage: (pageId: string, toIndex: number) => void;
  undo: () => void;
  redo: () => void;
  exportBytes: () => Promise<Uint8Array>;
  download: () => Promise<void>;
  /** Trigger a debounced local autosave */
  autosave: () => void;
  /** Load recovered document from IndexedDB */
  recoverDocument: () => Promise<boolean>;
  /** Dismiss the informational banner */
  dismissNotice: () => void;
  /** Store extracted native text items for a page */
  setNativeText: (pageId: string, items: NativeTextItem[]) => void;
  /** Mark the one-time native-edit warning as shown */
  markNativeEditWarned: () => void;
  /**
   * Find native text fragments matching a query.
   * Returns matches with page info and any existing replacement element.
   * Only searches natively extracted text (no OCR).
   */
  findTextMatches: (query: string, caseSensitive: boolean) => Array<{
    pageId: string;
    pageNumber: number;
    item: NativeTextItem;
    existingElementId: string | null;
  }>;
  /**
   * Replace the text of a single native text fragment.
   * @param pageId The page containing the fragment
   * @param item The native text fragment (from findTextMatches)
   * @param query The search query to replace
   * @param replacement The replacement text
   * @param caseSensitive Whether matching is case-sensitive
   * Creates a native-text element or updates the existing one.
   * Returns the element ID, or null if the replacement was not safe.
   */
  replaceTextMatch: (pageId: string, item: NativeTextItem, query: string, replacement: string, caseSensitive: boolean) => string | null;
}

function pushHistory(
  state: { past: HistoryCommand[]; future: HistoryCommand[]; historyLog: HistoryRecord[]; pages: Page[] },
  cmd: Omit<HistoryCommand, 'id'>,
) {
  const id = crypto.randomUUID();
  const fullCmd: HistoryCommand = { ...cmd, id };
  state.past.push(fullCmd);
  if (state.past.length > 100) {
    const removed = state.past.shift()!;
    // Remove the corresponding log record by command ID (stable across splices)
    const logIdx = state.historyLog.findIndex((r) => r.commandId === removed.id);
    if (logIdx !== -1) state.historyLog.splice(logIdx, 1);
  }
  state.future = [];
  // Create serializable metadata record
  const pageNumber = cmd.meta?.pageId
    ? state.pages.findIndex((p) => p.id === cmd.meta!.pageId!) + 1 || undefined
    : undefined;
  state.historyLog.push({
    id: crypto.randomUUID(),
    commandId: id,
    actionType: cmd.meta?.actionType ?? 'unknown',
    label: cmd.label,
    timestamp: Date.now(),
    pageNumber: pageNumber && pageNumber > 0 ? pageNumber : undefined,
    pageId: cmd.meta?.pageId,
    objectIds: cmd.meta?.objectIds,
    commandIndex: state.past.length - 1,
  });
}

export const useEditor = create<EditorState>()(
  immer((set, get) => ({
    fileName: null,
    fileSize: 0,
    pdfBytes: null,
    pageCount: 0,
    pages: [],
    elements: {},
    activePageId: null,
    tool: 'select',
    selectedId: null,
    zoom: 1,
    loading: false,
    error: null,
    notice: null,
    nativeText: {},
    nativeEditWarned: false,
    snapEnabled: true,
    snapThreshold: 5,
    past: [],
    future: [],
    historyLog: [],
    saveStatus: 'idle',

    loadPdf: async (file) => {
      set((s) => {
        s.loading = true;
        s.error = null;
        s.notice = null;
      });
      try {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          throw new Error('Please choose a PDF file.');
        }
        if (file.size > 50 * 1024 * 1024) {
          throw new Error('File exceeds the 50 MB limit.');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());

        // PDFEDI state package: a previously downloaded PDF carries its own
        // editing state as attachments — restore it instead of starting fresh.
        const { tryRestorePdfediPackage, looksScanned, RestoreError } = await import(
          '@/lib/pdfedi-state'
        );
        let pdfBytes: Uint8Array = bytes;
        let pages: Page[];
        let pageCount: number;
        let elements: Record<string, EditorElement> = {};
        let notice: { kind: 'info' | 'success' | 'warning'; message: string } | null = null;

        let restoreError: unknown = null;
        let restored: Awaited<ReturnType<typeof tryRestorePdfediPackage>> = null;
        try {
          restored = await tryRestorePdfediPackage(bytes);
        } catch (e) {
          if (e instanceof RestoreError) restoreError = e;
          else throw e;
        }

        if (restored) {
          // Valid package: edit against the embedded CLEAN source so the
          // flattened overlays in the uploaded file are never duplicated.
          // This also prevents recursive nesting — every export re-embeds
          // the original clean source, never the previous output.
          pdfBytes = restored.sourceBytes;
          pages = restored.pages;
          pageCount = pages.length;
          elements = restored.elements;
          const n = Object.keys(elements).length;
          notice = {
            kind: 'success',
            message:
              n > 0
                ? `Editing session restored — ${n} object${n === 1 ? '' : 's'} recovered. Continue editing.`
                : 'Editing session restored. Continue editing.',
          };
        } else {
          const loaded = await loadPdfDocument(bytes);
          pageCount = loaded.pageCount;
          pages = loaded.pages;
          if (restoreError instanceof RestoreError) {
            // A manifest was present but unusable: open the visible content
            // as a new document and explain clearly. Never invent objects.
            notice = { kind: 'warning', message: `${restoreError.message} Opened as a new document.` };
          } else if (/-edited\.pdf$/i.test(file.name)) {
            // Likely a PDFEDI download whose attachments were stripped by
            // another application.
            notice = {
              kind: 'warning',
              message:
                'This looks like a PDFEDI download, but its editing data was not found (it may have been removed by another app). Previous additions cannot be restored.',
            };
          } else if (await looksScanned(bytes)) {
            // Heuristic only — no OCR is performed.
            notice = {
              kind: 'info',
              message:
                'This PDF appears to contain scanned or flattened content. The original content cannot be edited directly, but you can add and edit your own text, signatures, images, shapes, and other supported objects.',
            };
          }
        }

        set((s) => {
          s.fileName = file.name;
          s.fileSize = file.size;
          s.pdfBytes = pdfBytes;
          s.pageCount = pageCount;
          s.pages = pages;
          s.elements = elements;
          s.activePageId = pages[0]?.id ?? null;
          s.selectedId = null;
          s.past = [];
          s.future = [];
          s.historyLog = [];
          s.tool = 'select';
          s.loading = false;
          s.notice = notice;
          s.nativeText = {};
          s.nativeEditWarned = false;
        });
      } catch (e) {
        set((s) => {
          s.loading = false;
          s.error = e instanceof Error ? e.message : 'Failed to load PDF.';
        });
      }
    },

    closeDocument: () => {
      set((s) => {
        // Drop every byte — nothing persists.
        s.fileName = null;
        s.fileSize = 0;
        s.pdfBytes = null;
        s.pageCount = 0;
        s.pages = [];
        s.elements = {};
        s.activePageId = null;
        s.selectedId = null;
        s.past = [];
        s.future = [];
        s.historyLog = [];
        s.error = null;
        s.notice = null;
        s.nativeText = {};
        s.nativeEditWarned = false;
      });
    },

    setTool: (tool) => set((s) => { s.tool = tool; }),
    setZoom: (zoom) =>
      set((s) => { s.zoom = Math.min(3, Math.max(0.25, zoom)); }),
    setActivePage: (pageId) => set((s) => { s.activePageId = pageId; }),
    setSnapEnabled: (enabled) => set((s) => { s.snapEnabled = enabled; }),
    setSnapThreshold: (pt) => set((s) => { s.snapThreshold = Math.max(1, Math.min(20, pt)); }),
    select: (id) => set((s) => { s.selectedId = id; }),

    addElement: (el, label = 'Add element') => {
      const snapshot = el;
      set((s) => {
        s.elements[el.id] = el;
        s.selectedId = el.id;
        pushHistory(s, {
          label,
          meta: {
            actionType: 'add-element',
            pageId: el.pageId,
            objectIds: [el.id],
          },
          undo: () => {
            useEditor.setState((st) => {
              delete st.elements[snapshot.id];
              if (st.selectedId === snapshot.id) st.selectedId = null;
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              st.elements[snapshot.id] = snapshot;
            });
          },
        });
      });
    },

    updateElement: (id, patch, label = 'Edit element', opts) => {
      const before = get().elements[id];
      if (!before) return;
      const mergeKey = opts?.mergeKey;
      set((s) => {
        Object.assign(s.elements[id], patch);
        const afterSnap = { ...s.elements[id] };
        const last = s.past[s.past.length - 1];
        if (mergeKey && last && last.mergeKey === mergeKey) {
          // Same drag session: fold into the previous command so one
          // drag = one undo step. Keep the original undo (pre-drag state).
          last.redo = () => {
            useEditor.setState((st) => { st.elements[id] = afterSnap; });
          };
          last.label = label;
          const logEntry = s.historyLog[s.historyLog.length - 1];
          if (logEntry) logEntry.label = label;
          return;
        }
        const beforeSnap = { ...before };
        pushHistory(s, {
          label,
          mergeKey,
          undo: () => {
            useEditor.setState((st) => { st.elements[id] = beforeSnap; });
          },
          redo: () => {
            useEditor.setState((st) => { st.elements[id] = afterSnap; });
          },
        });
      });
    },

    deleteElement: (id) => {
      const el = get().elements[id];
      if (!el) return;

      // Native-text deletion: convert to a mask (empty text) instead of
      // removing, so the source text stays covered and the area remains blank.
      // Deleting a mask (already empty) removes it entirely, revealing the
      // original. This preserves masking state through delete/undo/redo.
      if (el.kind === 'native-text' && el.text.trim() !== '') {
        const maskEl = { ...el, text: '' };
        set((s) => {
          s.elements[id] = maskEl as EditorElement;
          if (s.selectedId === id) s.selectedId = null;
          pushHistory(s, {
            label: 'Delete native text',
            undo: () => {
              useEditor.setState((st) => { st.elements[id] = el; });
            },
            redo: () => {
              useEditor.setState((st) => {
                st.elements[id] = maskEl as EditorElement;
                if (st.selectedId === id) st.selectedId = null;
              });
            },
          });
        });
        return;
      }

      set((s) => {
        delete s.elements[id];
        if (s.selectedId === id) s.selectedId = null;
        pushHistory(s, {
          label: 'Delete element',
          undo: () => {
            useEditor.setState((st) => { st.elements[id] = el; });
          },
          redo: () => {
            useEditor.setState((st) => {
              delete st.elements[id];
              if (st.selectedId === id) st.selectedId = null;
            });
          },
        });
      });
    },

    duplicateElement: (id) => {
      const el = get().elements[id];
      if (!el) return;
      const copyId = crypto.randomUUID();
      // Offset slightly so the duplicate is visible
      const copy = { ...el, id: copyId, x: el.x + 12, y: el.y - 12 };
      set((s) => {
        s.elements[copyId] = copy as EditorElement;
        s.selectedId = copyId;
        pushHistory(s, {
          label: 'Duplicate element',
          meta: { actionType: 'duplicate-element', pageId: el.pageId, objectIds: [copyId] },
          undo: () => {
            useEditor.setState((st) => {
              delete st.elements[copyId];
              st.selectedId = id;
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              st.elements[copyId] = copy as EditorElement;
              st.selectedId = copyId;
            });
          },
        });
      });
    },

    rotatePage: (pageId) => {
      set((s) => {
        const idx = s.pages.findIndex((p) => p.id === pageId);
        if (idx === -1) return;
        const before = s.pages[idx];
        const after = coreRotatePage(before);
        s.pages[idx] = after;
        pushHistory(s, {
          label: 'Rotate page',
          undo: () => {
            useEditor.setState((st) => {
              const i = st.pages.findIndex((p) => p.id === pageId);
              if (i !== -1) st.pages[i] = before;
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              const i = st.pages.findIndex((p) => p.id === pageId);
              if (i !== -1) st.pages[i] = after;
            });
          },
        });
      });
    },

    deletePage: (pageId) => {
      const state = get();
      const idx = state.pages.findIndex((p) => p.id === pageId);
      if (idx === -1 || state.pages.length <= 1) return;
      const removedPage = state.pages[idx];
      const removedElements = Object.values(state.elements).filter(
        (e) => e.pageId === pageId,
      );
      set((s) => {
        s.pages = coreDeletePage(s.pages, pageId);
        for (const e of removedElements) delete s.elements[e.id];
        if (s.activePageId === pageId) s.activePageId = s.pages[0]?.id ?? null;
        if (removedElements.some((e) => e.id === s.selectedId)) s.selectedId = null;
        pushHistory(s, {
          label: 'Delete page',
          undo: () => {
            useEditor.setState((st) => {
              st.pages.splice(idx, 0, removedPage);
              for (const e of removedElements) st.elements[e.id] = e;
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              st.pages = coreDeletePage(st.pages, pageId);
              for (const e of removedElements) delete st.elements[e.id];
            });
          },
        });
      });
    },

    duplicatePage: (pageId) => {
      const state = get();
      const idx = state.pages.findIndex((p) => p.id === pageId);
      if (idx === -1) return;
      const copy = coreDuplicatePage(state.pages[idx]);
      // Duplicate elements onto the new page with fresh ids
      const elCopies: EditorElement[] = Object.values(state.elements)
        .filter((e) => e.pageId === pageId)
        .map((e) => ({ ...e, id: crypto.randomUUID(), pageId: copy.id }));
      set((s) => {
        s.pages.splice(idx + 1, 0, copy);
        for (const e of elCopies) s.elements[e.id] = e;
        pushHistory(s, {
          label: 'Duplicate page',
          undo: () => {
            useEditor.setState((st) => {
              st.pages = coreDeletePage(st.pages, copy.id);
              for (const e of elCopies) delete st.elements[e.id];
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              const i = st.pages.findIndex((p) => p.id === pageId);
              st.pages.splice(i + 1, 0, copy);
              for (const e of elCopies) st.elements[e.id] = e;
            });
          },
        });
      });
    },

    insertBlankPage: (afterPageId) => {
      const state = get();
      if (state.pages.length === 0) return;
      // Reference page selection (in priority order):
      // 1. Explicit afterPageId (if valid)
      // 2. Currently selected page (activePageId) — for mixed-size PDFs
      // 3. Last page (fallback)
      // The new blank page inherits the reference page's actual dimensions
      // (width/height in PDF points), which already reflect any rotation.
      let insertIdx: number;
      let refPage: Page;
      const effectiveAfterId = afterPageId ?? state.activePageId;
      if (effectiveAfterId) {
        const refIdx = state.pages.findIndex((p) => p.id === effectiveAfterId);
        if (refIdx === -1) {
          insertIdx = state.pages.length;
          refPage = state.pages[state.pages.length - 1];
        } else {
          insertIdx = refIdx + 1;
          refPage = state.pages[refIdx];
        }
      } else {
        // No selection: append to end, reference last page
        insertIdx = state.pages.length;
        refPage = state.pages[state.pages.length - 1];
      }
      const blank: Page = {
        id: crypto.randomUUID(),
        sourceIndex: 0, // 0 = blank inserted page (no source to copy)
        width: refPage.width,
        height: refPage.height,
        rotation: 0,
      };
      set((s) => {
        s.pages.splice(insertIdx, 0, blank);
        s.pageCount = s.pages.length;
        pushHistory(s, {
          label: 'Insert blank page',
          undo: () => {
            useEditor.setState((st) => {
              st.pages = coreDeletePage(st.pages, blank.id);
              st.pageCount = st.pages.length;
            });
          },
          redo: () => {
            useEditor.setState((st) => {
              const i = afterPageId
                ? st.pages.findIndex((p) => p.id === afterPageId)
                : st.pages.length - 1;
              st.pages.splice(i + 1, 0, blank);
              st.pageCount = st.pages.length;
            });
          },
        });
      });
    },

    reorderPage: (pageId, toIndex) => {
      const before = get().pages;
      set((s) => {
        s.pages = coreReorderPage(s.pages, pageId, toIndex);
        const after = s.pages;
        pushHistory(s, {
          label: 'Reorder page',
          undo: () => {
            useEditor.setState((st) => { st.pages = before; });
          },
          redo: () => {
            useEditor.setState((st) => { st.pages = after; });
          },
        });
      });
    },

    undo: () => {
      const cmd = get().past[get().past.length - 1];
      if (!cmd) return;
      set((s) => {
        s.past.pop();
        s.future.push(cmd);
      });
      void cmd.undo();
    },

    redo: () => {
      const cmd = get().future[get().future.length - 1];
      if (!cmd) return;
      set((s) => {
        s.future.pop();
        s.past.push(cmd);
      });
      void cmd.redo();
    },

    exportBytes: async () => {
      const s = get();
      if (!s.pdfBytes) throw new Error('No document loaded.');

      // Fast path: no edits made — return the original bytes unchanged.
      // This avoids embedding the source PDF and manifest when the user
      // simply uploads and downloads without changes, keeping the output
      // size identical to the input.
      const hasElements = Object.keys(s.elements).length > 0;
      const pagesModified =
        s.pages.length !== s.pageCount ||
        s.pages.some((p, i) => p.sourceIndex !== i + 1 || (p.rotation ?? 0) !== 0);
      if (!hasElements && !pagesModified) {
        return s.pdfBytes;
      }

      // Build the PDFEDI state package: manifest + clean source + assets,
      // embedded as file attachments so the download stays re-editable.
      // s.pdfBytes is always the clean source (for restored sessions it is
      // the extracted original), so recursive nesting cannot occur.
      const {
        buildManifestParts,
        createManifest,
        sha256Hex,
        exportPdfWithState,
      } = await import('@pdfeditor/pdf-core');
      const parts = await buildManifestParts(s.pages, s.elements, async (el) => {
        if (el.kind !== 'image' && el.kind !== 'signature') return null;
        try {
          const res = await fetch(el.src);
          if (!res.ok) return null;
          const buf = await res.arrayBuffer();
          if (buf.byteLength === 0) return null;
          return {
            bytes: new Uint8Array(buf),
            mime: el.kind === 'image' ? el.mime : 'image/png',
          };
        } catch {
          return null;
        }
      });
      const sourceHash = await sha256Hex(s.pdfBytes);
      const manifest = createManifest(sourceHash, s.pages, parts.elements, parts.manifestAssets);
      return exportPdfWithState(
        { srcBytes: s.pdfBytes, pages: s.pages, elements: s.elements },
        { manifest, sourceBytes: s.pdfBytes, assets: parts.assets },
      );
    },

    download: async () => {
      const bytes = await get().exportBytes();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = (get().fileName ?? 'document.pdf').replace(/\.pdf$/i, '');
      a.href = url;
      a.download = `${base}-edited.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Privacy: revoke immediately after the download starts
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },

    dismissNotice: () => set((s) => { s.notice = null; }),
    setNativeText: (pageId, items) =>
      set((s) => {
        if (!s.nativeText) s.nativeText = {};
        s.nativeText[pageId] = items;
      }),
    markNativeEditWarned: () => set((s) => { s.nativeEditWarned = true; }),

    findTextMatches: (query, caseSensitive) => {
      if (!query) return [];
      const s = get();
      const matches: Array<{
        pageId: string;
        pageNumber: number;
        item: NativeTextItem;
        existingElementId: string | null;
      }> = [];
      const q = caseSensitive ? query : query.toLowerCase();
      for (const page of s.pages) {
        const items = s.nativeText?.[page.id] ?? [];
        for (const item of items) {
          const text = caseSensitive ? item.text : item.text.toLowerCase();
          if (!text.includes(q)) continue;
          // Check if a native-text element already covers this fragment
          const existing = Object.values(s.elements).find(
            (el) =>
              el.kind === 'native-text' &&
              el.pageId === page.id &&
              Math.abs(el.x - item.x) < 1 &&
              Math.abs(el.y - item.y) < 1,
          );
          matches.push({
            pageId: page.id,
            pageNumber: s.pages.indexOf(page) + 1,
            item,
            existingElementId: existing?.id ?? null,
          });
        }
      }
      return matches;
    },

    replaceTextMatch: (pageId, item, query, replacement, caseSensitive) => {
      const s = get();
      // Find existing element covering this fragment
      const existing = Object.values(s.elements).find(
        (el): el is Extract<EditorElement, { kind: 'native-text' }> =>
          el.kind === 'native-text' &&
          el.pageId === pageId &&
          Math.abs(el.x - item.x) < 1 &&
          Math.abs(el.y - item.y) < 1,
      );
      // Determine the source text:
      // - If an element exists with non-empty text, use its current text.
      // - If it's a mask (empty text from deletion), use the originalText
      //   so Replace can restore content into the masked area.
      // - Otherwise, use the fragment's original text.
      const sourceText = existing
        ? (existing.text ? existing.text : existing.originalText)
        : item.text;
      // Perform the replacement (all occurrences within this fragment)
      let newText: string;
      if (caseSensitive) {
        newText = sourceText.split(query).join(replacement);
      } else {
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        newText = sourceText.replace(regex, replacement);
      }
      // If nothing changed, skip
      if (newText === sourceText) return existing?.id ?? null;

      const label = `Find & Replace — "${replacement.length > 30 ? replacement.slice(0, 30) + '…' : replacement}"`;
      if (existing) {
        s.updateElement(existing.id, { text: newText }, label);
        return existing.id;
      } else {
        const elId = crypto.randomUUID();
        s.addElement(
          {
            id: elId,
            pageId,
            kind: 'native-text',
            x: item.x,
            y: item.y,
            rotation: 0,
            originalText: item.text,
            text: newText,
            width: item.width,
            height: item.height,
            baselineOffset: item.baselineOffset,
            fontSize: item.fontSize,
            fontFamily: item.fontFamily,
            color: '#000000',
            bold: item.bold,
            italic: item.italic,
          },
          label,
        );
        return elId;
      }
    },

    autosave: () => {
      // Debounced in the caller; this performs the actual save
      const s = get();
      if (!s.pdfBytes || s.pages.length === 0) return;
      // Don't overwrite a recovery snapshot with an unedited document
      if (s.historyLog.length === 0) return;
      set({ saveStatus: 'saving' });
      import('@/lib/persistence').then(({ saveDocument }) => {
        const pdfBytes = s.pdfBytes!;
        // Copy bytes for IndexedDB (it needs ArrayBuffer)
        const buf = pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength,
        ) as ArrayBuffer;
        saveDocument({
          fileName: s.fileName,
          fileSize: s.fileSize,
          pdfBytes: buf,
          pages: s.pages,
          elements: s.elements,
          historyLog: s.historyLog,
        })
          .then(() => {
            if (get().pdfBytes) set({ saveStatus: 'saved' });
          })
          .catch(() => set({ saveStatus: 'error' }));
      });
    },

    recoverDocument: async () => {
      const { loadDocument } = await import('@/lib/persistence');
      const doc = await loadDocument();
      if (!doc || !doc.pdfBytes) return false;
      const pages = doc.pages as Page[];
      const elements = doc.elements as Record<string, EditorElement>;
      const pdfBytes = new Uint8Array(doc.pdfBytes);
      // Pause autosave during recovery to prevent overwriting the snapshot
      // with intermediate empty state
      set((s) => {
        s.saveStatus = 'saving'; // blocks autosave via the guard below
      });
      set((s) => {
        s.fileName = doc.fileName;
        s.fileSize = doc.fileSize;
        // Force PDF.js reload by changing the bytes reference
        // (append a no-op copy to guarantee a new reference)
        s.pdfBytes = pdfBytes.slice();
        s.pageCount = pages.length;
        // Deep-clone to avoid any IndexedDB structured-clone proxy issues
        s.pages = JSON.parse(JSON.stringify(pages));
        s.elements = JSON.parse(JSON.stringify(elements));
        s.activePageId = pages[0]?.id ?? null;
        s.selectedId = null;
        s.past = [];
        s.future = [];
        s.historyLog = JSON.parse(JSON.stringify(doc.historyLog ?? []));
        s.saveStatus = 'saved';
      });
      return true;
    },
  })),
);
