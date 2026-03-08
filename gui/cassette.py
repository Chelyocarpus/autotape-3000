"""Animated cassette-reel title-bar icon for Autotape 3000."""

import math

from PyQt6.QtCore import QPointF, QRectF, Qt, QTimer
from PyQt6.QtGui import QColor, QPainter, QPainterPath, QPen
from PyQt6.QtWidgets import QWidget

from gui.theme import COLOR_SURFACE

# ── Palette (Tron cyan — mirrors waveform.py) ─────────────────────────────────
_CYAN      = QColor(0x00, 0xe5, 0xff)
_CYAN_DIM  = QColor(0x00, 0x60, 0x75)
_BODY_FILL = QColor(0x04, 0x08, 0x14)   # near-black body interior
_BG        = QColor(COLOR_SURFACE)      # title-bar surface — fills widget margins

# ── Animation ─────────────────────────────────────────────────────────────────
_TIMER_MS = 33        # ~30 fps tick
_MAX_DPS  = 600.0     # degrees / second at RMS == 1.0
_SMOOTH   = 0.18      # IIR coefficient for speed smoothing

# ── Cassette geometry in a 20 × 14 coordinate space ──────────────────────────
_CAS_W   = 20.0
_CAS_H   = 14.0
_REEL_LX = 5.5    # left reel centre x
_REEL_RX = 14.5   # right reel centre x
_REEL_Y  = 5.5    # reel centre y (in cassette body space)
_REEL_R  = 3.5    # outer reel radius
_HUB_R   = 1.2    # hub (inner nub) radius
_WIN_X1  = 4.5    # tape window cutout — left edge
_WIN_X2  = 15.5   # tape window cutout — right edge
_WIN_Y1  = 10.2   # tape window cutout — top edge
_WIN_Y2  = 13.2   # tape window cutout — bottom edge


class CassetteTapeWidget(QWidget):
    """Tiny (~20 × 14 px body) cassette icon with two animated spinning reels.

    The reels rotate at a speed proportional to the audio level supplied via
    :meth:`set_level`.  Call :meth:`set_recording` to start/stop the animation.
    Both methods must be called from the main (GUI) thread.
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedSize(20, 20)

        self._angle      = 0.0   # current reel rotation (degrees)
        self._speed      = 0.0   # smoothed angular speed (degrees / second)
        self._target_spd = 0.0   # un-smoothed target from last level update

        self._timer = QTimer(self)
        self._timer.setInterval(_TIMER_MS)
        self._timer.timeout.connect(self._tick)

    # ── Public API ────────────────────────────────────────────────────────────

    def set_recording(self, active: bool) -> None:
        if active:
            self._timer.start()
        else:
            self._timer.stop()
            self._angle      = 0.0
            self._speed      = 0.0
            self._target_spd = 0.0
            self.update()

    def set_level(self, rms: float) -> None:
        """Update the target reel speed from a normalised RMS level [0, 1]."""
        self._target_spd = rms * _MAX_DPS

    # ── Internal ──────────────────────────────────────────────────────────────

    def _tick(self) -> None:
        self._speed = _SMOOTH * self._target_spd + (1.0 - _SMOOTH) * self._speed
        dt = _TIMER_MS / 1000.0
        self._angle = (self._angle + self._speed * dt) % 360.0
        self.update()

    # ── Paint ─────────────────────────────────────────────────────────────────

    def paintEvent(self, event) -> None:  # noqa: ANN001
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # Fill entire widget with title-bar surface color so the 3 px
        # margin strips above/below the cassette body blend in seamlessly.
        painter.fillRect(self.rect(), _BG)

        # Translate so the 20 × 14 cassette body is vertically centred in the
        # 20 × 20 widget area.
        off_y = (self.height() - _CAS_H) / 2.0
        painter.translate(0.0, off_y)

        self._draw_body(painter)
        for cx in (_REEL_LX, _REEL_RX):
            self._draw_reel(painter, cx, _REEL_Y)

    def _draw_body(self, p: QPainter) -> None:
        # Outer cassette shell
        p.setPen(QPen(_CYAN, 0.9))
        p.setBrush(_BODY_FILL)
        body = QPainterPath()
        body.addRoundedRect(QRectF(0.5, 0.5, _CAS_W - 1.0, _CAS_H - 1.0), 1.5, 1.5)
        p.drawPath(body)

        # Recessed tape-window strip at the bottom of the shell
        p.setPen(QPen(_CYAN_DIM, 0.5))
        p.setBrush(QColor(0x02, 0x05, 0x0e))
        p.drawRoundedRect(
            QRectF(_WIN_X1, _WIN_Y1, _WIN_X2 - _WIN_X1, _WIN_Y2 - _WIN_Y1),
            0.8, 0.8,
        )

    def _draw_reel(self, p: QPainter, cx: float, cy: float) -> None:
        # Outer ring
        p.setPen(QPen(_CYAN, 0.8))
        p.setBrush(QColor(0x02, 0x05, 0x0e))
        p.drawEllipse(QPointF(cx, cy), _REEL_R, _REEL_R)

        # Three rotating spokes
        spoke_pen = QPen(_CYAN, 0.8)
        spoke_pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(spoke_pen)
        for i in range(3):
            deg = self._angle + i * 120.0
            rad = math.radians(deg)
            cos_r = math.cos(rad)
            sin_r = math.sin(rad)
            p.drawLine(
                QPointF(cx + cos_r * (_HUB_R + 0.3), cy + sin_r * (_HUB_R + 0.3)),
                QPointF(cx + cos_r * (_REEL_R - 0.4), cy + sin_r * (_REEL_R - 0.4)),
            )

        # Central hub nub
        p.setPen(QPen(_CYAN, 0.5))
        p.setBrush(_CYAN_DIM)
        p.drawEllipse(QPointF(cx, cy), _HUB_R, _HUB_R)
