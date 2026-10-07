"""PDFEDI Testing Sandbox server.

Isolated by design:
  * imports ONLY the stable tool contract (pdfedi.tools.base)
  * never imports the production app, database, quotas, or admin
  * no database, no auth, no quotas — uploads live in temp dirs and are
    deleted after each run
  * only tools explicitly listed in tools/__init__.py (SANDBOX_TOOLS)
    are loaded
"""
from __future__ import annotations

import hashlib
import importlib
import json
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response

import asyncio

from pdfedi.tools.base import ToolContext, ToolError, ToolInput, ToolSpec
from tools import SANDBOX_TOOLS  # noqa: E402  (sandbox-local registry)

HERE = Path(__file__).resolve().parent
WEB_DIR = HERE / "web"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# Concurrency control: max 2 simultaneous tool runs. Prevents memory spikes
# from concurrent OCR jobs on limited servers. Lightweight asyncio semaphore —
# no queues, no workers, no infrastructure.
_MAX_CONCURRENT_RUNS = 2
_run_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RUNS)

app = FastAPI(title="PDFEDI Testing Sandbox", docs_url=None, redoc_url=None)


def _load_tools() -> dict[str, ToolSpec]:
    """Import only the explicitly registered experimental tools."""
    specs: dict[str, ToolSpec] = {}
    for module_name, key in SANDBOX_TOOLS.items():
        try:
            module = importlib.import_module(f"tools.{module_name}")
        except Exception as e:
            raise RuntimeError(f"sandbox tool '{module_name}' failed to import: {e}") from e
        spec: ToolSpec = module.SPEC
        if spec.key != key:
            raise RuntimeError(
                f"sandbox registry key '{key}' does not match SPEC.key '{spec.key}'"
            )
        specs[key] = spec
    return specs


TOOLS = _load_tools()


def _get_tool(key: str) -> tuple[ToolSpec, object]:
    spec = TOOLS.get(key)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"Unknown sandbox tool '{key}'")
    module_name = next(m for m, k in SANDBOX_TOOLS.items() if k == key)
    module = importlib.import_module(f"tools.{module_name}")
    return spec, module


@app.get("/", response_class=HTMLResponse)
def index():
    return (WEB_DIR / "index.html").read_text()


@app.get("/api/health")
def health():
    return {"status": "ok", "sandbox": True, "tools": sorted(TOOLS)}


@app.get("/api/tools")
def list_tools():
    return [
        {
            "key": s.key,
            "name": s.name,
            "tagline": s.tagline,
            "description": s.description,
            "input_kinds": s.input_kinds,
            "min_files": s.min_files,
            "max_files": s.max_files,
            "options": [
                {
                    "name": o.name, "kind": o.kind, "label": o.label,
                    "required": o.required, "default": o.default,
                    "choices": o.choices, "help": o.help,
                }
                for o in s.options
            ],
            "output_ext": s.output_ext,
            "output_mime": s.output_mime,
            "activity": s.activity,
        }
        for s in TOOLS.values()
    ]


@app.post("/api/run/{tool_key}")
async def run_tool(
    tool_key: str,
    files: list[UploadFile] = File(...),
    options: str = Form(default="{}"),
):
    spec, module = _get_tool(tool_key)
    try:
        opts = json.loads(options) if options else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="options must be valid JSON")
    if not isinstance(opts, dict):
        raise HTTPException(status_code=400, detail="options must be a JSON object")

    if not (spec.min_files <= len(files) <= spec.max_files):
        raise HTTPException(
            status_code=400,
            detail=f"This tool needs {spec.min_files}-{spec.max_files} file(s), got {len(files)}.",
        )

    tmpdir = Path(tempfile.mkdtemp(prefix="pdfedi-sandbox-"))
    ctx: ToolContext | None = None
    try:
        inputs: list[ToolInput] = []
        for i, uf in enumerate(files):
            data = await uf.read()
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="File exceeds the 50 MB limit.")
            if not data:
                raise HTTPException(status_code=400, detail=f"File {i + 1} is empty.")
            digest = hashlib.sha256(data).hexdigest()
            # Light kind check per declared input kind.
            if "pdf" in spec.input_kinds and "image" not in spec.input_kinds \
                    and "document" not in spec.input_kinds:
                if not data.lstrip().startswith(b"%PDF-"):
                    raise HTTPException(
                        status_code=422, detail=f"File {i + 1} is not a valid PDF."
                    )
            if "document" in spec.input_kinds:
                if not data.startswith(b"PK\x03\x04"):
                    raise HTTPException(
                        status_code=422, detail=f"File {i + 1} is not a valid .docx file."
                    )
            p = tmpdir / f"input_{i}_{uuid.uuid4().hex[:8]}"
            p.write_bytes(data)
            inputs.append(
                ToolInput(
                    file_id=f"sandbox-{i}",
                    filename=uf.filename or f"file{i}",
                    path=p, size=len(data), sha256=digest, page_count=None,
                )
            )
        ctx = ToolContext(inputs)
        try:
            # Limit concurrent runs to prevent memory spikes on limited servers.
            # The semaphore is acquired here; the tool runs synchronously.
            async with _run_semaphore:
                out_path = module.run(ctx, opts)
        except ToolError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:  # noqa: BLE001 — surface unexpected failures
            raise HTTPException(status_code=500, detail=f"Tool crashed: {e}")
        if not out_path or not Path(out_path).is_file():
            raise HTTPException(status_code=500, detail="Tool did not produce an output file.")
        # Read the bytes now: temp dirs are removed in `finally` below,
        # which runs before the response streams.
        payload = Path(out_path).read_bytes()
        filename = f"{spec.key}_output.{spec.output_ext}"
        mime = spec.output_mime
    finally:
        if ctx is not None:
            ctx.cleanup()
        shutil.rmtree(tmpdir, ignore_errors=True)

    return Response(
        content=payload,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
