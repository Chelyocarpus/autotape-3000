"""Tron-style real-time waveform visualizer widget."""

import collections
import math

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QColor, QLinearGradient, QPainter, QPen
from PyQt6.QtWidgets import QSizePolicy, QWidget

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
_BG        = QColor(0x04, 0x08, 0x14)          # near-black blue tint
_GRID      = QColor(0x12, 0x1e, 0x38, 120)     # subtle indigo grid lines
_CENTER    = QColor(0x1e, 0x30, 0x58, 200)     # dim center baseline
_CYAN      = QColor(0x00, 0xe5, 0xff)          # Tron neon cyan
_CYAN_MID  = QColor(0x00, 0xb8, 0xd4)          # slightly darker mid-bar
_GLOW_OUT  = QColor(0x00, 0xe5, 0xff,  22)     # outermost soft halo
_GLOW_MID  = QColor(0x00, 0xe5, 0xff,  55)     # inner halo
_BRACKET   = QColor(0x00, 0xe5, 0xff, 100)     # corner bracket marks
_IDLE_LINE = QColor(0x00, 0xe5, 0xff,  50)     # flat line when idle

NUM_BARS   = 120   # more columns → finer resolution
BAR_GAP    = 1     # 1 px gap between bars
CORNER_LEN = 8     # px — length of corner bracket arms
WIDGET_H   = 72

# Smoothing coefficients (applied every push_level call)
_ATTACK = 0.75   # weight given to a *rising* new sample  (fast attack)
_DECAY  = 0.12   # weight given to a *falling* new sample (slow decay)


class WaveformWidget(QWidget):
    """Scrolling bar-waveform visualiser with a Tron / sci-fi aesthetic.

    Call :meth:`push_level` (via a Qt signal so it is thread-safe) every time
    a new RMS value is available.  Call :meth:`set_active` to switch between
    the recording-active and idle visual states.
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        # Raw incoming levels scrolled as history
        self._levels: collections.deque[float] = collections.deque(
            [0.0] * NUM_BARS, maxlen=NUM_BARS
        )
        # Per-column smoothed display value (attack on rise, decay on fall)
        self._smoothed: list[float] = [0.0] * NUM_BARS
        self._active = False

        self.setFixedHeight(WIDGET_H)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_active(self, active: bool) -> None:
        """Switch between recording (active) and idle visual state."""
        self._active = active
        if not active:
            for i in range(len(self._levels)):
                self._levels[i] = 0.0
            self._smoothed = [0.0] * NUM_BARS
        self.update()

    def push_level(self, rms: float) -> None:
        """Append a normalized RMS value [0, 1] and trigger a repaint.

        A perceptual sqrt curve expands quiet signals so fine detail is
        visible even at low recording levels.  Each column is then
        independently attack/decay-smoothed before painting.
        """
        perceptual = math.sqrt(max(0.0, min(1.0, rms)))
        self._levels.append(perceptual)

        # Re-apply smoothing across the entire column history so the
        # decay glides as the history scrolls left.
        raw = list(self._levels)
        for i, lvl in enumerate(raw):
            prev = self._smoothed[i]
            if lvl >= prev:
                self._smoothed[i] = _ATTACK * lvl + (1.0 - _ATTACK) * prev
            else:
                self._smoothed[i] = _DECAY * lvl + (1.0 - _DECAY) * prev

        self.update()

    # ------------------------------------------------------------------
    # Paint
    # ------------------------------------------------------------------

    def paintEvent(self, event) -> None:  # noqa: ANN001
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self.width()
        h = self.height()
        cx = w // 2
        cy = h // 2

        # --- background ------------------------------------------------
        painter.fillRect(0, 0, w, h, _BG)

        # --- grid (3 horizontal rules) ---------------------------------
        grid_pen = QPen(_GRID, 1, Qt.PenStyle.DotLine)
        painter.setPen(grid_pen)
        for frac in (0.25, 0.5, 0.75):
            y = int(h * frac)
            painter.drawLine(0, y, w, y)

        # --- center baseline -------------------------------------------
        painter.setPen(QPen(_CENTER, 1))
        painter.drawLine(0, cy, w, cy)

        # --- bars -------------------------------------------------------
        n = NUM_BARS
        smoothed = self._smoothed

        # Compute per-bar pixel width from available widget width
        total_gap = (n - 1) * BAR_GAP
        bar_w = max(1, (w - total_gap) // n)
        step = bar_w + BAR_GAP

        # Glow widths scale with bar width so thin bars keep proportions
        glow_outer_w = max(3, bar_w + 5)
        glow_inner_w = max(2, bar_w + 2)

        for i in range(n):
            lvl = smoothed[i]
            if lvl <= 0.001:
                continue

            bar_h = max(2, int(lvl * (h - 6)))
            x = i * step
            bar_top = cy - bar_h // 2
            bar_bot = cy + bar_h // 2
            mid_x = int(x + bar_w / 2)

            # Outer glow
            glow_outer = QPen(_GLOW_OUT, glow_outer_w)
            glow_outer.setCapStyle(Qt.PenCapStyle.FlatCap)
            painter.setPen(glow_outer)
            painter.drawLine(mid_x, bar_top - 2, mid_x, bar_bot + 2)

            # Inner glow
            glow_inner = QPen(_GLOW_MID, glow_inner_w)
            glow_inner.setCapStyle(Qt.PenCapStyle.FlatCap)
            painter.setPen(glow_inner)
            painter.drawLine(mid_x, bar_top - 1, mid_x, bar_bot + 1)

            # Core — vertical gradient cyan → slightly dimmer at midpoint
            grad = QLinearGradient(0, bar_top, 0, bar_bot)
            grad.setColorAt(0.0, _CYAN)
            grad.setColorAt(0.5, _CYAN_MID)
            grad.setColorAt(1.0, _CYAN)
            core_pen = QPen(grad, bar_w)  # type: ignore[arg-type]
            core_pen.setCapStyle(Qt.PenCapStyle.FlatCap)
            painter.setPen(core_pen)
            painter.drawLine(mid_x, bar_top, mid_x, bar_bot)

        # --- idle flat line (when not recording) -----------------------
        if not self._active:
            painter.setPen(QPen(_IDLE_LINE, 1))
            painter.drawLine(0, cy, w, cy)

        # --- corner brackets -------------------------------------------
        self._draw_brackets(painter, w, h)

        painter.end()

    @staticmethod
    def _draw_brackets(painter: QPainter, w: int, h: int) -> None:
        """Draw small L-shaped corner decorations à la Tron HUD."""
        pen = QPen(_BRACKET, 1)
        painter.setPen(pen)
        cl = CORNER_LEN

        # Top-left
        painter.drawLine(0, 0, cl, 0)
        painter.drawLine(0, 0, 0, cl)
        # Top-right
        painter.drawLine(w - cl, 0, w - 1, 0)
        painter.drawLine(w - 1, 0, w - 1, cl)
        # Bottom-left
        painter.drawLine(0, h - 1, cl, h - 1)
        painter.drawLine(0, h - cl, 0, h - 1)
        # Bottom-right
        painter.drawLine(w - cl, h - 1, w - 1, h - 1)
        painter.drawLine(w - 1, h - cl, w - 1, h - 1)
