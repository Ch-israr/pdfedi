'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeUrl } from '@/lib/url';

/**
 * Inline URL prompt shown after drag-drawing a link region.
 * Enter/button saves (http/https only), Escape discards.
 */
export function LinkUrlEditor({
  screenX,
  screenY,
  onSave,
  onDiscard,
}: {
  screenX: number;
  screenY: number;
  onSave: (url: string) => void;
  onDiscard: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const discardOnce = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDiscard();
  };

  const save = () => {
    if (settledRef.current) return;
    const url = normalizeUrl(value);
    if (!url) {
      setError('Enter a valid http(s) address');
      return;
    }
    settledRef.current = true;
    onSave(url);
  };

  return (
    <div
      className="absolute z-20 rounded-lg border-2 border-brand-500 bg-white p-2 shadow-lg"
      style={{ left: screenX, top: screenY }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="mb-1 block text-[11px] font-medium text-slate-600">
        Link address
      </label>
      <div className="flex items-center gap-1.5">
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              discardOnce();
            }
          }}
          onBlur={() => {
            // Blur without a value discards the pending region; a typed
            // value is kept until explicitly saved or escaped.
            if (!value.trim()) discardOnce();
          }}
          placeholder="https://example.com"
          aria-label="Link address"
          className="w-56 rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          className="rounded bg-brand-500 px-2.5 py-1 text-sm font-medium text-white hover:bg-brand-600"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
