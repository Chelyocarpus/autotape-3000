"""SVG icon helpers for Autotape 3000 GUI."""

from pathlib import Path

from PyQt6.QtGui import QIcon

ICONS_DIR: Path = Path(__file__).parent / "icons"


def make(filename: str) -> QIcon:
    """Return a QIcon loaded from the given SVG filename in the gui/icons directory."""
    return QIcon(str(ICONS_DIR / filename))
