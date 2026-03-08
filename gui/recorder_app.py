"""Main recorder application window - PyQt6 UI."""

import csv
import datetime
import io
import json
import os
import shutil
import subprocess
import threading

import numpy as np

from PIL import Image, ImageGrab
from PyQt6.QtCore import QSize, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QColor, QIcon, QPixmap, QImage
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMenu,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSpinBox,
    QStatusBar,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from core.converter import (
    BITRATES,
    DEFAULT_BITRATE,
    DEFAULT_QUALITY,
    QUALITY_OPTIONS,
    convert_wav_to_mp3,
    write_mp3_tags,
)
from core.recorder import (
    BIT_DEPTHS,
    DEFAULT_BIT_DEPTH,
    DEFAULT_CHANNELS,
    DEFAULT_SAMPLERATE,
    AudioDevice,
    BitDepth,
    Recorder,
    get_all_devices,
)
from gui.icons import make as _icon
from gui.region_selector import RegionSelector
from gui.titlebar import TitleBar
from gui.waveform import WaveformWidget
from gui.theme import (
    COLOR_ACCENT,
    COLOR_BG,
    COLOR_BORDER,
    COLOR_DANGER,
    COLOR_SUBTEXT,
    COLOR_SUCCESS,
    COLOR_WARNING,
    _ACCENT_HOVER,
    _DANGER_HOVER,
    _WARNING_HOVER,
)
from services.media_session import (
    _GSMTC_AVAILABLE,
    run_gsmtc_watcher,
)
from utils.filename import (
    COVER_THUMB_SIZE,
    DEFAULT_DUPLICATE_MODE,
    DUPLICATE_MODE_LABELS,
    DUPLICATE_MODES,
    _sanitize_filename,
    resolve_output_path,
)

SAMPLE_RATES = [22050, 44100, 48000, 96000]

DISK_SPACE_LOW_BYTES = 1 * 1024 ** 3  # 1 GB threshold for red warning
CHANNEL_OPTIONS = [1, 2]

_LOG_COLUMNS = ("Time", "Status", "", "Track", "Duration")
_LOG_STATUS_COLORS: dict[str, str] = {
    "Saved": COLOR_SUCCESS,
    "Skipped": COLOR_WARNING,
    "Error": COLOR_DANGER,
}

# Event log (GSMTC raw-event timeline in the Log tab)
_EVTLOG_COLUMNS = ("Time", "Event", "Info")
_EVTLOG_COLORS: dict[str, str] = {
    "playback_info_changed":    "#5b9bd5",
    "media_properties_changed": "#f0a040",
    "session_changed":          "#b07ecb",
    "poll_result":              "#6ab04c",
}
_EVTLOG_MAX_ROWS = 500   # trim oldest rows when this limit is reached
_EVTLOG_TRIM_TO  = 400

WINDOW_TITLE = "Autotape 3000"
WINDOW_WIDTH = 520
WINDOW_HEIGHT = 720
COMPACT_HEIGHT = 190  # height when tabs/controls are hidden

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "settings.json")


def _explorer_select(path: str) -> None:
    """Open Windows Explorer with *path* highlighted.

    The canonical form is a plain string passed directly to Popen — Windows
    finds explorer.exe on PATH and passes the rest as its raw command line,
    which is what explorer's own parser requires for /select to work.
    Backslashes are required; os.path.normpath converts any forward slashes.
    """
    norm = os.path.normpath(path)
    subprocess.Popen(f'explorer /select,"{norm}"')  # noqa: S603


def _format_source_app(source_app: str) -> str:
    """Return a short, human-readable label from a GSMTC source AUMID.

    Strips path components and extensions so that e.g.
    ``"{GUID}\\\\Spotify.exe"`` becomes ``"Spotify"``.
    """
    if not source_app:
        return ""
    name = source_app.replace("/", "\\").split("\\")[-1]
    name = name.split(".")[0]
    return name if name else source_app


def _pct_deviation(actual: float, reported: float) -> float:
    """Return the percentage deviation between *actual* and *reported* duration."""
    return abs(actual - reported) / max(reported, 0.001) * 100


def _abs_deviation(actual: float, reported: float) -> float:
    """Return the absolute deviation in seconds between *actual* and *reported* duration."""
    return abs(actual - reported)


def _dur_skip_pct_reason(actual: float, reported: float, threshold_pct: int) -> str:
    """Return a human-readable skip reason for a percentage duration mismatch."""
    deviation = _pct_deviation(actual, reported)
    return (
        f"Duration {actual:.1f}s deviates {deviation:.0f}% "
        f"from reported {reported:.1f}s (limit: {threshold_pct}%)"
    )


def _dur_skip_abs_reason(actual: float, reported: float, threshold_abs_s: int) -> str:
    """Return a human-readable skip reason for an absolute duration mismatch."""
    deviation = _abs_deviation(actual, reported)
    return (
        f"Duration {actual:.1f}s deviates {deviation:.1f}s "
        f"from reported {reported:.1f}s (limit: {threshold_abs_s}s)"
    )


class RecorderApp(QMainWindow):
    """PyQt6 main window for audio recording."""

    _media_info_ready = pyqtSignal(object)
    _sig_track_changing = pyqtSignal()  # fires immediately on media_properties_changed, before coalesce
    _waveform_level = pyqtSignal(float)

    # Per-event GSMTC signals — used to populate the event log table.
    # Emitted from the background watcher thread; str payload is HH:MM:SS.mmm timestamp.
    _sig_evt_playback_changed = pyqtSignal(str)   # playback_info_changed fired
    _sig_evt_track_changed    = pyqtSignal(str)   # media_properties_changed fired
    _sig_evt_session_changed  = pyqtSignal(str)   # current_session_changed fired

    # Signals used to marshal save-thread results back to the main thread.
    # Using signals is the correct PyQt6 mechanism for cross-thread callbacks;
    # it guarantees delivery on the receiver's thread (main thread) regardless
    # of which thread emits.
    _sig_save_complete = pyqtSignal(str, float, str, object)           # path, duration, track, cover_art
    _sig_save_skipped = pyqtSignal(float, int, str, object)            # duration, min_s, track, cover_art
    _sig_save_skipped_duplicate = pyqtSignal(str, str, object)         # stem, track, cover_art
    _sig_save_skipped_dur_pct = pyqtSignal(float, float, int, str, object)   # actual_s, reported_s, pct, track, cover_art
    _sig_save_skipped_dur_abs = pyqtSignal(float, float, int, str, object)   # actual_s, reported_s, abs_s, track, cover_art
    _sig_save_error = pyqtSignal(str, str, object)                     # error, track, cover_art
    _sig_ensure_btn_ready = pyqtSignal()
    _sig_save_progress = pyqtSignal(int)  # 0–100, emitted from save thread during MP3 encoding

    def __init__(self) -> None:
        super().__init__()
        self._recorder: Recorder | None = None
        self._devices: list[AudioDevice] = []
        self._input_devices: list[AudioDevice] = []
        self._recording = False

        self._current_track_display: str | None = None
        self._current_album: str = ""

        self._cover_art_bytes: bytes | None = None
        self._cover_region_bbox: tuple[int, int, int, int] | None = None
        self._use_song_cover: bool = False
        self._last_thumbnail_bytes: bytes | None = None

        self._output_filename: str = "recording.wav"
        self._duplicate_mode: str = DEFAULT_DUPLICATE_MODE
        self._stop_requested: bool = False
        self._current_reported_duration: float | None = None
        self._priority_sources: list[str] = ["Spotify", "Firefox"]
        self._skip_patterns: list[dict] = []

        self._media_last_title: str | None = None
        self._media_watcher_stop = threading.Event()
        self._media_watcher_thread: threading.Thread | None = None
        self._media_pending_start = False
        self._media_pause_timer: QTimer | None = None
        self._evt_log_visible: bool = False
        self._is_compact: bool = False

        self._elapsed_seconds: int = 0
        self._elapsed_timer = QTimer(self)
        self._elapsed_timer.setInterval(1000)
        self._elapsed_timer.timeout.connect(self._tick_elapsed)

        self._media_info_ready.connect(self._media_poll)
        self._sig_track_changing.connect(self._on_track_changing)
        self._sig_evt_playback_changed.connect(self._on_evt_playback_changed)
        self._sig_evt_track_changed.connect(self._on_evt_track_changed)
        self._sig_evt_session_changed.connect(self._on_evt_session_changed)
        self._sig_save_complete.connect(self._on_save_complete)
        self._sig_save_skipped.connect(self._on_save_skipped)
        self._sig_save_skipped_duplicate.connect(self._on_save_skipped_duplicate)
        self._sig_save_skipped_dur_pct.connect(self._on_save_skipped_dur_pct)
        self._sig_save_skipped_dur_abs.connect(self._on_save_skipped_dur_abs)
        self._sig_save_error.connect(self._on_save_error)
        self._sig_ensure_btn_ready.connect(self._ensure_btn_ready)

        self._waveform = WaveformWidget()
        self._waveform_level.connect(self._waveform.push_level)

        self._track_label = QLabel("\u2014")
        self._track_label.setObjectName("trackLabel")
        self._track_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._setup_window()
        self._build_ui()
        self._waveform_level.connect(self._title_bar.set_level)
        self._populate_devices()
        self._load_config()

    # ------------------------------------------------------------------
    # Window setup
    # ------------------------------------------------------------------

    def _setup_window(self) -> None:
        self.setWindowTitle(WINDOW_TITLE)
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint | Qt.WindowType.Window
        )
        self.setFixedSize(WINDOW_WIDTH, WINDOW_HEIGHT)

    def _toggle_compact_view(self) -> None:
        self._is_compact = not self._is_compact
        self._tabs.setVisible(not self._is_compact)
        self._controls_section.setVisible(not self._is_compact)
        target_h = COMPACT_HEIGHT if self._is_compact else WINDOW_HEIGHT
        self.setFixedSize(WINDOW_WIDTH, target_h)
        self._title_bar.set_compact(self._is_compact)

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        central = QWidget()
        central.setObjectName("outerFrame")
        self.setCentralWidget(central)
        outer = QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self._title_bar = TitleBar(self)
        outer.addWidget(self._title_bar)
        self._title_bar.compact_toggle.connect(self._toggle_compact_view)

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(10)

        self._tabs = QTabWidget()
        self._tabs.setIconSize(QSize(14, 14))
        self._tabs.addTab(self._build_log_tab(), _icon("tab_log.svg"), "Log")
        self._tabs.addTab(self._build_record_tab(), _icon("tab_record.svg"), "Record")
        self._tabs.addTab(self._build_export_tab(), _icon("tab_export.svg"), "Export")
        self._tabs.addTab(self._build_automation_tab(), _icon("tab_automation.svg"), "Automation")
        layout.addWidget(self._tabs, 1)

        layout.addWidget(self._track_label)
        layout.addWidget(self._waveform)
        layout.addSpacing(4)
        self._controls_section = self._build_controls_section()
        layout.addWidget(self._controls_section, alignment=Qt.AlignmentFlag.AlignHCenter)
        outer.addWidget(content, 1)

        status_bar = QStatusBar()
        self._status_label = QLabel("Ready")
        self._status_label.setObjectName("statusBar")
        status_bar.addWidget(self._status_label, 1)
        status_bar.setSizeGripEnabled(False)
        self.setStatusBar(status_bar)

    def _build_log_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(4)

        # Search / export toolbar
        toolbar = QHBoxLayout()
        toolbar.setContentsMargins(0, 0, 0, 0)
        toolbar.setSpacing(4)
        self._log_search_edit = QLineEdit()
        self._log_search_edit.setPlaceholderText("Search tracks…")
        self._log_search_edit.setClearButtonEnabled(True)
        self._log_search_edit.textChanged.connect(self._on_log_search)
        toolbar.addWidget(self._log_search_edit, 1)
        export_btn = QPushButton("Export CSV")
        export_btn.setFixedHeight(24)
        export_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        export_btn.setToolTip("Export session log to a CSV file")
        export_btn.clicked.connect(self._export_log_csv)
        toolbar.addWidget(export_btn)
        layout.addLayout(toolbar)

        self._log_table = QTableWidget(0, len(_LOG_COLUMNS))
        self._log_table.setHorizontalHeaderLabels(list(_LOG_COLUMNS))
        hh = self._log_table.horizontalHeader()
        hh.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        hh.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        hh.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        hh.setStretchLastSection(False)
        self._log_table.setColumnWidth(2, 28)
        self._log_table.verticalHeader().setVisible(False)
        self._log_table.verticalHeader().setDefaultSectionSize(28)
        self._log_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self._log_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self._log_table.setAlternatingRowColors(True)
        self._log_table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self._log_table.customContextMenuRequested.connect(self._on_log_context_menu)
        self._log_table.cellDoubleClicked.connect(self._on_log_row_double_clicked)
        layout.addWidget(self._log_table)

        # GSMTC event log — shows raw event timeline so the user can compare
        # how different track-change methods (Next key vs. playlist click) fire.
        # Hidden by default; add "evt_log_visible": true to settings.json to show it.
        self._evt_log_header = QWidget()
        evt_header_layout = QHBoxLayout(self._evt_log_header)
        evt_header_layout.setContentsMargins(0, 6, 0, 2)
        evt_header_layout.setSpacing(4)
        evt_header_layout.addWidget(self._subtext_label("GSMTC Event Log"))
        evt_header_layout.addStretch()
        evt_copy_btn = QPushButton("Copy")
        evt_copy_btn.setFixedHeight(20)
        evt_copy_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        evt_copy_btn.setToolTip("Copy all event log rows to clipboard")
        evt_copy_btn.clicked.connect(self._copy_event_log)
        evt_header_layout.addWidget(evt_copy_btn)
        evt_clear_btn = QPushButton("Clear")
        evt_clear_btn.setFixedHeight(20)
        evt_clear_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        evt_clear_btn.clicked.connect(self._clear_event_log)
        evt_header_layout.addWidget(evt_clear_btn)
        layout.addWidget(self._evt_log_header)
        self._evt_log_header.setVisible(False)

        self._evt_log_table = QTableWidget(0, len(_EVTLOG_COLUMNS))
        self._evt_log_table.setHorizontalHeaderLabels(list(_EVTLOG_COLUMNS))
        evh = self._evt_log_table.horizontalHeader()
        evh.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        evh.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        evh.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        evh.setStretchLastSection(False)
        self._evt_log_table.verticalHeader().setVisible(False)
        self._evt_log_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self._evt_log_table.setAlternatingRowColors(True)
        self._evt_log_table.setMaximumHeight(145)
        layout.addWidget(self._evt_log_table)
        self._evt_log_table.setVisible(False)
        return tab

    def _build_record_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(8)
        layout.addWidget(self._build_device_section())
        layout.addWidget(self._build_output_section())
        layout.addStretch()
        return tab

    def _build_export_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(8)
        layout.addWidget(self._build_audio_format_section())
        layout.addWidget(self._build_mp3_export_section())
        layout.addWidget(self._build_cover_art_section())
        layout.addStretch()
        return tab

    def _build_automation_tab(self) -> QWidget:
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 8, 0, 8)
        layout.setSpacing(8)
        layout.addWidget(self._build_auto_record_section())
        layout.addWidget(self._build_source_priority_section())
        layout.addWidget(self._build_duplicate_section())
        layout.addWidget(self._build_min_duration_section())
        layout.addWidget(self._build_duration_match_section())
        layout.addWidget(self._build_always_skip_section())
        layout.addStretch()

        scroll = QScrollArea()
        scroll.setWidget(content)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        return scroll

    def _build_source_priority_section(self) -> QGroupBox:
        box = QGroupBox("Source Priority")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(4)

        row = QHBoxLayout()
        row.addWidget(self._subtext_label("Priority (highest first):"))
        self._priority_sources_edit = QLineEdit()
        self._priority_sources_edit.setPlaceholderText("e.g. Spotify, Firefox")
        self._priority_sources_edit.setToolTip(
            "When multiple audio sources are playing simultaneously, the one "
            "whose player name matches the first entry in this comma-separated "
            "list is recorded.\n"
            "Matching is case-insensitive and partial "
            "(e.g. \"Spotify\" matches \"Spotify.exe\")."
        )
        self._priority_sources_edit.setText(", ".join(self._priority_sources))
        self._priority_sources_edit.textChanged.connect(self._on_priority_sources_changed)
        row.addWidget(self._priority_sources_edit, 1)
        col.addLayout(row)

        if not _GSMTC_AVAILABLE:
            unavail = QLabel("Requires winsdk (GSMTC unavailable)")
            unavail.setObjectName("hint")
            col.addWidget(unavail)

        return box

    def _on_priority_sources_changed(self) -> None:
        text = self._priority_sources_edit.text()
        self._priority_sources = [
            part.strip() for part in text.split(",") if part.strip()
        ]

    def _build_min_duration_section(self) -> QGroupBox:
        box = QGroupBox("Minimum Duration")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        row.addWidget(self._subtext_label("Skip if shorter than:"))

        self._min_dur_min = QSpinBox()
        self._min_dur_min.setRange(0, 59)
        self._min_dur_min.setFixedWidth(50)
        self._min_dur_min.setDisplayIntegerBase(10)
        row.addWidget(self._min_dur_min)

        sep = QLabel(":")
        sep.setFixedWidth(8)
        sep.setAlignment(Qt.AlignmentFlag.AlignCenter)
        row.addWidget(sep)

        self._min_dur_sec = QSpinBox()
        self._min_dur_sec.setRange(0, 59)
        self._min_dur_sec.setFixedWidth(50)
        row.addWidget(self._min_dur_sec)

        hint = QLabel("mm : ss")
        hint.setObjectName("hint")
        row.addWidget(hint)
        row.addStretch()
        return box

    def _build_duration_match_section(self) -> QGroupBox:
        box = QGroupBox("Duration Match")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(6)

        row1 = QHBoxLayout()
        self._dur_match_pct_chk = QCheckBox("Skip if duration deviates by more than")
        self._dur_match_pct_chk.setEnabled(_GSMTC_AVAILABLE)
        self._dur_match_pct_chk.stateChanged.connect(self._on_dur_match_pct_toggle)
        row1.addWidget(self._dur_match_pct_chk)
        self._dur_match_pct_spin = QSpinBox()
        self._dur_match_pct_spin.setRange(1, 50)
        self._dur_match_pct_spin.setValue(10)
        self._dur_match_pct_spin.setFixedWidth(55)
        self._dur_match_pct_spin.setEnabled(False)
        row1.addWidget(self._dur_match_pct_spin)
        row1.addWidget(self._subtext_label("%"))
        row1.addStretch()
        col.addLayout(row1)

        row2 = QHBoxLayout()
        self._dur_match_abs_chk = QCheckBox("Skip if duration deviates by more than")
        self._dur_match_abs_chk.setEnabled(_GSMTC_AVAILABLE)
        self._dur_match_abs_chk.stateChanged.connect(self._on_dur_match_abs_toggle)
        row2.addWidget(self._dur_match_abs_chk)
        self._dur_match_abs_spin = QSpinBox()
        self._dur_match_abs_spin.setRange(1, 3600)
        self._dur_match_abs_spin.setValue(30)
        self._dur_match_abs_spin.setFixedWidth(65)
        self._dur_match_abs_spin.setEnabled(False)
        row2.addWidget(self._dur_match_abs_spin)
        row2.addWidget(self._subtext_label("s"))
        row2.addStretch()
        col.addLayout(row2)

        if not _GSMTC_AVAILABLE:
            unavail = QLabel("Requires winsdk (GSMTC unavailable)")
            unavail.setObjectName("hint")
            col.addWidget(unavail)

        return box

    def _build_always_skip_section(self) -> QGroupBox:
        box = QGroupBox("Always Skip")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(6)

        hint = QLabel("Skip tracks whose artist, title, or album contains a pattern (case-insensitive).")
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        col.addWidget(hint)

        self._skip_list = QListWidget()
        self._skip_list.setFixedHeight(80)
        self._skip_list.setAlternatingRowColors(True)
        self._skip_list.setSelectionMode(QListWidget.SelectionMode.SingleSelection)
        col.addWidget(self._skip_list)

        add_row = QHBoxLayout()
        add_row.setSpacing(4)

        self._skip_field_combo = QComboBox()
        self._skip_field_combo.addItems(["Artist", "Title", "Album"])
        self._skip_field_combo.setFixedWidth(84)
        add_row.addWidget(self._skip_field_combo)

        self._skip_pattern_edit = QLineEdit()
        self._skip_pattern_edit.setPlaceholderText("Pattern to match…")
        self._skip_pattern_edit.returnPressed.connect(self._on_skip_pattern_add)
        add_row.addWidget(self._skip_pattern_edit, 1)

        add_btn = QPushButton("Add")
        add_btn.setIcon(_icon("btn_add.svg"))
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setMinimumWidth(68)
        add_btn.clicked.connect(self._on_skip_pattern_add)
        add_row.addWidget(add_btn)

        remove_btn = QPushButton("Remove")
        remove_btn.setIcon(_icon("btn_clear.svg"))
        remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        remove_btn.setMinimumWidth(84)
        remove_btn.clicked.connect(self._on_skip_pattern_remove)
        add_row.addWidget(remove_btn)

        col.addLayout(add_row)
        return box

    def _on_skip_pattern_add(self) -> None:
        pattern = self._skip_pattern_edit.text().strip()
        if not pattern:
            return
        field = self._skip_field_combo.currentText().lower()
        entry = {"field": field, "pattern": pattern}
        self._skip_patterns.append(entry)
        self._skip_list.addItem(QListWidgetItem(f"{field.capitalize()}: {pattern}"))
        self._skip_pattern_edit.clear()

    def _on_skip_pattern_remove(self) -> None:
        row = self._skip_list.currentRow()
        if row < 0:
            return
        self._skip_list.takeItem(row)
        del self._skip_patterns[row]

    def _build_device_section(self) -> QGroupBox:
        box = QGroupBox("Audio Device")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._device_combo = QComboBox()
        row.addWidget(self._device_combo, 1)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setIcon(_icon("btn_refresh.svg"))
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.clicked.connect(self._populate_devices)
        row.addWidget(refresh_btn)
        return box

    def _build_audio_format_section(self) -> QGroupBox:
        box = QGroupBox("Audio Format")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(6)

        row1 = QHBoxLayout()
        row1.addWidget(self._subtext_label("Sample rate:"))
        self._samplerate_combo = QComboBox()
        self._samplerate_combo.addItems([str(r) for r in SAMPLE_RATES])
        self._samplerate_combo.setCurrentText(str(DEFAULT_SAMPLERATE))
        self._samplerate_combo.setFixedWidth(92)
        row1.addWidget(self._samplerate_combo)
        row1.addSpacing(12)

        row1.addWidget(self._subtext_label("Channels:"))
        self._channels_combo = QComboBox()
        self._channels_combo.addItems([str(c) for c in CHANNEL_OPTIONS])
        self._channels_combo.setCurrentText(str(DEFAULT_CHANNELS))
        self._channels_combo.setFixedWidth(67)
        row1.addWidget(self._channels_combo)
        row1.addSpacing(12)

        row1.addWidget(self._subtext_label("Bit depth:"))
        self._bit_depth_combo = QComboBox()
        self._bit_depth_combo.addItems([bd.label for bd in BIT_DEPTHS])
        self._bit_depth_combo.setCurrentText(DEFAULT_BIT_DEPTH.label)
        self._bit_depth_combo.setFixedWidth(80)
        row1.addWidget(self._bit_depth_combo)
        row1.addStretch()
        col.addLayout(row1)

        return box

    def _build_mp3_export_section(self) -> QGroupBox:
        box = QGroupBox("MP3 Export")
        outer = QVBoxLayout(box)
        outer.setContentsMargins(8, 8, 8, 8)
        outer.setSpacing(6)

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        self._convert_mp3_chk = QCheckBox("Convert to MP3")
        self._convert_mp3_chk.stateChanged.connect(self._on_convert_mp3_toggle)
        row.addWidget(self._convert_mp3_chk)
        row.addSpacing(8)

        self._mp3_bitrate_combo = QComboBox()
        self._mp3_bitrate_combo.addItems([str(b) for b in BITRATES])
        self._mp3_bitrate_combo.setCurrentText(str(DEFAULT_BITRATE))
        self._mp3_bitrate_combo.setFixedWidth(72)
        self._mp3_bitrate_combo.setEnabled(False)
        row.addWidget(self._mp3_bitrate_combo)
        row.addWidget(self._subtext_label("kbps"))
        row.addSpacing(8)

        self._mp3_quality_combo = QComboBox()
        self._mp3_quality_combo.addItems(list(QUALITY_OPTIONS.keys()))
        self._mp3_quality_combo.setCurrentText(DEFAULT_QUALITY)
        self._mp3_quality_combo.setFixedWidth(142)
        self._mp3_quality_combo.setEnabled(False)
        row.addWidget(self._mp3_quality_combo)
        row.addStretch()
        outer.addLayout(row)

        self._normalize_lufs_chk = QCheckBox("Normalize to -14\u202fLUFS (streaming standard)")
        self._normalize_lufs_chk.setEnabled(False)
        outer.addWidget(self._normalize_lufs_chk)

        return box

    def _build_cover_art_section(self) -> QGroupBox:
        box = QGroupBox("Cover Art")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._cover_label = QLabel()
        self._cover_label.setFixedSize(COVER_THUMB_SIZE, COVER_THUMB_SIZE)
        self._cover_label.setStyleSheet(
            f"border: 1px solid {COLOR_BORDER}; background: {COLOR_BG};"
        )
        self._cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._cover_label.setText("none")
        self._cover_label.setObjectName("hint")
        row.addWidget(self._cover_label)
        row.addSpacing(8)

        self._song_cover_btn = QPushButton("Song cover")
        self._song_cover_btn.setIcon(_icon("btn_song_cover.svg"))
        self._song_cover_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._song_cover_btn.setCheckable(True)
        self._song_cover_btn.clicked.connect(self._on_song_cover_clicked)
        row.addWidget(self._song_cover_btn)

        pick_btn = QPushButton("Pick region")
        pick_btn.setIcon(_icon("btn_pick_region.svg"))
        pick_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        pick_btn.clicked.connect(self._launch_cover_picker)
        row.addWidget(pick_btn)

        self._clear_cover_btn = QPushButton("Clear")
        self._clear_cover_btn.setIcon(_icon("btn_clear.svg"))
        self._clear_cover_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._clear_cover_btn.clicked.connect(self._clear_cover_art)
        self._clear_cover_btn.setEnabled(False)
        row.addWidget(self._clear_cover_btn)
        row.addStretch()

        return box

    def _build_output_section(self) -> QGroupBox:
        box = QGroupBox("Output Folder")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(4)

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        self._output_edit = QLineEdit(os.path.expanduser("~"))
        self._output_edit.textChanged.connect(self._update_disk_space)
        row.addWidget(self._output_edit, 1)

        browse_btn = QPushButton("Browse")
        browse_btn.setIcon(_icon("btn_browse.svg"))
        browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        browse_btn.clicked.connect(self._browse_output)
        row.addWidget(browse_btn)
        col.addLayout(row)

        self._disk_space_lbl = QLabel()
        self._disk_space_lbl.setObjectName("hint")
        col.addWidget(self._disk_space_lbl)
        self._update_disk_space(self._output_edit.text())
        return box

    def _build_auto_record_section(self) -> QGroupBox:
        box = QGroupBox("Auto-Record")
        col = QVBoxLayout(box)
        col.setContentsMargins(8, 8, 8, 8)
        col.setSpacing(6)

        row1 = QHBoxLayout()
        self._auto_record_chk = QCheckBox("Auto-record tracks")
        self._auto_record_chk.setEnabled(_GSMTC_AVAILABLE)
        self._auto_record_chk.stateChanged.connect(self._on_auto_record_toggle)
        row1.addWidget(self._auto_record_chk)
        row1.addStretch()
        col.addLayout(row1)

        self._media_status_lbl = QLabel(
            "Not available (winsdk missing)" if not _GSMTC_AVAILABLE else "Idle"
        )
        self._media_status_lbl.setObjectName("subtext")
        self._media_status_lbl.setWordWrap(True)
        self._media_status_lbl.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred
        )
        col.addWidget(self._media_status_lbl)

        return box

    def _build_duplicate_section(self) -> QGroupBox:
        box = QGroupBox("Duplicate Handling")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        row.addWidget(self._subtext_label("If duplicate:"))
        self._duplicate_mode_combo = QComboBox()
        self._duplicate_mode_combo.addItems([DUPLICATE_MODE_LABELS[m] for m in DUPLICATE_MODES])
        self._duplicate_mode_combo.setCurrentText(DUPLICATE_MODE_LABELS[DEFAULT_DUPLICATE_MODE])
        self._duplicate_mode_combo.setFixedWidth(142)
        self._duplicate_mode_combo.currentIndexChanged.connect(self._on_duplicate_mode_changed)
        row.addWidget(self._duplicate_mode_combo)
        row.addStretch()
        return box

    def _build_controls_section(self) -> QWidget:
        container = QWidget()
        col = QVBoxLayout(container)
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(6)
        col.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        self._timer_label = QLabel("00:00:00")
        self._timer_label.setObjectName("timerLabel")
        self._timer_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        self._timer_label.setVisible(False)
        col.addWidget(self._timer_label)

        self._record_btn = QPushButton("Start Recording")
        self._record_btn.setObjectName("recordBtn")
        self._record_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._record_btn.setMinimumWidth(180)
        self._record_btn.setIconSize(QSize(16, 16))
        self._record_btn.clicked.connect(self._toggle_recording)
        self._set_record_btn_idle()
        col.addWidget(self._record_btn)

        self._save_progress_bar = QProgressBar()
        self._save_progress_bar.setRange(0, 100)
        self._save_progress_bar.setTextVisible(False)
        self._save_progress_bar.setFixedHeight(4)
        self._save_progress_bar.setVisible(False)
        self._sig_save_progress.connect(self._save_progress_bar.setValue)
        col.addWidget(self._save_progress_bar)
        return container

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _subtext_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("subtext")
        return lbl

    def _set_record_btn_idle(self) -> None:
        self._record_btn.setIcon(_icon("btn_record_start.svg"))
        self._record_btn.setStyleSheet(
            f"QPushButton#recordBtn {{ background-color: {COLOR_ACCENT}; color: #ffffff; border: none; border-radius: 6px; font-size: 11pt; font-weight: bold; padding: 10px 24px; }}"
            f"QPushButton#recordBtn:hover {{ background-color: {_ACCENT_HOVER}; }}"
        )

    def _set_record_btn_recording(self) -> None:
        self._record_btn.setIcon(_icon("btn_record_stop.svg"))
        self._record_btn.setStyleSheet(
            f"QPushButton#recordBtn {{ background-color: {COLOR_DANGER}; color: #ffffff; border: none; border-radius: 6px; font-size: 11pt; font-weight: bold; padding: 10px 24px; }}"
            f"QPushButton#recordBtn:hover {{ background-color: {_DANGER_HOVER}; }}"
        )

    def _set_record_btn_pending(self) -> None:
        self._record_btn.setIcon(_icon("btn_record_stop.svg"))
        self._record_btn.setStyleSheet(
            f"QPushButton#recordBtn {{ background-color: {COLOR_WARNING}; color: #ffffff; border: none; border-radius: 6px; font-size: 11pt; font-weight: bold; padding: 10px 24px; }}"
            f"QPushButton#recordBtn:hover {{ background-color: {_WARNING_HOVER}; }}"
        )

    def _log_entry(
        self, status: str, track: str, duration: float, path: str = "", tooltip: str = "",
        cover_art: bytes | None = None,
    ) -> None:
        """Append one row to the recording log table."""
        row = self._log_table.rowCount()
        self._log_table.insertRow(row)
        # Column 2 — 24×24 cover-art thumbnail (placed after Time/Status).
        thumb_lbl = QLabel()
        thumb_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        if tooltip:
            thumb_lbl.setToolTip(tooltip)
        if cover_art:
            pixmap = QPixmap()
            pixmap.loadFromData(cover_art)
            if not pixmap.isNull():
                thumb_lbl.setPixmap(
                    pixmap.scaled(24, 24, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
                )
        time_str = datetime.datetime.now().strftime("%H:%M:%S")
        dur_str = (
            f"{int(duration // 60)}:{int(duration % 60):02d}"
            if duration > 0
            else "—"
        )
        color_hex = _LOG_STATUS_COLORS.get(status, "#dde1f0")
        # Columns 0-1: Time, Status
        for col, val in enumerate((time_str, status)):
            item = QTableWidgetItem(val)
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            if col == 1:
                item.setForeground(QColor(color_hex))
            if tooltip:
                item.setToolTip(tooltip)
            self._log_table.setItem(row, col, item)
        # Column 2: thumbnail widget
        self._log_table.setCellWidget(row, 2, thumb_lbl)
        # Columns 3-4: Track, Duration
        for col, val in enumerate((track or "—", dur_str)):
            item = QTableWidgetItem(val)
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            if tooltip:
                item.setToolTip(tooltip)
            self._log_table.setItem(row, col + 3, item)
        # Store path and status on the Time item so double-click / context menu can retrieve them.
        time_item = self._log_table.item(row, 0)
        if time_item is not None:
            time_item.setData(Qt.ItemDataRole.UserRole, (path, status))
        # Apply the active search filter to the new row immediately.
        filter_text = self._log_search_edit.text().strip().lower()
        if filter_text:
            track_item = self._log_table.item(row, 3)
            match = filter_text in (track_item.text().lower() if track_item else "")
            self._log_table.setRowHidden(row, not match)
        self._log_table.scrollToBottom()

    # ------------------------------------------------------------------
    # Device management
    # ------------------------------------------------------------------

    def _populate_devices(self) -> None:
        self._devices = get_all_devices()
        self._input_devices = [d for d in self._devices if d.max_input_channels > 0]
        names = [d.name for d in self._input_devices]
        self._device_combo.clear()
        self._device_combo.addItems(names)

        cable_idx = next(
            (i for i, n in enumerate(names) if "cable output" in n.lower()), None
        )
        if cable_idx is not None:
            self._device_combo.setCurrentIndex(cable_idx)
        elif names:
            self._device_combo.setCurrentIndex(0)

        self._status("Devices refreshed.")

    def _selected_device(self) -> AudioDevice | None:
        idx = self._device_combo.currentIndex()
        if idx < 0 or idx >= len(self._input_devices):
            return None
        return self._input_devices[idx]

    # ------------------------------------------------------------------
    # Recording control
    # ------------------------------------------------------------------

    def _toggle_recording(self) -> None:
        if self._stop_requested:
            # Second click: cancel deferred stop and stop immediately.
            self._stop_requested = False
            self._stop_recording()
        elif self._recording:
            if self._auto_record_chk.isChecked():
                # Defer: wait for the current song to end or pause.
                self._stop_requested = True
                self._record_btn.setText("Stopping after song…")
                self._set_record_btn_pending()
                self._status("Waiting for current song to end…")
            else:
                self._stop_recording()
        else:
            self._current_track_display = None
            self._current_album = ""
            self._output_filename = "recording.wav"
            self._start_recording()

    def _start_recording(self) -> None:
        device = self._selected_device()
        if device is None:
            QMessageBox.critical(self, "Error", "Please select an audio device.")
            return

        output_folder = self._output_edit.text().strip()
        if not output_folder:
            QMessageBox.critical(self, "Error", "Please specify an output folder.")
            return
        output_path = os.path.join(output_folder, self._output_filename)

        selected_bit_depth: BitDepth = next(
            (bd for bd in BIT_DEPTHS if bd.label == self._bit_depth_combo.currentText()),
            DEFAULT_BIT_DEPTH,
        )
        self._recorder = Recorder(
            device=device,
            samplerate=int(self._samplerate_combo.currentText()),
            channels=int(self._channels_combo.currentText()),
            bit_depth=selected_bit_depth,
            data_callback=self._on_audio_data,
        )
        self._recorder.start()
        self._recording = True
        self._waveform.set_active(True)
        self._title_bar.set_recording(True)

        self._record_btn.setText("Stop Recording")
        self._record_btn.setEnabled(True)
        self._set_record_btn_recording()
        self._elapsed_seconds = 0
        self._timer_label.setText("00:00:00")
        self._timer_label.setVisible(True)
        self._elapsed_timer.start()
        self._track_label.setText(self._current_track_display or "\u2014")
        self._status(f"Recording from: {device.name}")

    def _stop_recording(self, *, discard: bool = False) -> None:
        if self._recorder is None or not self._recording:
            return

        self._track_label.setText("\u2014")

        output_folder = self._output_edit.text().strip()
        output_path = os.path.join(output_folder, self._output_filename)
        min_duration_s = self._min_dur_min.value() * 60 + self._min_dur_sec.value()
        reported_duration = self._current_reported_duration
        dur_match_pct_enabled = self._dur_match_pct_chk.isChecked()
        dur_match_pct = self._dur_match_pct_spin.value()
        dur_match_abs_enabled = self._dur_match_abs_chk.isChecked()
        dur_match_abs_s = self._dur_match_abs_spin.value()
        samplerate = self._recorder.samplerate
        convert_mp3 = self._convert_mp3_chk.isChecked()
        mp3_bitrate = int(self._mp3_bitrate_combo.currentText())
        mp3_quality = QUALITY_OPTIONS.get(self._mp3_quality_combo.currentText(), 5)
        normalize_lufs = self._normalize_lufs_chk.isChecked()
        track_display = self._current_track_display
        album = self._current_album
        cover_art = self._cover_art_bytes
        recorder = self._recorder

        duplicate_mode = self._duplicate_mode
        output_stem = os.path.splitext(os.path.basename(output_path))[0]

        def _save() -> None:
            try:
                audio = recorder.stop()
                if discard:
                    return  # Audio discarded — do not write to disk or emit any log signal.
                duration = len(audio) / samplerate
                if min_duration_s > 0 and duration < min_duration_s:
                    self._sig_save_skipped.emit(duration, min_duration_s, track_display or "", cover_art)
                    return
                if reported_duration is not None:
                    if dur_match_pct_enabled:
                        if _pct_deviation(duration, reported_duration) > dur_match_pct:
                            self._sig_save_skipped_dur_pct.emit(
                                duration, reported_duration, dur_match_pct, track_display or "", cover_art
                            )
                            return
                    if dur_match_abs_enabled:
                        if _abs_deviation(duration, reported_duration) > dur_match_abs_s:
                            self._sig_save_skipped_dur_abs.emit(
                                duration, reported_duration, dur_match_abs_s, track_display or "", cover_art
                            )
                            return
                if convert_mp3:
                    final_ext = ".mp3"
                    resolved_mp3 = resolve_output_path(output_folder, output_stem, final_ext, duplicate_mode)
                    if resolved_mp3 is None:
                        self._sig_save_skipped_duplicate.emit(output_stem, track_display or "", cover_art)
                        return
                    recorder.save(audio, output_path)
                    mp3_path = resolved_mp3
                    def _progress_cb(fraction: float) -> None:
                        self._sig_save_progress.emit(int(fraction * 100))
                    convert_wav_to_mp3(output_path, mp3_path, mp3_bitrate, mp3_quality, normalize_lufs, _progress_cb)
                    if track_display:
                        parts = track_display.split(" - ", 1)
                        artist = parts[0].strip() if len(parts) == 2 else ""
                        title = parts[1].strip() if len(parts) == 2 else track_display
                    else:
                        artist, title = "", ""
                    write_mp3_tags(mp3_path, artist, title, cover_art, album)
                    try:
                        os.remove(output_path)
                    except OSError:
                        pass
                    self._sig_save_complete.emit(mp3_path, duration, track_display or "", cover_art)
                else:
                    resolved_wav = resolve_output_path(output_folder, output_stem, ".wav", duplicate_mode)
                    if resolved_wav is None:
                        self._sig_save_skipped_duplicate.emit(output_stem, track_display or "", cover_art)
                        return
                    recorder.save(audio, resolved_wav)
                    self._sig_save_complete.emit(resolved_wav, duration, track_display or "", cover_art)
            except Exception as exc:  # noqa: BLE001
                self._sig_save_error.emit(str(exc), track_display or "", cover_art)
            finally:
                # Safety net: if an unexpected BaseException (e.g. SystemExit)
                # bypasses the except block, always unblock the UI.
                self._sig_ensure_btn_ready.emit()

        threading.Thread(target=_save, daemon=True).start()

        self._recording = False
        self._waveform.set_active(False)
        self._title_bar.set_recording(False)
        self._elapsed_timer.stop()
        self._record_btn.setText("Saving…")
        self._record_btn.setEnabled(False)
        if convert_mp3:
            self._save_progress_bar.setValue(0)
            self._save_progress_bar.setVisible(True)
        self._status("Saving recording…")

    def _on_audio_data(self, data: np.ndarray) -> None:
        """Called from the audio thread; compute RMS and forward to the waveform signal."""
        if np.issubdtype(data.dtype, np.integer):
            scale = float(np.iinfo(data.dtype).max)
            normalized = data.astype(np.float32) / scale
        else:
            normalized = data.astype(np.float32)
        rms = float(np.sqrt(np.mean(normalized ** 2)))
        self._waveform_level.emit(min(1.0, rms))

    def _tick_elapsed(self) -> None:
        self._elapsed_seconds += 1
        h, rem = divmod(self._elapsed_seconds, 3600)
        m, s = divmod(rem, 60)
        self._timer_label.setText(f"{h:02d}:{m:02d}:{s:02d}")

    def _ensure_btn_ready(self) -> None:
        """Re-enable the record button if no recording is active and no save is pending.

        Called as a finally-guard after every save attempt. Safe to call multiple
        times — it is a no-op while recording is in progress.
        """
        if not self._recording and not self._media_pending_start:
            if self._record_btn.text() in ("Saving\u2026", "Saving...", "Stopping after song\u2026"):
                self._record_btn.setText("Start Recording")
                self._set_record_btn_idle()
                self._record_btn.setEnabled(True)
                self._timer_label.setVisible(False)
                self._save_progress_bar.setVisible(False)

    def _on_save_complete(self, path: str, duration: float, track: str | None = None, cover_art: bytes | None = None) -> None:
        self._save_progress_bar.setVisible(False)
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        self._log_entry("Saved", track or "", duration, path=path, cover_art=cover_art)
        self._status(f"Saved {duration:.1f}s \u2192 {path}")

    def _on_save_skipped(self, duration: float, min_duration_s: int, track: str | None = None, cover_art: bytes | None = None) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        mins, secs = divmod(min_duration_s, 60)
        reason = f"Duration {duration:.1f}s is shorter than minimum {mins:02d}:{secs:02d}"
        self._log_entry("Skipped", track or "", duration, tooltip=reason, cover_art=cover_art)
        self._status(f"Skipped \u2014 {reason}")

    def _on_save_skipped_dur_pct(
        self, actual: float, reported: float, threshold_pct: int, track: str | None = None, cover_art: bytes | None = None
    ) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        reason = _dur_skip_pct_reason(actual, reported, threshold_pct)
        self._log_entry("Skipped", track or "", actual, tooltip=reason, cover_art=cover_art)
        self._status(f"Skipped \u2014 {reason}")

    def _on_save_skipped_dur_abs(
        self, actual: float, reported: float, threshold_abs_s: int, track: str | None = None, cover_art: bytes | None = None
    ) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        reason = _dur_skip_abs_reason(actual, reported, threshold_abs_s)
        self._log_entry("Skipped", track or "", actual, tooltip=reason, cover_art=cover_art)
        self._status(f"Skipped \u2014 {reason}")

    def _on_save_skipped_duplicate(self, stem: str, track: str | None = None, cover_art: bytes | None = None) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        self._log_skip_duplicate(stem, track or stem, cover_art=cover_art)

    def _log_skip_duplicate(self, stem: str, display: str, cover_art: bytes | None = None) -> None:
        """Log a duplicate-skip entry and update the status bar."""
        self._log_entry("Skipped", display, 0.0, tooltip=f"Duplicate: {stem} already exists", cover_art=cover_art)
        self._status(f"Skipped duplicate \u2014 {stem} already exists")

    def _match_skip_patterns(self, title: str, artist: str, album: str) -> bool:
        """Return True if any always-skip pattern matches the given track fields."""
        field_map = {"artist": artist, "title": title, "album": album}
        for entry in self._skip_patterns:
            field = entry.get("field", "")
            pattern = entry.get("pattern", "").lower()
            if not pattern:
                continue
            if pattern in field_map.get(field, "").lower():
                return True
        return False

    def _log_skip_pattern(self, display: str, title: str, artist: str, album: str) -> None:
        """Log an always-skip entry and update the status bar."""
        matched = []
        field_map = {"artist": artist, "title": title, "album": album}
        for entry in self._skip_patterns:
            field = entry.get("field", "")
            pattern = entry.get("pattern", "").lower()
            if not pattern:
                continue
            if pattern in field_map.get(field, "").lower():
                matched.append(f'{field.capitalize()}: "{entry["pattern"]}"')
        reason = "; ".join(matched) if matched else "always-skip rule"
        self._log_entry("Skipped", display, 0.0, tooltip=f"Always skip \u2014 {reason}")
        self._status(f"Skipped \u2014 {reason}")

    def _on_save_error(self, error: str, track: str | None = None, cover_art: bytes | None = None) -> None:
        self._save_progress_bar.setVisible(False)
        self._record_btn.setText("Start Recording")
        self._set_record_btn_idle()
        self._record_btn.setEnabled(True)
        self._log_entry("Error", track or "", 0.0, cover_art=cover_art)
        self._status(f"Error: {error}")
        QMessageBox.critical(self, "Save Error", error)

    def _on_dur_match_pct_toggle(self) -> None:
        self._dur_match_pct_spin.setEnabled(self._dur_match_pct_chk.isChecked())

    def _on_dur_match_abs_toggle(self) -> None:
        self._dur_match_abs_spin.setEnabled(self._dur_match_abs_chk.isChecked())

    def _on_convert_mp3_toggle(self) -> None:
        enabled = self._convert_mp3_chk.isChecked()
        self._mp3_bitrate_combo.setEnabled(enabled)
        self._mp3_quality_combo.setEnabled(enabled)
        self._normalize_lufs_chk.setEnabled(enabled)

    # ------------------------------------------------------------------
    # Cover art
    # ------------------------------------------------------------------

    def _launch_cover_picker(self) -> None:
        self.hide()
        QTimer.singleShot(150, self._open_region_selector)

    def _open_region_selector(self) -> None:
        self._region_selector = RegionSelector(self._on_cover_picked)

    def _on_cover_picked(self, image: Image.Image | None, bbox: tuple | None) -> None:
        self.show()
        if image is None:
            return
        # Region mode is exclusive with song-cover mode.
        self._use_song_cover = False
        self._song_cover_btn.setChecked(False)
        self._cover_region_bbox = bbox
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=90)
        self._cover_art_bytes = buf.getvalue()
        self._update_cover_thumbnail(image)
        self._clear_cover_btn.setEnabled(True)
        self._status(f"Cover art captured: {image.width}\u00d7{image.height} px")

    def _clear_cover_art(self) -> None:
        self._cover_art_bytes = None
        self._cover_region_bbox = None
        self._use_song_cover = False
        self._song_cover_btn.setChecked(False)
        self._cover_label.setPixmap(QPixmap())
        self._cover_label.setText("none")
        self._clear_cover_btn.setEnabled(False)
        self._status("Cover art cleared.")

    def _on_song_cover_clicked(self) -> None:
        """Toggle song-cover mode.  When enabled, GSMTC thumbnails are used
        automatically for every track; region capture is disabled."""
        self._use_song_cover = self._song_cover_btn.isChecked()
        if self._use_song_cover:
            # Drop any saved region so the fallback logic doesn't fire.
            self._cover_region_bbox = None
            if self._last_thumbnail_bytes:
                self._apply_gsmtc_cover(self._last_thumbnail_bytes)
                self._status("Using song cover art.")
            else:
                self._status("Song cover: will apply when next track is detected.")
        else:
            self._clear_cover_art()

    def _update_cover_thumbnail(self, image: Image.Image) -> None:
        thumb = image.convert("RGBA")
        thumb.thumbnail((COVER_THUMB_SIZE, COVER_THUMB_SIZE), Image.LANCZOS)
        data = thumb.tobytes("raw", "RGBA")
        qimg = QImage(data, thumb.width, thumb.height, QImage.Format.Format_RGBA8888)
        pixmap = QPixmap.fromImage(qimg).scaled(
            COVER_THUMB_SIZE, COVER_THUMB_SIZE,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self._cover_label.setText("")
        self._cover_label.setPixmap(pixmap)

    def _recapture_cover_art(self) -> None:
        if self._cover_region_bbox is None:
            return
        try:
            image = ImageGrab.grab(bbox=self._cover_region_bbox, all_screens=True)
        except Exception:  # noqa: BLE001
            return
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=90)
        self._cover_art_bytes = buf.getvalue()
        self._update_cover_thumbnail(image)
        self._clear_cover_btn.setEnabled(True)

    def _apply_gsmtc_cover(self, data: bytes) -> None:
        self._last_thumbnail_bytes = data
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
            buf = io.BytesIO()
            image.save(buf, format="JPEG", quality=90)
            self._cover_art_bytes = buf.getvalue()
            self._update_cover_thumbnail(image)
            self._clear_cover_btn.setEnabled(True)
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------
    # Media session watcher
    # ------------------------------------------------------------------

    def _on_auto_record_toggle(self) -> None:
        if self._auto_record_chk.isChecked():
            self._start_media_watcher()
        else:
            if self._stop_requested:
                self._stop_requested = False
                self._stop_recording()
            self._stop_media_watcher()

    def _on_duplicate_mode_changed(self) -> None:
        label = self._duplicate_mode_combo.currentText()
        self._duplicate_mode = next(
            (m for m, lbl in DUPLICATE_MODE_LABELS.items() if lbl == label),
            DEFAULT_DUPLICATE_MODE,
        )

    def _start_media_watcher(self) -> None:
        self._media_last_title = None
        self._media_watcher_stop.clear()
        self._media_watcher_thread = threading.Thread(
            target=self._media_watcher_loop, daemon=True
        )
        self._media_watcher_thread.start()
        self._status("Media session watcher started.")

    def _stop_media_watcher(self) -> None:
        self._media_pending_start = False
        self._cancel_pause_stop()
        self._media_watcher_stop.set()
        self._media_status_lbl.setText("Idle")
        self._status("Media session watcher stopped.")

    # ------------------------------------------------------------------
    # GSMTC event log helpers
    # ------------------------------------------------------------------

    def _log_event(self, timestamp: str, event_type: str, info: str) -> None:
        """Append one row to the GSMTC event log table (no-op when the log is hidden)."""
        if not self._evt_log_visible:
            return
        if self._evt_log_table.rowCount() >= _EVTLOG_MAX_ROWS:
            rows_to_remove = self._evt_log_table.rowCount() - _EVTLOG_TRIM_TO
            for _ in range(rows_to_remove):
                self._evt_log_table.removeRow(0)
        row = self._evt_log_table.rowCount()
        self._evt_log_table.insertRow(row)
        color_hex = _EVTLOG_COLORS.get(event_type, COLOR_SUBTEXT)
        for col, text in enumerate((timestamp, event_type, info)):
            item = QTableWidgetItem(text)
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            if col == 1:
                item.setForeground(QColor(color_hex))
            self._evt_log_table.setItem(row, col, item)
        self._evt_log_table.scrollToBottom()

    def _clear_event_log(self) -> None:
        self._evt_log_table.setRowCount(0)

    @staticmethod
    def _table_to_tsv(table: QTableWidget) -> str:
        """Serialize all rows of *table* to a tab-separated string with a header line."""
        cols = table.columnCount()
        headers = [table.horizontalHeaderItem(c).text() for c in range(cols)]
        lines = ["\t".join(headers)]
        for row in range(table.rowCount()):
            cells = []
            for col in range(cols):
                item = table.item(row, col)
                cells.append(item.text() if item else "")
            lines.append("\t".join(cells))
        return "\n".join(lines)

    def _on_log_row_double_clicked(self, row: int, _col: int) -> None:
        """Open the containing folder with the saved file selected (Saved rows only)."""
        time_item = self._log_table.item(row, 0)
        if time_item is None:
            return
        data = time_item.data(Qt.ItemDataRole.UserRole)
        if not data:
            return
        path, status = data
        if status != "Saved" or not path:
            return
        _explorer_select(path)

    def _on_log_context_menu(self, pos) -> None:  # noqa: ANN001
        """Show Open folder / Copy path / Copy track name context menu."""
        row = self._log_table.rowAt(pos.y())
        if row < 0:
            return
        time_item = self._log_table.item(row, 0)
        track_item = self._log_table.item(row, 3)
        data = time_item.data(Qt.ItemDataRole.UserRole) if time_item else None
        path, status = data if data else ("", "")
        track_name = track_item.text() if track_item else ""

        menu = QMenu(self)
        open_action = menu.addAction("Open folder")
        open_action.setEnabled(bool(path) and status == "Saved")
        copy_path_action = menu.addAction("Copy path")
        copy_path_action.setEnabled(bool(path))
        copy_track_action = menu.addAction("Copy track name")
        copy_track_action.setEnabled(bool(track_name) and track_name != "\u2014")

        action = menu.exec(self._log_table.viewport().mapToGlobal(pos))
        if action == open_action:
            _explorer_select(path)
        elif action == copy_path_action:
            QApplication.clipboard().setText(path)
            self._status(f"Path copied \u2192 {path}")
        elif action == copy_track_action:
            QApplication.clipboard().setText(track_name)
            self._status(f"Track name copied \u2192 {track_name}")

    def _on_log_search(self, text: str) -> None:
        """Show only rows whose Track column contains *text* (case-insensitive)."""
        needle = text.strip().lower()
        for row in range(self._log_table.rowCount()):
            if needle:
                item = self._log_table.item(row, 3)
                match = needle in (item.text().lower() if item else "")
                self._log_table.setRowHidden(row, not match)
            else:
                self._log_table.setRowHidden(row, False)

    def _export_log_csv(self) -> None:
        """Export all log rows to a user-chosen CSV file."""
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Session Log",
            os.path.join(os.path.expanduser("~"), "autotape_log.csv"),
            "CSV files (*.csv)",
        )
        if not path:
            return
        csv_headers = ("Time", "Status", "Track", "Duration")
        # Column indices that map to the CSV headers (skip the thumbnail column 2)
        col_indices = (0, 1, 3, 4)
        try:
            with open(path, "w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh)
                writer.writerow(csv_headers)
                for row in range(self._log_table.rowCount()):
                    cells = []
                    for col in col_indices:
                        item = self._log_table.item(row, col)
                        cells.append(item.text() if item else "")
                    writer.writerow(cells)
        except OSError as exc:
            QMessageBox.critical(self, "Export Failed", str(exc))
            return
        self._status(f"Log exported \u2192 {path}")

    def _copy_log(self) -> None:
        QApplication.clipboard().setText(self._table_to_tsv(self._log_table))
        self._status("Recording log copied to clipboard.")

    def _copy_event_log(self) -> None:
        QApplication.clipboard().setText(self._table_to_tsv(self._evt_log_table))
        self._status("Event log copied to clipboard.")

    def _on_evt_playback_changed(self, ts: str) -> None:
        self._log_event(ts, "playback_info_changed", "")

    def _on_evt_track_changed(self, ts: str) -> None:
        self._log_event(ts, "media_properties_changed", "")

    def _on_evt_session_changed(self, ts: str) -> None:
        self._log_event(ts, "session_changed", "")

    def _media_watcher_loop(self) -> None:
        def _ts() -> str:
            return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

        def _on_track_change() -> None:
            self._sig_evt_track_changed.emit(_ts())
            self._sig_track_changing.emit()

        def _on_playback_change() -> None:
            self._sig_evt_playback_changed.emit(_ts())

        def _on_session_change() -> None:
            self._sig_evt_session_changed.emit(_ts())

        run_gsmtc_watcher(
            emit_fn=self._media_info_ready.emit,
            stop_event=self._media_watcher_stop,
            on_track_change_fn=_on_track_change,
            get_priority_fn=lambda: self._priority_sources,
            on_playback_change_fn=_on_playback_change,
            on_session_change_fn=_on_session_change,
        )

    def _on_track_changing(self) -> None:
        """Stop the current recording immediately for a clean cut.

        The new recording is started by _media_poll once the incoming track title
        is confirmed by a coalesced GSMTC query.  This avoids capturing audio
        before Spotify actually switches its output, which can lag the first
        media_properties_changed event by up to ~1 s on playlist-click changes.
        """
        if not self._auto_record_chk.isChecked():
            return
        if self._recording:
            self._stop_recording()

    def _media_start_recording(self) -> None:
        self._media_pending_start = False
        self._start_recording()

    # Amount of time (ms) a pause must persist before we stop the recording.
    # This prevents brief buffering/transition gaps during track changes from
    # cutting the recording short.
    _PAUSE_DEBOUNCE_MS = 2500

    def _schedule_pause_stop(self) -> None:
        self._cancel_pause_stop()
        self._media_pause_timer = QTimer(self)
        self._media_pause_timer.setSingleShot(True)
        self._media_pause_timer.timeout.connect(self._on_pause_timeout)
        self._media_pause_timer.start(self._PAUSE_DEBOUNCE_MS)

    def _cancel_pause_stop(self) -> None:
        if self._media_pause_timer is not None:
            self._media_pause_timer.stop()
            self._media_pause_timer = None

    def _on_pause_timeout(self) -> None:
        self._media_pause_timer = None
        if self._recording:
            self._stop_recording()

    def _media_poll(self, info: dict | None) -> None:
        # Log the coalesced poll result only when the track/state changes so the
        # event log shows transitions rather than a constant stream of identical rows.
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        if info is None:
            _poll_key = "__none__"
            _poll_label = "—"
        elif info.get("is_playing"):
            _t = info.get("title", "").strip()
            _a = info.get("artist", "").strip()
            _poll_key = f"playing|{_a}|{_t}"
            _poll_label = f"{_a} - {_t}" if _a else _t or "playing"
        else:
            _poll_key = "__paused__"
            _poll_label = "paused"
        if _poll_key != getattr(self, "_evt_last_poll_key", None):
            self._evt_last_poll_key = _poll_key
            self._log_event(ts, "poll_result", _poll_label)

        if not self._auto_record_chk.isChecked():
            return

        if info is None:
            self._media_status_lbl.setText("Player: not running")
            self._cancel_pause_stop()
            if self._recording:
                self._stop_recording()
            self._media_last_title = None
            self._track_label.setText("\u2014")
            return

        is_idle = not info["is_playing"]
        if is_idle:
            display = "Paused"
            track_key = "__paused__"
        else:
            title = info["title"].strip()
            artist = info["artist"].strip()
            if not title:
                # GSMTC fired before metadata was ready — skip this transient state.
                return
            display = f"{artist} - {title}" if artist else title
            track_key = f"{title}|{artist}"

        source_app = info.get("source_app", "")
        source_label = _format_source_app(source_app)
        status_suffix = f" [{source_label}]" if source_label else ""
        self._media_status_lbl.setText(f"Playing: {display}{status_suffix}")

        if track_key == self._media_last_title:
            return

        self._media_last_title = track_key

        if is_idle:
            # Don't stop recording immediately — the player briefly reports
            # a paused/buffering state between tracks.  Only stop after the
            # pause has persisted for _PAUSE_DEBOUNCE_MS.
            if self._recording:
                self._schedule_pause_stop()
            self._track_label.setText("\u2014")
            return

        # New track is playing — cancel any pending pause-stop and switch.
        self._cancel_pause_stop()

        if self._recording:
            self._stop_recording()

        if self._stop_requested:
            self._stop_requested = False
            return

        album_title = info.get("album_title", "")
        if self._match_skip_patterns(title, artist, album_title):
            self._log_skip_pattern(display, title, artist, album_title)
            return

        safe_name = _sanitize_filename(display)
        output_folder = self._output_edit.text().strip()
        convert_mp3 = self._convert_mp3_chk.isChecked()
        final_ext = ".mp3" if convert_mp3 else ".wav"
        resolved = resolve_output_path(output_folder, safe_name, final_ext, self._duplicate_mode)
        if resolved is None:
            self._track_label.setText(display)
            self._log_skip_duplicate(safe_name, display)
            return
        if convert_mp3:
            # Always record as WAV first; the .mp3 path was validated above.
            self._output_filename = f"{safe_name}.wav"
        else:
            # Use the resolved stem (may have " (N)" suffix) directly.
            self._output_filename = os.path.basename(resolved)
        self._current_track_display = display
        self._current_album = info.get("album_title", "")
        self._current_reported_duration = info.get("duration_seconds")
        if info.get("thumbnail_bytes"):
            self._apply_gsmtc_cover(info["thumbnail_bytes"])
        elif self._use_song_cover:
            # No thumbnail for this track yet — clear stale art from the
            # previous track so it isn't attributed to this one.  If the
            # media session later sends a thumbnail for this track,
            # _apply_gsmtc_cover will populate it then.
            self._cover_art_bytes = None
            self._cover_label.setPixmap(QPixmap())
            self._cover_label.setText("none")
        elif self._cover_region_bbox is not None:
            QTimer.singleShot(800, self._recapture_cover_art)
        self._media_pending_start = True
        self._media_start_recording()

    # ------------------------------------------------------------------
    # File picker
    # ------------------------------------------------------------------

    def _update_disk_space(self, path: str = "") -> None:
        """Update the disk-space label next to the output folder field."""
        folder = (path or self._output_edit.text()).strip()
        # Walk up to the nearest existing ancestor so the label remains
        # useful while the user is typing a new path.
        probe = folder
        while probe and not os.path.exists(probe):
            parent = os.path.dirname(probe)
            if parent == probe:
                probe = ""
                break
            probe = parent
        if not probe:
            self._disk_space_lbl.setText("")
            return
        try:
            free = shutil.disk_usage(probe).free
        except OSError:
            self._disk_space_lbl.setText("")
            return
        if free >= 1024 ** 3:
            text = f"\u2193 {free / 1024 ** 3:.0f} GB free"
            color = COLOR_SUBTEXT
        elif free >= 1024 ** 2:
            text = f"\u2193 {free / 1024 ** 2:.0f} MB free"
            color = COLOR_DANGER
        else:
            text = "\u2193 < 1 MB free"
            color = COLOR_DANGER
        if free < DISK_SPACE_LOW_BYTES:
            color = COLOR_DANGER
        self._disk_space_lbl.setText(text)
        self._disk_space_lbl.setStyleSheet(f"color: {color};")

    def _browse_output(self) -> None:
        folder = QFileDialog.getExistingDirectory(
            self,
            "Select Output Folder",
            self._output_edit.text() or os.path.expanduser("~"),
        )
        if folder:
            self._output_edit.setText(folder)

    # ------------------------------------------------------------------
    # Status bar
    # ------------------------------------------------------------------

    def _status(self, message: str) -> None:
        self._status_label.setText(message)

    # ------------------------------------------------------------------
    # Window lifecycle
    # ------------------------------------------------------------------

    def closeEvent(self, event) -> None:
        self._save_config()
        self._stop_media_watcher()
        if self._recording and self._recorder:
            try:
                self._recorder.stop()
            except RuntimeError:
                pass
        super().closeEvent(event)

    # ------------------------------------------------------------------
    # Config persistence
    # ------------------------------------------------------------------

    def _save_config(self) -> None:
        data = {
            "device_name": self._device_combo.currentText(),
            "samplerate": int(self._samplerate_combo.currentText()),
            "channels": int(self._channels_combo.currentText()),
            "bit_depth": self._bit_depth_combo.currentText(),
            "min_dur_min": self._min_dur_min.value(),
            "min_dur_sec": self._min_dur_sec.value(),
            "convert_mp3": self._convert_mp3_chk.isChecked(),
            "mp3_bitrate": int(self._mp3_bitrate_combo.currentText()),
            "mp3_quality": self._mp3_quality_combo.currentText(),
            "normalize_lufs": self._normalize_lufs_chk.isChecked(),
            "output_folder": self._output_edit.text(),
            "auto_record": self._auto_record_chk.isChecked(),
            "duplicate_mode": self._duplicate_mode,
            "cover_region_bbox": list(self._cover_region_bbox) if self._cover_region_bbox else None,
            "use_song_cover": self._use_song_cover,
            "dur_match_pct_enabled": self._dur_match_pct_chk.isChecked(),
            "dur_match_pct": self._dur_match_pct_spin.value(),
            "dur_match_abs_enabled": self._dur_match_abs_chk.isChecked(),
            "dur_match_abs_s": self._dur_match_abs_spin.value(),
            "priority_sources": self._priority_sources,
            "skip_patterns": self._skip_patterns,
        }
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
        except OSError:
            pass

    def _load_config(self) -> None:
        try:
            with open(CONFIG_PATH, encoding="utf-8") as fh:
                data: dict = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return

        def _get(key, default=None):
            return data.get(key, default)

        saved_device = _get("device_name", "")
        if saved_device:
            idx = self._device_combo.findText(saved_device)
            if idx >= 0:
                self._device_combo.setCurrentIndex(idx)

        if (v := _get("samplerate")) is not None:
            self._samplerate_combo.setCurrentText(str(int(v)))
        if (v := _get("channels")) is not None:
            self._channels_combo.setCurrentText(str(int(v)))
        if (v := _get("bit_depth")) is not None:
            self._bit_depth_combo.setCurrentText(str(v))
        if (v := _get("min_dur_min")) is not None:
            self._min_dur_min.setValue(int(v))
        if (v := _get("min_dur_sec")) is not None:
            self._min_dur_sec.setValue(int(v))
        if (v := _get("convert_mp3")) is not None:
            self._convert_mp3_chk.setChecked(bool(v))
            self._on_convert_mp3_toggle()
        if (v := _get("mp3_bitrate")) is not None:
            self._mp3_bitrate_combo.setCurrentText(str(int(v)))
        if (v := _get("mp3_quality")) is not None:
            self._mp3_quality_combo.setCurrentText(str(v))
        if (v := _get("normalize_lufs")) is not None:
            self._normalize_lufs_chk.setChecked(bool(v))
        if (v := _get("output_folder")) is not None:
            self._output_edit.setText(str(v))
        elif (v := _get("output_path")) is not None:
            # Backward compat: old config stored full file path — extract the folder.
            self._output_edit.setText(os.path.dirname(str(v)) or str(v))
        if (v := _get("auto_record", _get("spotify_auto"))) is not None:
            self._auto_record_chk.setChecked(bool(v))
            if bool(v):
                self._start_media_watcher()
        if (v := _get("cover_region_bbox")) is not None:
            try:
                bbox = tuple(int(x) for x in v)
                if len(bbox) == 4:
                    self._cover_region_bbox = bbox  # type: ignore[assignment]
                    QTimer.singleShot(200, self._recapture_cover_art)
            except (TypeError, ValueError):
                pass
        if (v := _get("duplicate_mode")) is not None and v in DUPLICATE_MODES:
            self._duplicate_mode = v
            self._duplicate_mode_combo.setCurrentText(DUPLICATE_MODE_LABELS[v])
        if _get("use_song_cover"):
            self._use_song_cover = True
            self._song_cover_btn.setChecked(True)
        if (v := _get("dur_match_pct_enabled")) is not None:
            self._dur_match_pct_chk.setChecked(bool(v))
            self._on_dur_match_pct_toggle()
        if (v := _get("dur_match_pct")) is not None:
            self._dur_match_pct_spin.setValue(int(v))
        if (v := _get("dur_match_abs_enabled")) is not None:
            self._dur_match_abs_chk.setChecked(bool(v))
            self._on_dur_match_abs_toggle()
        if (v := _get("dur_match_abs_s")) is not None:
            self._dur_match_abs_spin.setValue(int(v))
        if (v := _get("priority_sources")) is not None and isinstance(v, list):
            self._priority_sources = [str(s) for s in v if str(s).strip()]
            self._priority_sources_edit.setText(", ".join(self._priority_sources))
        if (v := _get("skip_patterns")) is not None and isinstance(v, list):
            self._skip_patterns = [
                e for e in v
                if isinstance(e, dict) and e.get("field") in ("artist", "title", "album") and e.get("pattern")
            ]
            self._skip_list.clear()
            for entry in self._skip_patterns:
                label = f'{entry["field"].capitalize()}: {entry["pattern"]}'
                self._skip_list.addItem(QListWidgetItem(label))
        if _get("evt_log_visible"):
            self._evt_log_visible = True
            self._evt_log_header.setVisible(True)
            self._evt_log_table.setVisible(True)
        self._update_disk_space(self._output_edit.text())
