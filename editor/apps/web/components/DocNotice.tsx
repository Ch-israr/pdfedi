'use client';

import { useEditor } from '@/store/editor';

const STYLES = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
} as const;

const ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️' } as const;

/** Dismissible informational banner (restore status, scanned notice, …). */
export function DocNotice() {
  const notice = useEditor((s) => s.notice);
  const dismissNotice = useEditor((s) => s.dismissNotice);
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-4 border-b px-4 py-2.5 ${STYLES[notice.kind]}`}
    >
      <p className="text-sm">
        <span aria-hidden className="mr-2">{ICONS[notice.kind]}</span>
        {notice.message}
      </p>
      <button
        type="button"
        onClick={dismissNotice}
        aria-label="Dismiss notice"
        className="shrink-0 rounded-md px-2 py-1 text-sm font-medium opacity-70 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
