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
 * - The footer is not fixed either — it sits at the page end, after
 *   the editor. The Pages sidebar is sticky below the toolbar with its
 *   own scroll for many-page documents.
 */
const DEV_LAYOUT_ENABLED =
  process.env.NEXT_PUBLIC_DEV_LAYOUT !== 'false';

export function DevelopmentLayout() {
  if (!DEV_LAYOUT_ENABLED) {
    return (
      <div className="min-h-screen">
        <EditorContent />
      </div>
    );
  }

  // Document-flow page (reference behavior): the page itself scrolls, the
  // dev header scrolls away with it, the editor Toolbar sticks to the top,
  // and the footer sits at the page end — nothing is viewport-fixed.
  return (
    <div className="min-h-screen bg-slate-100">
      <DevHeader />
      <EditorContent />
      <DevFooter />
    </div>
  );
}
