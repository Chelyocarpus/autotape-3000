"""Custom frameless window title bar."""

import os

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QStackedWidget, QWidget

from gui.cassette import CassetteTapeWidget

_ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")


TITLEBAR_HEIGHT = 36

# Unicode symbols used as button glyphs (typography, not emoji)
_ICON_MINIMIZE = "\u2212"   # − MINUS SIGN
_ICON_CLOSE    = "\u00d7"   # × MULTIPLICATION SIGN
_ICON_COMPACT  = "\u229f"   # ⊟ SQUARED MINUS  (enter compact view)
_ICON_EXPAND   = "\u229e"   # ⊞ SQUARED PLUS   (leave compact view)


class TitleBar(QWidget):
    """Drag-to-move title bar with minimize and close buttons.

    Designed for frameless ``QMainWindow`` windows.  Relies on the OS-level
    ``startSystemMove()`` API so Aero Snap and multi-monitor dragging work
    exactly as with a native title bar.
    """

    compact_toggle = pyqtSignal()  # emitted when the compact-view button is clicked
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

        # Icon slot: index 0 = static pixmap, index 1 = animated cassette.
        self._icon_stack = QStackedWidget()
        self._icon_stack.setFixedSize(20, 20)

        icon_lbl = QLabel()
        icon_lbl.setObjectName("titleBarIcon")
        pixmap = QPixmap(_ICON_PATH)
        if not pixmap.isNull():
            icon_lbl.setPixmap(pixmap.scaled(20, 20, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        self._icon_stack.addWidget(icon_lbl)      # index 0 — idle

        self._cassette = CassetteTapeWidget()
        self._icon_stack.addWidget(self._cassette) # index 1 — recording

        layout.addWidget(self._icon_stack)
        layout.addSpacing(8)

        title_lbl = QLabel(self._window.windowTitle())
        title_lbl.setObjectName("titleBarTitle")
        layout.addWidget(title_lbl)

        layout.addStretch()

        for obj_name, glyph, slot in (
            ("titleBarCompact", _ICON_COMPACT, self.compact_toggle.emit),
            ("titleBarMin",     _ICON_MINIMIZE, self._minimize),
            ("titleBarClose",   _ICON_CLOSE,    self._window.close),
        ):
            btn = QPushButton(glyph)
            btn.setObjectName(obj_name)
            btn.setFixedSize(40, TITLEBAR_HEIGHT)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(slot)
            layout.addWidget(btn)
        self._compact_btn = self.findChild(QPushButton, "titleBarCompact")

    def set_compact(self, active: bool) -> None:
        """Update the compact button glyph to reflect the current view state."""
        if self._compact_btn:
            self._compact_btn.setText(_ICON_EXPAND if active else _ICON_COMPACT)
            tip = "Restore full view" if active else "Compact view"
            self._compact_btn.setToolTip(tip)

    # ------------------------------------------------------------------
    # Recording state
    # ------------------------------------------------------------------

    def set_recording(self, active: bool) -> None:
        """Swap to the animated cassette (recording) or static icon (idle)."""
        self._icon_stack.setCurrentIndex(1 if active else 0)
        self._cassette.set_recording(active)

    def set_level(self, rms: float) -> None:
        """Forward the current audio RMS level to the cassette reel animation."""
        self._cassette.set_level(rms)

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
