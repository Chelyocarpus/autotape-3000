# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-03-08

### Added
- **Log tab: double-click to reveal in Explorer** — double-clicking a "Saved" row opens the containing folder with the file selected (`explorer /select,"path"`). Only active for "Saved" rows; double-clicking "Skipped" or "Error" rows is a no-op.
- **Log tab: right-click context menu** — right-clicking any log row shows a context menu with three actions: **Open folder** (enabled only for "Saved" rows with an existing path), **Copy path** (copies the full file path to the clipboard), and **Copy track name** (copies the track name to the clipboard). Unavailable actions are shown disabled rather than hidden.
- **Log tab: track search** — a search field above the recording log filters visible rows in real-time as the user types (case-insensitive substring match on the Track column). Rows that do not match are hidden instantly; clearing the field restores all rows. Newly added log entries are also hidden immediately if they do not match an active filter.
- **Log tab: Export CSV** — an "Export CSV" button next to the search field dumps the full session log (Time, Status, Track, Duration columns) to a user-chosen `.csv` file via a save dialog. Both controls sit in a compact 24 px toolbar that takes space from the log table rather than the window height.
- **Disk space indicator** in the Output Folder section (Record tab): a label below the folder path displays available free space (e.g. `↓ 234 GB free`) using `shutil.disk_usage`. The label turns red when free space is below 1 GB. It updates live as the user types a path, walking up to the nearest existing ancestor directory so it stays informative while a new path is being entered. The label also refreshes on startup after the saved folder is restored from `settings.json`.
- **Always Skip list** in the Automation tab. Users can define patterns (by Artist, Title, or Album) that cause matching tracks to be automatically skipped when auto-record is active. Each rule performs a case-insensitive substring match. Patterns are added via a combo box (Artist / Title / Album), a text field, and an "Add" button (or pressing Enter); selected entries are removed with the "Remove" button. The list is persisted in `settings.json` under `skip_patterns`. Skipped tracks are logged as "Skipped" in the Log tab with the matched rule shown as a tooltip, and the status bar identifies the matching pattern.

### Fixed
- **Context menu styling** — added `QMenu` rules to the app stylesheet so the right-click context menu uses the app's dark indigo theme (surface background, accent-colour hover highlight, muted disabled items, themed separator) instead of the Windows system default.
- **MP3 conversion progress** — a slim 4 px `QProgressBar` below the record button now shows accurate 0→100 % progress during MP3 encoding. The `lameenc` encode loop is chunked (≈1 % of total frames per step) so the main thread receives progress signals throughout the conversion. The bar appears only when saving as MP3 and disappears automatically on completion, error, or skip.

## [1.8.0] - 2026-03-08

### Added
- **Compact view** button (⊟/⊞) in the title bar. Clicking it collapses the window to just the song title and waveform strip (tabs and record controls hidden) at a reduced window height, then restores the full layout on a second click. The button glyph and tooltip update to reflect the current state.

## [1.7.0] - 2026-03-08

### Added
- **Normalize to -14 LUFS** checkbox in the MP3 Export section. When enabled, an RMS-based gain scalar targeting the -14 LUFS streaming standard (EBU R128 / AES streaming) is applied to the audio before int16 quantisation and lameenc encoding. The gain is clamped such that the output never clips. The setting is persisted in `settings.json` under `normalize_lufs` and is only enabled when "Convert to MP3" is checked. (`LUFS_TARGET` constant and `_peak_normalization_gain` helper added to `core/converter.py`.)

## [1.6.0] - 2026-03-08

### Added
- **Cover-art thumbnail column** in the recording Log tab: each log row now opens with a 24×24 px thumbnail showing the cover art that was embedded in the saved (or skipped) file. The image is decoded from the captured bytes at log time, so the thumbnail remains correct even if the artwork changes for a subsequent track. Rows without cover art display an empty cell. Row height is fixed at 28 px to accommodate the thumbnail cleanly.

## [1.5.0] - 2026-03-08

### Added
- **Animated cassette icon** (`gui/cassette.py`): when recording is active the static title-bar icon is replaced by a tiny (~20 × 14 px) Tron-style cassette tape. Two SVG-drawn reels with three spokes each rotate continuously; rotation speed scales proportionally with the live audio RMS level so the reels visibly speed up during loud passages and coast to a near-stop during silence. The static icon is restored automatically when recording stops.

## [1.4.0] - 2026-03-08

### Added
- **GSMTC Event Log** (Log tab): a live event timeline table below the recording log shows every raw GSMTC event as it fires — `playback_info_changed` (blue), `media_properties_changed` (orange), `session_changed` (purple), and post-coalesce `poll_result` (green) with millisecond timestamps (`HH:MM:SS.mmm`). This makes it easy to see exactly how different track-change methods (Next key, media button, or clicking a song in a playlist) produce different event sequences and to diagnose the ≈1 s bleed caused by `media_properties_changed` firing before Spotify’s audio output switches.
- `on_playback_change_fn` parameter added to `run_gsmtc_watcher` and `_gsmtc_event_watcher`; the callable is invoked synchronously whenever `playback_info_changed` fires on any subscribed session.
- `on_session_change_fn` parameter added to `run_gsmtc_watcher` and `_gsmtc_event_watcher`; the callable is invoked whenever `current_session_changed` fires on the session manager.
- A **Clear** button in the event log header discards all accumulated rows.
- Oldest rows are automatically pruned (kept at 400, trimmed when 500 is reached) to keep the table responsive during long sessions.

## [1.3.0] - 2026-03-06

### Added
- **Source Priority** (Automation tab): a new "Source Priority" group box lets users specify a comma-separated, ordered list of player names (e.g. `Spotify, Firefox`). When two or more audio sources are playing simultaneously, the session whose AUMID contains the first matching entry is chosen for recording, resolving UI confusion and incorrect track titles caused by player-agnostic session selection. The priority list is persisted in `settings.json` under `priority_sources`.
- `_pick_by_priority` helper in `services/media_session.py` selects the highest-priority playing GSMTC session using case-insensitive AUMID substring matching.
- `source_app` field added to the media-session info dictionary returned by `_gsmtc_get_media_info`; the value is the raw `source_app_user_model_id` of the selected session. The Automation-tab status label now shows the active player name alongside the current track (e.g. `Playing: Artist - Title [Spotify]`).
- `get_priority_fn` parameter added to `run_gsmtc_watcher` and `_gsmtc_event_watcher`; the callable is invoked on every poll/event so priority changes take effect immediately without restarting the watcher.

## [1.2.0] - 2026-03-06

### Added
- **Duration Match – percentage filter** (Automation tab): a new "Duration Match" group box lets users enable a filter that skips recordings whose length deviates from the GSMTC-reported song duration by more than a configurable percentage (1–50%, default 10%). The filter is automatically disabled when GSMTC is unavailable (winsdk missing).
- **Duration Match – absolute seconds filter** (Automation tab): a second independent filter skips recordings that differ from the reported duration by more than a configurable number of seconds (1–3600, default 30). Both filters can be toggled on/off independently and their spin-box values are persisted in `settings.json`.
- `duration_seconds` field added to the media-session info dictionary returned by `_gsmtc_get_media_info`; the value is derived from `GlobalSystemMediaTransportControlsSessionTimelineProperties.end_time − start_time` and is `None` when the session does not expose timeline data.
- Two new cross-thread signals (`_sig_save_skipped_dur_pct`, `_sig_save_skipped_dur_abs`) marshal duration-mismatch skip events from the save thread to the main thread, producing Log-tab entries with status "Skipped" and descriptive status-bar messages that show actual vs. reported duration and the active threshold.

## [1.1.0] - 2026-03-05

### Added
- SVG icons on all four tab labels (Log, Record, Export, Automation) and all action buttons (Refresh, Browse, Song cover, Pick region, Clear, Start/Stop Recording). A new `gui/icons.py` helper module provides the `make()` factory used throughout the UI.

## [1.0.9] - 2026-03-03

### Fixed
- `run.bat`: missing `requirements.txt` was silently ignored. If the file was absent, `certutil -hashfile` would fail leaving `CURRENT_HASH` empty, which matched an empty `STORED_HASH` and caused the script to skip installation entirely. Added an explicit `if not exist` guard immediately after `REQ_FILE` is set; the script now prints a clear error message and exits with code 1 instead of launching the app with potentially missing dependencies.

## [1.0.8] - 2026-03-03

### Changed
- Styled scrollbars to match the dark theme: slim 8 px track with no arrow buttons, rounded handle using `COLOR_BORDER`, brightening to `COLOR_SUBTEXT` on hover. Applied to both vertical and horizontal axes.

## [1.0.7] - 2026-03-03

### Changed
- Removed the Path column from the Log tab. The track name column now stretches to fill the full available width.

## [1.0.6] - 2026-03-03

### Fixed
- Alternate (even) rows in the Log table had no hover highlight or selection highlight. The `QTableWidget::item:alternate` stylesheet rule has higher CSS specificity than the widget-level `selection-background-color` property, so Qt silently ignored hover and selection for those rows. Added explicit `::item:hover`, `::item:selected`, `::item:alternate:hover`, and `::item:alternate:selected` rules so both row types behave consistently.

## [1.0.5] - 2026-03-03

### Fixed
- Log tab status cells showing no colour. The stylesheet rule `QTableWidget::item { color: … }` was hard-coding all cell text to the default text colour, overriding the programmatic `setForeground()` call used to colour Saved/Skipped/Error entries. Removed the redundant `color` declarations from the `::item` and `::item:alternate` stylesheet rules; the base `QTableWidget { color: … }` rule already supplies the default colour.
- Track name being cut off in the Log tab. Both the Track and Path columns were set to `Stretch`, splitting the available width equally. Changed the Path column to `Interactive` with a sensible default width so the Track column receives all remaining stretch space.

## [1.0.4] - 2026-03-03

### Fixed
- Log tab entries not appearing after recordings were saved or skipped. The save background thread was using `QTimer.singleShot(0, lambda …)` to deliver results to the main thread, which is unreliable in PyQt6 from non-Qt threads. Replaced all five cross-thread callbacks in `_save()` with dedicated `pyqtSignal` emissions (`_sig_save_complete`, `_sig_save_skipped`, `_sig_save_skipped_duplicate`, `_sig_save_error`, `_sig_ensure_btn_ready`), which are the correct PyQt6 mechanism for thread-safe main-thread dispatch.

## [1.0.3] - 2026-03-03

### Added
- **Log tab** (first tab): a table showing every recording outcome — time, status (Saved / Skipped / Error), track name, duration, and filename. Status cells are colour-coded green/amber/red. Rows are appended automatically after each save attempt.
- **Track label**: the current song title is displayed prominently above the waveform while recording is active, using the accent colour.
- **Deferred stop** (auto-record mode): pressing "Stop Recording" once while auto-record is on sets a *Stopping after song…* state (amber button). The recording keeps running and stops automatically when the media player pauses or moves to a new track. A second click stops immediately.

### Changed
- `_on_save_complete`, `_on_save_skipped`, `_on_save_skipped_duplicate`, and `_on_save_error` each accept an optional `track` parameter so the log always captures the correct title even when the media session has already advanced to the next song.
- `_on_auto_record_toggle`: disabling auto-record while a deferred stop is pending now triggers an immediate stop instead of leaving the app in an inconsistent state.
- Added `COLOR_WARNING` / `_WARNING_HOVER` (amber) and `QLabel#trackLabel`, `QTableWidget`, `QHeaderView` styles to the theme stylesheet.

## [1.0.2] - 2026-03-03

### Changed
- Extracted duplicate handling out of the Auto-Record group box into its own "Duplicate Handling" group box on the Automation tab.

## [1.0.1] - 2026-03-03

### Changed
- Moved "Minimum Duration" from the Export tab's Audio Format section into a dedicated group box on the Automation tab, where it sits logically alongside auto-record and duplicate-handling settings.

## [1.0.0] - 2026-03-03

### Changed
- Restructured the main window UI around a `QTabWidget` with three tabs:
  - **Record** — audio device selection and output folder.
  - **Export** — audio format options, MP3 export settings, and cover art.
  - **Automation** — auto-record and duplicate-handling settings.
- Waveform visualiser and recording controls remain always visible below the tab area.
- Reduced window height from 800 px to 580 px to match the new compact layout.
- Added `QTabBar` / `QTabWidget` styling to the theme stylesheet to match the existing dark indigo palette.

## [0.9.9] - 2026-03-03

### Changed
- `run.bat` now shows an animated spinner (`[-]`, `[\]`, `[|]`, `[/]`) in-place on the same console line while dependencies are being installed, replacing the static "Installing dependencies..." message.

## [0.9.8] - 2026-03-03

### Added
- `run.bat` launcher script — double-click to install dependencies and start the app without any manual setup steps.

### Changed
- `run.bat` now skips `pip install` when `requirements.txt` has not changed since the last run. A SHA-256 hash of `requirements.txt` is stored in `.deps_hash` next to the script and compared on each launch; dependencies are only reinstalled when the file actually changes.

## [0.9.7] - 2026-03-03

### Fixed
- Spinner (QSpinBox) up/down arrow buttons were invisible. Styling `::up-button` / `::down-button` in Qt removes the default OS arrows; added explicit `::up-arrow` and `::down-arrow` sub-control rules backed by new `arrow_up.svg` / `arrow_down.svg` assets.

## [0.9.6] - 2026-03-03

### Fixed
- Taskbar now shows the correct app icon on Windows. `SetCurrentProcessExplicitAppUserModelID` is called before the `QApplication` is created in `main.py`, preventing Windows from falling back to the Python interpreter's icon.

## [0.9.5] - 2026-03-03

### Fixed
- `_gsmtc_get_media_info` now falls back to scanning all GSMTC sessions for an actively playing one when `get_current_session()` returns `None`, restoring the prior behaviour and preventing missed sessions. The OS-designated current session is still preferred when present.

## [0.9.4] - 2026-03-03

### Changed
- Auto-record is now player-agnostic: the Spotify-only GSMTC filter (`"spotify" in source_app_user_model_id`) has been removed from `services/media_session.py`. The watcher now uses the OS-designated current session (`get_current_session()`) as its primary source, with a fallback that scans all sessions for one that is actively playing. Any GSMTC-capable player (YouTube Music, Apple Music, Tidal, VLC, Winamp, etc.) is now supported automatically.
- Event subscriptions in the watcher now cover all registered GSMTC sessions instead of only Spotify, so track-change events fire regardless of which player is in use.

## [0.9.3] - 2026-03-02

### Added
- Duplicate-song handling option in the Auto-Record section. Three modes are available and persisted in settings: **Skip** (do not record if a file with the same name already exists), **Append number** (save as `Title (2)`, `Title (3)`, etc.), and **Overwrite** (replace the existing file). Defaults to *Append number*. The check is performed before recording starts (fast-skip in auto-record mode) and again at save time to guard against races. Works for both WAV and MP3 output.

## [0.9.2] - 2026-03-02

### Fixed
- "Saving…" UI lock-up after pressing Stop: `Recorder.stop()` called `threading.Thread.join()` with no timeout, which blocked indefinitely if PortAudio stalled closing the stream (e.g. device disconnect or WASAPI teardown delay). Added a 10-second timeout so the save thread always proceeds.
- Added `_ensure_btn_ready()` as a `finally`-guard in the `_save` thread: regardless of how the save exits (success, exception, or unexpected `BaseException`), the record button is always restored to its idle state if no new recording is active, preventing the UI from ever getting stuck.

## [0.9.1] - 2026-03-02

### Added
- Custom frameless window (`gui/titlebar.py`): the native OS title bar is replaced by a styled `TitleBar` widget that matches the Tron/indigo palette.  It contains a small all-caps application title on the left, and Minimize / Close buttons on the right.  Dragging uses `QWindow.startSystemMove()` so Aero Snap and multi-monitor positioning work natively; double-clicking the drag area minimizes the window.
- Outer 1 px `COLOR_BORDER` frame rendered around the frameless window via `QWidget#outerFrame` styling.
- `WINDOW_HEIGHT` increased from 640 → 676 px to accommodate the 36 px title bar without reducing content area height.

## [0.9.0] - 2026-03-02

### Added
- Tron-style real-time waveform visualizer (`gui/waveform.py`): a `WaveformWidget` that renders scrolling vertical bars in neon cyan with a glow halo, subtle dot-grid, and HUD-style corner brackets on a near-black background.  The widget is displayed between the settings panels and the record button and animates with live audio RMS values while recording, then collapses to a dim flat line when idle.
- `Recorder` now accepts an optional `data_callback` parameter that receives every raw audio chunk from the InputStream callback, enabling real-time level monitoring without modifying the captured data.
- `RecorderApp` computes normalized RMS from each audio chunk and forwards it to the waveform via a `pyqtSignal(float)`, keeping UI updates thread-safe.

## [0.8.5] - 2026-03-02

### Fixed
- `D:\Downloads\recording.mp3` being created on every track change, and the actual song recording being cut off: GSMTC fires its change events before Spotify has finished writing the new track's metadata, so a query made instantly after the event returns empty title and artist. `_sanitize_filename("")` falls back to `"recording"`, causing the recorder to stop the current song and start a new recording named `recording.wav` (later converted to `.mp3`). Fixed with two guards:
  1. A 100 ms coalesce delay in the GSMTC event watcher — after the trigger fires, the watcher sleeps briefly so all property updates settle before querying.
  2. `_spotify_poll` now skips any `is_playing=True` event where `title` is empty, treating it as a transient metadata state rather than a real track change.

## [0.8.4] - 2026-03-02

### Fixed
- Track-change recordings being cut off and saved with the wrong filename (e.g. `recording.mp3`): GSMTC fires `playback_info_changed` and `media_properties_changed` in rapid succession during transitions, causing Spotify to briefly report a paused/buffering state immediately after a new track starts. The app now debounces pause events — a pause must persist for 2 500 ms before the recording is stopped. Any subsequent playing event cancels the pending stop, so brief gaps between tracks no longer truncate recordings.
- `_stop_recording()` could be called redundantly (while `_recording` is already `False`), potentially corrupting save state; it now returns early if no recording is active.

## [0.8.3] - 2026-03-02

### Changed
- Spotify auto-record now starts recording the instant the OS reports a track change instead of waiting for the next poll cycle. The watcher subscribes to GSMTC `playback_info_changed` and `media_properties_changed` events so detection is event-driven rather than timer-based; polling every 250 ms is kept only as a safety-net fallback.
- Removed the 200 ms artificial delay that was inserted between detecting a new track and calling `_start_recording()`.
- Reduced the fallback poll interval from 1 000 ms to 250 ms (`SPOTIFY_POLL_INTERVAL_MS`).

## [0.8.2] - 2026-03-02

### Fixed
- Repaired widespread encoding corruption in `gui/recorder_app.py`: every Unicode symbol (`—`, `…`, `→`, `×`) had been stored as mojibake (`â€"`, `â€¦`, `â†'`, `Ã—`) due to a Latin-1/UTF-8 mismatch; all occurrences are now correct Unicode escape sequences.
- Removed duplicate `SAMPLE_RATES` / `CHANNEL_OPTIONS` constant definitions that were appended to the bottom of `recorder_app.py`.

### Changed
- `gui/check.svg` added: a clean white-stroke checkmark icon used by the Qt stylesheet.
- `gui/theme.py`: `QCheckBox::indicator:checked` now renders an actual checkmark via `image: url(...)` pointing at the bundled SVG, replacing the featureless solid-fill block.

## [0.8.1] - 2026-03-02

### Changed
- Replaced the theme palette with a fully cohesive deep indigo-slate color scheme:
  - All base colors (`BG`, `SURFACE`, `BORDER`, `SUBTEXT`) now share the same blue-purple hue family (≈240–265°) instead of mixing warm and cool purples.
  - `COLOR_ACCENT` shifted from warm `#7c6af7` to cooler indigo `#7b77f5`, harmonising with the darker backgrounds.
  - `COLOR_DANGER` changed to rose `#f2637a` (complementary to indigo) instead of the clashing orange-red.
  - `COLOR_TEXT` updated to `#dde1f0` (cool blue-white, matching the indigo family).
  - Added `_ACCENT_HOVER`, `_SURFACE_HOVER`, and `_DANGER_HOVER` derived states so all interactive hover colors are coordinated and defined in one place.
  - Added `:hover` and `:focus` border transitions for `QLineEdit`, `QSpinBox`, `QComboBox`, and `QCheckBox::indicator`.
  - Slightly increased `border-radius` on group boxes, buttons, and inputs for a more polished look.

## [0.8.0] - 2026-03-02

### Changed
- Replaced the tkinter/ttk UI with PyQt6 throughout the application:
  - `main.py` — creates a `QApplication`, applies the global stylesheet, and shows `RecorderApp`.
  - `gui/theme.py` — removed tkinter imports; now exports `APP_STYLESHEET` (a Qt stylesheet string) alongside the existing `COLOR_*` constants.
  - `gui/recorder_app.py` — full rewrite as a `QMainWindow` subclass; all tkinter widgets replaced with their Qt equivalents (`QComboBox`, `QSpinBox`, `QCheckBox`, `QLineEdit`, `QPushButton`, `QGroupBox`, etc.); Spotify background-thread callbacks use `pyqtSignal` for thread-safe dispatch.
  - `gui/region_selector.py` — rewritten as a `QWidget` fullscreen overlay using `QPainter` for the selection rectangle and Qt mouse events; no longer depends on tkinter.

## [0.7.0] - 2026-03-02

### Changed
- Restructured the project from three flat scripts into a proper package layout:
  - `core/recorder.py` — audio device and recording logic (was `recorder.py`).
  - `core/converter.py` — WAV-to-MP3 conversion logic and constants (extracted from `converter.py`).
  - `gui/theme.py` — shared `COLOR_*` constants and `apply_dark_theme()` (deduplicated from both GUIs).
  - `gui/region_selector.py` — `RegionSelector` class (extracted from `window.py`).
  - `gui/recorder_app.py` — `RecorderApp` class (was `window.py`).
  - `services/spotify.py` — GSMTC Spotify integration (extracted from `window.py`).
  - `utils/filename.py` — `_sanitize_filename` and `COVER_THUMB_SIZE` (extracted from `window.py`).
  - `main.py` — entry point for the recorder application (replaces `window.py`).

### Removed
- Standalone converter GUI (`gui/converter_app.py`, `run_converter.py`). The conversion logic in `core/converter.py` is unaffected.

## [0.6.2] - 2026-03-02

### Fixed
- `window.py`: Album cover was not embedded in the MP3. The root cause was a call-order race: `_apply_gsmtc_cover` was scheduled via `after(0, ...)` but `_stop_recording` had already snapshotted `_cover_art_bytes = None` before that callback fired. Fixed by calling `_apply_gsmtc_cover` synchronously inside `_spotify_poll`, before `_stop_recording` is invoked, so the cover bytes are always available when the save thread reads them.

## [0.6.1] - 2026-03-02

### Changed
- `window.py`: Replaced the window-title + screen-grab Spotify detection with the Windows Global System Media Transport Controls (GSMTC) API via `winrt-Windows.Media.Control`. Track title, artist, and album are now read directly from the structured GSMTC session properties; cover art is pulled from the GSMTC thumbnail stream, eliminating the need for a screen-region recapture on every track change. The manual "Pick region" cover-art picker is retained as a fallback when no GSMTC thumbnail is available. `_WIN32_AVAILABLE`/`pywin32` dependency removed from the Spotify auto-record path; replaced by `_GSMTC_AVAILABLE`.
- `window.py`: Album name from GSMTC is stored in `_current_album` and forwarded to `write_mp3_tags` so the TALB ID3 tag is now populated automatically.
- `converter.py`: `write_mp3_tags` now accepts an optional `album` parameter and writes it as a TALB ID3 tag.

## [0.6.0] - 2026-03-02

### Added
- `media_session_demo.py`: Standalone demo that reads the currently playing track from any GSMTC-registered media player (Spotify, browsers, VLC, etc.) via the Windows Global System Media Transport Controls API using `winrt-Windows.Media.Control`. Reports title, artist, album, track number, playback status, and source app. Saves the album art thumbnail as a PNG file for each active session. Required packages: `winrt-runtime`, `winrt-Windows.Media.Control`, `winrt-Windows.Storage.Streams`, `winrt-Windows.Foundation`.

## [0.5.9] - 2026-03-02

### Added
- `window.py`: Settings are now persisted to `gravity_recorder.json` (next to the script) on close and restored on startup. Saved fields: audio device name, sample rate, channels, bit depth, min. duration, convert-to-MP3 toggle, MP3 bitrate, MP3 quality, output path, Spotify auto-record toggle, and cover art screen region (bounding box). The cover art region is re-captured immediately on startup (200 ms delay) so the thumbnail is live. If Spotify auto-record was enabled it is restarted automatically.

## [0.5.8] - 2026-03-02

### Changed
- `window.py`: Cover art is now automatically re-captured on every Spotify track change. `RegionSelector` now passes the absolute screen bounding box alongside the cropped image via its callback. `RecorderApp` stores the bbox in `_cover_region_bbox` and calls `_recapture_cover_art()` 800 ms after each song change (giving Spotify's UI time to update) to grab a fresh screenshot of the same region and update both `_cover_art_bytes` and the thumbnail preview.

## [0.5.7] - 2026-03-02

### Added
- `window.py`: **Cover art** row in Settings (below the MP3 row). A "Pick region" button hides the main window and opens a fullscreen `RegionSelector` overlay — a darkened screenshot of the entire virtual desktop where the user drags to select any rectangular region. The selected region is shown as a 48×48 pixel thumbnail preview inline. A "Clear" button removes it. The captured region is stored as JPEG bytes and embedded into the MP3 as an ID3 `APIC` (cover) tag on every save. Pressing Escape cancels without changing the current art.
- `converter.py`: `write_mp3_tags` now accepts an optional `cover_art: bytes | None` parameter and embeds it as an ID3 `APIC` frame (`type=3`, `image/jpeg`).

## [0.5.6] - 2026-03-02

### Added
- `window.py`: **Convert to MP3 after save** checkbox in Settings (row 3) with bitrate and quality dropdowns (disabled until checked). When enabled, after a successful WAV save the recording is converted to MP3 via `lameenc`, tagged with ID3 `TPE1` (artist) and `TIT2` (title) parsed from the Spotify window title (`"Artist - Song"` format), and the original WAV is deleted. Works for both manual and Spotify auto-recordings; manual recordings receive no tags.
- `converter.py`: `write_mp3_tags(mp3_path, artist, title)` function using `mutagen` to write ID3 artist and title tags to an MP3 file.

## [0.5.5] - 2026-03-02

### Added
- `window.py`: **Min. duration** setting (MM:SS spinboxes) in the Settings section. When set, any recording shorter than the threshold is discarded instead of saved. The status bar reports the skipped duration and the minimum. Works for both manual and Spotify auto-recordings. Defaults to `00:00` (no minimum).

## [0.5.4] - 2026-03-02

### Added
- `window.py`: **Spotify Auto-Record** section with an "Auto-record tracks" checkbox. When enabled, a background thread polls the Spotify window title every second using the Windows Core Audio/Win32 API (`win32gui`, `win32process`, and `QueryFullProcessImageNameW` via ctypes). On each track change the current recording is stopped and saved (filename derived from the previous track), then a new recording starts immediately for the incoming track. Playback resuming from pause also triggers a fresh recording. When Spotify is paused or closed the recording stops automatically. The section is gracefully disabled when `pywin32` is not installed. Requires `pywin32` (`pip install pywin32`).

## [0.5.3] - 2026-03-02

### Changed
- `ocr.py`: Improved umlaut (Ö/Ä/Ü and ä/ö/ü) recognition by switching the recognition backbone from `crnn_vgg16_bn` to **`parseq`** (PARSeq), which ships with a significantly wider character vocabulary. Added a `SMOOTH_MORE` denoise pass before contrast/sharpness enhancement to preserve the small diacritic dots that overly aggressive sharpening would blur or destroy. Reduced sharpness factor from 2.2 to 1.8 for the same reason.

## [0.5.2] - 2026-03-02

### Changed
- `ocr.py`: After selecting a screen region the toolbar now shows the region's coordinates and size as `(x, y)  W×H` next to a **Copy Coords** button. Clicking it copies the raw bounding box as `left, top, right, bottom` to the clipboard, useful for reusing the region in scripts or other tools.

## [0.5.1] - 2026-03-02

### Changed
- `ocr.py`: Added **Invert colors** checkbox to the toolbar. When enabled, color inversion (via `ImageOps.invert`) is applied to the captured frame before contrast and sharpness enhancement, which improves OCR accuracy on dark-background / light-text screens. Toggling the checkbox on an existing capture immediately re-processes the image, updates the Processed Screenshot panel, clears the bounding-box panel, and triggers a new OCR run if the model is ready.

## [0.5.0] - 2026-03-02

### Added
- `ocr.py`: Screen-region OCR application built on `python-doctr` (`mindee/doctr`). A semi-transparent fullscreen overlay (covers all monitors via virtual desktop metrics) lets the user drag-select any screen region. The main window displays three side-by-side image panels: **Input Screenshot** (raw capture), **Processed Screenshot** (upscaled + contrast-boosted + sharpened), and **Bounding Boxes** (word-level bounding boxes drawn over the processed image with semi-transparent fills and value labels). Recognised text is shown in a scrollable `Consolas` editor below the panels with a one-click Copy button. The docTR predictor is pre-warmed in a background thread at startup; OCR runs automatically after region selection when the model is ready, with a manual **Run OCR** button for re-runs. Upscale factor (1×–4×) is selectable from the toolbar. Matches the dark theme of the rest of the suite.

## [0.4.1] - 2026-03-01

### Changed
- `ocr.py`: Added a live screenshot preview panel. The window is now split side-by-side — a preview canvas on the left shows a thumbnail of the captured region immediately after selection, and the recognized text panel sits on the right. The screenshot is grabbed once on region selection and reused by the OCR worker, so "Run OCR" no longer re-captures the screen.
- `ocr.py`: Fixed region selector to cover all monitors by reading the full virtual desktop bounds via `ctypes` `GetSystemMetrics` instead of using `-fullscreen True` (which only covered the primary monitor on Windows).
- `ocr.py`: Added image upscaling, contrast enhancement, and sharpness boost in `_preprocess()` before running the OCR model, plus an Upscale factor dropdown (1×–4×) in the Preprocessing section. Added `assume_straight_pages=True` to the predictor.

## [0.4.0] - 2026-03-01

### Added
- `ocr.py`: Standalone screen-region OCR application. A semi-transparent fullscreen overlay lets the user drag-select any screen region; the captured area is fed to `python-doctr` (`mindee/doctr`) running a pretrained OCR predictor in a background thread. Results appear in a scrollable editor with Copy and Clear actions. The model is pre-warmed at startup so the first recognition is near-instant. Matches the dark theme of the rest of the suite.

## [0.3.0] - 2026-03-01

### Added
- `converter.py`: Standalone WAV → MP3 converter application with the same dark UI theme as the recorder. Supports configurable bitrate (96–320 kbps) and encoding quality (Best / Good / Fast) via LAME encoder (`lameenc`). Auto-fills the output path from the input filename and runs conversion in a background thread to keep the UI responsive.

## [0.2.0] - 2026-03-01

### Changed
- `recorder.py`: Added `_build_friendly_name_map()` which queries the Windows Core Audio API via pycaw (`AudioUtilities.GetAllDevices()`) — the same approach as NAudio's `MMDeviceEnumerator / FriendlyName` used in spy-spotify. Capture endpoints are identified by `{0.0.1.` in their WASAPI device id. Every name prefix of length ≥ 10 is stored so that PortAudio-truncated sounddevice names still resolve to the full Windows friendly name. Falls back gracefully to sounddevice names if pycaw is unavailable.
- `recorder.py`: `get_all_devices()` now enriches each device name from the WASAPI friendly-name map before returning.
- `window.py`: Device dropdown now displays only the full friendly name (no `[index]` prefix). Device resolution changed from index-parsing to positional lookup against the `_input_devices` list.

## [0.1.0] - 2026-03-01

### Added
- `recorder.py`: `AudioDevice` data class and `get_all_devices()` / `find_device_by_name()` helpers for enumerating sounddevice inputs.
- `recorder.py`: `Recorder` class that captures audio from any input device in a background thread using a streaming callback, supporting configurable sample rate and channels (defaults: 48 kHz, stereo).
- `window.py`: Tkinter `RecorderApp` GUI with device selector (auto-detects CABLE Output), sample rate and channel dropdowns, output file browser, Start/Stop recording button, and a live status bar.
