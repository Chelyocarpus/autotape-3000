"""Shared filename and UI thumbnail utilities."""

import os
import re

COVER_THUMB_SIZE = 48

# Duplicate-handling modes
DUPLICATE_MODE_SKIP = "skip"
DUPLICATE_MODE_APPEND = "append"
DUPLICATE_MODE_OVERWRITE = "overwrite"

DUPLICATE_MODES = [DUPLICATE_MODE_SKIP, DUPLICATE_MODE_APPEND, DUPLICATE_MODE_OVERWRITE]
DUPLICATE_MODE_LABELS = {
    DUPLICATE_MODE_SKIP: "Skip",
    DUPLICATE_MODE_APPEND: "Append number",
    DUPLICATE_MODE_OVERWRITE: "Overwrite",
}
DEFAULT_DUPLICATE_MODE = DUPLICATE_MODE_APPEND


def sanitize_filename(name: str) -> str:
    """Strip invalid filesystem characters and trim whitespace."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    return name.strip(" .") or "recording"


def resolve_output_path(folder: str, stem: str, ext: str, mode: str) -> str | None:
    """Return the full output path to use for the given stem and extension.

    Parameters
    ----------
    folder:
        Target directory.
    stem:
        Base filename without extension (e.g. ``"Artist - Title"``).
    ext:
        File extension including the leading dot (e.g. ``".mp3"``).
    mode:
        One of :data:`DUPLICATE_MODE_SKIP`, :data:`DUPLICATE_MODE_APPEND`, or
        :data:`DUPLICATE_MODE_OVERWRITE`.

    Returns
    -------
    str | None
        The resolved path, or ``None`` when *mode* is ``"skip"`` and the file
        already exists.
    """
    candidate = os.path.join(folder, f"{stem}{ext}")

    if mode == DUPLICATE_MODE_OVERWRITE:
        return candidate

    if not os.path.exists(candidate):
        return candidate

    # File exists — skip or find a numbered variant.
    if mode == DUPLICATE_MODE_SKIP:
        return None

    # DUPLICATE_MODE_APPEND: find the lowest free " (N)" suffix.
    n = 2
    while True:
        numbered = os.path.join(folder, f"{stem} ({n}){ext}")
        if not os.path.exists(numbered):
            return numbered
        n += 1
