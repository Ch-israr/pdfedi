"""Chunked-upload test suite: /uploads/chunked init/part/complete/abort + /uploads.

Turns the ad-hoc 13/13 chunked-upload verification (2026-10-15) into a permanent,
repeatable suite. Launches the REAL backend (pinned-venv uvicorn) on an ephemeral
localhost port with STORAGE_DIR and cwd pointed at a throwaway tmpdir, so the repo's
real DB/storage are never touched.

Fixtures are built with reportlab/PIL (NO PyMuPDF — AGPL-banned). Run:
    ~/workspace/.venvs/pdfedi-pinned/bin/python tool-audit/chunked-upload-test.py
from ~/workspace/pdfedi.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path("/home/hatch/workspace/pdfedi")
VENV_PY = Path("/home/hatch/workspace/.venvs/pdfedi-pinned/bin/python")
CHUNK_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

TMP = Path(tempfile.mkdtemp(prefix="chunked-upload-test-"))
BASE = None          # set once the server is up
proc = None
passed = failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
    except AssertionError as e:
        failed += 1
        print(f"FAIL  {name}: {e}")
    except Exception as e:
        failed += 1
        print(f"FAIL  {name}: unexpected {type(e).__name__}: {e}")
    else:
        passed += 1
        print(f"PASS  {name}")


# ---------------------------------------------------------------- HTTP
class HttpStatus(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:200]}")
        self.status = status
        self.body = body


def call(method, path, body=None, headers=None, ctype=None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def api(method, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    return call(method, path, body, ctype="application/json")


def multipart(field, filename, data, ctype="application/pdf"):
    boundary = "BOUNDARY" + hashlib.md5(os.urandom(8)).hexdigest()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------- fixtures
def big_pdf() -> bytes:
    """Real, valid PDF > 8 MB (noise-image page; passes backend ingest validation)."""
    random.seed(20261015)
    from PIL import Image
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    img = Image.effect_noise((2300, 2300), 64).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(612, 792))
    c.drawImage(ImageReader(buf), 0, 0, width=612, height=792)
    c.showPage()
    c.save()
    data = out.getvalue()
    assert len(data) > 8 * 1024 * 1024, f"fixture too small: {len(data)}"
    return data


def small_pdf() -> bytes:
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(612, 792))
    c.drawString(100, 700, "chunked-upload-test small fixture")
    c.showPage()
    c.save()
    return out.getvalue()


# ---------------------------------------------------------------- server
def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server():
    global BASE, proc
    port = free_port()
    env = dict(os.environ)
    env["STORAGE_DIR"] = str(TMP / "storage")
    env.pop("DB_PROVIDER", None)
    env.pop("TURSO_DATABASE_URL", None)
    env.pop("TURSO_AUTH_TOKEN", None)
    proc = subprocess.Popen(
        [str(VENV_PY), "-m", "uvicorn", "main:app",
         "--host", "127.0.0.1", "--port", str(port),
         "--app-dir", str(REPO / "backend")],
        cwd=str(TMP),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    BASE = f"http://127.0.0.1:{port}/api/v1"
    HEALTH_URL = f"http://127.0.0.1:{port}/api/v1/health/live"
    deadline = time.time() + 120
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("uvicorn exited during startup")
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=5) as r:
                if r.status == 200:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError("server did not become healthy in 120s")


def stop_server():
    global proc
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    proc = None


# ---------------------------------------------------------------- checks
def run_checks():
    global BASE
    BIG = big_pdf()
    SMALL = small_pdf()
    BIG_SHA = hashlib.sha256(BIG).hexdigest()
    parts = [BIG[i:i + CHUNK_BYTES] for i in range(0, len(BIG), CHUNK_BYTES)]
    assert all(len(p) <= CHUNK_BYTES for p in parts)

    def _t(name, cond, msg):
        if not cond:
            raise AssertionError(msg)
        check(name, lambda: None)

    # 1. declared size over the 50 MB cap -> 413
    status, _ = api("POST", "/uploads/chunked/init",
                    {"filename": "huge.pdf", "size": MAX_UPLOAD_BYTES + 1,
                     "content_type": "application/pdf"})
    _t("1. init over 50MB cap -> 413", status == 413, f"got {status}")

    # 2. declared size 0 -> 422
    status, _ = api("POST", "/uploads/chunked/init",
                    {"filename": "empty.pdf", "size": 0,
                     "content_type": "application/pdf"})
    _t("2. init with size 0 -> 422", status == 422, f"got {status}")

    # 3. init for the big file -> 200 + session id
    status, body = api("POST", "/uploads/chunked/init",
                       {"filename": "big9.pdf", "size": len(BIG),
                        "content_type": "application/pdf"})
    init = json.loads(body)
    _t("3. init big file -> 200 with upload_id",
       status == 200 and init.get("upload_id") and init.get("chunk_bytes") == CHUNK_BYTES,
       f"got {status} {body[:120]}")
    sid = init["upload_id"]

    # 4. PUT all parts out of order -> each 200
    order = sorted(range(len(parts)), reverse=True)
    oks = []
    for i in order:
        status, body = call("PUT", f"/uploads/chunked/{sid}/parts/{i}", parts[i])
        oks.append(status == 200 and json.loads(body).get("size") == len(parts[i]))
    _t(f"4. {len(parts)} parts out of order -> all 200", all(oks),
       f"per-part results: {oks}")

    # 5. complete -> 200, size_bytes + sha256 match
    status, body = api("POST", f"/uploads/chunked/{sid}/complete")
    rec = json.loads(body)
    _t("5. complete -> size_bytes + sha256 match",
       status == 200 and rec.get("size_bytes") == len(BIG) and rec.get("sha256") == BIG_SHA,
       f"got {status} size={rec.get('size_bytes')} sha_ok={rec.get('sha256') == BIG_SHA}")
    file_id = rec["id"]

    # 6. metadata job on the completed file -> succeeded
    status, body = api("POST", "/jobs", {"tool_key": "metadata", "file_ids": [file_id]})
    assert status in (200, 202), f"job create got {status}: {body[:200]}"
    job_id = json.loads(body)["id"]
    final = None
    for _ in range(20):
        time.sleep(3)
        s, b = call("GET", f"/jobs/{job_id}")
        final = json.loads(b)
        if final.get("status") in ("succeeded", "failed"):
            break
    _t("6. metadata job on chunked file -> succeeded",
       final is not None and final.get("status") == "succeeded",
       f"final status: {(final or {}).get('status')}: {(final or {}).get('error')}")

    # 7. new session, only part 0, complete -> 422 (missing part)
    status, body = api("POST", "/uploads/chunked/init",
                       {"filename": "big9.pdf", "size": len(BIG),
                        "content_type": "application/pdf"})
    sid2 = json.loads(body)["upload_id"]
    s1, _ = call("PUT", f"/uploads/chunked/{sid2}/parts/0", parts[0])
    assert s1 == 200, f"part 0 got {s1}"
    status, body = api("POST", f"/uploads/chunked/{sid2}/complete")
    _t("7. complete with missing part -> 422", status == 422, f"got {status}")

    # 8. abort session, then complete -> 404
    status, body = api("POST", "/uploads/chunked/init",
                       {"filename": "big9.pdf", "size": len(BIG),
                        "content_type": "application/pdf"})
    sid3 = json.loads(body)["upload_id"]
    s1, _ = call("DELETE", f"/uploads/chunked/{sid3}")
    assert s1 == 200, f"abort got {s1}"
    status, _ = api("POST", f"/uploads/chunked/{sid3}/complete")
    _t("8. complete after abort -> 404", status == 404, f"got {status}")

    # 9. complete on a nonexistent session -> 404
    status, _ = api("POST", "/uploads/chunked/deadbeefdeadbeefdeadbeefdeadbeef/complete")
    _t("9. complete unknown session -> 404", status == 404, f"got {status}")

    # 10. single-shot /uploads still works (regression guard)
    body, ctype = multipart("file", "small.pdf", SMALL)
    status, resp = call("POST", "/uploads", body, ctype=ctype)
    rec = json.loads(resp) if status == 200 else {}
    _t("10. single-shot /uploads -> 200", status == 200 and rec.get("size_bytes") == len(SMALL),
       f"got {status}")


# ---------------------------------------------------------------- main
def main() -> int:
    if not VENV_PY.exists():
        print(f"FAIL  pinned venv not found at {VENV_PY}")
        return 1
    try:
        start_server()
    except Exception as e:
        print(f"FAIL  server startup: {type(e).__name__}: {e}")
        shutil.rmtree(TMP, ignore_errors=True)
        return 1
    try:
        run_checks()
    finally:
        stop_server()
        shutil.rmtree(TMP, ignore_errors=True)
    total = passed + failed
    print(f"\n{passed}/{total} checks passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
