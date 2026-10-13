"""Tool registry — the single source of truth for available tools."""
from __future__ import annotations

from typing import Any

from . import (
    compress,
    crop,
    delete_pages,
    edit_metadata,
    extract_images,
    extract_text,
    flatten,
    grayscale,
    images_to_pdf,
    compare,
    merge,
    metadata,
    n_up,
    ocr,
    pdf_to_word,
    page_numbers,
    password_protect,
    pdf_to_images,
    redact,
    repair,
    reorder_pages,
    resize_pages,
    rotate_pages,
    split,
    thumbnails,
    unlock_pdf,
    watermark,
)
from .base import ToolSpec

_MODULES = [
    compress, merge, split, rotate_pages, delete_pages, reorder_pages,
    resize_pages, n_up, repair,
    extract_text, pdf_to_images, images_to_pdf, thumbnails, extract_images,
    ocr, metadata, edit_metadata, watermark, page_numbers, crop,
    grayscale, password_protect, unlock_pdf, redact, flatten, compare,
    pdf_to_word,
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
