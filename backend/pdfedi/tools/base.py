"""Tool interface for PDFEDI's PDF tools.

Every tool module exposes:
    SPEC: ToolSpec   — metadata for the API, docs and the frontend
    run(ctx, options) -> Path  — executes the tool, returns the output file
                                 (created inside ctx.workdir)

Conventions:
  * raise ToolError for user-facing failures (bad input, bad options).
    Unexpected exceptions are treated as internal errors by the runner.
  * run() must be pure with respect to the database — it only reads input
    files from disk and writes the output file. The runner persists results.
  * options arrive as a plain dict; validate them explicitly and raise
    ToolError on anything missing or malformed.
"""
from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ToolError(Exception):
    """User-facing tool failure: the request or the file was unusable."""

    def __init__(self, message: str, *, code: str = "tool_error"):
        super().__init__(message)
        self.code = code


@dataclass
class ToolOption:
    name: str
    kind: str  # "text" | "number" | "boolean" | "select" | "pages"
    label: str
    required: bool = False
    default: Any = None
    choices: list[str] | None = None
    help: str = ""


@dataclass
class ToolSpec:
    key: str                 # e.g. "merge" — stable, used in URLs and the API
    name: str                # e.g. "Merge PDF"
    tagline: str             # one-line description for cards
    description: str         # longer description for the tool page
    input_kinds: list[str]   # ["pdf"] or ["image"]
    min_files: int = 1
    max_files: int = 1
    options: list[ToolOption] = field(default_factory=list)
    output_kind: str = "pdf"  # "pdf" | "images" | "text" | "zip"
    output_ext: str = "pdf"
    output_mime: str = "application/pdf"


@dataclass
class ToolInput:
    file_id: str
    filename: str
    path: Path       # local path to the input bytes
    size: int
    sha256: str
    page_count: int | None


class ToolContext:
    """Per-run context handed to a tool's run()."""

    def __init__(self, inputs: list[ToolInput]):
        self.inputs = inputs
        self.workdir = Path(tempfile.mkdtemp(prefix="pdfedi-tool-"))

    def new_output_path(self, suffix: str) -> Path:
        safe = "".join(c if c.isalnum() else "_" for c in suffix)[:40] or "output"
        return self.workdir / f"output_{safe}"

    def cleanup(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)


def get_option(options: dict, spec: ToolSpec, name: str) -> Any:
    """Fetch an option value, falling back to the spec default."""
    if name in options and options[name] is not None:
        return options[name]
    for opt in spec.options:
        if opt.name == name:
            return opt.default
    return None


def require_option(options: dict, spec: ToolSpec, name: str) -> Any:
    value = get_option(options, spec, name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ToolError(f"Option '{name}' is required.", code="missing_option")
    return value
