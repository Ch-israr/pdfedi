"""Repair a corrupted or partially unreadable PDF by rebuilding its structure."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="repair",
    name="Repair PDF",
    tagline="Fix corrupted or unreadable PDFs",
    description=(
        "Repair a damaged PDF by rebuilding its internal structure — broken "
        "cross-reference tables, truncated downloads and malformed object "
        "streams are fixed where possible. If the file cannot be salvaged, "
        "you get a clear error, never a fake 'repaired' file."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="optimizing",
    category="optimize",
)


def _is_encrypted(data: bytes) -> bool:
    """Best-effort encrypted check; never raises."""
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        return bool(getattr(reader, "is_encrypted", False))
    except Exception:
        return False


def _verify_readable(path: Path, filename: str) -> None:
    """Confirm the repaired output opens and has at least one page."""
    try:
        data = path.read_bytes()
        reader = PdfReader(io.BytesIO(data), strict=False)
        if len(reader.pages) == 0:
            raise ValueError("no pages")
    except Exception as exc:
        raise ToolError(
            f"Repair of '{filename}' did not produce a readable PDF: {exc}",
            code="unrepairable",
        ) from exc


def run(ctx: ToolContext, options: dict) -> Path:
    """Rebuild the PDF structure with qpdf; fall back to a lenient rewrite."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Repair needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    tool_input = ctx.inputs[0]
    data = tool_input.path.read_bytes()
    filename = tool_input.filename

    if _is_encrypted(data):
        raise ToolError(
            f"'{filename}' is password-protected. Use the Unlock PDF tool "
            "first, then repair the unlocked file.",
            code="encrypted_pdf",
        )

    out = ctx.new_output_path("repaired.pdf").with_suffix(".pdf")

    # Attempt 1: pikepdf (qpdf) — rebuilds xref tables and object streams,
    # the standard repair path for corrupted PDFs.
    try:
        import pikepdf

        with pikepdf.open(io.BytesIO(data)) as pdf:
            pdf.save(out)
        _verify_readable(out, filename)
        return out
    except Exception:
        # Fall through to the lenient rewrite below. pikepdf raises
        # PasswordError for encrypted files (already handled above) and
        # PdfError for unrecoverable corruption.
        pass

    # Attempt 2: lenient pypdf parse + rewrite of every readable page.
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        writer = PdfWriter()
        wrote = 0
        for page in reader.pages:
            try:
                writer.add_page(page)
                wrote += 1
            except Exception:
                continue
        if wrote == 0:
            raise ValueError("no readable pages")
        with out.open("wb") as f:
            writer.write(f)
        _verify_readable(out, filename)
        return out
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be repaired — the file is too damaged. "
            f"Detail: {exc}",
            code="unrepairable",
        ) from exc
