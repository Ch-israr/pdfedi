# ---- Stage 1: build the Next.js frontend (static export -> /build/out) ----
FROM node:20-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY components ./components
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
COPY netlify/functions/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=web /build/out ./static
EXPOSE 8000
# Render injects $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir /srv/backend"]
