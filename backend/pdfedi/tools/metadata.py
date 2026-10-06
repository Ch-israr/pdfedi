"""Read a PDF's document metadata and write it as a JSON file (pypdf)."""
from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from pdfedi.tools._helpers import read_input_bytes
from pdfedi.tools.base import ToolContext, ToolError, ToolSpec

_METADATA_FIELDS = (
    ("title", "/Title"),
    ("author", "/Author"),
    ("subject", "/Subject"),
    ("keywords", "/Keywords"),
    ("creator", "/Creator"),
    ("producer", "/Producer"),
)

SPEC = ToolSpec(
    key="metadata",
    name="Inspect Metadata",
    tagline="See a PDF's hidden document info",
    description=(
        "Read a PDF's document metadata (title, author, subject, keywords, "
        "creator, producer) plus page count and encryption status, and "
        "download it as a JSON file. The PDF itself is not modified."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="text",
    output_ext="json",
    output_mime="application/json",
)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Inspect Metadata needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )

    data = read_input_bytes(ctx.inputs[0].path)
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "Input is not a valid PDF file (missing %PDF- header).",
            code="invalid_input",
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"Input could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc

    encrypted = bool(getattr(reader, "is_encrypted", False))
    payload: dict[str, Any] = {
        "title": None,
        "author": None,
        "subject": None,
        "keywords": None,
        "creator": None,
        "producer": None,
        "page_count": None,
        "encrypted": encrypted,
        "has_forms": None,
    }
    if not encrypted:
        info = reader.metadata or {}
        for name, pdf_key in _METADATA_FIELDS:
            payload[name] = _text(info.get(pdf_key))
        try:
            payload["page_count"] = len(reader.pages)
        except Exception:
            payload["page_count"] = None
        try:
            payload["has_forms"] = reader.get_fields() is not None
        except Exception:
            payload["has_forms"] = None

    out = Path(str(ctx.new_output_path("metadata")) + ".json")
    out.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return out
