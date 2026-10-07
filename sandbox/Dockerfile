# Standalone sandbox image. Build context: repository root.
#   docker build -f sandbox/Dockerfile -t pdfedi-sandbox .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/srv/sandbox

# Native dependencies for experimental tools:
#  - tesseract-ocr: local OCR path in pdf_to_word
#  - libreoffice-writer: word_to_pdf conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/sandbox

# Shared tool framework + common PDF libraries (same versions as production).
COPY backend/requirements-render.txt ./base-requirements.txt
RUN pip install --no-cache-dir -r base-requirements.txt

# Sandbox-only experimental dependencies (kept out of production).
COPY sandbox/requirements.txt ./sandbox-requirements.txt
RUN pip install --no-cache-dir -r sandbox-requirements.txt

# Production tool contract (base.py) — the sandbox must NOT import the
# production app, db, quotas, or the production tool registry; only
# pdfedi.tools.base is used. We copy a pruned tree so that importing
# pdfedi.tools.base never triggers pdfedi/tools/__init__.py (which loads
# all 18 production tools).
RUN mkdir -p pdfedi/tools
COPY backend/pdfedi/__init__.py ./pdfedi/__init__.py
COPY backend/pdfedi/tools/base.py ./pdfedi/tools/base.py
RUN touch ./pdfedi/tools/__init__.py
# Sandbox server, experimental tools, and test UI.
COPY sandbox ./sandbox

WORKDIR /srv/sandbox/sandbox
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
