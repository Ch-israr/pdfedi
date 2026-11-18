// Language preference persistence (client-side only — there is no
// server to read these under static export).
// - localStorage `pdfedi-locale`: primary store, read on load.
// - cookie `pdfedi-locale` (1 year, SameSite=Lax): mirror, so a future
//   server/edge layer can read it and so the preference survives if
//   localStorage is unavailable. A bare locale code is a functional
//   preference, not personal data and not tracking.
// - sessionStorage `pdfedi-lang-suggestion-dismissed`: suppresses the
//   suggestion prompt for the current session only after a dismiss.
// A saved preference is NEVER overwritten automatically — only an
// explicit user selection writes it.
export const LOCALE_STORAGE_KEY = "pdfedi-locale";
export const SUGGESTION_DISMISSED_KEY = "pdfedi-lang-suggestion-dismissed";

export function getSavedLocale(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLocalePreference(locale: string): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* storage unavailable — cookie still set below */
  }
  try {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${LOCALE_STORAGE_KEY}=${encodeURIComponent(locale)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export function isSuggestionDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SUGGESTION_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissSuggestionForSession(): void {
  try {
    window.sessionStorage.setItem(SUGGESTION_DISMISSED_KEY, "1");
  } catch {
    /* ignore */
  }
}
