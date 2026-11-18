// Non-intrusive language suggestion banner.
// Trigger: first visit, no saved preference, browser language maps to a
// supported non-English locale, and the suggestion was not dismissed
// this session. Shown ~800 ms after load so it never blocks first paint.
// English stays active until the user clicks "Switch". Never shown to a
// user with a saved preference, and never re-shown after a dismiss in
// the same session. Country/IP is never consulted.
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LOCALES, matchBrowserLocales, toLocalePath, type LocaleSegment } from "../i18n/routing";
import {
  dismissSuggestionForSession,
  getSavedLocale,
  isSuggestionDismissed,
  saveLocalePreference,
} from "../lib/locale-pref";

export function LanguageSuggest({ locale }: { locale: string }) {
  const t = useTranslations("suggest");
  const pathname = usePathname();
  const router = useRouter();
  const [suggested, setSuggested] = useState<LocaleSegment | null>(null);

  useEffect(() => {
    if (getSavedLocale()) return; // a saved preference wins; never prompt
    if (isSuggestionDismissed()) return;
    const timer = window.setTimeout(() => {
      const match = matchBrowserLocales(navigator.languages ?? [navigator.language]);
      if (match && match !== "en" && match !== locale) setSuggested(match);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!suggested) return null;
  const info = LOCALES[suggested];

  function basePath(): string {
    const parts = (pathname || "/").split("/").filter(Boolean);
    if (parts.length > 0 && parts[0] in LOCALES) parts.shift();
    const p = "/" + parts.join("/");
    return p === "/" ? "/" : p.replace(/\/$/, "");
  }

  function accept() {
    if (!suggested) return;
    saveLocalePreference(suggested);
    router.push(toLocalePath(basePath(), suggested));
  }

  function dismiss() {
    dismissSuggestionForSession();
    setSuggested(null);
  }

  return (
    <div
      role="status"
      dir={info.dir}
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:mb-6"
    >
      <p className="font-semibold text-slate-800">
        {t("title", { language: info.englishName })}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {t("subtitle", { language: info.englishName, nativeName: info.nativeName })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={accept}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {t("switch", { language: info.englishName })}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-600 hover:text-brand-600"
        >
          {t("continue")}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="ms-auto rounded-lg px-2 py-2 text-sm text-slate-500 hover:text-slate-800"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
