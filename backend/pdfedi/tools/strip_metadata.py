"""Strip PDF metadata in one click, with a before/after report.

One-click strip: removes title, author, subject, keywords, creator,
producer, creation/modification dates and the XMP metadata packet, then
returns the cleaned PDF(s) plus a metadata_report.json showing exactly
what was in each file before and what remains after.

This is deliberately different from Edit Metadata (which edits fields
one by one) and View Metadata (read-only): it removes everything it can
and proves it with the report.

Honest limit: pypdf's writer stamps its own producer value on the
output file. The report lists that as a remaining field instead of
claiming the file is completely bare.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

from pdfedi.tools._helpers import open_pdf_reader, text_or_none
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

_FIELDS = (
    ("title", "/Title"),
    ("author", "/Author"),
    ("subject", "/Subject"),
    ("keywords", "/Keywords"),
    ("creator", "/Creator"),
    ("producer", "/Producer"),
    ("creation_date", "/CreationDate"),
    ("modification_date", "/ModDate"),
)

SPEC = ToolSpec(
    key="strip_metadata",
    name="Strip Metadata",
    tagline="Remove hidden metadata, with a before/after report",
    description=(
        "Remove all document metadata from a PDF in one click — title, "
        "author, dates, creator, producer and the XMP packet — and get a "
        "before/after report showing exactly what was removed. Upload 1–10 "
        "PDFs; results come back as a ZIP of cleaned PDFs plus "
        "metadata_report.json."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=10,
    options=[],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    activity="processing",
    category="security",
)


def _read_report(reader: PdfReader) -> dict[str, Any]:
    report: dict[str, Any] = {}
    info = reader.metadata or {}
    for name, pdf_key in _FIELDS:
        report[name] = text_or_none(info.get(pdf_key))
    try:
        report["page_count"] = len(reader.pages)
    except Exception:
        report["page_count"] = None
    try:
        catalog = reader.trailer.get("/Root")
        catalog = catalog.get_object() if catalog is not None else {}
        report["has_xmp_metadata"] = "/Metadata" in catalog
    except Exception:
        report["has_xmp_metadata"] = None
    return report


def _strip_pdf(data: bytes, filename: str) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    reader = open_pdf_reader(data, filename, encrypted_code="invalid_input")
    before = _read_report(reader)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    # Blank every document-info field. A fresh PdfWriter does not copy the
    # source catalog, so the XMP packet is dropped with it.
    writer.add_metadata({key: "" for _name, key in _FIELDS})
    buf = io.BytesIO()
    writer.write(buf)
    out_bytes = buf.getvalue()
    after_reader = PdfReader(io.BytesIO(out_bytes))
    after = _read_report(after_reader)
    return out_bytes, before, after


def run(ctx: ToolContext, options: dict) -> Path:
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    report: dict[str, Any] = {"files": []}
    out = Path(str(ctx.new_output_path("metadata_stripped")) + ".zip")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for tool_input in ctx.inputs:
            data = tool_input.path.read_bytes()
            cleaned, before, after = _strip_pdf(data, tool_input.filename)
            stem = Path(tool_input.filename).stem or "document"
            zf.writestr(f"{stem}_clean.pdf", cleaned)
            removed = sorted(
                name for name, value in before.items()
                if value not in (None, "", False) and after.get(name) in (None, "")
            )
            remaining = sorted(
                name for name, value in after.items()
                if value not in (None, "", False)
            )
            report["files"].append({
                "filename": tool_input.filename,
                "before": before,
                "after": after,
                "removed": removed,
                "remaining": remaining,
                "note": (
                    "Producer may show as the PDF writer's own value; "
                    "that is set when the cleaned file is written, not "
                    "carried over from your original."
                    if "producer" in remaining else ""
                ),
            })
    with zipfile.ZipFile(out, "a", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metadata_report.json", json.dumps(report, indent=2) + "\n")
    return out
