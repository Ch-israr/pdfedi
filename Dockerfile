# PDFEDI on Render free tier — single Docker image:
#   Stage 1 builds the static Next.js frontend.
#   Stage 2 runs FastAPI (API) + serves the exported frontend, one origin.
#
# Free-tier notes:
#   - slim Python deps (backend/requirements-render.txt): no celery/redis/
#     boto3/psycopg/alembic/sentry — unused with the Render configuration
#     (inline worker, local storage, Turso, redis disabled). Smaller image,
#     faster builds and cold starts, less RAM.
#   - single uvicorn worker (default): correct for 512 MB RAM.

# ---- Stage 1: build the Next.js frontend (static export -> /build/out) ----
FROM node:20-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY components ./components
COPY context ./context
COPY lib ./lib
COPY public ./public
COPY next.config.mjs tsconfig.json tailwind.config.ts postcss.config.mjs next-env.d.ts ./
RUN npm run build

# ---- Stage 2: Python runtime serving the API + the static frontend ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIR=/srv/static
WORKDIR /srv
COPY backend/requirements-render.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=web /build/out ./static
EXPOSE 8000
# Render injects $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir /srv/backend"]
