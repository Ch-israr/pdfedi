/** @type {import('next').NextConfig} */
// Build-time knobs for embedding the editor in the main PDFEDI site:
//   NEXT_STATIC_EXPORT=1  -> `output: 'export'` (static HTML in out/)
//   NEXT_BASE_PATH=/editor -> serve all assets/links under /editor
// The standalone Render service (`next start`) sets neither and is unaffected.
const basePath = process.env.NEXT_BASE_PATH || '';
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_STATIC_EXPORT === '1'
    ? { output: 'export', trailingSlash: true }
    : {}),
  ...(basePath ? { basePath } : {}),
  // Inlined into the client bundle so lib code can build base-aware asset URLs.
  // The integrated build also drops the dummy dev header/footer in favour of
  // the real site chrome (DevelopmentLayout reads NEXT_PUBLIC_DEV_LAYOUT).
  env: {
    NEXT_BASE_PATH: basePath,
    ...(process.env.NEXT_STATIC_EXPORT === '1'
      ? { NEXT_PUBLIC_DEV_LAYOUT: 'false' }
      : {}),
  },
  // Serve the PDF.js worker from /public for reliability (no CDN dependency)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
