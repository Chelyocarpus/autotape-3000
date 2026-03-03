"""Entry point for the Autotape 3000 application."""

import ctypes
import os
import sys

from PyQt6.QtGui import QIcon
from PyQt6.QtWidgets import QApplication

from gui.recorder_app import RecorderApp
from gui.theme import APP_STYLESHEET

_APP_ID = "autotape3000.app"
_ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gui", "icon.png")


def _set_app_id() -> None:
    """Set a Windows AppUserModelID so the taskbar shows the correct icon."""
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(_APP_ID)
    except (AttributeError, OSError):
        pass  # Non-Windows or unavailable — safe to ignore.


def main() -> None:
    _set_app_id()
    app = QApplication(sys.argv)
    app.setStyleSheet(APP_STYLESHEET)
    app_icon = QIcon(_ICON_PATH)
    app.setWindowIcon(app_icon)
    window = RecorderApp()
    window.setWindowIcon(app_icon)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
