"""Experimental tool template. NOT loaded — copy to <key>.py to use.

Every sandbox tool follows the exact production contract from
backend/pdfedi/tools/base.py so a validated tool can move to production
unchanged (after explicit approval):

    SPEC: ToolSpec   — metadata
    run(ctx, options) -> Path  — returns the output file inside ctx.workdir

Rules:
  * raise ToolError for user-facing failures.
  * run() must be pure w.r.t. any database — read inputs from disk,
    write the output file. No network calls to production services.
"""
from __future__ import annotations

from pathlib import Path

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="template",
    name="Template Tool",
    tagline="Copy me to start a new experimental tool",
    description="Replace this with the experimental tool's description.",
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="example",
            kind="text",
            label="Example option",
            required=False,
            default="",
            help="An example text option.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="processing",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    example = get_option(options, SPEC, "example")

    # --- experimental implementation goes here ---
    # Must return a Path to the output file inside ctx.workdir.
    raise ToolError(
        f"Template tool is not implemented (example={example!r}).",
        code="not_implemented",
    )
