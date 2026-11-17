"""Tool registry — the single source of truth for available tools."""
from __future__ import annotations

from typing import Any

from . import (
    compress,
    crop,
    delete_pages,
    edit_metadata,
    exhibit_combine,
    extract_text,
    flatten,
    grayscale,
    images_to_pdf,
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
    rotate_pages,
    split,
    strip_image_metadata,
    strip_metadata,
    unlock_pdf,
    watermark,
)
from .base import ToolSpec

_MODULES = [
    merge, split, rotate_pages, delete_pages, reorder_pages,
    n_up, repair,
    extract_text, pdf_to_images, images_to_pdf,
    ocr, metadata, edit_metadata, watermark, page_numbers, crop,
    grayscale, password_protect, unlock_pdf, redact, flatten,
    pdf_to_word,
    compress, strip_metadata, exhibit_combine, strip_image_metadata,
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
