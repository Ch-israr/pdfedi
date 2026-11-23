// Mobile navigation (DISC-03 / PERF-01 fix). Client component: the Header
// is a server component, so the hamburger toggle lives here. Below the
// 480 px breakpoint the desktop nav links are hidden (see chrome.tsx) and
// this button + dropdown take their place; at 480 px and above this whole
// component is hidden by CSS. The dropdown is positioned against the
// <header> (which is relative) so it spans the full width below the bar.
"use client";

import { useState } from "react";
import Link from "next/link";

export function MobileNav({
  homeHref,
  lawyersHref,
  allToolsLabel,
  forLawyersLabel,
  menuLabel,
  closeMenuLabel,
}: {
  homeHref: string;
  lawyersHref: string;
  allToolsLabel: string;
  forLawyersLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? closeMenuLabel : menuLabel}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:border-brand-600 hover:text-brand-600"
      >
        {open ? (
          <span aria-hidden className="text-lg leading-none">
            ✕
          </span>
        ) : (
          <span aria-hidden className="text-lg leading-none">
            ☰
          </span>
        )}
      </button>
      {open && (
        <nav
          aria-label={menuLabel}
          className="absolute inset-x-0 top-full z-50 border-b border-slate-200 bg-white px-4 py-2 shadow-sm"
        >
          <Link
            href={homeHref}
            prefetch={false}
            onClick={() => setOpen(false)}
            className="block py-2 text-sm font-medium text-slate-700 hover:text-brand-600"
          >
            {allToolsLabel}
          </Link>
          <Link
            href={lawyersHref}
            prefetch={false}
            onClick={() => setOpen(false)}
            className="block py-2 text-sm font-medium text-slate-700 hover:text-brand-600"
          >
            {forLawyersLabel}
          </Link>
        </nav>
      )}
    </>
  );
}
