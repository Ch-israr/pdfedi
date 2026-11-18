// next-intl request config (static export: no middleware, no negotiation).
// Loads the active locale's messages and deep-merges them OVER the English
// messages, so a missing key in any locale renders the English string
// instead of a blank or a key name. The completeness script
// (scripts/check-translations.mjs) fails the build on missing keys, so
// the fallback is a safety net, not the plan.
import { getRequestConfig } from "next-intl/server";
import type { AbstractIntlMessages } from "next-intl";
import { isLocaleSegment } from "./routing";

type Messages = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k] as Messages, v);
    else out[k] = v;
  }
  return out;
}

async function loadMessages(locale: string): Promise<Messages> {
  // A locale whose files have not landed yet (e.g. mid-rollout) falls
  // back to English instead of failing the build. The completeness
  // script (scripts/check-translations.mjs) is the enforcement that
  // every shipped locale is fully translated — this catch is only a
  // safety net for a partially-landed locale.
  try {
    const common = (await import(`../messages/${locale}/common.json`)).default as Messages;
    const toolContent = (await import(`../messages/${locale}/tool-content.json`)).default as Messages;
    return { ...common, toolContent };
  } catch {
    return {};
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !isLocaleSegment(locale)) locale = "en";
  const messages =
    locale === "en"
      ? await loadMessages("en")
      : deepMerge(await loadMessages("en"), await loadMessages(locale));
  return { locale, messages: messages as unknown as AbstractIntlMessages };
});
