"""Shared filename and UI thumbnail utilities."""

import re

COVER_THUMB_SIZE = 48


def _sanitize_filename(name: str) -> str:
    """Strip invalid filesystem characters and trim whitespace."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    return name.strip(" .") or "recording"
