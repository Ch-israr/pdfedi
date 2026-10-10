'use client';

import type { ToolId } from '@/store/editor';

/**
 * Consistent stroke-based tool icons (24×24, currentColor).
 * Replaces the previous mixed unicode/emoji glyphs.
 */

function base(props: React.SVGProps<SVGSVGElement> = {}) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function ToolIcon({ id }: { id: ToolId }) {
  switch (id) {
    case 'select':
      return (
        <svg {...base()}>
          <path d="M5 3l7 18 2.5-7.5L22 11 5 3z" />
        </svg>
      );
    case 'text':
      // Typography: text lines (not a bare "T")
      return (
        <svg {...base()}>
          <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
        </svg>
      );
    case 'image':
      return (
        <svg {...base()}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4.5 18.5l5-5 3.5 3.5 2.5-2.5 4 4" />
        </svg>
      );
    case 'highlight':
      return (
        <svg {...base()}>
          <path d="M9 11l-5.5 5.5a2.1 2.1 0 003 3L12 14" />
          <path d="M14.5 5.5l4 4L20 8l-4-4-1.5 1.5z" />
          <path d="M14.5 5.5L9 11" />
          <path d="M3 21h8" strokeWidth={2.5} />
        </svg>
      );
    case 'signature':
      return (
        <svg {...base()}>
          <path d="M4 20c2-1 3-6 4.5-6S10 18 11.5 18s1.5-8 3-8 2.5 6 4 6 2-3 2.5-3" />
          <path d="M14 4l6 6" />
        </svg>
      );
    case 'shape-rect':
      return (
        <svg {...base()}>
          <rect x="4" y="6" width="16" height="12" rx="1" />
        </svg>
      );
    case 'shape-ellipse':
      return (
        <svg {...base()}>
          <ellipse cx="12" cy="12" rx="8" ry="6" />
        </svg>
      );
    case 'shape-line':
      return (
        <svg {...base()}>
          <path d="M5 19L19 5" />
          <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'shape-arrow':
      return (
        <svg {...base()}>
          <path d="M4 20L20 4" />
          <path d="M14 4h6v6" />
        </svg>
      );
    default:
      return null;
  }
}
