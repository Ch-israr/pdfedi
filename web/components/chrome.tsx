import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MobileNav } from "./MobileNav";
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
    <header className="relative border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href={toLocalePath("/", locale)} prefetch={false} className="flex shrink-0 items-center gap-2">
          <img src="/logo.png" alt="PDFEDI logo" className="h-9 w-9 rounded-lg" />
          <span className="text-xl font-extrabold tracking-tight text-brand-600">
            PDFEDI
          </span>
        </Link>
        {/* Desktop nav — hidden below 480 px, where the hamburger takes over.
            (DISC-03/PERF-01: at 375 px these links overlapped the logo.) */}
        <nav className="hidden min-[480px]:flex items-center gap-4 text-sm text-slate-600">
          <Link href={toLocalePath("/", locale)} prefetch={false} className="hover:text-brand-600">
            {t("allTools")}
          </Link>
          <Link href={toLocalePath("/lawyers", locale)} prefetch={false} className="hover:text-brand-600">
            {t("forLawyers")}
          </Link>
          {showLanguageUI && <LanguageSwitcher locale={locale} />}
        </nav>
        {/* Mobile controls — hamburger + language switcher, desktop-hidden. */}
        <div className="flex min-[480px]:hidden items-center gap-2">
          {showLanguageUI && <LanguageSwitcher locale={locale} showLabel={false} />}
          <MobileNav
            homeHref={toLocalePath("/", locale)}
            lawyersHref={toLocalePath("/lawyers", locale)}
            allToolsLabel={t("allTools")}
            forLawyersLabel={t("forLawyers")}
            menuLabel={t("menu")}
            closeMenuLabel={t("closeMenu")}
          />
        </div>
      </div>
    </header>
  );
}

export async function Footer({ locale }: { locale: LocaleSegment }) {
  const t = await getTranslations({ locale, namespace: "chrome" });
  const links: Array<{ href: string; label: string }> = [
    { href: "/privacy", label: t("privacy") },
    { href: "/terms", label: t("terms") },
    { href: "/about", label: t("about") },
    { href: "/contact", label: t("contact") },
    { href: "/lawyers", label: t("forLawyers") },
    { href: "/how-we-handle-files", label: t("howWeHandleFiles") },
  ];
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500">
        <p className="flex items-center gap-2 font-semibold text-slate-700">
          <img src="/logo.png" alt="PDFEDI logo" className="h-8 w-8 rounded-md" />
          {t("tagline")}
        </p>
        <p className="mt-1">{t("footerNote")}</p>
        <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={toLocalePath(l.href, locale)}
              prefetch={false}
              className="hover:text-brand-600"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
