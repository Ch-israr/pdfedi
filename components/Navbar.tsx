"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Navbar() {
  const { user, loading, logout, isAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        pathname === href
          ? "text-brand-700 bg-brand-50"
          : "text-slate-600 hover:text-brand-700 hover:bg-slate-100"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-lg">
              P
            </span>
            <span className="text-xl font-bold text-slate-900">
              PDF<span className="text-brand-600">EDI</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {link("/", "Home")}
            {link("/pricing", "Pricing")}
            {user && link("/dashboard", "Dashboard")}
            {user && link("/files", "My Files")}
            {isAdmin && link("/admin", "Admin")}
          </nav>

          <div className="flex items-center gap-2">
            {loading ? (
              <div className="h-9 w-24 animate-pulse rounded-md bg-slate-100" />
            ) : user ? (
              <>
                <Link
                  href="/account"
                  className="hidden sm:block px-3 py-2 text-sm font-medium text-slate-600 hover:text-brand-700"
                >
                  {user.name || user.email}
                </Link>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-brand-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden flex gap-1 pb-3 overflow-x-auto">
          {link("/", "Home")}
          {link("/pricing", "Pricing")}
          {user && link("/dashboard", "Dashboard")}
          {user && link("/files", "Files")}
          {isAdmin && link("/admin", "Admin")}
        </nav>
      </div>
    </header>
  );
}
