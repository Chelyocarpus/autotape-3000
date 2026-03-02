"""Main recorder application window - PyQt6 UI."""

import io
import json
import os
import threading

import numpy as np

from PIL import Image, ImageGrab
from PyQt6.QtCore import QSize, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QIcon, QPixmap, QImage
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QSpinBox,
    QStatusBar,
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
from gui.region_selector import RegionSelector
from gui.titlebar import TitleBar
from gui.waveform import WaveformWidget
from gui.theme import (
    COLOR_ACCENT,
    COLOR_BG,
    COLOR_BORDER,
    COLOR_DANGER,
    COLOR_SUBTEXT,
    _ACCENT_HOVER,
    _DANGER_HOVER,
)
from services.media_session import (
    _GSMTC_AVAILABLE,
    run_gsmtc_watcher,
)
from utils.filename import COVER_THUMB_SIZE, _sanitize_filename

SAMPLE_RATES = [22050, 44100, 48000, 96000]
CHANNEL_OPTIONS = [1, 2]

WINDOW_TITLE = "Autotape 3000"
WINDOW_WIDTH = 520
WINDOW_HEIGHT = 750   # expanded for split sections

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "settings.json")


class RecorderApp(QMainWindow):
    """PyQt6 main window for audio recording."""

    _media_info_ready = pyqtSignal(object)
    _waveform_level = pyqtSignal(float)

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

        self._media_last_title: str | None = None
        self._media_watcher_stop = threading.Event()
        self._media_watcher_thread: threading.Thread | None = None
        self._media_pending_start = False
        self._media_pause_timer: QTimer | None = None

        self._elapsed_seconds: int = 0
        self._elapsed_timer = QTimer(self)
        self._elapsed_timer.setInterval(1000)
        self._elapsed_timer.timeout.connect(self._tick_elapsed)

        self._media_info_ready.connect(self._media_poll)

        self._waveform = WaveformWidget()
        self._waveform_level.connect(self._waveform.push_level)

        self._setup_window()
        self._build_ui()
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

        outer.addWidget(TitleBar(self))

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(10)

        layout.addWidget(self._build_device_section())
        layout.addWidget(self._build_output_section())
        layout.addWidget(self._build_audio_format_section())
        layout.addWidget(self._build_mp3_export_section())
        layout.addWidget(self._build_cover_art_section())
        layout.addWidget(self._build_auto_record_section())
        layout.addStretch()
        layout.addWidget(self._waveform)
        layout.addSpacing(8)
        layout.addWidget(self._build_controls_section(), alignment=Qt.AlignmentFlag.AlignHCenter)
        layout.addStretch()
        outer.addWidget(content, 1)

        status_bar = QStatusBar()
        self._status_label = QLabel("Ready")
        self._status_label.setObjectName("statusBar")
        status_bar.addWidget(self._status_label, 1)
        status_bar.setSizeGripEnabled(False)
        self.setStatusBar(status_bar)

    def _build_device_section(self) -> QGroupBox:
        box = QGroupBox("Audio Device")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._device_combo = QComboBox()
        row.addWidget(self._device_combo, 1)

        refresh_btn = QPushButton("Refresh")
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
        self._samplerate_combo.setFixedWidth(80)
        row1.addWidget(self._samplerate_combo)
        row1.addSpacing(12)

        row1.addWidget(self._subtext_label("Channels:"))
        self._channels_combo = QComboBox()
        self._channels_combo.addItems([str(c) for c in CHANNEL_OPTIONS])
        self._channels_combo.setCurrentText(str(DEFAULT_CHANNELS))
        self._channels_combo.setFixedWidth(55)
        row1.addWidget(self._channels_combo)
        row1.addSpacing(12)

        row1.addWidget(self._subtext_label("Bit depth:"))
        self._bit_depth_combo = QComboBox()
        self._bit_depth_combo.addItems([bd.label for bd in BIT_DEPTHS])
        self._bit_depth_combo.setCurrentText(DEFAULT_BIT_DEPTH.label)
        self._bit_depth_combo.setFixedWidth(105)
        row1.addWidget(self._bit_depth_combo)
        row1.addStretch()
        col.addLayout(row1)

        row2 = QHBoxLayout()
        row2.addWidget(self._subtext_label("Min. duration:"))

        self._min_dur_min = QSpinBox()
        self._min_dur_min.setRange(0, 59)
        self._min_dur_min.setFixedWidth(50)
        self._min_dur_min.setDisplayIntegerBase(10)
        row2.addWidget(self._min_dur_min)

        sep = QLabel(":")
        sep.setFixedWidth(8)
        sep.setAlignment(Qt.AlignmentFlag.AlignCenter)
        row2.addWidget(sep)

        self._min_dur_sec = QSpinBox()
        self._min_dur_sec.setRange(0, 59)
        self._min_dur_sec.setFixedWidth(50)
        row2.addWidget(self._min_dur_sec)

        hint = QLabel("(mm : ss \u2014 skip recordings shorter than this)")
        hint.setObjectName("hint")
        row2.addWidget(hint)
        row2.addStretch()
        col.addLayout(row2)

        return box

    def _build_mp3_export_section(self) -> QGroupBox:
        box = QGroupBox("MP3 Export")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._convert_mp3_chk = QCheckBox("Convert to MP3")
        self._convert_mp3_chk.stateChanged.connect(self._on_convert_mp3_toggle)
        row.addWidget(self._convert_mp3_chk)
        row.addSpacing(8)

        self._mp3_bitrate_combo = QComboBox()
        self._mp3_bitrate_combo.addItems([str(b) for b in BITRATES])
        self._mp3_bitrate_combo.setCurrentText(str(DEFAULT_BITRATE))
        self._mp3_bitrate_combo.setFixedWidth(60)
        self._mp3_bitrate_combo.setEnabled(False)
        row.addWidget(self._mp3_bitrate_combo)
        row.addWidget(self._subtext_label("kbps"))
        row.addSpacing(8)

        self._mp3_quality_combo = QComboBox()
        self._mp3_quality_combo.addItems(list(QUALITY_OPTIONS.keys()))
        self._mp3_quality_combo.setCurrentText(DEFAULT_QUALITY)
        self._mp3_quality_combo.setFixedWidth(130)
        self._mp3_quality_combo.setEnabled(False)
        row.addWidget(self._mp3_quality_combo)
        row.addStretch()

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
        self._song_cover_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._song_cover_btn.setCheckable(True)
        self._song_cover_btn.clicked.connect(self._on_song_cover_clicked)
        row.addWidget(self._song_cover_btn)

        pick_btn = QPushButton("Pick region")
        pick_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        pick_btn.clicked.connect(self._launch_cover_picker)
        row.addWidget(pick_btn)

        self._clear_cover_btn = QPushButton("Clear")
        self._clear_cover_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._clear_cover_btn.clicked.connect(self._clear_cover_art)
        self._clear_cover_btn.setEnabled(False)
        row.addWidget(self._clear_cover_btn)
        row.addStretch()

        return box

    def _build_output_section(self) -> QGroupBox:
        box = QGroupBox("Output Folder")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._output_edit = QLineEdit(os.path.expanduser("~"))
        row.addWidget(self._output_edit, 1)

        browse_btn = QPushButton("Browse")
        browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        browse_btn.clicked.connect(self._browse_output)
        row.addWidget(browse_btn)
        return box

    def _build_auto_record_section(self) -> QGroupBox:
        box = QGroupBox("Auto-Record")
        row = QHBoxLayout(box)
        row.setContentsMargins(8, 8, 8, 8)

        self._auto_record_chk = QCheckBox("Auto-record tracks")
        self._auto_record_chk.setEnabled(_GSMTC_AVAILABLE)
        self._auto_record_chk.stateChanged.connect(self._on_auto_record_toggle)
        row.addWidget(self._auto_record_chk)

        self._media_status_lbl = QLabel(
            "Not available (winsdk missing)" if not _GSMTC_AVAILABLE else "Idle"
        )
        self._media_status_lbl.setObjectName("subtext")
        row.addWidget(self._media_status_lbl)
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
        self._record_btn.clicked.connect(self._toggle_recording)
        self._set_record_btn_idle()
        col.addWidget(self._record_btn)
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
        self._record_btn.setStyleSheet(
            f"QPushButton#recordBtn {{ background-color: {COLOR_ACCENT}; color: #ffffff; border: none; border-radius: 6px; font-size: 11pt; font-weight: bold; padding: 10px 24px; }}"
            f"QPushButton#recordBtn:hover {{ background-color: {_ACCENT_HOVER}; }}"
        )

    def _set_record_btn_recording(self) -> None:
        self._record_btn.setStyleSheet(
            f"QPushButton#recordBtn {{ background-color: {COLOR_DANGER}; color: #ffffff; border: none; border-radius: 6px; font-size: 11pt; font-weight: bold; padding: 10px 24px; }}"
            f"QPushButton#recordBtn:hover {{ background-color: {_DANGER_HOVER}; }}"
        )

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
        if self._recording:
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

        self._record_btn.setText("Stop Recording")
        self._record_btn.setEnabled(True)
        self._set_record_btn_recording()
        self._elapsed_seconds = 0
        self._timer_label.setText("00:00:00")
        self._timer_label.setVisible(True)
        self._elapsed_timer.start()
        self._status(f"Recording from: {device.name}")

    def _stop_recording(self) -> None:
        if self._recorder is None or not self._recording:
            return

        output_folder = self._output_edit.text().strip()
        output_path = os.path.join(output_folder, self._output_filename)
        min_duration_s = self._min_dur_min.value() * 60 + self._min_dur_sec.value()
        samplerate = self._recorder.samplerate
        convert_mp3 = self._convert_mp3_chk.isChecked()
        mp3_bitrate = int(self._mp3_bitrate_combo.currentText())
        mp3_quality = QUALITY_OPTIONS.get(self._mp3_quality_combo.currentText(), 5)
        track_display = self._current_track_display
        album = self._current_album
        cover_art = self._cover_art_bytes
        recorder = self._recorder

        def _save() -> None:
            try:
                audio = recorder.stop()
                duration = len(audio) / samplerate
                if min_duration_s > 0 and duration < min_duration_s:
                    QTimer.singleShot(0, lambda: self._on_save_skipped(duration, min_duration_s))
                    return
                recorder.save(audio, output_path)
                if convert_mp3:
                    mp3_path = os.path.splitext(output_path)[0] + ".mp3"
                    convert_wav_to_mp3(output_path, mp3_path, mp3_bitrate, mp3_quality)
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
                    QTimer.singleShot(0, lambda: self._on_save_complete(mp3_path, duration))
                else:
                    QTimer.singleShot(0, lambda: self._on_save_complete(output_path, duration))
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
                QTimer.singleShot(0, lambda: self._on_save_error(err))
            finally:
                # Safety net: if an unexpected BaseException (e.g. SystemExit)
                # bypasses the except block, always unblock the UI.
                QTimer.singleShot(0, self._ensure_btn_ready)

        threading.Thread(target=_save, daemon=True).start()

        self._recording = False
        self._waveform.set_active(False)
        self._elapsed_timer.stop()
        self._record_btn.setText("Saving…")
        self._record_btn.setEnabled(False)
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
            if self._record_btn.text() in ("Saving\u2026", "Saving..."):
                self._record_btn.setText("Start Recording")
                self._set_record_btn_idle()
                self._record_btn.setEnabled(True)
                self._timer_label.setVisible(False)

    def _on_save_complete(self, path: str, duration: float) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        self._status(f"Saved {duration:.1f}s \u2192 {path}")

    def _on_save_skipped(self, duration: float, min_duration_s: int) -> None:
        if not self._recording and not self._media_pending_start:
            self._record_btn.setText("Start Recording")
            self._set_record_btn_idle()
            self._record_btn.setEnabled(True)
        mins, secs = divmod(min_duration_s, 60)
        self._status(f"Skipped \u2014 {duration:.1f}s is shorter than minimum {mins:02d}:{secs:02d}")

    def _on_save_error(self, error: str) -> None:
        self._record_btn.setText("Start Recording")
        self._set_record_btn_idle()
        self._record_btn.setEnabled(True)
        self._status(f"Error: {error}")
        QMessageBox.critical(self, "Save Error", error)

    def _on_convert_mp3_toggle(self) -> None:
        enabled = self._convert_mp3_chk.isChecked()
        self._mp3_bitrate_combo.setEnabled(enabled)
        self._mp3_quality_combo.setEnabled(enabled)

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
            self._stop_media_watcher()

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

    def _media_watcher_loop(self) -> None:
        run_gsmtc_watcher(
            emit_fn=self._media_info_ready.emit,
            stop_event=self._media_watcher_stop,
        )

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
        if not self._auto_record_chk.isChecked():
            return

        if info is None:
            self._media_status_lbl.setText("Player: not running")
            self._cancel_pause_stop()
            if self._recording:
                self._stop_recording()
            self._media_last_title = None
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

        self._media_status_lbl.setText(f"Playing: {display}")

        if track_key == self._media_last_title:
            return

        self._media_last_title = track_key

        if is_idle:
            # Don't stop recording immediately — the player briefly reports
            # a paused/buffering state between tracks.  Only stop after the
            # pause has persisted for _PAUSE_DEBOUNCE_MS.
            if self._recording:
                self._schedule_pause_stop()
            return

        # New track is playing — cancel any pending pause-stop and switch.
        self._cancel_pause_stop()

        if self._recording:
            self._stop_recording()

        safe_name = _sanitize_filename(display)
        self._output_filename = f"{safe_name}.wav"
        self._current_track_display = display
        self._current_album = info.get("album_title", "")
        if info.get("thumbnail_bytes"):
            self._apply_gsmtc_cover(info["thumbnail_bytes"])
        elif self._use_song_cover:
            # Song-cover mode but no thumbnail yet — leave cover_art_bytes as-is;
            # the next track event that includes a thumbnail will fill it in.
            pass
        elif self._cover_region_bbox is not None:
            QTimer.singleShot(800, self._recapture_cover_art)
        self._media_pending_start = True
        self._media_start_recording()

    # ------------------------------------------------------------------
    # File picker
    # ------------------------------------------------------------------

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
            "output_folder": self._output_edit.text(),
            "auto_record": self._auto_record_chk.isChecked(),
            "cover_region_bbox": list(self._cover_region_bbox) if self._cover_region_bbox else None,
            "use_song_cover": self._use_song_cover,
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
        if _get("use_song_cover"):
            self._use_song_cover = True
            self._song_cover_btn.setChecked(True)


SAMPLE_RATES = [22050, 44100, 48000, 96000]
CHANNEL_OPTIONS = [1, 2]
