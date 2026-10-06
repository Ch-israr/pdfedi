# PDFEDI v2 — Free Online PDF Tools

Single-service deployment: FastAPI backend + statically exported Next.js
frontend in one Docker image (Render free tier).

## Layout

- `backend/` — FastAPI API (`pdfedi/` package, `main.py` entry)
- `web/` — Next.js frontend (static export)
- `Dockerfile` — combined image: builds `web/`, serves API + static files
- `render.yaml` — Render Blueprint

## API

Base: `/api/v1`

- `GET /api/v1/health/live`, `GET /api/v1/health/ready`
- `GET /api/v1/tools`, `GET /api/v1/tools/{key}`
- `POST /api/v1/uploads` (multipart, 4 MB max)
- `GET /api/v1/files/{id}`, `DELETE /api/v1/files/{id}`
- `POST /api/v1/jobs` `{tool_key, file_ids, config}` — runs inline
- `GET /api/v1/jobs/{id}`, `POST /api/v1/jobs/{id}/cancel`, `POST /api/v1/jobs/{id}/retry`
- `GET /api/v1/downloads/{file_id}` (4 MB max)
- `GET /api/v1/quota/{tool}`
- Admin: `POST /api/v1/admin/login`, `GET /api/v1/admin/dashboard`, `/admin/files`, `/admin/jobs`, `/admin/change-password`

## Configuration (env vars)

`DB_PROVIDER` (sqlite|turso), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`JWT_SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (argon2; legacy
SHA-256 accepted once and auto-upgraded), `STORAGE_DIR`, `MAX_UPLOAD_MB`,
`MAX_DOWNLOAD_MB`, `QUOTA_PER_HOUR`, `ENV`, `FRONTEND_DIR`.

## Database

SQLite locally, Turso hosted. Enums and timestamps are stored as plain
strings — no ORM enum mapping, so no serialization bugs. Versioned SQL
migrations run at startup (`pdfedi/migrate.py`).

## Local dev

```sh
cd backend && pip install -r requirements-render.txt
ENV=development FRONTEND_DIR=../web/out uvicorn main:app --reload --app-dir .
```
