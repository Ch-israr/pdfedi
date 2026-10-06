/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the frontend is pre-rendered to ./out and served by the
  // FastAPI backend from the same origin (combined deployment).
  // lib/api.ts defaults to same-origin /api/v1 when NEXT_PUBLIC_API_URL
  // is absent, so no backend URL is baked in at build time.
  output: "export",
};

export default nextConfig;
