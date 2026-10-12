# Editor → Main Website Migration Log

Directive: move the sandbox PDF editor into the main PDFEDI website at
`https://pdfedi.onrender.com/editor` (user order, 2026-10-12).
Rule: BACKUP → SYNCHRONIZE → AUDIT → INTEGRATE → TEST → APPROVAL → DEPLOY → VERIFY.

## Phase 1 — Backup (2026-10-12)

- Pre-migration HEAD (main): `80b4f9cc41d20fcd892cbafb367f0df6b74809f7`
  ("True redaction: permanent text removal + unsafe-refusal guard")
- Working tree was CLEAN at backup time (no uncommitted changes).
- Backup branch: `backup/pre-editor-integration-20261012`
  → points at 80b4f9c (verified: 57 files under sandbox/pdfeditor/apps/web, main web/ intact).
- Migration branch: `migrate/editor-to-main` → starts at 80b4f9c.
- Rollback dry-run performed: checkout backup branch → 80b4f9c, back to
  migration branch → 80b4f9c, tree clean. Rollback procedure is usable.

### How to roll back

To restore the pre-migration state of everything (main site + standalone editor):

```
cd ~/workspace/pdfedi
git checkout backup/pre-editor-integration-20261012
# To make it live again:
git checkout -B main backup/pre-editor-integration-20261012
git push --force-with-lease origin main   # only with explicit user approval
# Then trigger a manual Render deploy of the affected service(s).
```

The standalone editor Render service (`pdfeditor`, srv-db48ni7lot8c73875b40)
is NOT being retired during this migration and needs no rollback itself.

## Phase 2 — Audit (2026-10-12)

- Main site: FastAPI + static-export Next.js (`output:'export'`, trailingSlash).
  Catch-all serves `frontend/<path>/index.html` — **zero backend changes needed**
  for `/editor`.
- Editor: pnpm/turbo, fully client-side ('use client', no API routes, no
  next/image, no server imports, no root hrefs). Static export feasible.
- One blocker found & fixed: absolute `/pdf.worker.min.mjs` in
  lib/pdfjs.ts + lib/pdfedi-state.ts (3 spots) → now basePath-aware via
  `process.env.NEXT_BASE_PATH` inlined from next.config.js `env`.
- Homepage cards render from TOOL_CARDS → `/tools/<key>`; the editor card is a
  separate featured "Most popular" card → `/editor` (not in TOOL_CARDS, so no
  bogus `/tools/editor` route is generated).

## Phase 3 — Integration (2026-10-12, branch migrate/editor-to-main)

1. `sandbox/pdfeditor/apps/web/next.config.js`: conditional
   `output:'export'` + `trailingSlash` (NEXT_STATIC_EXPORT=1) and conditional
   `basePath` (NEXT_BASE_PATH). Standalone `next start` service unaffected.
2. `lib/pdfjs.ts`, `lib/pdfedi-state.ts`: workerSrc now
   `${process.env.NEXT_BASE_PATH || ''}/pdf.worker.min.mjs`.
3. Root `Dockerfile`: new `editor` stage (node:20-slim + pnpm 10.34.6, builds
   shared → pdf-core → web with NEXT_STATIC_EXPORT=1, NEXT_BASE_PATH=/editor);
   final stage adds `COPY --from=editor /build/editor/apps/web/out ./static/editor`.
4. `web/app/page.tsx`: "Most popular" featured card → `/editor`, existing card
   styling + brand ring. No other main-site UI changed.

## Phase 4 — Tests (2026-10-12, local; Docker unavailable in this env)

Assembled the exact Docker layout (/srv/static = web/out + editor/out) and ran
the REAL backend (uvicorn) against it:
- main web `npm run build`: PASS
- editor `NEXT_STATIC_EXPORT=1 NEXT_BASE_PATH=/editor` build: PASS
- editor HTML asset refs all `/editor/_next/...`, zero bare `/_next`: PASS
- GET / → 200, "Most popular" card present, href="/editor/": PASS
- GET /editor and /editor/ → 200: PASS
- GET /editor/_next/.../webpack-*.js → 200: PASS
- GET /editor/pdf.worker.min.mjs → 200: PASS
- GET /tools/merge (existing tool page) → 200: PASS
- GET /api/v1/health/live → 200; GET /api/v1/bogus → JSON 404: PASS
- Real end-to-end merge job (upload → job → succeeded): PASS

NOT verifiable here (honest gaps): the production Docker build itself (no
Docker in this environment — the new stage mirrors the editor's own proven
Dockerfile pattern); in-browser editor interaction (browser tool cannot reach
localhost). Both are covered by the post-deploy live verification plan.

## Phase 5 — Deployment

DO NOT push or deploy until the user gives explicit approval after the
Phase 4 test report.
