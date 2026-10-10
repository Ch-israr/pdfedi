'use client';

import { useState } from 'react';
import type { EditorElement } from '@pdfeditor/shared';
import { useEditor } from '@/store/editor';

const FONTS = [
  { label: 'Arial', value: 'Helvetica' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Times New Roman', value: 'Times-Roman' },
  { label: 'Courier New', value: 'Courier' },
  { label: 'Georgia', value: 'Georgia' },
];

/**
 * Floating toolbar for selected text elements.
 * Appears above the selected text; actions affect only that element.
 * All pointer events are stopped so toolbar clicks never create/move/deselect.
 */
export function FloatingTextToolbar({
  el,
  screenX,
  screenY,
  textHeight,
  zoom,
  editing,
  overrideUpdate,
}: {
  el: Extract<EditorElement, { kind: 'text' | 'native-text' }>;
  screenX: number;
  screenY: number;
  textHeight: number;
  zoom: number;
  editing: boolean;
  /** Optional: intercept updates (for new-text mode with pending formatting) */
  overrideUpdate?: (id: string, patch: Partial<Extract<EditorElement, { kind: 'text' | 'native-text' }>>) => void;
}) {
  const storeUpdate = useEditor((s) => s.updateElement);
  const updateElement = overrideUpdate
    ? (id: string, patch: Partial<Extract<EditorElement, { kind: 'text' | 'native-text' }>>, _label?: string) =>
        overrideUpdate(id, patch)
    : storeUpdate;
  const deleteElement = useEditor((s) => s.deleteElement);
  const isNewMode = el.id === '__new__';
  const [showLink, setShowLink] = useState(false);
  const [linkInput, setLinkInput] = useState(el.kind === 'text' ? (el.link ?? '') : '');
  const [copied, setCopied] = useState(false);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // Prevent toolbar interactions from stealing focus from the text editor
  const keepFocus = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // screenY is the text TOP. Position toolbar above with zoom-aware gap.
  // If insufficient space above, place below the text bottom.
  const gap = 12 * zoom;
  const toolbarH = 48;
  const placeAbove = screenY - gap - toolbarH > 4;
  const top = placeAbove ? screenY - gap - toolbarH : screenY + textHeight + gap;

  const normalizeUrl = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    // Block unsafe schemes
    if (/^(javascript|data|vbscript|file):/i.test(t)) return null;
    // Add https:// if no scheme
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  };

  const saveLink = () => {
    if (el.kind !== 'text') return; // links are text-element only
    const url = normalizeUrl(linkInput);
    if (url) {
      updateElement(el.id, { link: url }, 'Add link');
    } else if (!linkInput.trim()) {
      // Empty = remove link
      updateElement(el.id, { link: undefined }, 'Remove link');
    }
    setShowLink(false);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(el.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable; fallback via textarea
      const ta = document.createElement('textarea');
      ta.value = el.text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-brand-500 bg-white px-2 py-1.5 shadow-lg"
      style={{
        left: screenX,
        top,
        maxWidth: 'calc(100vw - 2rem)',
      }}
      onPointerDown={keepFocus}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Bold */}
      <button
        type="button"
        title="Bold"
        aria-label="Bold"
        aria-pressed={el.bold}
        className={`flex h-8 w-8 items-center justify-center rounded text-lg font-bold transition-colors ${
          el.bold ? 'bg-brand-50 text-brand-600' : 'text-brand-600 hover:bg-slate-100'
        }`}
        onClick={() => updateElement(el.id, { bold: !el.bold }, 'Toggle bold')}
      >
        B
      </button>
      {/* Italic */}
      <button
        type="button"
        title="Italic"
        aria-label="Italic"
        aria-pressed={el.italic}
        className={`flex h-8 w-8 items-center justify-center rounded text-lg italic transition-colors ${
          el.italic ? 'bg-brand-50 text-brand-600' : 'text-brand-600 hover:bg-slate-100'
        }`}
        onClick={() => updateElement(el.id, { italic: !el.italic }, 'Toggle italic')}
      >
        I
      </button>
      <div className="h-6 w-px bg-slate-200" aria-hidden />
      {/* Font size dropdown */}
      <div className="relative">
        <button
          type="button"
          title="Font size"
          aria-label="Font size"
          className="flex h-8 items-center gap-0.5 rounded px-1.5 text-brand-600 hover:bg-slate-100"
          onClick={(e) => {
            e.stopPropagation();
            // Simple cycle through common sizes; full dropdown would need popover
            const sizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
            const idx = sizes.findIndex((s) => s >= el.fontSize);
            const next = sizes[(idx + 1) % sizes.length];
            updateElement(el.id, { fontSize: next }, 'Change font size');
          }}
        >
          <span className="text-base font-bold">T</span>
          <span className="text-xs">T</span>
          <span className="text-[10px]">▼</span>
        </button>
      </div>
      <div className="h-6 w-px bg-slate-200" aria-hidden />
      {/* Font family dropdown */}
      <select
        value={el.fontFamily}
        aria-label="Font family"
        title="Font family"
        onChange={(e) => updateElement(el.id, { fontFamily: e.target.value }, 'Change font')}
        onClick={stop}
        className="h-8 cursor-pointer rounded bg-transparent px-1 text-sm font-medium text-brand-600 hover:bg-slate-100"
        style={{ maxWidth: '4rem' }}
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="h-6 w-px bg-slate-200" aria-hidden />
      {/* Color */}
      <label
        title="Text color"
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded text-brand-600 hover:bg-slate-100"
        onClick={stop}
      >
        <span aria-hidden className="text-lg">
          🎨
        </span>
        <span className="text-[10px]">▼</span>
        <span className="sr-only">Text color</span>
        <input
          type="color"
          value={el.color}
          aria-label="Text color"
          onChange={(e) => updateElement(el.id, { color: e.target.value }, 'Change text color')}
          className="absolute inset-0 cursor-pointer opacity-0"
          onClick={stop}
        />
      </label>
      <div className="h-6 w-px bg-slate-200" aria-hidden />
      {/* Link (hidden in new mode; text elements only) */}
      {!isNewMode && el.kind === 'text' && (
        <>
          <button
            type="button"
            title={el.link ? `Edit link: ${el.link}` : 'Add link'}
            aria-label={el.link ? 'Edit hyperlink' : 'Add hyperlink'}
            aria-pressed={!!el.link}
            className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
              el.link ? 'bg-brand-50 text-brand-600' : 'text-brand-600 hover:bg-slate-100'
            }`}
            onClick={() => {
              setLinkInput(el.link ?? '');
              setShowLink((v) => !v);
            }}
          >
            <span className="text-base">🔗</span>
          </button>
          <div className="h-6 w-px bg-slate-200" aria-hidden />
        </>
      )}
      {/* Copy (hidden in new mode) */}
      {!isNewMode && (
        <>
          <button
            type="button"
            title={copied ? 'Copied!' : 'Copy text'}
            aria-label="Copy text"
            className="flex h-8 w-8 items-center justify-center rounded text-brand-600 hover:bg-slate-100"
            onClick={copyText}
          >
            <span className="text-base">{copied ? '✓' : '⧉'}</span>
          </button>
          <div className="h-6 w-px bg-slate-200" aria-hidden />
        </>
      )}
      {/* Delete (hidden in new mode) */}
      {!isNewMode && (
        <button
          type="button"
          title="Delete text"
          aria-label="Delete text element"
          className="flex h-8 w-8 items-center justify-center rounded text-brand-600 hover:bg-red-50 hover:text-red-600"
          onClick={() => deleteElement(el.id)}
        >
          <span className="text-base">🗑</span>
        </button>
      )}

      {/* Link editor popover (text elements only) */}
      {showLink && el.kind === 'text' && (
        <div
          className="absolute left-1/2 top-full z-40 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
          onClick={stop}
          onPointerDown={stop}
        >
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Link URL (https://…)
          </label>
          <div className="flex gap-1">
            <input
              type="url"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') saveLink();
                if (e.key === 'Escape') setShowLink(false);
              }}
              placeholder="https://example.com"
              className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-xs"
              autoFocus
            />
            <button
              type="button"
              onClick={saveLink}
              className="h-8 rounded-md bg-brand-500 px-2 text-xs font-medium text-white hover:bg-brand-600"
            >
              OK
            </button>
          </div>
          {el.link && (
            <button
              type="button"
              onClick={() => {
                updateElement(el.id, { link: undefined }, 'Remove link');
                setShowLink(false);
              }}
              className="mt-1 text-xs text-red-600 hover:underline"
            >
              Remove link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
