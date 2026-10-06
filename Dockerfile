# PDFEDI v2 on Render free tier — single Docker image:
#   Stage 1 builds the static Next.js frontend (web/ -> /build/out).
#   Stage 2 runs FastAPI (API) + serves the exported frontend, one origin.

# ---- Stage 1: build the Next.js frontend ----
FROM node:20-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
COPY web ./
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIR=/srv/static \
    STORAGE_DIR=/srv/storage \
    ENV=production
WORKDIR /srv
COPY backend/requirements-render.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=web /build/out ./static
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir /srv/backend"]
