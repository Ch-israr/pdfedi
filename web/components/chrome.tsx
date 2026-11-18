import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { toLocalePath, type LocaleSegment } from "../i18n/routing";

export async function Header({
  locale,
  showLanguageUI = true,
}: {
  locale: LocaleSegment;
  showLanguageUI?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "chrome" });
  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href={toLocalePath("/", locale)} className="flex items-center gap-2">
          <img src="/logo.png" alt="PDFEDI logo" className="h-9 w-9 rounded-lg" />
          <span className="text-xl font-extrabold tracking-tight text-brand-600">
            PDFEDI
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href={toLocalePath("/", locale)} className="hover:text-brand-600">
            {t("allTools")}
          </Link>
          <Link href={toLocalePath("/lawyers", locale)} className="hover:text-brand-600">
            {t("forLawyers")}
          </Link>
          {showLanguageUI && <LanguageSwitcher locale={locale} />}
        </nav>
      </div>
    </header>
  );
}

export async function Footer({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "chrome" });
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500">
        <p className="flex items-center gap-2 font-semibold text-slate-700">
          <img src="/logo.png" alt="PDFEDI logo" className="h-8 w-8 rounded-md" />
          {t("tagline")}
        </p>
        <p className="mt-1">{t("footerNote")}</p>
      </div>
    </footer>
  );
}
