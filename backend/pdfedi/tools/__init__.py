"""Tool registry — the single source of truth for available tools."""
from __future__ import annotations

from typing import Any

from . import (
    compress,
    delete_pages,
    edit_metadata,
    extract_text,
    flatten,
    images_to_pdf,
    merge,
    metadata,
    ocr,
    page_numbers,
    password_protect,
    pdf_to_images,
    redact,
    reorder_pages,
    rotate_pages,
    split,
    thumbnails,
    watermark,
)
from .base import ToolSpec

_MODULES = [
    compress, merge, split, rotate_pages, delete_pages, reorder_pages,
    extract_text, pdf_to_images, images_to_pdf, thumbnails, metadata,
    edit_metadata, password_protect, watermark, page_numbers, redact,
    flatten, ocr,
]

TOOLS: dict[str, Any] = {}
for _m in _MODULES:
    if _m.SPEC.key in TOOLS:
        raise RuntimeError(f"duplicate tool key: {_m.SPEC.key}")
    TOOLS[_m.SPEC.key] = _m

def get_tool(key: str) -> Any | None:
    return TOOLS.get(key)


def list_specs() -> list[ToolSpec]:
    return [_m.SPEC for _m in _MODULES]
