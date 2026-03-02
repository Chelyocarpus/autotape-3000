"""Custom frameless window title bar."""

import os

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget

_ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")


TITLEBAR_HEIGHT = 36

# Unicode symbols used as button glyphs (typography, not emoji)
_ICON_MINIMIZE = "\u2212"   # − MINUS SIGN
_ICON_CLOSE    = "\u00d7"   # × MULTIPLICATION SIGN


class TitleBar(QWidget):
    """Drag-to-move title bar with minimize and close buttons.

    Designed for frameless ``QMainWindow`` windows.  Relies on the OS-level
    ``startSystemMove()`` API so Aero Snap and multi-monitor dragging work
    exactly as with a native title bar.
    """

    def __init__(self, window: "QWidget") -> None:
        super().__init__(window)
        self._window = window
        self.setObjectName("titleBar")
        self.setFixedHeight(TITLEBAR_HEIGHT)
        self._build()

    def _build(self) -> None:
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 0, 4, 0)
        layout.setSpacing(0)

        icon_lbl = QLabel()
        icon_lbl.setObjectName("titleBarIcon")
        pixmap = QPixmap(_ICON_PATH)
        if not pixmap.isNull():
            icon_lbl.setPixmap(pixmap.scaled(20, 20, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        icon_lbl.setContentsMargins(0, 0, 8, 0)
        layout.addWidget(icon_lbl)

        title_lbl = QLabel(self._window.windowTitle())
        title_lbl.setObjectName("titleBarTitle")
        layout.addWidget(title_lbl)

        layout.addStretch()

        for obj_name, glyph, slot in (
            ("titleBarMin",   _ICON_MINIMIZE, self._minimize),
            ("titleBarClose", _ICON_CLOSE,    self._window.close),
        ):
            btn = QPushButton(glyph)
            btn.setObjectName(obj_name)
            btn.setFixedSize(40, TITLEBAR_HEIGHT)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(slot)
            layout.addWidget(btn)

    # ------------------------------------------------------------------
    # Button actions
    # ------------------------------------------------------------------

    def _minimize(self) -> None:
        self._window.showMinimized()

    # ------------------------------------------------------------------
    # Drag to move
    # ------------------------------------------------------------------

    def mousePressEvent(self, event) -> None:  # noqa: ANN001
        if event.button() == Qt.MouseButton.LeftButton:
            handle = self._window.windowHandle()
            if handle:
                handle.startSystemMove()
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: ANN001
        """Double-click minimizes (no maximize — window is fixed-size)."""
        if event.button() == Qt.MouseButton.LeftButton:
            self._minimize()
        super().mouseDoubleClickEvent(event)
