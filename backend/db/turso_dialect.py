"""Custom SQLAlchemy dialect for Turso via HTTP API (pure Python).

This dialect uses Turso's HTTP pipeline API directly, avoiding the native
libsql client which has compatibility issues on some platforms (e.g. Vercel).

Turso HTTP API:
- POST https://<host>/v2/pipeline
- Headers: Authorization: Bearer <token>, Content-Type: application/json
- Body: {"requests": [{"type": "execute", "stmt": {"sql": "...", "args": [...]}}]}

PDFEDI-only. Pure Python, no native extensions.
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any

from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite
from sqlalchemy import util


class TursoHttpConnection:
    """DBAPI-compatible connection using Turso HTTP API."""

    def __init__(self, host: str, auth_token: str):
        self.host = host
        self.auth_token = auth_token
        self._closed = False
        # DBAPI attributes
        self.autocommit = False

    def _api_request(self, statements: list[dict]) -> list[dict]:
        """Send pipeline request to Turso HTTP API."""
        url = f"https://{self.host}/v2/pipeline"
        body = json.dumps({"requests": statements}).encode()

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
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                return data.get("results", [])
        except urllib.error.HTTPError as e:
            raise Exception(f"Turso API error {e.code}: {e.read().decode()[:200]}")
        except Exception as e:
            raise Exception(f"Turso connection failed: {str(e)[:200]}")

    def cursor(self):
        return TursoHttpCursor(self)

    def commit(self):
        pass  # Turso HTTP API auto-commits each statement

    def rollback(self):
        pass

    def close(self):
        self._closed = True

    # Context manager support
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class TursoHttpCursor:
    """DBAPI-compatible cursor using Turso HTTP API."""

    def __init__(self, connection: TursoHttpConnection):
        self.connection = connection
        self._rows: list[tuple] = []
        self._description: list | None = None
        self.rowcount = -1
        self.lastrowid: int | None = None
        self._closed = False

    @property
    def description(self):
        return self._description

    def _convert_value(self, val: dict) -> Any:
        """Convert Turso API value format to Python value."""
        if val is None:
            return None
        t = val.get("type")
        v = val.get("value")
        if t == "null":
            return None
        if t == "integer":
            return int(v)
        if t == "float":
            return float(v)
        if t == "text":
            return str(v)
        if t == "blob":
            import base64
            return base64.b64decode(v) if isinstance(v, str) else v
        return v

    def execute(self, sql: str, params: tuple | dict | None = None):
        """Execute a SQL statement."""
        # Convert params to Turso args format
        args = []
        if params:
            if isinstance(params, dict):
                # Named params — convert to positional in order of appearance
                # (simplified: Turso supports named args as {"name": {"type":..., "value":...}})
                for k, v in params.items():
                    args.append(self._to_turso_arg(v))
            else:
                for v in params:
                    args.append(self._to_turso_arg(v))

        stmt: dict[str, Any] = {"sql": sql}
        if args:
            stmt["args"] = args

        results = self.connection._api_request([
            {"type": "execute", "stmt": stmt}
        ])

        if not results:
            self._rows = []
            return self

        result = results[0]
        if result.get("type") == "error":
            err = result.get("error", {})
            raise Exception(f"Turso SQL error: {err.get('message', 'unknown')}")

        response = result.get("response", {})
        if response.get("type") != "execute":
            self._rows = []
            return self

        data = response.get("result", {})
        cols = data.get("cols", [])
        rows = data.get("rows", [])

        # Build DBAPI description: (name, type_code, display_size, internal_size, precision, scale, null_ok)
        self._description = [
            (c.get("name"), None, None, None, None, None, True)
            for c in cols
        ]

        # Convert rows
        self._rows = [
            tuple(self._convert_value(v) for v in row)
            for row in rows
        ]

        # For UPDATE/DELETE, use affected_row_count (not len(rows) which is 0)
        # SQLAlchemy checks rowcount to verify the UPDATE matched 1 row
        affected = data.get("affected_row_count")
        if affected is not None:
            try:
                self.rowcount = int(affected)
            except (ValueError, TypeError):
                self.rowcount = len(self._rows)
        else:
            self.rowcount = len(self._rows)
        self.lastrowid = data.get("last_insert_rowid")
        if self.lastrowid is not None:
            try:
                self.lastrowid = int(self.lastrowid)
            except (ValueError, TypeError):
                pass

        return self

    def _to_turso_arg(self, v: Any) -> dict:
        """Convert Python value to Turso arg format."""
        if v is None:
            return {"type": "null"}
        if isinstance(v, bool):
            return {"type": "integer", "value": "1" if v else "0"}
        if isinstance(v, int):
            return {"type": "integer", "value": str(v)}
        if isinstance(v, float):
            return {"type": "float", "value": str(v)}
        if isinstance(v, bytes):
            import base64
            return {"type": "blob", "value": base64.b64encode(v).decode()}
        # Handle datetime: convert to SQLite-compatible format (no timezone suffix, no microseconds)
        # Turso/SQLite expects "YYYY-MM-DD HH:MM:SS" format
        import datetime as dt_module
        import uuid as uuid_module
        if isinstance(v, dt_module.datetime):
            # Convert to UTC and format without timezone/microseconds
            if v.tzinfo is not None:
                v = v.astimezone(dt_module.timezone.utc).replace(tzinfo=None)
            # Format as "YYYY-MM-DD HH:MM:SS" (SQLite standard)
            formatted = v.strftime("%Y-%m-%d %H:%M:%S")
            return {"type": "text", "value": formatted}
        if isinstance(v, dt_module.date):
            return {"type": "text", "value": v.isoformat()}
        if isinstance(v, uuid_module.UUID):
            return {"type": "text", "value": str(v)}
        return {"type": "text", "value": str(v)}

    def executemany(self, sql: str, seq_of_params):
        for params in seq_of_params:
            self.execute(sql, params)
        return self

    def fetchone(self):
        if self._rows:
            return self._rows.pop(0)
        return None

    def fetchmany(self, size: int | None = None):
        size = size or 1
        result = self._rows[:size]
        self._rows = self._rows[size:]
        return result

    def fetchall(self):
        rows = self._rows
        self._rows = []
        return rows

    def close(self):
        self._closed = True

    # Context manager
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class SQLiteDialect_tursohttp(SQLiteDialect_pysqlite):
    """SQLAlchemy dialect for Turso via HTTP API."""

    name = "tursohttp"
    driver = "tursohttp"

    supports_statement_cache = False

    @classmethod
    def import_dbapi(cls):
        # Return a mock module with the required attributes.
        # SQLAlchemy's SQLite dialect checks for sqlite_version_info etc.
        class MockDBAPI:
            apilevel = "2.0"
            threadsafety = 2
            paramstyle = "qmark"
            # Pretend to be a recent SQLite version
            sqlite_version = "3.45.0"
            sqlite_version_info = (3, 45, 0)
            version = "2.6.0"
            version_info = (2, 6, 0)

            class Error(Exception):
                pass

            class DatabaseError(Error):
                pass

            class OperationalError(DatabaseError):
                pass

            class IntegrityError(DatabaseError):
                pass

            @staticmethod
            def connect(*args, **kwargs):
                # Handled by dialect.connect() override below
                raise NotImplementedError

        return MockDBAPI

    def create_connect_args(self, url):
        """Parse URL into host/auth_token for connect()."""
        host = url.host or ""
        if url.port:
            host = f"{host}:{url.port}"
        query = dict(url.query)
        auth_token = query.get("authToken", "")
        # Store for connect() to use
        self._turso_host = host
        self._turso_token = auth_token
        return ([], {})

    def connect(self, *cargs, **cparams):
        """Create a TursoHttpConnection (overrides default DBAPI connect)."""
        host = getattr(self, "_turso_host", "")
        token = getattr(self, "_turso_token", "")
        return TursoHttpConnection(host, token)

    def on_connect(self):
        # Skip pysqlite-specific setup
        return None

    def do_rollback(self, dbapi_connection):
        pass

    def do_commit(self, dbapi_connection):
        pass


# Register the dialect
dialect = SQLiteDialect_tursohttp
