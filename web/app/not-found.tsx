// Real 404 page (I18N-4 / DISC-02 fix). The auto-generated 404 was a bare
// fragment with no <html>/<body> (the root layout is a passthrough and the
// group layouts render html/body via SiteLayout), so it failed to hydrate
// and rendered as a blank white page with React #418/#423 errors. This page
// renders through SiteLayout (locale "en") like every other page, so the
// built out/404/index.html is a complete document that hydrates cleanly.
// The page is English-only: unknown URLs have no locale to translate into.
// robots noindex is kept, matching the default 404 page's behaviour.
import type { Metadata } from "next";
import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { SiteLayout } from "../components/SiteLayout";

export const metadata: Metadata = {
  title: "404: This page could not be found.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  setRequestLocale("en");
  return (
    <SiteLayout locale="en">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-6xl font-extrabold tracking-tight text-brand-600">404</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          The page you are looking for does not exist or was moved.
        </p>
        <p className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
          >
            &larr; Back to all tools
          </Link>
          <Link
            href="/lawyers"
            className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:border-brand-600 hover:text-brand-600"
          >
            For lawyers
          </Link>
        </p>
      </div>
    </SiteLayout>
  );
}
