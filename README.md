# PDFEDI Web

Responsive website for the PDFEDI platform — Next.js 14, TypeScript, Tailwind CSS.

## Backend

The app is a pure API client. It talks to the live backend:

```
NEXT_PUBLIC_API_URL=https://pdfedi-backend-5y28wv3x3-chisrar647-3507.vercel.app/api/v1
```

No mocks, no dummy auth, no localhost fallbacks in production builds.

## Develop

```bash
npm install
cp .env.example .env.local   # optional — defaults are baked into next.config.mjs
npm run dev
```

## Build & deploy

```bash
npm run build
```

Deploys to Vercel as a standard Next.js project (auto-detected framework). Set
`NEXT_PUBLIC_API_URL` in the Vercel project environment variables for
production/preview.

## Structure

- `app/` — App Router pages (landing, auth, dashboard, tools/[key], files, pricing, admin, account)
- `components/` — Navbar, Footer, FileDropzone, RequireAuth
- `lib/api.ts` — typed API client with token refresh
- `lib/tools.tsx` — per-tool metadata and params forms
- `context/AuthContext.tsx` — auth state
