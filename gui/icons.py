"""SVG icon helpers for Autotape 3000 GUI."""

import os

from PyQt6.QtGui import QIcon

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")


def make(filename: str) -> QIcon:
    """Return a QIcon loaded from the given SVG filename in the gui/icons directory."""
    return QIcon(os.path.join(_DIR, filename))
