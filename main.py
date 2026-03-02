"""Entry point for the Autotape 3000 application."""

import os
import sys

from PyQt6.QtGui import QIcon
from PyQt6.QtWidgets import QApplication

from gui.recorder_app import RecorderApp
from gui.theme import APP_STYLESHEET

_ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gui", "icon.png")


def main() -> None:
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
