# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-04-03

### Added

- **Interactive Song Trim Modal** — A `SongTrimModal` dialog lets you visually preview and adjust the start and end points of any saved recording before committing to the file. Open it by hovering a recording entry and clicking the scissors icon. The modal decodes the audio with the Web Audio API and draws a live waveform, with two draggable amber handles that control the trim region. Clicking the waveform area also moves the nearest handle. A "Preview trim" playback button auditions the selected segment using an `AudioBufferSourceNode`.
- **Trim preset system** — After adjusting a song's trim you can check "Save as preset for future recordings". The offsets (start and end trim amounts) are stored per song identity (`artist|||title`) in `trim-presets.json` in the app's userData folder. A "global default" preset (apply to all songs) is also available via a second checkbox. Presets are automatically applied in `TrackSplitter._finalizeStoppedRecording` so recurring songs are trimmed correctly without any manual steps. An existing preset badge with a delete button is shown in the modal header.
- **`TrimPresetsStore` service** — New `src/main/services/TrimPresetsStore.ts` provides `getTrimPreset`, `saveTrimPreset`, `deleteTrimPreset`, and `loadAllTrimPresets`.
- **`AudioRecorder.retrimFile()`** — New static method re-encodes a saved MP3 or trims a WAV in-place to the exact `[startSec, endSec]` range using ffmpeg (MP3 preserves ID3 metadata via `-map_metadata 0`).
- **`autotape-audio://` Electron protocol** — Registered alongside `autotape-art://` to serve local audio files to the renderer's Web Audio API without needing `webSecurity: false`.
- **IPC trim handlers** — `trim:apply`, `trim:get-preset`, `trim:get-all-presets`, `trim:save-preset`, `trim:delete-preset` registered in the main process and exposed on `window.electronAPI`.

### Changed

- **Zoomable waveform in Trim Modal** — The waveform now supports up to 40× zoom via scroll wheel (centred on the cursor), a draggable zoom slider, and `+` / `−` buttons. A reset-to-full-view button appears when zoomed. Dragging a handle near the left or right edge auto-pans the view, and holding the middle mouse button drags to pan manually.
- **Relative trim offsets displayed** — The time labels below the waveform now show both absolute timestamps (`0:01.3`) and relative offsets from the file boundaries (`+1.300s from start` / `−0.500s from end`). The "Save as preset" checkbox label also shows the computed offset pair, and the existing-preset badge in the modal header now displays the stored offsets (e.g. `+0.300s / −0.500s`) instead of just "Preset saved", making it immediately clear the preset will work across different-length songs.

### Fixed

- **electron-builder config validation** — Fixed build failure caused by unsupported `portable` options in `electron-builder.yml` (`shortcutName`, `uninstallDisplayName`, `createDesktopShortcut`). These keys were removed to match `electron-builder` 26.x schema so Windows builds succeed again.

## [2.3.1] - 2026-03-25

### Added

- **Icons throughout the UI** — Added `lucide-react` icons to the tab triggers ("Recordings" with a library icon, "Settings" with a sliders icon), the Controls card header (microphone icon), and all settings section labels (folder, file-audio, gauge, radio, timer, headphones, file-minus, CPU icons). Icons use a consistent `w-3.5 h-3.5` size and subtle `text-zinc-500` tint to complement the existing design.
- **Vinyl record button affordance** — The idle vinyl now shows a `Play` icon in the center label, a brighter and larger hover glow, stronger scale-up on hover, and a persistent "Click to record" label below the disc to make the interactive intent immediately clear.

## [2.3.0] - 2026-03-25

### Added

- **ffmpeg path setting with auto-detect** — A new "ffmpeg Binary" field in the Settings panel lets you specify a custom ffmpeg executable path. Leave it blank to use the automatic resolution logic (bundled binary first, then system PATH). A spinning refresh button triggers a fresh detection pass and shows the resolved path as a hint below the field. The resolved path is persisted in `settings.json` and applied immediately on startup and every time settings are saved.
- **`FfmpegResolver` shared module** — All ffmpeg binary resolution logic (asar-unpack remapping, bundled probe, `where.exe` fallback) is now in a single `FfmpegResolver.ts` service, shared by both `AudioRecorder` and `AudioDevices`. Exposes `getFfmpegPath()`, `setFfmpegOverride()`, and `detectFfmpegPath()`.
- **`AudioRecorder.resetProbe()`** — New static method that clears the cached ffmpeg capability probe, so changing the binary path in settings immediately takes effect on the next recording start.

## [2.2.3] - 2026-03-25

### Fixed

- **`spawn EFTYPE` crash on startup** — On some Windows setups the `ffmpeg-static` bundled binary cannot be executed (producing `spawn EFTYPE` / `ERROR_BAD_EXE_FORMAT`). Both `AudioRecorder` and `AudioDevices` now probe the bundled binary at first use; if it fails they fall back to a system-installed ffmpeg found via `where.exe`. This eliminates the unhandled promise rejection that prevented recording from starting.
- **Unhandled promise rejection in `_doProbe`** — `AudioRecorder._doProbe` now wraps the ffmpeg probe in a try/catch, so if the binary can't be spawned the recorder defaults to `_wasapiSupported = false` instead of crashing with an unhandled rejection.
- **`_wasapiSupported` regex in `AudioRecorder`** — The regex `/\bD\s+wasapi\b/` (requiring exactly `D wasapi`) did not match the actual ffmpeg output (`DE wasapi`), causing WASAPI support to be wrongly detected as absent. Now uses `/\bwasapi\b/` consistently.
- **Virtual audio cable not discovered** — The dshow device parser required a `(audio)` suffix on each device line that modern ffmpeg versions do not emit. The parser now extracts only the "DirectShow audio devices" section of the output and matches device names without that suffix, so VB-Audio Virtual Cable and similar devices appear correctly in the settings dropdown.
- **Every song saved as error** — `AudioRecorder.encodeToMp3` and `AudioRecorder.trimWav` still referenced the old `ffmpegPath` module constant (renamed to `_bundledFfmpegPath` in v2.2.3). On systems where the bundled binary fails with EFTYPE, these static methods tried to spawn the broken path and threw, causing every recording finalization to report `status: 'error'`. Both methods now call `getFfmpegPath()` to get the resolved (and potentially system-fallback) binary.
- **Synchronous `spawnSync` calls in `_supportsWasapi` / `_getFirstDshowAudioInput` removed** — These methods previously re-ran ffmpeg synchronously on the main thread if `probe()` hadn't resolved yet. They now return cached values only (or safe defaults), relying on the async `probe()` call that is awaited before `start()`.

## [2.2.2] - 2026-03-25

### Fixed

- **Audio devices not listed** — `AudioDevices.ts` had two bugs: (1) it only read `stderr` from ffmpeg, but some ffmpeg builds write the `-devices` / `-list_devices` output to `stdout`, causing the backend detection to silently fail and return only the "Default" option; (2) it used the raw `ffmpeg-static` path without remapping `app.asar → app.asar.unpacked`, so the ffmpeg binary could not be spawned in packaged builds at all. Both are now fixed to match the pattern already used in `AudioRecorder.ts`.

## [2.2.1] - 2026-03-25

### Fixed

- **Warm recorder restart loop** — When ffmpeg exited immediately after warm-recorder start (e.g. device momentarily unavailable), the `stopped` / `error` handler re-entered `_startWarmRecorder()` synchronously, spawning a new process on every exit and creating a tight loop (10+ processes in 180 ms). The restart is now scheduled with a 1 s backoff via `_scheduleWarmRestart()`, and the timer is deduplicated so only one restart can be queued at a time. The timer is also cancelled in `_killWarmRecorder()` so no ghost restarts occur after `stopListening()`.

## [2.2.0] - 2026-03-24

### Changed

- **Vinyl record button** — The record button is now a spinning vinyl disc SVG: dark near-black disc with 8 warm-toned concentric groove rings, a specular highlight arc for depth, an amber center label (shifts terracotta while recording), and a spindle hole. The disc spins slowly at idle (8 s/revolution) and fast while recording (1.8 s/revolution). A stop icon overlays the center label while recording.

## [2.1.0] - 2026-03-24

### Added

- **Title click secret** — Clicking the "Spytify" title 5 times rapidly within 1.5 s reveals a brief "Tuned in." confirmation beside the logo.
- **Cassette tape empty state** — The recording log's empty state now shows an inline SVG cassette tape illustration with the copy *"No tracks saved yet — Hit record to start building your collection."* instead of plain text.
- **Rotating idle taglines on RecordButton** — When not recording, a tagline cycles every 3.5 s through: "Drop the needle.", "Ready to roll tape.", and "Cue the music."
- **Music-flavoured recording status** — The recording pulse label rotates every 4 s through: "Rolling tape", "Capturing the groove", "Laying down tracks", and "In the booth".
