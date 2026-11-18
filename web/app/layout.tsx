// Root layout is a passthrough: each route group renders its own
// <html>/<body> (lang/dir differ per locale) via components/SiteLayout.
// Next.js requires html/body somewhere in the rendered tree, not
// necessarily in this file.
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
