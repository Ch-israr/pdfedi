"""Netlify serverless entrypoint for the FastAPI application.

Netlify invokes ``handler(event, context)`` for each request to this
function. Mangum adapts the FastAPI ASGI app to the Lambda-style event.
"""
import sys
from pathlib import Path

# backend/main.py defines create_app(); backend/app/* is the application package.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from mangum import Mangum  # noqa: E402

from main import create_app  # noqa: E402

# lifespan="auto": run FastAPI startup (table creation + seeding) on cold start.
_asgi_adapter = Mangum(create_app(), lifespan="auto")

# netlify.toml rewrites /api/v1/* -> /.netlify/functions/api/api/v1/:splat,
# so stripping this prefix always yields the original /api/v1/... path.
# (If Netlify ever passes the original path instead, there is no prefix
# to strip and the path is used as-is.)
_FUNCTION_PREFIX = "/.netlify/functions/api"


def handler(event, context):
    path = event.get("path") or "/"
    if path.startswith(_FUNCTION_PREFIX):
        stripped = path[len(_FUNCTION_PREFIX):]
        event["path"] = stripped if stripped.startswith("/") else "/" + stripped
    return _asgi_adapter(event, context)
