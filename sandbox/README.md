# PDFEDI Testing Sandbox

An isolated area for testing new tools and features **without touching production**.

## Binding rules

1. The main/production website must **never be modified during testing**.
2. When the user asks to **test, experiment with, or add a new tool/feature for testing**,
   that work goes **only inside `sandbox/`**.
3. Do **not** automatically add a tested tool/feature to the main website.
4. Experimental code, UI, dependencies, and changes here must not be able to
   break production. The sandbox imports only the stable tool contract
   (`pdfedi.tools.base`) — never the production app, database, quotas, or admin.
5. Only the specific tool/feature under test is loaded (see `tools/__init__.py`).
   Do not copy or recreate production tools here.
6. Use the sandbox for experimentation, debugging, performance testing, and validation.
7. Fix every error, dependency conflict, or unexpected behavior **before**
   considering a test complete.
8. Nothing moves from sandbox to production without the user's **explicit approval**.
9. Never assume a tested feature should be deployed to production.
   Testing and production implementation are two separate steps.

## Layout

```
sandbox/
  README.md            this file — the rules
  app.py               minimal FastAPI server (no DB, no auth, no quotas)
  requirements.txt     sandbox-only dependencies (experimental deps go here,
                       never in backend/requirements*.txt)
  tools/
    __init__.py        SANDBOX_TOOLS registry — explicit opt-in per tool
    _template.py       template for a new experimental tool (not loaded)
  web/
    index.html         minimal test UI (vanilla JS, no build step)
  Dockerfile           standalone image (build context: repo root)
  render.yaml          optional separate Render service definition
```

## Workflow: testing a new tool

1. Copy `tools/_template.py` to `tools/<key>.py` and implement `SPEC` + `run()`
   following the contract in `backend/pdfedi/tools/base.py`.
2. Register it **only** in `tools/__init__.py` (`SANDBOX_TOOLS`).
3. Put any new dependency in `sandbox/requirements.txt` — never in the
   production requirements.
4. Run locally and exercise it through the UI or the API until it is fully
   working, including error paths. Fix everything found.
5. Report results. **Stop.** Wait for explicit approval before touching
   `backend/`, `web/`, or anything production.

## Run locally

```bash
cd sandbox
python -m venv .venv && . .venv/bin/activate
pip install -r ../backend/requirements-render.txt -r requirements.txt
PYTHONPATH=../backend uvicorn app:app --port 8001
# open http://localhost:8001
```

## Deploy as a separate service (only when asked)

The sandbox is designed to deploy as its own Render service so experiments
never share a process with production:

- New Web Service → repo `Ch-israr/pdfedi` → Dockerfile path `sandbox/Dockerfile`
- Or apply `sandbox/render.yaml`.

The sandbox service has no database and stores uploads only in temp dirs.
