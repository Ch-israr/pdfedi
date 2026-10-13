import type { ToolId } from '@/store/editor';

/**
 * Every shape tool the editor supports. The Shapes dropdown lists
 * exactly these — no more, no fewer — and each maps to an existing
 * drawing workflow via its tool id.
 */
export const SHAPE_TOOLS: { id: ToolId; label: string; shortcut?: string }[] = [
  { id: 'shape-rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'shape-ellipse', label: 'Ellipse' },
  { id: 'shape-line', label: 'Line', shortcut: 'L' },
  { id: 'shape-arrow', label: 'Arrow', shortcut: 'A' },
];
