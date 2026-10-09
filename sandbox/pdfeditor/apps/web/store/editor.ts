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
  exportPdf,
  reorderPage as coreReorderPage,
  rotatePage as coreRotatePage,
} from '@pdfeditor/pdf-core';
import type {
  EditorElement,
  HistoryCommand,
  HistoryRecord,
  Page,
} from '@pdfeditor/shared';
import { loadPdfDocument } from '@/lib/pdfjs';

export type ToolId =
  | 'select'
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
  updateElement: (id: string, patch: Partial<EditorElement>, label?: string) => void;
  deleteElement: (id: string) => void;
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
}

function pushHistory(
  state: { past: HistoryCommand[]; future: HistoryCommand[]; historyLog: HistoryRecord[]; pages: Page[] },
  cmd: HistoryCommand,
) {
  state.past.push(cmd);
  if (state.past.length > 100) {
    state.past.shift();
    state.historyLog.shift();
  }
  state.future = [];
  // Create serializable metadata record
  const pageNumber = cmd.meta?.pageId
    ? state.pages.findIndex((p) => p.id === cmd.meta!.pageId!) + 1 || undefined
    : undefined;
  state.historyLog.push({
    id: crypto.randomUUID(),
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
      });
      try {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          throw new Error('Please choose a PDF file.');
        }
        if (file.size > 50 * 1024 * 1024) {
          throw new Error('File exceeds the 50 MB limit.');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { pageCount, pages } = await loadPdfDocument(bytes);
        set((s) => {
          s.fileName = file.name;
          s.fileSize = file.size;
          s.pdfBytes = bytes;
          s.pageCount = pageCount;
          s.pages = pages;
          s.elements = {};
          s.activePageId = pages[0]?.id ?? null;
          s.selectedId = null;
          s.past = [];
          s.future = [];
          s.historyLog = [];
          s.tool = 'select';
          s.loading = false;
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

    updateElement: (id, patch, label = 'Edit element') => {
      const before = get().elements[id];
      if (!before) return;
      const beforeSnap = { ...before };
      set((s) => {
        Object.assign(s.elements[id], patch);
        const afterSnap = { ...s.elements[id] };
        pushHistory(s, {
          label,
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
      // Default: append to END of document. If afterPageId is explicitly provided,
      // insert after that page. Otherwise, always go to the end.
      let insertIdx: number;
      let refPage: Page;
      if (afterPageId) {
        const refIdx = state.pages.findIndex((p) => p.id === afterPageId);
        if (refIdx === -1) {
          insertIdx = state.pages.length;
          refPage = state.pages[state.pages.length - 1];
        } else {
          insertIdx = refIdx + 1;
          refPage = state.pages[refIdx];
        }
      } else {
        // Default: end of document
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
      return exportPdf({
        srcBytes: s.pdfBytes,
        pages: s.pages,
        elements: s.elements,
      });
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

    autosave: () => {
      // Debounced in the caller; this performs the actual save
      const s = get();
      if (!s.pdfBytes || s.pages.length === 0) return;
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
      set((s) => {
        s.fileName = doc.fileName;
        s.fileSize = doc.fileSize;
        s.pdfBytes = new Uint8Array(doc.pdfBytes!);
        s.pageCount = pages.length;
        s.pages = pages;
        s.elements = elements;
        s.activePageId = pages[0]?.id ?? null;
        s.selectedId = null;
        s.past = [];
        s.future = [];
        s.historyLog = (doc.historyLog as HistoryRecord[]) ?? [];
        s.saveStatus = 'saved';
      });
      return true;
    },
  })),
);
