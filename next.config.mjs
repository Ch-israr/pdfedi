/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_PUBLIC_API_URL must be set in the Vercel dashboard (or .env.local).
  // No hardcoded fallback — a stale backend URL is worse than a build error.
  // The lib/api.ts module validates this at runtime and fails loudly.
};

export default nextConfig;
