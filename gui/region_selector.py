"""Fullscreen region-selector overlay for picking a screen area as cover art."""

import ctypes

from PIL import ImageGrab
from PyQt6.QtCore import QPoint, QRect, Qt
from PyQt6.QtGui import QColor, QCursor, QImage, QPainter, QPen, QPixmap
from PyQt6.QtWidgets import QWidget

from gui.theme import COLOR_ACCENT

# Semi-transparent dark tint applied outside the selection rectangle.
_SCRIM_ALPHA = 140  # 0-255; area *outside* selection only


class RegionSelector(QWidget):
    """Fullscreen overlay spanning all monitors that lets the user drag-select
    a screen region.

    The screenshot is shown at full brightness; only the area *outside* the
    active selection is dimmed so the user can see exactly what they are
    capturing.

    Calls *callback* with (PIL Image, bbox tuple) on success, or
    (None, None) if the user cancels (Escape) or the area is too small.
    """

    _MIN_PX = 5

    def __init__(self, callback) -> None:
        super().__init__()
        self._callback = callback
        self._start: QPoint = QPoint()
        self._current: QPoint = QPoint()
        self._selecting = False
        self._done = False

        # Virtual desktop origin and dimensions (covers all monitors).
        um = ctypes.windll.user32
        self._vx: int = um.GetSystemMetrics(76)   # SM_XVIRTUALSCREEN
        self._vy: int = um.GetSystemMetrics(77)   # SM_YVIRTUALSCREEN
        vw: int      = um.GetSystemMetrics(78)    # SM_CXVIRTUALSCREEN
        vh: int      = um.GetSystemMetrics(79)    # SM_CYVIRTUALSCREEN

        self._screenshot = ImageGrab.grab(
            bbox=(self._vx, self._vy, self._vx + vw, self._vy + vh),
            all_screens=True,
        )

        # Convert screenshot to a QPixmap at original (undarkened) quality.
        img_rgba = self._screenshot.convert("RGBA")
        buf = img_rgba.tobytes("raw", "RGBA")
        qimg = QImage(buf, img_rgba.width, img_rgba.height, QImage.Format.Format_RGBA8888)
        self._bg_pixmap = QPixmap.fromImage(qimg)

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        # Use show() — showFullScreen() would snap to the primary monitor only.
        self.setGeometry(self._vx, self._vy, vw, vh)
        self.setCursor(QCursor(Qt.CursorShape.CrossCursor))
        self.show()

    # ------------------------------------------------------------------
    # Event handling
    # ------------------------------------------------------------------

    def keyPressEvent(self, event) -> None:  # noqa: ANN001
        if event.key() == Qt.Key.Key_Escape:
            self._cancel()

    def mousePressEvent(self, event) -> None:  # noqa: ANN001
        if event.button() == Qt.MouseButton.LeftButton:
            self._start = event.pos()
            self._current = event.pos()
            self._selecting = True

    def mouseMoveEvent(self, event) -> None:  # noqa: ANN001
        if self._selecting:
            self._current = event.pos()
            self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: ANN001
        if event.button() == Qt.MouseButton.LeftButton and self._selecting:
            self._selecting = False
            self._current = event.pos()
            self._finish()

    # ------------------------------------------------------------------
    # Painting
    # ------------------------------------------------------------------

    def paintEvent(self, event) -> None:  # noqa: ANN001
        painter = QPainter(self)
        w, h = self.width(), self.height()

        # Always draw the full undarkened screenshot first.
        painter.drawPixmap(0, 0, self._bg_pixmap)

        scrim = QColor(0, 0, 0, _SCRIM_ALPHA)

        if self._selecting or self._start != self._current:
            sel = QRect(self._start, self._current).normalized()

            # Darken the four regions around the selection, not the selection itself.
            # Top strip
            painter.fillRect(0, 0, w, sel.top(), scrim)
            # Bottom strip
            painter.fillRect(0, sel.bottom() + 1, w, h - sel.bottom() - 1, scrim)
            # Left strip (between top and bottom strips)
            painter.fillRect(0, sel.top(), sel.left(), sel.height(), scrim)
            # Right strip (between top and bottom strips)
            painter.fillRect(sel.right() + 1, sel.top(), w - sel.right() - 1, sel.height(), scrim)

            # Selection border
            pen = QPen(QColor(COLOR_ACCENT), 2)
            painter.setPen(pen)
            painter.drawRect(sel)
        else:
            # No selection started yet — dim everything with a light scrim.
            painter.fillRect(0, 0, w, h, scrim)

        painter.end()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def closeEvent(self, event) -> None:  # noqa: ANN001
        if not self._done:
            self._done = True
            self._callback(None, None)
        super().closeEvent(event)

    def _cancel(self) -> None:
        self._done = True
        self._callback(None, None)
        self.close()

    def _finish(self) -> None:
        rect = QRect(self._start, self._current).normalized()
        x1, y1, x2, y2 = rect.left(), rect.top(), rect.right(), rect.bottom()
        self._done = True
        self.close()
        if x2 - x1 < self._MIN_PX or y2 - y1 < self._MIN_PX:
            self._callback(None, None)
            return
        bbox = (
            self._vx + x1, self._vy + y1,
            self._vx + x2, self._vy + y2,
        )
        cropped = self._screenshot.crop((x1, y1, x2, y2))
        self._callback(cropped, bbox)
