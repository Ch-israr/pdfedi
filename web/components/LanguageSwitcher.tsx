// Language switcher — header dropdown listing all 10 languages by
// native name (never a flag). Selecting a language navigates to the
// equivalent page in that locale and saves the preference (localStorage
// + cookie). Client component: it reads the current path to preserve
// the page across the switch.
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LOCALES, LOCALE_SEGMENTS, isLocaleSegment, toLocalePath } from "../i18n/routing";
import { saveLocalePreference } from "../lib/locale-pref";

export function LanguageSwitcher({ locale, showLabel = true }: { locale: string; showLabel?: boolean }) {
  const t = useTranslations("switcher");
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  // Strip the locale prefix (if any) to get the locale-agnostic path.
  function basePath(): string {
    const parts = (pathname || "/").split("/").filter(Boolean);
    if (parts.length > 0 && isLocaleSegment(parts[0])) parts.shift();
    const p = "/" + parts.join("/");
    return p === "/" ? "/" : p.replace(/\/$/, "");
  }

  function switchTo(target: string) {
    setOpen(false);
    saveLocalePreference(target);
    router.push(toLocalePath(basePath(), target));
  }

  const current = LOCALES[locale as keyof typeof LOCALES] ?? LOCALES.en;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("choose")}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-600 hover:text-brand-600"
      >
        <span aria-hidden>🌐</span>
        {showLabel && <span>{current.nativeName}</span>}
        <span aria-hidden className="text-xs">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("choose")}
          className="absolute end-0 z-50 mt-1 max-h-80 w-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {LOCALE_SEGMENTS.map((seg) => {
            const info = LOCALES[seg];
            const active = seg === locale;
            return (
              <li key={seg} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => switchTo(seg)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-brand-50 ${
                    active ? "font-bold text-brand-700" : "text-slate-700"
                  }`}
                >
                  <span>
                    <span lang={info.bcp47}>{info.nativeName}</span>
                    <span className="ms-2 text-xs text-slate-400">{info.englishName}</span>
                  </span>
                  {active && <span aria-hidden>✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
