# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.5] - 2026-08-23

### Changed

- **"Skipped" and "Error" labels in the recording list are easier to spot at a glance** — They now use the same bold, uppercase style as other status labels in the app instead of small plain text that blended in with timestamps and other fine print.
- **Tooltips now have a small pointer connecting them to what they're describing, and a bit more visual lift** — Helpful once several small icon-only buttons sit close together, like the zoom controls in the trim editor or the trim/open-folder buttons in the recording list.
- **The recording time in the recording list could be mistaken for the duration next to it** — Both were shown as plain "M:SS"-style numbers with nothing to tell them apart, especially on 24-hour clocks. The recording time now has a small clock icon in front of it.
- **The recording list's timestamp/status and its Trim/Open buttons ran together as one cluster** — There was no visual break between "what happened to this recording" and "what you can do about it." A bit more space now separates the two groups.
- **The recording time's tooltip used a plain unstyled browser tooltip instead of the app's own tooltip style**, and **the Trim/Open buttons showed no hover highlight, just a faint color shift** — both easy to miss. The time now shows the app's styled tooltip with the full date, and both buttons get a visible background highlight on hover.

### Fixed

- **Keyboard users could tab out of first-time setup into the app behind it** — Since setup can't be skipped on a first run, this meant the very thing it was supposed to prevent. Keyboard focus now stays inside the setup window until it's completed or closed. The same fix now applies to the trim editor and the "no audio detected" warning.
- **The dark/light mode toggle had no label for screen readers** — It announced only as "button" with no indication of what it did. It now announces "Switch to light mode" or "Switch to dark mode".
- **The spinning record button, recording pulse ring, and playing equalizer bars ignored your system's reduced-motion setting** — If you have "reduce motion" turned on in Windows, these now hold still (or show a static snapshot) instead of animating continuously, while still showing the same information at a glance.
- **Previewing a trim on a long recording could make playback stutter** — The trim editor's waveform was being fully recalculated on every single frame while a preview played, not just when you zoomed or scrolled it. That work is now only redone when the view actually changes, so playback stays smooth.
- **The sidebar's "Click to record" label could get cut off at the smallest window size** — At the app's minimum size, the album art and record button left no room for the status text below them. The sidebar now compacts itself at small window heights so nothing gets clipped.
- **Screen reader users had no quick way to jump between the title bar, the Now Playing/record pane, and the Recordings/Settings pane** — The window now exposes proper header/main landmarks plus labeled sections for each pane, so navigating by region or heading works like it does in other apps.
- **Starting your very first recording briefly showed a confusing "No matches, nothing found for ''" message** — while that first recording was still being saved and the list had nothing else in it yet. The list now just shows the in-progress recording, with no stray message underneath.
- **Screen reader users couldn't jump straight to the Output, Source, Behavior, or Advanced sections in Settings** — Those section labels were plain text, not real headings. They're now proper headings, so heading-navigation works there too.

## [2.5.4] - 2026-08-18

### Changed

- **Settings is now organized into groups** — Output, Source, Behavior, and an Advanced section for the rarely-touched ffmpeg path and setup wizard, instead of nine settings all sitting in one flat list.
- **Recording rows now show when they were captured**, not just how long they are.
- **Settings' audio device list now highlights recommended virtual-cable devices**, matching the same grouping first-time setup already used.

### Fixed

- **The trim editor's start/end handles couldn't be used without a mouse** — Keyboard users could zoom into a recording but had no way to actually set a trim point. The handles can now be tabbed to and nudged with the arrow keys (hold Shift for bigger steps).
- **Settings labels didn't match the rest of the app** — Field labels in Settings ("Output Folder", "Format", "Bitrate", etc.) were larger and styled differently from every other section label in the app. They now match.
- **A few small text labels were smaller than the rest of the app's fine print** — Bumped up to match.
- **Reopening first-time setup from Settings had no way out** — If you opened "Setup" to re-check your device or folder, you had to click through every step to close it. It can now be closed at any time with the X or Escape key (the very first setup still can't be skipped).
- **First-time setup's last button said "Start recording" but didn't start one** — It only closed the setup window. Renamed to "Finish setup" so it says what it actually does.
- **Setup didn't warn early enough about needing a virtual audio cable** — If no virtual cable was found on your PC, the device list showed no guidance until after you'd already picked something. It now explains upfront, before you choose, with a link to get one.
- **The Now Playing artwork glow used the wrong color in light mode** — It was hardcoded to the dark-theme accent color, so it looked off after switching to light mode. It now follows the current theme correctly.
- **The ffmpeg "auto-detect" button in Settings could silently clear a working custom path** — Clicking it always reset your custom ffmpeg location, even if detection came up empty. It now only resets it when detection actually finds something.

## [2.5.3] - 2026-08-17

### Added

- **Search box in the recording list** — Type a title or artist to quickly filter down to it once you've recorded a lot of tracks.

### Changed

- **Recording list rows got a visual refresh** — Bigger album art, a distinct card look for each row, and better-aligned status icons.
- **Successful recordings no longer show a checkmark icon** — Only skipped and failed recordings get a status icon now; a clean recording is shown by its absence, keeping the list quieter.
- **The recording list stays fast no matter how large your archive gets** — Previously, a list of thousands of recordings could take several seconds to open and make searching feel sluggish. The list now only renders what's on screen, so it opens and searches instantly regardless of how many recordings you've saved.
- **A freshly saved recording now settles into the list with a brief glow** — When a track finishes saving, it now visibly lands at the top of the list with a soft highlight, instead of just silently appearing.
- **Small uppercase labels in the recording list now match in size** — "RECORDINGS", "NO TRACKS YET", "NO MATCHES", and "CLEAR SEARCH" previously rendered at three slightly different sizes; they're now consistent.

### Fixed

- **A long track title or artist name broke the whole recording list** — If one recording had a very long title, every row in the list would stretch far past the visible area, pushing the duration, status, and Trim/Open buttons off-screen. Long titles now truncate correctly instead.
- **Trim and Open-folder buttons were invisible when reached by keyboard** — Tabbing to these buttons showed no visual indication they were focused. They now show a focus ring.
- **Searching while a recording was still saving could hide the "no matches" message** — If nothing matched your search while a track was actively being saved, you'd see no explanation and no way to clear the search. Both now show correctly at the same time.
- **Recording rows had no visible margin from the panel edge** — Rows could sit flush against the panel's border on the left, right, and bottom. They now keep a consistent gap on every side, matching the search bar above them.
- **Recordings over an hour showed a wrong-looking duration** — A recording over 59:59 (e.g. a long DJ mix) showed as "125:30" instead of "2:05:30".
- **Long titles or artist names had no way to see the full text** — Hovering a truncated title or artist now shows the full text in a tooltip.
- **Trim and Open-folder buttons were easy to miss** — They only appeared on hover, so their existence wasn't obvious. They now stay faintly visible at all times and brighten on hover or focus.
- **A failed trim save gave no indication anything went wrong** — If saving a trimmed recording failed, the dialog just quietly returned to normal with no message. It now shows what went wrong and lets you try again.
- **The first-run setup window now appears with a bit of polish** — It used to pop in instantly; it now fades and settles in like every other dialog in the app.
- **The "no audio detected" warning used the wrong color and tone** — It looked the same as a routine notice instead of a warning, and read like generic software copy. It's now shown in the app's warning color with copy that matches the app's voice.
- **The trim editor's checkboxes didn't match the rest of the app** — "Save as preset" and "Apply as global default" used plain browser checkboxes instead of the app's usual toggle switches, and the Save button used the wrong accent color. Both now match the rest of the app.

## [2.5.2] - 2026-08-16

### Added

- **"Encoding…" indicator while a recording is being saved** — After a track finishes, saving it to MP3/WAV now briefly shows a spinner in the recording list instead of appearing to do nothing until the file shows up.

### Changed

- **Now-playing detection uses less background CPU** — Autotape now reacts to song changes, pauses, and skips using Windows' own media notifications instead of checking many times per second in the background.

### Removed

- **The hidden "type TRON" theme easter egg** — Typing "tron" no longer switches the app into its secret Tron-styled look.

### Fixed

- **Trim preview showed "failed to fetch" instead of loading the waveform** — In an installed (non-dev) build, opening the trim tool to preview and trim a recording could fail immediately with a generic "failed to fetch" error instead of showing the waveform. Recordings are now read directly rather than through a fetch that could be blocked in this situation, so the trim preview loads reliably.
- **Typing in Settings could briefly stutter** — Editing the output folder or ffmpeg path fields saved to disk on every keystroke. Saves are now grouped together and written a moment after you stop typing, so nothing is lost but typing stays smooth.
- **Hardened saved-file naming against unusual track metadata** — Song titles/artists come from whatever app is playing music, so a file name is now double-checked to always land inside your chosen output folder no matter what characters that metadata contains.
- **Hardened album art and audio preview loading** — The internal links used to load album art and audio previews are now double-checked to only ever load files from the app's own temporary folder.
- **Background recording process could be left running after closing the app** — In some cases, quitting Autotape didn't stop the background audio-capture process, leaving it running unseen. It's now always stopped when the app quits.
- **Saving song info (title/artist/cover art) into a file could briefly stall the app** — Writing this info, especially with large cover art, now happens without blocking the rest of the app.
- **A quickly replayed song could silently overwrite its own earlier recording** — If the same track was recorded twice in close succession (e.g. played again right after finishing), the second save could land on the exact same file name as the first while it was still being written, losing one of the two recordings instead of saving both.
- **Recordings could lose a small sliver of audio right at the start of a song** — When a track change was detected before the new song's title had arrived yet, Autotape briefly assumed the new song hadn't started playing at all, which could trim slightly too much off the beginning once it saved. It now uses the actual reported playback position, so the trim lines up correctly.

## [2.5.1] - 2026-08-15

### Added

- **Trimming a recording no longer double-compresses MP3s** — If you trim an MP3 shortly after it's recorded, Autotape now uses the original uncompressed audio behind the scenes instead of re-compressing the already-compressed file a second time, avoiding an extra generation of quality loss. The original audio is kept temporarily and cleaned up automatically after a while; if it's no longer available, trimming still works exactly as before and you'll see a warning that quality may be slightly reduced.

### Removed

- **"Capturing" track box during recording** — The small box showing the artist and title of the track currently being captured has been removed from below the record button.

### Fixed

- **Track-detection process could restart in a tight, endless loop** — If the background process that reads currently-playing track info kept failing to start (for example, blocked by antivirus or a PowerShell execution policy), it would retry every second forever. It now waits longer between each failed retry (up to 30 seconds) and gives up with an error message after 10 failures in a row, instead of retrying indefinitely.
- **Giving up after repeated failures could be silently undone** — After the track-detection process gave up, changing the app/source filter in Settings could unintentionally kick off a fresh unbounded retry loop instead of staying stopped.

## [2.5.0] - 2026-07-12

### Added

- **App version now shown in Settings** — The Settings panel footer displays "Autotape 3000 v{version}", read via a new `app:get-version` IPC channel (`app.getVersion()`) exposed through the preload bridge as `getAppVersion()` and a `useAppVersion()` hook. Previously there was no way to check which build was installed from within the app itself.

### Fixed

- **Title bar overlay briefly flashed light on a dark-themed launch** — `createWindow()` hardcoded a light `titleBarOverlay` in the `BrowserWindow` constructor; the correct color only arrived later via the renderer's `useEffect([theme])`, which runs after the window's first frame is already composited and shown. Added `src/main/services/ThemeStore.ts` (persists the user's chosen theme to `theme.json` in `userData`, mirroring `SettingsStore`'s pattern) and two IPC channels: `theme:get` — resolves the persisted theme, falling back to `nativeTheme.shouldUseDarkColors` — and `theme:save`. `createWindow()` now uses `resolveInitialTheme()` for the initial overlay colors, and `App.tsx`'s theme effect calls `saveTheme()` alongside its existing `setTitleBarOverlay()` call so the next launch's initial overlay always matches the last chosen theme instead of a hardcoded default.
- **`package.json` version was frozen at `2.0.0` since project scaffolding** — Every release since has been tracked in `changelog.md` but never reflected in `package.json`, so `app.getVersion()` (and anything else reading the package version) would have reported a version 5 releases stale. Bumped to `2.5.0` to match this release.
- **Pre-existing `tsc` errors surfaced while touching these files** — `SettingsPanel.tsx` had an unused `useCallback` import; `SongTrimModal.tsx`'s `drawWaveform` computed an unused `clrAmberDim` color that was never applied to the canvas (the cut-region wash overlay already de-emphasizes those areas); `test/setup.ts` referenced the ambient `beforeEach` global without importing it, which only worked at runtime (vitest's `globals: true`) but not under `tsc --noEmit`. Removed the two dead values and added the missing `import { beforeEach } from 'vitest'`, matching every other test file's explicit-import style.

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
