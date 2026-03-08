"""Shared dark theme constants and Qt stylesheet for all Autotape 3000 windows."""

from gui.icons import ICONS_DIR as _ICONS_DIR

_ICON_DIR     = _ICONS_DIR.as_posix()
_CHECK_SVG    = f"{_ICON_DIR}/check.svg"
_ARROW_UP_SVG = f"{_ICON_DIR}/arrow_up.svg"
_ARROW_DN_SVG = f"{_ICON_DIR}/arrow_down.svg"

# Deep indigo-slate palette — all hues drawn from the blue-purple family (240–265°)
# with rose as a designed complementary danger color.
COLOR_BG      = "#0e0e1a"   # near-black with deep indigo tint
COLOR_SURFACE = "#1a1a2e"   # dark indigo card surface
COLOR_ACCENT  = "#7b77f5"   # soft indigo primary action
COLOR_SUCCESS = "#3ecf8e"   # teal-green (neutral complement)
COLOR_DANGER  = "#f2637a"   # rose — harmonious complementary to indigo
COLOR_TEXT    = "#dde1f0"   # cool blue-white text — 12:1 on surface (WCAG AAA)
COLOR_SUBTEXT = "#8b90b0"   # muted blue-gray — 5.4:1 on surface (WCAG AA)
COLOR_BORDER  = "#363660"   # dark indigo border — visible against all surfaces

COLOR_WARNING = "#e8a838"   # amber — pending/waiting state

# Derived interactive states (not exported, used only in stylesheet below)
_ACCENT_HOVER   = "#6960e8"
_WARNING_HOVER  = "#d4952a"
_SURFACE_HOVER  = "#22223a"
_DANGER_HOVER   = "#d94f65"

APP_STYLESHEET = f"""
    QWidget {{
        background-color: {COLOR_BG};
        color: {COLOR_TEXT};
        font-family: 'Segoe UI';
        font-size: 10pt;
    }}
    QLabel {{
        background-color: transparent;
    }}
    QGroupBox {{
        background-color: {COLOR_SURFACE};
        border: 1px solid {COLOR_BORDER};
        border-radius: 6px;
        margin-top: 8px;
        padding: 8px;
        font-size: 8pt;
        color: {COLOR_SUBTEXT};
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        left: 8px;
        padding: 0 4px;
    }}
    QComboBox {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        padding: 3px 6px;
        selection-background-color: {COLOR_ACCENT};
    }}
    QComboBox:hover {{
        border-color: {COLOR_ACCENT};
    }}
    QComboBox:disabled {{
        color: {COLOR_SUBTEXT};
    }}
    QComboBox QAbstractItemView {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        selection-background-color: {COLOR_ACCENT};
        selection-color: #ffffff;
        border: 1px solid {COLOR_BORDER};
    }}
    QComboBox::drop-down {{
        border: none;
    }}
    QLineEdit {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        padding: 4px 6px;
        selection-background-color: {COLOR_ACCENT};
    }}
    QLineEdit:hover, QLineEdit:focus {{
        border-color: {COLOR_ACCENT};
    }}
    QSpinBox {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        padding: 3px 4px;
        selection-background-color: {COLOR_ACCENT};
    }}
    QSpinBox:hover, QSpinBox:focus {{
        border-color: {COLOR_ACCENT};
    }}
    QSpinBox::up-button, QSpinBox::down-button {{
        background-color: {COLOR_BORDER};
        border: none;
        width: 14px;
    }}
    QSpinBox::up-button:hover, QSpinBox::down-button:hover {{
        background-color: {_SURFACE_HOVER};
    }}
    QSpinBox::up-arrow {{
        image: url("{_ARROW_UP_SVG}");
        width: 7px;
        height: 5px;
    }}
    QSpinBox::down-arrow {{
        image: url("{_ARROW_DN_SVG}");
        width: 7px;
        height: 5px;
    }}
    QSpinBox::up-arrow:disabled, QSpinBox::down-arrow:disabled {{
        opacity: 0.35;
    }}
    QCheckBox {{
        background-color: transparent;
        color: {COLOR_TEXT};
        spacing: 6px;
    }}
    QCheckBox::indicator {{
        width: 14px;
        height: 14px;
        background-color: {COLOR_BG};
        border: 1px solid {COLOR_BORDER};
        border-radius: 3px;
    }}
    QCheckBox::indicator:hover {{
        border-color: {COLOR_ACCENT};
    }}
    QCheckBox::indicator:checked {{
        background-color: {COLOR_ACCENT};
        border-color: {COLOR_ACCENT};
        image: url("{_CHECK_SVG}");
    }}
    QCheckBox:disabled {{
        color: {COLOR_SUBTEXT};
    }}
    QPushButton {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        padding: 5px 12px;
        font-size: 9pt;
    }}
    QPushButton:hover {{
        background-color: {_SURFACE_HOVER};
        border-color: {COLOR_ACCENT};
    }}
    QPushButton:disabled {{
        color: {COLOR_SUBTEXT};
    }}
    QPushButton:checked {{
        background-color: {COLOR_ACCENT};
        color: #ffffff;
        border-color: {COLOR_ACCENT};
    }}
    QPushButton:checked:hover {{
        background-color: {_ACCENT_HOVER};
        border-color: {_ACCENT_HOVER};
    }}
    QPushButton#recordBtn {{
        border-radius: 6px;
        font-size: 11pt;
        font-weight: bold;
        padding: 10px 24px;
    }}
    QStatusBar {{
        background-color: {COLOR_SURFACE};
        border-top: 1px solid {COLOR_BORDER};
    }}
    QLabel#statusBar {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_SUBTEXT};
        font-size: 9pt;
        padding: 4px 12px;
    }}
    QLabel#subtext {{
        color: {COLOR_SUBTEXT};
        font-size: 9pt;
    }}
    QLabel#hint {{
        color: {COLOR_SUBTEXT};
        font-size: 8pt;
    }}
    QWidget#titleBar {{
        background-color: {COLOR_SURFACE};
        border-bottom: 1px solid {COLOR_BORDER};
    }}
    QLabel#titleBarTitle {{
        color: {COLOR_SUBTEXT};
        font-size: 8pt;
        font-weight: bold;
        letter-spacing: 1px;
        text-transform: uppercase;
    }}
    QPushButton#titleBarCompact {{
        background: transparent;
        border: none;
        color: {COLOR_SUBTEXT};
        font-size: 13pt;
        border-radius: 0px;
        padding: 0px;
    }}
    QPushButton#titleBarCompact:hover {{
        background-color: {_SURFACE_HOVER};
        color: {COLOR_TEXT};
    }}
    QPushButton#titleBarMin {{
        background: transparent;
        border: none;
        color: {COLOR_SUBTEXT};
        font-size: 15pt;
        border-radius: 0px;
        padding: 0px;
    }}
    QPushButton#titleBarMin:hover {{
        background-color: {_SURFACE_HOVER};
        color: {COLOR_TEXT};
    }}
    QPushButton#titleBarClose {{
        background: transparent;
        border: none;
        color: {COLOR_SUBTEXT};
        font-size: 14pt;
        border-radius: 0px;
        padding: 0px;
    }}
    QPushButton#titleBarClose:hover {{
        background-color: {COLOR_DANGER};
        color: #ffffff;
    }}
    QWidget#outerFrame {{
        border: 1px solid {COLOR_BORDER};
    }}
    QLabel#timerLabel {{
        background-color: transparent;
        color: {COLOR_DANGER};
        font-size: 14pt;
        font-weight: bold;
        font-family: 'Consolas', 'Courier New', monospace;
        letter-spacing: 2px;
    }}
    QTabWidget::pane {{
        border: 1px solid {COLOR_BORDER};
        border-radius: 6px;
        background-color: {COLOR_BG};
        padding: 4px;
    }}
    QTabBar::tab {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_SUBTEXT};
        border: 1px solid {COLOR_BORDER};
        border-bottom: none;
        border-top-left-radius: 4px;
        border-top-right-radius: 4px;
        padding: 5px 16px;
        font-size: 9pt;
    }}
    QTabBar::tab:selected {{
        background-color: {COLOR_BG};
        color: {COLOR_TEXT};
        border-bottom: 1px solid {COLOR_BG};
    }}
    QTabBar::tab:hover:!selected {{
        background-color: {_SURFACE_HOVER};
        color: {COLOR_TEXT};
    }}
    QLabel#trackLabel {{
        background-color: transparent;
        color: {COLOR_ACCENT};
        font-size: 10pt;
        font-weight: bold;
        padding: 0 4px 4px 4px;
    }}
    QTableWidget {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        gridline-color: {COLOR_BORDER};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        selection-background-color: {COLOR_ACCENT};
        selection-color: #ffffff;
    }}
    QTableWidget::item {{
        padding: 3px 6px;
    }}
    QTableWidget::item:hover {{
        background-color: {_SURFACE_HOVER};
    }}
    QTableWidget::item:selected {{
        background-color: {COLOR_ACCENT};
        color: #ffffff;
    }}
    QTableWidget::item:alternate {{
        background-color: {COLOR_BG};
    }}
    QTableWidget::item:alternate:hover {{
        background-color: {_SURFACE_HOVER};
    }}
    QTableWidget::item:alternate:selected {{
        background-color: {COLOR_ACCENT};
        color: #ffffff;
    }}
    QHeaderView::section {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_SUBTEXT};
        border: none;
        border-bottom: 1px solid {COLOR_BORDER};
        padding: 4px 6px;
        font-size: 8pt;
    }}
    QScrollBar:vertical {{
        background-color: {COLOR_BG};
        width: 8px;
        border: none;
        border-radius: 4px;
    }}
    QScrollBar::handle:vertical {{
        background-color: {COLOR_BORDER};
        min-height: 24px;
        border-radius: 4px;
    }}
    QScrollBar::handle:vertical:hover {{
        background-color: {COLOR_SUBTEXT};
    }}
    QScrollBar::add-line:vertical,
    QScrollBar::sub-line:vertical {{
        height: 0;
        background: none;
    }}
    QScrollBar::add-page:vertical,
    QScrollBar::sub-page:vertical {{
        background: none;
    }}
    QScrollBar:horizontal {{
        background-color: {COLOR_BG};
        height: 8px;
        border: none;
        border-radius: 4px;
    }}
    QScrollBar::handle:horizontal {{
        background-color: {COLOR_BORDER};
        min-width: 24px;
        border-radius: 4px;
    }}
    QScrollBar::handle:horizontal:hover {{
        background-color: {COLOR_SUBTEXT};
    }}
    QScrollBar::add-line:horizontal,
    QScrollBar::sub-line:horizontal {{
        width: 0;
        background: none;
    }}
    QScrollBar::add-page:horizontal,
    QScrollBar::sub-page:horizontal {{
        background: none;
    }}
    QToolTip {{
        background-color: {COLOR_SURFACE};
        color: {COLOR_TEXT};
        border: 1px solid {COLOR_BORDER};
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 9pt;
    }}
"""
