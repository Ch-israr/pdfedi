// Translation completeness check — run with: node scripts/check-translations.mjs
// Compares every locale's messages/<locale>/{common,tool-content}.json
// against English. Reports, per locale:
//   - missing keys (present in en, absent in locale) -> FAIL
//   - empty values -> FAIL
//   - broken ICU (unparseable message, or placeholders/tags that do not
//     match the English source) -> FAIL
//   - extra keys (present in locale, absent in en) -> WARN
//   - identical-to-English prose (suspicious untranslated string) -> WARN
//     (values that legitimately stay English — URLs, tool slugs/keys,
//     identifiers, "PDFEDI" — are allowlisted and not warned about)
// Exit code is non-zero when any locale FAILs. Warnings do not fail
// the build, but every warning must be dispositioned in the final
// verification report.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const EN = "en";

function load(locale, file) {
  const p = join(root, locale, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

// Flatten a nested JSON object to dotted key paths (arrays keep indices).
function flatten(obj, prefix = "", out = {}) {
  if (obj !== null && typeof obj === "object") {
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    } else {
      for (const [k, v] of Object.entries(obj)) {
        flatten(v, prefix ? `${prefix}.${k}` : k, out);
      }
    }
  } else {
    out[prefix] = obj;
  }
  return out;
}

// Placeholders and rich-text tags in an ICU message string.
function placeholders(s) {
  const vars = new Set();
  for (const m of String(s).matchAll(/\{([a-zA-Z0-9_]+)[,\}]/g)) vars.add(m[1]);
  const tags = new Set();
  for (const m of String(s).matchAll(/<([a-zA-Z][a-zA-Z0-9]*)>/g)) tags.add(m[1]);
  return { vars, tags };
}

// Values that legitimately stay identical to English.
function isAllowlistedIdentical(value) {
  if (typeof value !== "string") return true; // numbers/bools are not prose
  const v = value.trim();
  if (v === "") return false;
  if (/^https?:\/\//.test(v)) return true; // URLs
  if (/^[a-z0-9_\-./]+$/.test(v)) return true; // slugs, keys, paths, extensions
  if (/^[A-Z0-9 _\-/().,%°×→]+$/i.test(v) && /pdf|mb|kb|dpi/i.test(v)) return true; // units/formats
  if (["PDFEDI", "PDF", "ZIP", "OCR", "EXIF", "GPS", "XMP", "C2PA", "Bates"].includes(v)) return true;
  if (/^\d+$/.test(v)) return true; // pure numbers
  return false;
}

const enCommon = load(EN, "common.json");
const enTools = load(EN, "tool-content.json");
if (!enCommon || !enTools) {
  console.error("English source messages are missing — cannot check.");
  process.exit(2);
}
const enFlat = {
  ...flatten(enCommon),
  ...Object.fromEntries(
    Object.entries(flatten(enTools)).map(([k, v]) => [`toolContent.${k}`, v]),
  ),
};

const locales = readdirSync(root).filter((d) => d !== EN);
let failed = false;

for (const locale of locales.sort()) {
  const common = load(locale, "common.json");
  const tools = load(locale, "tool-content.json");
  const report = { missing: [], empty: [], brokenIcu: [], extra: [], untranslated: [] };
  if (!common || !tools) {
    console.log(`\n== ${locale} ==\n  FAIL: missing file(s): ${!common ? "common.json " : ""}${!tools ? "tool-content.json" : ""}(full English fallback in effect)`);
    failed = true;
    continue;
  }
  const flat = {
    ...flatten(common),
    ...Object.fromEntries(
      Object.entries(flatten(tools)).map(([k, v]) => [`toolContent.${k}`, v]),
    ),
  };

  for (const [key, enVal] of Object.entries(enFlat)) {
    if (!(key in flat)) {
      report.missing.push(key);
      continue;
    }
    const val = flat[key];
    if (typeof val === "string" && val.trim() === "") {
      // Only a failure when the English source is non-empty; some
      // source strings are legitimately empty (e.g. option help text
      // the backend does not provide).
      if (typeof enVal === "string" && enVal.trim() !== "") report.empty.push(key);
      continue;
    }
    if (typeof enVal === "string" && typeof val === "string") {
      // ICU parse check (skip strings that are pure identifiers/URLs).
      if (!isAllowlistedIdentical(enVal)) {
        try {
          new IntlMessageFormat(val, locale);
        } catch (e) {
          report.brokenIcu.push(`${key} :: ${String(e.message).slice(0, 120)}`);
          continue;
        }
        const enPh = placeholders(enVal);
        const loPh = placeholders(val);
        const missingVars = [...enPh.vars].filter((v) => !loPh.vars.has(v));
        const extraVars = [...loPh.vars].filter((v) => !enPh.vars.has(v));
        const missingTags = [...enPh.tags].filter((t) => !loPh.tags.has(t));
        // Plural/select structure: if English pluralizes a variable,
        // the translation must pluralize the same variable (a flat
        // "{count} files" loses the singular/plural distinction).
        const enPlurals = new Set(
          [...String(enVal).matchAll(/\{([a-zA-Z0-9_]+),\s*(plural|select|selectordinal)/g)].map((m) => `${m[1]}:${m[2]}`),
        );
        const loPlurals = new Set(
          [...String(val).matchAll(/\{([a-zA-Z0-9_]+),\s*(plural|select|selectordinal)/g)].map((m) => `${m[1]}:${m[2]}`),
        );
        const missingPlurals = [...enPlurals].filter((p) => !loPlurals.has(p));
        if (missingVars.length || extraVars.length || missingTags.length || missingPlurals.length) {
          report.brokenIcu.push(
            `${key} :: vars missing [${missingVars}] extra [${extraVars}] tags missing [${missingTags}] plurals missing [${missingPlurals}]`,
          );
        }
      }
      // Untranslated prose.
      if (val === enVal && !isAllowlistedIdentical(enVal)) {
        report.untranslated.push(key);
      }
    }
  }
  for (const key of Object.keys(flat)) {
    if (!(key in enFlat)) report.extra.push(key);
  }

  const total = Object.keys(enFlat).length;
  const translated = total - report.missing.length - report.empty.length;
  console.log(`\n== ${locale} ==`);
  console.log(`  keys: ${translated}/${total} present (${((translated / total) * 100).toFixed(1)}%)`);
  if (report.missing.length) { failed = true; console.log(`  MISSING (${report.missing.length}):\n    - ${report.missing.slice(0, 30).join("\n    - ")}${report.missing.length > 30 ? `\n    ... +${report.missing.length - 30} more` : ""}`); }
  if (report.empty.length) { failed = true; console.log(`  EMPTY (${report.empty.length}):\n    - ${report.empty.join("\n    - ")}`); }
  if (report.brokenIcu.length) { failed = true; console.log(`  BROKEN ICU (${report.brokenIcu.length}):\n    - ${report.brokenIcu.slice(0, 30).join("\n    - ")}${report.brokenIcu.length > 30 ? `\n    ... +${report.brokenIcu.length - 30} more` : ""}`); }
  if (report.extra.length) console.log(`  EXTRA keys (${report.extra.length}): ${report.extra.slice(0, 10).join(", ")}${report.extra.length > 10 ? " ..." : ""}`);
  if (report.untranslated.length) console.log(`  UNTRANSLATED (identical to English, verify) (${report.untranslated.length}):\n    - ${report.untranslated.slice(0, 20).join("\n    - ")}${report.untranslated.length > 20 ? `\n    ... +${report.untranslated.length - 20} more` : ""}`);
  if (!report.missing.length && !report.empty.length && !report.brokenIcu.length) {
    console.log("  PASS (no missing/empty/broken keys)");
  }
}

if (!locales.length) console.log("No non-English locales found under messages/.");
process.exit(failed ? 1 : 0);
