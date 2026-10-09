'use client';

import { DevHeader } from './DevHeader';
import { DevFooter } from './DevFooter';
import { EditorContent } from './EditorContent';

/**
 * Set to false (or remove this wrapper) when integrating into production.
 * When disabled, only EditorContent renders — no placeholder space,
 * no extra wrappers, no margins.
 *
 * Production integration:
 *   <YourProductionHeader />
 *   <EditorContent />
 *   <YourProductionFooter />
 */
const DEV_LAYOUT_ENABLED =
  process.env.NEXT_PUBLIC_DEV_LAYOUT !== 'false';

export function DevelopmentLayout() {
  if (!DEV_LAYOUT_ENABLED) {
    return (
      <div className="h-screen">
        <EditorContent />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <DevHeader />
      <div className="min-h-0 flex-1">
        <EditorContent />
      </div>
      <DevFooter />
    </div>
  );
}
