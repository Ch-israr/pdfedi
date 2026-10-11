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
 *
 * Recommended scroll behavior (per UI reference review):
 * - The production site header (logo/nav) should NOT be fixed — let it
 *   scroll away with the page so the document gets maximum vertical space.
 * - The editor Toolbar must stay visible while scrolling: keep it
 *   `position: sticky; top: 0` (or the equivalent in the site's layout)
 *   so tools remain reachable on long documents.
 * - The footer is not fixed either — it sits at the page bottom, after
 *   the editor. (In this dev preview the app uses a fixed viewport with
 *   internal document scrolling, so the toolbar is already always visible
 *   and the placeholders demonstrate the mount points.)
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
