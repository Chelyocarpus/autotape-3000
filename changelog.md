# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.1] - 2026-07-13

### Added

- **Two-click stop** — Clicking Stop while a track is still playing now defers the stop until that track ends naturally, instead of cutting it off mid-song; the record button shows a pending badge, and a second click forces an immediate stop.
- **Auto-discard after a long pause** — Playback pausing no longer immediately splits the recording; it keeps running through brief pauses (resuming continues the same file) and only stops-and-discards the take once paused longer than the new "Discard After Paused" setting (default 60s, 0 disables).

### Changed

- **Redesigned the recordings list rows** — Each track now shows a track number, a warmer gradient thumbnail fallback, and pill-shaped status badges (duration / skipped / error) instead of bare icons and plain text, replacing the previous flat hover-only rows.

### Fixed

- **Browse button in Settings didn't open to the current output folder** — `dialog:pick-output-dir` never passed a `defaultPath`, so the folder picker opened wherever the OS last remembered instead of navigating to the currently configured output directory.
- **App silently stopped updating after the renderer process died** — GSMTC/recorder events kept firing into a dead window forever (logged as "Render frame was disposed" but never recovered). The main window now reloads itself when its renderer process goes away, and IPC sends check the frame is live first instead of firing blind.
- **Isolated app capture could fail to start on the very first recording** — `TrackSplitter` read the resolved process ID from a synchronous cache while the lookup was still in flight, so a track already playing when recording started always lost the race. Recording start now awaits the in-flight PID resolution instead of reading a possibly-empty cache.
- **Isolated app capture never resolved Firefox/Chromium tabs** — Browsers assign each window its own generated `AppUserModelID` (for taskbar/jump-list grouping) that bears no relation to the process name, so the exe-name-guessing resolver could never match it. `ProcessResolver` now reads the window's `System.AppUserModel.ID` property directly first, falling back to the exe-name guess only for windowless players.
- **Media Source dropdown showed an unrecognizable id for Spotify's current desktop client** — Spotify's CEF-based client (like browsers) registers its media session under an opaque generated id (e.g. `Chromium.<hash>`) instead of an app name; the picker now shows the track's artist/title instead of that raw id when it isn't recognizable. Capture resolution for these sources is unchanged (still unsupported — there's no OS API that maps this kind of self-chosen id back to a process).
- **Re-running the setup wizard and picking a different capture device didn't take effect until restart** — Settings and the onboarding wizard each load their own snapshot of settings independently; saving from one left the other showing a stale device until the app reloaded. `useSettings()` now broadcasts a save to every mounted instance, so Settings reflects a device picked in the wizard immediately.
- **Onboarding's selected capture-method card rendered near-black** — its highlight used `amber-950`, a shade outside the app's theme-aware amber scale (which only defines 300–700), so it fell back to Tailwind's raw dark value in every theme instead of adapting like the rest of the UI.

### Changed

- **Quieter, more useful logging** — Disabled the per-poll GSMTC log line (fired every 50ms and drowned out everything else); added timing logs to `AudioRecorder` for ffmpeg spawn latency, start/stop requests, and SIGKILL escalations.
- **Tighter track-boundary cut precision** — GSMTC's reported position is a snapshot the source app pushes on its own schedule, not on our poll cadence, so it could be stale by the time we used it. Both PowerShell scripts now also report when that position was last pushed, and `TrackSplitter` extrapolates a live position from it before computing trim offsets and the outgoing recording's cut point.
- **Onboarding's Audio Capture Method step now presents four explained choices instead of one dropdown** — Virtual Cable, Isolated, Standard (system-wide), and Other (a specific input device), each with a plain-language explanation of the tradeoff. Virtual Cable is the most robust option (a plain passthrough with nothing to resolve, unlike Isolated's dependency on mapping GSMTC's reported source back to a process — see above) but is greyed out with an explanation when no cable is detected; Isolated remains the fresh-install default when no cable is set up. A note now reminds the user this choice can be changed anytime in Settings.

## [2.5.0] - 2026-07-12

### Added

- **App version now shown in Settings** — Displays "Autotape 3000 v{version}" in the Settings footer, via a new `app:get-version` IPC channel and `useAppVersion()` hook.
- **Isolated per-app audio capture on Windows 10 2004+ (build 19041+)** — Records just the currently-playing app's audio via WASAPI process-loopback, no virtual cable needed. Implemented as a new bundled native helper (`native/loopback-capture`, Rust + [`wasapi`](https://crates.io/crates/wasapi)) piped into ffmpeg; `ProcessResolver.ts` resolves GSMTC's `sourceAppId` to a PID (win32 desktop apps only for now). New default capture mode on fresh installs, with the existing DirectShow device picker as a fallback. Building the helper requires the Rust toolchain (`pnpm build:native`).

### Changed

- **Clarified the Media Source / Audio Capture Method relationship** — Renamed the device picker to "Audio Capture Method" and its isolated option to "Isolated — follows Media Source (Recommended)", moved the two controls next to each other, and cross-referenced their help text so it's clear Media Source also picks *whose audio* gets recorded in that mode.
- **Media Source dropdown now leads with the process name** — Entries read `sourceAppId — artist — title (state, art)` instead of only falling back to the app id when metadata was missing, so the underlying app is always visible.
- **Onboarding now actually defaults to isolated capture** — Fixed a stale-state bug where the wizard's device selection never picked up the real settings-derived default, plus a "Recommended" grouping that didn't recognize the isolated option. Relabeled the step to match Settings.
- **Settings/Onboarding no longer mention cables or older Windows when isolated capture is already active** — Help text is now conditional on whether isolated capture is actually available on this machine; README's primary section dropped the same unnecessary hedge.

### Fixed

- **Media Source could rapidly flip between two sessions** — `gsmtc_loop.ps1` re-derived the "current" track from scratch on every ~50ms poll with no memory of what it had just reported, so two near-tied sessions (commonly both idle) could flip on every tick, in both `auto` and manual-selection mode. Rewrote selection to be stateful: once locked onto a track, it stays locked until that track disappears or a genuinely playing one takes over. Also changed `TrackSplitter`'s PID cache from a single value to a per-app `Map` (a flip back to a known app no longer re-spawns PowerShell) and closed a race where a superseded polling process's buffered output could still reach `_handleTrack()` after a newer one had already started.
- **Isolated capture could stutter under system load** — The capture thread wasn't registered with MMCSS and used WASAPI's default ~10ms buffer, so scheduling delays could drop samples. Registered it with MMCSS ("Pro Audio"), added a modest process priority bump, and grew the buffer to 500ms (latency doesn't matter for a background recorder).
- **Isolated capture could silently record silence for apps with several same-named processes** — `resolveAumidToPid()` picked the first `Get-Process` match by exe name, but apps like Spotify or a browser run multiple processes sharing one image name and only one owns the actual audio session. Now prefers whichever match owns a top-level window.
- **`ERR_STREAM_WRITE_AFTER_END` crash at the end of an isolated recording** — Graceful stop wrote `'q'` into ffmpeg's stdin and manually ended it, but for isolated capture that stream is a piped raw-PCM data channel (not a control channel like dshow's) that the pipe already auto-ends — a race that could throw. Removed the manual write/end for loopback recordings; killing the helper process alone already finalizes the file correctly.
- **`ProcessResolver` PID lookups could stall GSMTC's own PowerShell polling** — Switched from the WMI-backed `Get-CimInstance Win32_Process` to `Get-Process`, ~3x faster with no WMI service contention.
- **Title bar overlay briefly flashed light on a dark-themed launch** — Added `ThemeStore.ts` to persist the theme choice, so the initial `titleBarOverlay` color matches on the next launch instead of defaulting to light.
- **Trim editor could fail to load a recording ("Access to fetch... has been blocked by CORS policy")** — `SongTrimModal` fetched the audio file from a custom `autotape-audio://` protocol so it could hand the raw bytes to `decodeAudioData`. Chromium's `fetch()` CORS allowlist for cross-scheme requests only covers `chrome`/`chrome-extension`/`chrome-untrusted`/`data`/`http`/`https` — a custom scheme is never fetchable from the renderer no matter how `protocol.registerSchemesAsPrivileged` configures it, in dev or production. (An earlier pass fixed a real but secondary bug in the handler itself — a missing `await` on `net.fetch()` that let read failures bypass its `catch` block — but that fix could never have mattered here, since the request never reached the handler at all.) Replaced the whole fetch-a-custom-protocol approach with a new `audio:read-file` IPC channel that reads the file in the main process and returns the bytes directly — IPC isn't subject to `fetch()`'s CORS rules. Removed the now-unused `autotape-audio` protocol registration and handler entirely.
- **`pnpm run dev` failed with "No electron app entry file found"** — `package.json#main` pointed at `./out/main/index.js`, but this project's pinned `vite@^8.1.3` (which defaults to the Rolldown bundler) actually builds `out/main/index.mjs` — a pre-existing mismatch that had been masked by a stale `.js` build artifact left over from before the Vite upgrade; once that stale file was gone, the mismatch surfaced for real. Fixing that exposed a second, more serious issue: `electron` was getting bundled into the output instead of staying an external runtime import — `externalizeDepsPlugin()` only externalizes packages listed under `package.json#dependencies`, and `electron` is correctly in `devDependencies`, so it was never on that list; passing `include: ['electron']` to the plugin doesn't take effect under Rolldown either. Bundling `electron` replaces the real native `app`/`BrowserWindow` API with the npm package's plain-Node path-resolution stub, crashing the app on launch ("Electron failed to install correctly"). Set `rollupOptions.external: ['electron']` directly in `electron.vite.config.mjs` to fix that. Renaming the entry paths to `.mjs` to match Rolldown's default was the wrong direction, though — Electron's **sandboxed** preload (`sandbox: true`) cannot load ES modules ("Cannot use import statement outside a module"), so instead forced `rollupOptions.output.format: 'cjs'` on both the `main` and `preload` build targets, keeping `package.json#main` and the preload path in `createWindow()` at their original `.js` paths. Verified live: the app builds plain CommonJS output, launches, and runs stably with real GSMTC polling.
- **`package.json` version was frozen at `2.0.0`** — Bumped to `2.5.0` to match this release.
- **Pre-existing `tsc` errors surfaced while touching these files** — Removed two unused values (`SettingsPanel.tsx`, `SongTrimModal.tsx`) and added a missing `vitest` import in `test/setup.ts`.

## [2.4.2] - 2026-07-10

### Added

- **`AudioRecorder` unit tests** — New `src/main/services/__tests__/AudioRecorder.test.ts` covers the two behaviors from 2.4.1 that had no direct test coverage: the ffmpeg capture args no longer forcing a 44.1kHz sample rate, and `retrimFile` re-encoding MP3s in ABR mode at the source file's probed bitrate (with a 192kbps fallback when probing finds nothing usable), while WAV re-trims skip probing entirely and stream-copy instead.
- **Native toast + taskbar flash on silence detection** — The in-app silence modal was only visible if Autotape's window happened to be focused, but the app is meant to run in the background while you use something else. `wireSplitter`'s `silenceWarning` handler now also fires a native Windows `Notification` (so it lands in the notification center even if the app is minimized or behind another window) and calls `mainWindow.flashFrame(true)` when the window isn't focused, which Windows automatically stops once the user activates the window. `audioDetected` clears the flash if silence resolves before the user comes back.

### Changed

- **Native title bar buttons for Windows 11 Snap Layouts** — Replaced the custom-drawn SVG minimize/maximize/close buttons with Electron's `titleBarOverlay` (`frame: false` → `titleBarStyle: 'hidden'` + `titleBarOverlay`), so Windows renders and hit-tests the real system buttons. Hovering the maximize button now shows the OS's Snap Layouts flyout, matching apps like VS Code and Windows Terminal. The overlay's colors sync with the app's light/dark theme toggle via a new `window:set-titlebar-overlay` IPC channel; the old `window:minimize`/`maximize`/`close`/`is-maximized` channels were removed as dead code.

### Fixed

- **Theme now defaults to the OS light/dark preference on first run** — `App.tsx` previously fell back to a hardcoded `'light'` whenever no theme was saved in `localStorage`, ignoring `prefers-color-scheme` entirely. It now checks `window.matchMedia('(prefers-color-scheme: dark)')` and only falls back to `'light'` if there's no saved choice and no OS signal available.
- **Tailwind arbitrary-value syntax for the recording/error accent** — `ring-(--rec-500)`, `text-(--rec-500)`, and `bg-(--rec-500)` in `RecordButton.tsx`/`RecordingLog.tsx` used Tailwind v4's CSS-variable shorthand syntax; switched to the more broadly-recognized `ring-[var(--rec-500)]`/`text-[var(--rec-500)]`/`bg-[var(--rec-500)]` bracket form for compatibility with tooling that doesn't parse the shorthand. Verified both forms compile to identical output CSS, so this is a no-op at runtime.

### Removed

- **Committed TypeScript build cache** — `tsconfig.node.tsbuildinfo` (a machine-specific incremental-build artifact) was tracked in git; removed it from tracking and added `*.tsbuildinfo` to `.gitignore`.

## [2.4.1] - 2026-07-07

### Added

- **`TrackSplitter` unit tests** — New `src/main/services/__tests__/TrackSplitter.test.ts` covers the splitter's state machine with faked `AudioRecorder`/`GsmtcService`/filesystem collaborators and a controlled clock: warm-recorder pre-roll trim math and precise duration calculation across a track change, dropping short recordings on track change, duplicate detection both before a recording starts and after a sentinel recording's metadata resolves, in-place metadata updates that don't restart an in-progress recording, and graceful-vs-fast stop selection.
- **Hover tooltip explaining why a recording was skipped** — The Recording Log's "skipped" status label is now wrapped in the same hover tooltip the "error" label already had. `TrackSplitter` previously left `error` unset on the two duplicate-detected-before-recording paths and the duplicate-detected-at-finalize path, so those rows gave no indication of why they were skipped; all three now set a `"A file with this name already exists (duplicate action: skip)"` reason, alongside the existing short-recording-drop reason.

### Fixed

- **Recording no longer force-resamples to 44.1kHz** — `AudioRecorder`'s ffmpeg capture args dropped the hardcoded `-ar 44100` output option. Previously every recording was resampled from whatever rate the DirectShow device negotiated (commonly 48kHz on Windows) down to 44.1kHz via swresample, even for WAV output — so "WAV (lossless)" wasn't actually bit-faithful to the source. Both WAV and the MP3/LAME encoder handle 48kHz natively, so the capture now preserves the device's native sample rate.
- **MP3 encoding uses ABR instead of CBR** — `AudioRecorder.encodeToMp3` now passes `-abr 1` alongside `-b:a` so LAME targets the selected bitrate in average-bitrate (VBR-style) mode instead of strict constant bitrate. This gives better quality per file size at the same nominal bitrate while keeping the existing bitrate selector (128–320 kbps) meaningful.
- **Re-trim now preserves the original bitrate** — `AudioRecorder.retrimFile` previously re-encoded MP3s at a hardcoded `-q:a 0` (~245kbps VBR) regardless of the file's original bitrate, so trimming a 128kbps recording would balloon it to ~245kbps. It now probes the source file's nominal bitrate via ffmpeg's stream info and re-encodes at that same bitrate (ABR), falling back to 192kbps only if probing fails.
- **Debug-only PowerShell scripts no longer ship in production builds** — `electron-builder.yml`'s `extraResources` filter bundled every `scripts/**/*.ps1` file, pulling the dev-only `gsmtc_probe.ps1` and `debug_art.ps1` diagnostic tools into the packaged app. The filter now lists only `gsmtc.ps1` and `gsmtc_loop.ps1`, the two scripts `GsmtcService` actually invokes at runtime.
- **Recording/error coral now repaints correctly in Tron mode, and meets contrast in light mode** — The "recording" coral (`#d9826f`) and related accents were hardcoded as Tailwind arbitrary hex values in `RecordButton.tsx` and `RecordingLog.tsx` instead of living in `index.css` alongside the amber scale.
- **Pinned the package manager to pnpm** — Added `"packageManager": "pnpm@10.32.1"` to `package.json` and switched `build:win` to call `pnpm run build`. `.npmrc`'s `shamefully-hoist` is a pnpm-only setting; running scripts with plain `npm` (as `build:win` did internally) triggered a `npm warn Unknown project config "shamefully-hoist"` on every invocation. Use `pnpm`, not `npm`, for scripts in this repo.
- **Copyable text in read-only path/error fields** — The app-wide `user-select: none` in `index.css` (for the native-app feel) also blocked selecting the Output Folder and ffmpeg-path inputs, the "Auto-detected: …" hint, and the Recording Log's error-tooltip text — exactly the strings a user would want to copy into a search or bug report. Added `select-text` to those specific fields in `SettingsPanel.tsx`, `OnboardingWizard.tsx`, and `RecordingLog.tsx` so they remain selectable while the rest of the UI stays non-selectable.

### Removed

- **Dead `compact` variant of `RecordButton`** — Removed the unused `compact` prop and its ~35-line alternate rendering branch. It defaulted to `false` and no caller ever passed `true`, so it was a second design to maintain with no current purpose.

### Security

- **Renderer runs sandboxed** — `sandbox: false` in the `BrowserWindow`'s `webPreferences` is now `sandbox: true`. The preload script only uses `contextBridge`/`ipcRenderer` (no other Node built-ins), which Electron's sandboxed preload context fully supports, so this is a defense-in-depth tightening with no functional change: the renderer already had no `nodeIntegration` and all main-process access already went through the `contextBridge` API surface.
- Bump electron & vite; add pnpm overrides

## [2.4.0] - 2026-04-03

### Added

- **Interactive Song Trim Modal** — A `SongTrimModal` dialog lets you visually preview and adjust the start and end points of any saved recording before committing to the file. Open it by hovering a recording entry and clicking the scissors icon. The modal decodes the audio with the Web Audio API and draws a live waveform, with two draggable amber handles that control the trim region. Clicking the waveform area also moves the nearest handle. A "Preview trim" playback button auditions the selected segment using an `AudioBufferSourceNode`.
- **Trim preset system** — After adjusting a song's trim you can check "Save as preset for future recordings". The offsets (start and end trim amounts) are stored per song identity (`artist|||title`) in `trim-presets.json` in the app's userData folder. A "global default" preset (apply to all songs) is also available via a second checkbox. Presets are automatically applied in `TrackSplitter._finalizeStoppedRecording` so recurring songs are trimmed correctly without any manual steps. An existing preset badge with a delete button is shown in the modal header.
- **`TrimPresetsStore` service** — New `src/main/services/TrimPresetsStore.ts` provides `getTrimPreset`, `saveTrimPreset`, `deleteTrimPreset`, and `loadAllTrimPresets`.
- **`AudioRecorder.retrimFile()`** — New static method re-encodes a saved MP3 or trims a WAV in-place to the exact `[startSec, endSec]` range using ffmpeg (MP3 preserves ID3 metadata via `-map_metadata 0`).
- **`autotape-audio://` Electron protocol** — Registered alongside `autotape-art://` to serve local audio files to the renderer's Web Audio API without needing `webSecurity: false`.
- **IPC trim handlers** — `trim:apply`, `trim:get-preset`, `trim:get-all-presets`, `trim:save-preset`, `trim:delete-preset` registered in the main process and exposed on `window.electronAPI`.
- **README screenshots** — Added a light/dark screenshot table at the top of `README.md` (images expected at `docs/screenshots/app-light.png` / `app-dark.png`).
- **README Audio Trimming section** — New dedicated section in `README.md` documents the waveform trim editor with drag-to-select, per-song presets, global presets, and in-place re-encode behaviour. Includes a screenshot (`docs/screenshots/trim-editor.png`).

### Changed (UI)

- **Recordings/Settings panel redesign** — Replaced the pill-style tab widget with a clean underline navigation bar (borderless separator line, active tab highlighted with an amber bottom indicator). The right panel card now has zero top padding so the tab navigation sits flush at the card edge. Recording list rows gained a left amber accent bar on hover, a subtle `ring-1` on album art thumbnails, and tighter typography (`13px` title / `11px` artist with `leading-snug`). Duration stamps use `tabular-nums` mono for stable column alignment. The empty state was redesigned with a framed icon container and smaller, more precise copy.

### Changed

- **Zoomable waveform in Trim Modal** — The waveform now supports up to 40× zoom via scroll wheel (centred on the cursor), a draggable zoom slider, and `+` / `−` buttons. A reset-to-full-view button appears when zoomed. Dragging a handle near the left or right edge auto-pans the view, and holding the middle mouse button drags to pan manually.
- **Relative trim offsets displayed** — The time labels below the waveform now show both absolute timestamps (`0:01.3`) and relative offsets from the file boundaries (`+1.300s from start` / `−0.500s from end`). The "Save as preset" checkbox label also shows the computed offset pair, and the existing-preset badge in the modal header now displays the stored offsets (e.g. `+0.300s / −0.500s`) instead of just "Preset saved", making it immediately clear the preset will work across different-length songs.

### Fixed

- **electron-builder config validation** — Fixed build failure caused by unsupported `portable` options in `electron-builder.yml` (`shortcutName`, `uninstallDisplayName`, `createDesktopShortcut`). These keys were removed to match `electron-builder` 26.x schema so Windows builds succeed again.
- **Trim modal contrast in light theme** — Amber color tokens (`--amber-300` through `--amber-700`) were hardcoded in `@theme inline` and did not swap for the light theme, leaving warm-cream labels (`#e2b59a`) on a parchment modal background (≈1.6:1 — WCAG fail). Tokens are now declared per-theme in `:root` and `[data-theme="light"]` and referenced via CSS variables in `@theme inline`. Light-mode values use dark brown tones (`amber-400: #7c5c4a`, 5.5:1) that meet WCAG AA for all text sizes. The `--z-600` muted-text token in the light theme was also adjusted from `#8a6a56` to `#836050` to achieve a 5.1:1 ratio, clearing AA for 10 px labels.

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
