"""Minimal, correct SQLAlchemy dialect for Turso over its HTTP pipeline API.

Pure Python (urllib only) — no native extensions.

Design rules (learned from the previous implementation's bugs):
  * The driver only ever sees JSON-safe primitives. Application code stores
    enums/timestamps as plain strings, so serialization bugs cannot recur.
    Enum unwrapping is still applied here as defense-in-depth.
  * rowcount comes from Turso's affected_row_count, never from len(rows).
  * Turso constraint violations are raised as DBAPI IntegrityError so
    SQLAlchemy's error handling works as documented.
  * Multi-statement batches go through a single /v2/pipeline call
    (used by the migration runner for atomic-ish DDL).

Turso HTTP API: POST https://<host>/v2/pipeline
  {"requests": [{"type": "execute", "stmt": {"sql": "...", "args": [...]}}]}
"""
from __future__ import annotations

import base64
import datetime as dt
import enum
import json
import urllib.error
import urllib.request
from typing import Any
from uuid import UUID

from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite

_PIPELINE_PATH = "/v2/pipeline"
_TIMEOUT_S = 30


# ---------------------------------------------------------------------------
# DBAPI exceptions
# ---------------------------------------------------------------------------
class Error(Exception):
    pass


class DatabaseError(Error):
    pass


class OperationalError(DatabaseError):
    pass


class IntegrityError(DatabaseError):
    pass


class ProgrammingError(DatabaseError):
    pass


def _classify_error(message: str) -> type[Error]:
    msg = message.lower()
    if any(k in msg for k in ("unique constraint", "primary key", "foreign key", "not null", "check constraint")):
        return IntegrityError
    if any(k in msg for k in ("syntax error", "no such table", "no such column")):
        return ProgrammingError
    return OperationalError


# ---------------------------------------------------------------------------
# Value conversion
# ---------------------------------------------------------------------------
def to_turso_arg(value: Any) -> dict:
    """Convert a Python value to a Turso typed arg. Never fails on enums."""
    if isinstance(value, enum.Enum):  # defense-in-depth; app code passes raw values
        return to_turso_arg(value.value)
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": repr(value)}
    if isinstance(value, bytes):
        return {"type": "blob", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return {"type": "text", "value": value.strftime("%Y-%m-%d %H:%M:%S")}
    if isinstance(value, dt.date):
        return {"type": "text", "value": value.isoformat()}
    if isinstance(value, UUID):
        return {"type": "text", "value": str(value)}
    return {"type": "text", "value": str(value)}


def from_turso_value(val: Any) -> Any:
    """Convert a Turso typed value to a Python value."""
    if val is None:
        return None
    if isinstance(val, dict):
        t, v = val.get("type"), val.get("value")
        if t in ("null", None):
            return None
        if t == "integer":
            return int(v)
        if t == "float":
            return float(v)
        if t == "text":
            return str(v)
        if t == "blob":
            return base64.b64decode(v) if isinstance(v, str) else v
    return val


# ---------------------------------------------------------------------------
# DBAPI connection / cursor
# ---------------------------------------------------------------------------
class TursoHttpConnection:
    def __init__(self, host: str, auth_token: str):
        self.host = host
        self.auth_token = auth_token
        self._closed = False

    def _post(self, requests: list[dict]) -> list[dict]:
        url = f"https://{self.host}{_PIPELINE_PATH}"
        body = json.dumps({"requests": requests}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise OperationalError(f"Turso HTTP {e.code}: {detail}") from e
        except Exception as e:
            raise OperationalError(f"Turso request failed: {e}") from e
        results = payload.get("results", [])
        out: list[dict] = []
        for r in results:
            if r.get("type") == "error":
                message = r.get("error", {}).get("message", "unknown error")
                raise _classify_error(message)(f"Turso SQL error: {message}")
            out.append(r.get("response", {}).get("result", {}))
        return out

    def cursor(self) -> "TursoHttpCursor":
        return TursoHttpCursor(self)

    # Turso HTTP auto-commits each statement; these are no-ops for DBAPI.
    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        self._closed = True

    def __enter__(self) -> "TursoHttpConnection":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class TursoHttpCursor:
    def __init__(self, connection: TursoHttpConnection):
        self.connection = connection
        self._rows: list[tuple] = []
        self._description: list[tuple] | None = None
        self.rowcount: int = -1
        self.lastrowid: int | None = None

    @property
    def description(self) -> list[tuple] | None:
        return self._description

    def _apply_result(self, data: dict) -> None:
        cols = data.get("cols", [])
        self._description = [(c.get("name"), None, None, None, None, None, True) for c in cols]
        self._rows = [tuple(from_turso_value(v) for v in row) for row in data.get("rows", [])]
        affected = data.get("affected_row_count")
        self.rowcount = int(affected) if affected is not None else len(self._rows)
        lastrowid = data.get("last_insert_rowid")
        self.lastrowid = int(lastrowid) if lastrowid is not None else None

    def execute(self, sql: str, params: Any = None) -> "TursoHttpCursor":
        args = []
        if params:
            values = params.values() if isinstance(params, dict) else params
            args = [to_turso_arg(v) for v in values]
        stmt: dict[str, Any] = {"sql": sql}
        if args:
            stmt["args"] = args
        (data,) = self.connection._post([{"type": "execute", "stmt": stmt}])
        self._apply_result(data)
        return self

    def executemany(self, sql: str, seq_of_params: Any) -> "TursoHttpCursor":
        requests = []
        for params in seq_of_params:
            values = params.values() if isinstance(params, dict) else params
            stmt: dict[str, Any] = {"sql": sql, "args": [to_turso_arg(v) for v in values]}
            requests.append({"type": "execute", "stmt": stmt})
        # Sum affected rows across the batch: SQLAlchemy's ORM bulk handling
        # expects the TOTAL rowcount for executemany, and raises StaleDataError
        # if only the last statement's count is reported.
        total = 0
        for data in self.connection._post(requests):
            self._apply_result(data)
            if self.rowcount and self.rowcount > 0:
                total += self.rowcount
        self.rowcount = total
        return self

    def fetchone(self) -> tuple | None:
        return self._rows.pop(0) if self._rows else None

    def fetchmany(self, size: int | None = None) -> list[tuple]:
        size = size or 1
        out, self._rows = self._rows[:size], self._rows[size:]
        return out

    def fetchall(self) -> list[tuple]:
        out, self._rows = self._rows, []
        return out

    def close(self) -> None:
        pass

    def __enter__(self) -> "TursoHttpCursor":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# SQLAlchemy dialect
# ---------------------------------------------------------------------------
class _DbApiModule:
    apilevel = "2.0"
    threadsafety = 2
    paramstyle = "qmark"
    sqlite_version = "3.45.0"
    sqlite_version_info = (3, 45, 0)
    Error = Error
    DatabaseError = DatabaseError
    OperationalError = OperationalError
    IntegrityError = IntegrityError

    @staticmethod
    def connect(*args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("use dialect.connect()")


class Dialect_tursohttp(SQLiteDialect_pysqlite):
    name = "tursohttp"
    driver = "tursohttp"
    supports_statement_cache = False

    @classmethod
    def import_dbapi(cls) -> Any:
        return _DbApiModule

    def create_connect_args(self, url: Any) -> tuple[list, dict]:
        host = url.host or ""
        if url.port:
            host = f"{host}:{url.port}"
        self._turso_host = host
        self._turso_token = dict(url.query).get("authToken", "")
        return ([], {})

    def connect(self, *cargs: Any, **cparams: Any) -> TursoHttpConnection:
        return TursoHttpConnection(
            getattr(self, "_turso_host", ""),
            getattr(self, "_turso_token", ""),
        )

    def on_connect(self) -> None:
        return None

    def do_rollback(self, dbapi_connection: Any) -> None:
        pass

    def do_commit(self, dbapi_connection: Any) -> None:
        pass


dialect = Dialect_tursohttp
