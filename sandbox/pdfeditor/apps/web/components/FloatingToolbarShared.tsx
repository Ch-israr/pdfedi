'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Shared positioning logic for floating toolbars.
 * Positions the toolbar above the element, falling back below if there's
 * insufficient space. Keeps the toolbar within the viewport horizontally.
 * Recalculates on scroll, zoom, resize, and element changes.
 */
export function useFloatingToolbarPosition({
  elementScreenX,
  elementScreenTop,
  elementScreenHeight,
  zoom,
}: {
  elementScreenX: number;
  elementScreenTop: number;
  elementScreenHeight: number;
  zoom: number;
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const recalculate = useCallback(() => {
    const gap = 12 * zoom;
    const toolbarH = 48;
    const toolbarW = 320; // approximate max width

    // Prefer above; fall back below if insufficient space
    const placeAbove = elementScreenTop - gap - toolbarH > 4;
    const top = placeAbove
      ? elementScreenTop - gap - toolbarH
      : elementScreenTop + elementScreenHeight + gap;

    // Keep within viewport horizontally
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    let left = elementScreenX;
    const halfW = toolbarW / 2;
    if (left - halfW < 8) left = halfW + 8;
    if (left + halfW > viewportW - 8) left = viewportW - halfW - 8;

    setPosition({ top: Math.max(4, top), left });
  }, [elementScreenX, elementScreenTop, elementScreenHeight, zoom]);

  useEffect(() => {
    recalculate();
    // Recalculate on scroll, resize, zoom changes
    window.addEventListener('scroll', recalculate, true);
    window.addEventListener('resize', recalculate);
    return () => {
      window.removeEventListener('scroll', recalculate, true);
      window.removeEventListener('resize', recalculate);
    };
  }, [recalculate]);

  return position;
}

/**
 * Common props and event handlers for floating toolbars.
 * Prevents toolbar interactions from affecting the canvas underneath.
 */
export function useToolbarEvents() {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const keepFocus = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return { stop, keepFocus };
}

export const toolbarBtn =
  'flex h-8 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-sm transition-colors hover:bg-slate-100 text-slate-700';

export const toolbarDivider = <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />;
