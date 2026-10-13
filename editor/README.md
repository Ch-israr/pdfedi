# PDFEditor — Privacy-first web PDF editor

An original, privacy-first PDF editor built as a TypeScript monorepo. Your PDF
lives only in your browser tab's memory (or transiently in server memory during
a stateless API request). It is **never** written to disk, database, object
storage, localStorage, IndexedDB, or sent to the FastAPI backend.

## Architecture

```
┌─────────────────┐      JWT (FastAPI)      ┌──────────────────┐
│   apps/web      │ ──────────────────────▶ │   apps/api       │
│ Next.js + React │  Bearer token           │ Fastify + TS     │
│ PDF.js render   │                         │ stateless PDF ops│
│ pdf-lib export  │      metadata only      │ never stores     │
│ Zustand store   │ ──────────────────────▶ │ bytes            │
└────────┬────────┘  (tool, size, pages)    └──────────────────┘
         │                    ▲
         │ auth/user/plans    │ JWT issued here
         ▼                    │
┌─────────────────┐           │
│ Existing FastAPI│ ──────────┘
│ (your backend)  │  NEVER receives PDF bytes
└─────────────────┘
```

### Packages

| Package | Purpose |
|---|---|
| `apps/web` | Next.js 14 UI: upload, viewer, thumbnails, tools, undo/redo, download |
| `apps/api` | Fastify service: `/pdf/compress`, `/pdf/merge`, `/pdf/split`, `/pdf/rotate`, `/health` |
| `packages/shared` | Zod schemas + TS types (JWT claims, usage metadata, elements, API contracts) |
| `packages/pdf-core` | Pure PDF helpers: page ops, element→pdf-lib drawing, `exportPdf()` |

### Privacy guarantees

- `pdfBytes` lives only in the Zustand store (JS memory). `closeDocument()` drops it.
- No `localStorage` / `sessionStorage` / `IndexedDB` for PDF data.
- API keeps uploads in memory (`Buffer`) and returns the result in the response.
- Object URLs are revoked after download.
- Request bodies are never logged.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Configure
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
# Set JWT_SECRET in apps/api/.env to match your FastAPI signing secret.

# 3. Dev (all workspaces)
pnpm dev
# web → http://localhost:3000, api → http://localhost:4000

# 4. Or via Docker
docker compose up --build
```

## Environment variables

### apps/web (`.env`)
| Var | Description |
|---|---|
| `NEXT_PUBLIC_PDF_API_URL` | Fastify service URL (default `http://localhost:4000`) |
| `NEXT_PUBLIC_FASTAPI_URL` | Existing FastAPI backend URL |

### apps/api (`.env`)
| Var | Description |
|---|---|
| `PORT` / `HOST` | Listen address (default `127.0.0.1:4000`) |
| `JWT_SECRET` | **Required.** HS256 secret shared with FastAPI |
| `JWT_JWKS_URL` | Optional RS256 JWKS URL (production upgrade path) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `REDIS_URL` | Redis for BullMQ heavy jobs (default `redis://localhost:6379`) |
| `MAX_UPLOAD_BYTES` | Upload cap (default 52428800 = 50 MB) |

## API documentation

All `/pdf/*` routes require `Authorization: Bearer <JWT>` (issued by FastAPI).

### `GET /health`
Returns `{ ok, service, version, storage }`. No auth required.

### `POST /pdf/compress?quality=low|medium|high`
- Body: `multipart/form-data` with one `file` field (PDF).
- Returns: `application/pdf` (re-saved, metadata stripped).

### `POST /pdf/merge`
- Body: `multipart/form-data` with 2–20 `file` fields (PDFs).
- Returns: `application/pdf` (concatenated in upload order).

### `POST /pdf/split?ranges=1-3,5`
- Body: `multipart/form-data` with one `file` field.
- Returns: `application/pdf` (first range; multi-range ZIP is post-MVP).

### `POST /pdf/rotate?pages=1,3&angle=90`
- Body: `multipart/form-data` with one `file` field.
- `angle`: 90 | 180 | 270. `pages`: comma-separated 1-based (default: all).
- Returns: `application/pdf`.

Errors use the envelope `{ error, code, details? }` with HTTP 400/401/413/415/422.

## FastAPI integration contract

Your existing FastAPI backend needs **zero changes** for the sandbox MVP:

1. **JWT claims** (verified by `apps/api/src/auth.ts` via the shared `JwtClaimsSchema`):
   ```json
   { "sub": "user-123", "plan": "pro", "exp": 1735689600, "iat": 1735603200 }
   ```
2. **Usage metadata** (optional webhook your backend may expose; web sends only this):
   ```json
   { "tool": "compress", "fileSize": 1234567, "pageCount": 3,
     "timestamp": "2026-10-08T10:00:00Z", "userId": "user-123" }
   ```
3. **Never** send PDF bytes to FastAPI. The Node service never reads its database.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run all workspaces in dev mode |
| `pnpm build` | Build all workspaces (turbo, dependency order) |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm --filter @pdfeditor/web dev` | Web only |

## Project status

MVP complete: upload, viewer, thumbnails, text/image/highlight/signature/shape
tools, page rotate/delete/duplicate/reorder, undo/redo, client-side pdf-lib
export + download, server compress/merge/split/rotate behind JWT.

Post-MVP: real image-downsampling compression, multi-range split ZIP,
watermarks, page numbers, form filling, password protect/unlock, OCR
(Tesseract.js, then optional Python FastAPI OCR service), batch processing,
metadata editing.
