"use client";
/** No-auth: passes children through. Kept for compatibility. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
