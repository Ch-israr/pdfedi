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
# tesseract-ocr powers the OCR tool (pytesseract). The stock Ubuntu
# eng.traineddata ships LSTM-only, so we fetch the full tessdata build
# (tesseract-ocr/tessdata) which also contains the legacy engine
# components needed for --oem 0. Keep the layer small otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        wget \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && TESSDATA_DIR="$(dirname "$(find /usr/share/tesseract-ocr -name 'eng.traineddata' | head -1)")" \
    && wget -q -O "$TESSDATA_DIR/eng.traineddata" \
        https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata \
    && test "$(stat -c%s "$TESSDATA_DIR/eng.traineddata")" -gt 10000000
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIR=/srv/static \
    STORAGE_DIR=/srv/storage \
    ENV=production
WORKDIR /srv
COPY backend/requirements-render.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=web /build/out ./static
# GeoIP database for admin traffic analytics (DB-IP City Lite, CC BY 4.0,
# free, no account needed — https://db-ip.com/db/lite.php). Best-effort:
# the app runs fine without it (country/city show as "Unknown").
# Refresh monthly by rebuilding (new file published on the 1st).
RUN apt-get update -qq && apt-get install -y -qq curl ca-certificates && rm -rf /var/lib/apt/lists && \
    mkdir -p /srv/geoip && \
    (curl -sL --max-time 90 -o /tmp/dbip.mmdb.gz "https://download.db-ip.com/free/dbip-city-lite-$(date +%Y-%m).mmdb.gz" || \
     curl -sL --max-time 90 -o /tmp/dbip.mmdb.gz "https://download.db-ip.com/free/dbip-city-lite-$(date -d 'last month' +%Y-%m).mmdb.gz") && \
    gunzip -c /tmp/dbip.mmdb.gz > /srv/geoip/dbip-city-lite.mmdb && rm -f /tmp/dbip.mmdb.gz && \
    echo "GeoIP DB installed: $(du -h /srv/geoip/dbip-city-lite.mmdb | cut -f1)" || \
    echo "WARNING: GeoIP database download failed - country/city analytics will show Unknown"
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir /srv/backend"]
