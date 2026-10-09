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
  zoom,
}: {
  el: Extract<EditorElement, { kind: 'text' }>;
  screenX: number;
  screenY: number;
  zoom: number;
}) {
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);
  const [showLink, setShowLink] = useState(false);
  const [linkInput, setLinkInput] = useState(el.link ?? '');
  const [copied, setCopied] = useState(false);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const btn =
    'flex h-8 min-w-[2rem] items-center justify-center rounded-md px-1 text-sm transition-colors hover:bg-slate-100';

  // Zoom-aware gap: scales with zoom so spacing stays consistent.
  const gap = 12 * zoom;
  const toolbarH = 48;
  const placeAbove = screenY - gap - toolbarH > 4;

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
      className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-xl"
      style={{
        left: screenX,
        top: placeAbove ? screenY - gap - toolbarH : screenY + gap,
        maxWidth: 'calc(100vw - 2rem)',
      }}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {/* Font family */}
      <select
        value={el.fontFamily}
        aria-label="Font family"
        title="Font family"
        onChange={(e) => updateElement(el.id, { fontFamily: e.target.value }, 'Change font')}
        onClick={stop}
        className="h-8 max-w-[7rem] rounded-md border border-slate-200 bg-white px-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      {/* Bold / Italic */}
      <button
        type="button"
        title="Bold"
        aria-label="Bold"
        aria-pressed={el.bold}
        className={`${btn} font-bold ${el.bold ? 'bg-brand-50 text-brand-600' : 'text-slate-700'}`}
        onClick={() => updateElement(el.id, { bold: !el.bold }, 'Toggle bold')}
      >
        B
      </button>
      <button
        type="button"
        title="Italic"
        aria-label="Italic"
        aria-pressed={el.italic}
        className={`${btn} italic ${el.italic ? 'bg-brand-50 text-brand-600' : 'text-slate-700'}`}
        onClick={() => updateElement(el.id, { italic: !el.italic }, 'Toggle italic')}
      >
        I
      </button>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      {/* Font size */}
      <button
        type="button"
        title="Decrease font size"
        aria-label="Decrease font size"
        className={`${btn} text-slate-700`}
        onClick={() =>
          updateElement(el.id, { fontSize: Math.max(6, el.fontSize - 2) }, 'Decrease font size')
        }
      >
        A−
      </button>
      <span className="min-w-[2rem] text-center text-xs tabular-nums text-slate-600" aria-live="polite">
        {el.fontSize}
      </span>
      <button
        type="button"
        title="Increase font size"
        aria-label="Increase font size"
        className={`${btn} text-slate-700`}
        onClick={() =>
          updateElement(el.id, { fontSize: Math.min(144, el.fontSize + 2) }, 'Increase font size')
        }
      >
        A+
      </button>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      {/* Color */}
      <label
        title="Text color"
        className={`${btn} relative cursor-pointer text-slate-700`}
        onClick={stop}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-xs font-bold"
          style={{ color: el.color, borderBottom: `3px solid ${el.color}` }}
        >
          A
        </span>
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
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      {/* Copy */}
      <button
        type="button"
        title={copied ? 'Copied!' : 'Copy text'}
        aria-label="Copy text"
        className={`${btn} text-slate-700`}
        onClick={copyText}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {/* Link */}
      <button
        type="button"
        title={el.link ? `Edit link: ${el.link}` : 'Add link'}
        aria-label={el.link ? 'Edit hyperlink' : 'Add hyperlink'}
        aria-pressed={!!el.link}
        className={`${btn} ${el.link ? 'bg-brand-50 text-brand-600' : 'text-slate-700'}`}
        onClick={() => {
          setLinkInput(el.link ?? '');
          setShowLink((v) => !v);
        }}
      >
        🔗
      </button>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      {/* Delete */}
      <button
        type="button"
        title="Delete text"
        aria-label="Delete text element"
        className={`${btn} text-red-600 hover:bg-red-50`}
        onClick={() => deleteElement(el.id)}
      >
        🗑
      </button>

      {/* Link editor popover */}
      {showLink && (
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
