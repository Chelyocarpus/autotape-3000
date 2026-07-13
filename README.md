# Autotape 3000

| Light | Dark |
|-------|------|
| ![App — light theme](docs/screenshots/app-light.png) | ![App — dark theme](docs/screenshots/app-dark.png) |

A Windows desktop app that records system audio track by track. It watches the Windows **Global System Media Transport Controls (GSMTC)**, the same API behind taskbar controls and browser media players, and splits recordings every time the track changes. GSMTC also supplies the metadata (artist, title, album, cover art), so the source app must expose that information for tagging to work.

> [!IMPORTANT]
> Windows 10 / 11 only. GSMTC and DirectShow audio capture are Windows-exclusive features.

---

## Features

- **Per-track recording**: starts and stops on every track change, no manual splitting needed
- **Any GSMTC source**: music streaming apps, browser players, or anything else that exposes media controls
- **Isolated app capture**: on Windows 10 2004+ (build 19041+), captures only the currently playing app's audio via WASAPI process-loopback, no virtual audio cable needed
- **DirectShow fallback**: on older Windows, or for apps that can't be resolved, capture from any DirectShow audio device via ffmpeg
- **Warm pre-roll recorder**: ffmpeg stays running in the background to eliminate spawn latency on track changes
- **ID3 metadata & album art**: artist, title, album, and cover art embedded on save, left untagged if the source doesn't expose metadata
- **MP3 and WAV output**: configurable format and bitrate (128-320 kbps)
- **Audio trimming**: drag-to-select waveform editor with per-song and global presets, re-encodes in place
- **Session filter**: lock recording to a specific source, or follow whichever app is active
- **Duplicate handling**: skip, overwrite, or auto-increment filenames
- **Minimum save duration**: discard clips below a threshold you set
- **Two-click stop**: clicking Stop mid-song waits for the track to end before stopping; click again to stop right away
- **Pause-tolerant recording**: a short pause doesn't split the file, recording just picks back up; a pause past a configurable timeout stops and discards the clip

---

## Requirements

| Requirement | Notes |
|---|---|
| Windows 10 / 11 | GSMTC + DirectShow audio capture |
| Windows 10 2004 (build 19041) or later | Required for automatic isolated app capture; older builds fall back to manual DirectShow device selection |
| ffmpeg | Bundled automatically; a system install is used as a fallback |

---

## Getting Started

1. Download the latest release from the [Releases](https://github.com/Chelyocarpus/autotape-3000/releases) page: `Autotape3000-setup.exe` for the installer, or `Autotape3000-portable.exe` for the portable version (no install needed).
2. Run the installer or launch the portable executable. No admin rights required.
3. On first launch, a setup wizard walks you through picking an audio device and output folder.
4. Hit the record button, then play music in any GSMTC-enabled app. Recordings split with each track change.

> [!NOTE]
> ffmpeg is bundled with the app. If the bundled binary fails, install [ffmpeg](https://ffmpeg.org/download.html) separately and point the app to it in **Settings → ffmpeg Binary**.

---

## Audio Device Setup

### Isolated app capture (default, Windows 10 2004+ / build 19041+)

By default, Autotape 3000 captures only the audio of the app currently reporting a track via GSMTC: no virtual audio cable, no manual routing. This uses the Windows WASAPI **process-loopback** API (`ActivateAudioInterfaceAsync` with `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`), the same mechanism behind OBS's "Application Audio Capture" source, via a small bundled native helper (see [Development](#development)).

This requires **Windows 10 build 19041 (version 2004) or later**, and currently only resolves win32 desktop apps (not Store/UWP-packaged apps) to a process.

In Settings, this is two linked controls: **Media Source** picks *which app* to follow (for track detection, artwork, and — in this mode — audio), and **Audio Capture Method** picks *how* to record it. Audio Capture Method shows "Isolated — follows Media Source" as an option only when process-loopback is supported; selecting it always captures whatever app Media Source currently resolves to, not a separately-chosen app.

### Manual / fallback: virtual audio cable

On Windows 10 versions older than build 19041 (version 2004), or for apps process-loopback can't resolve, route your music app through a virtual audio cable and point Autotape 3000 at that device instead.

**Recommended: [VB-Cable Virtual Audio Device](https://vb-audio.com/Cable/)** (free)

1. Install VB-Cable and set **CABLE Output** as your default playback device in your music streaming app of choice.
2. In Autotape 3000, select **CABLE Output** as the audio device in Settings.
3. Audio played on your system will now be captured directly.

> [!TIP]
> If you want to hear audio while recording, enable "Listen to this device" on CABLE Output in Windows Sound settings, or use VB-Cable's companion app [VoiceMeeter](https://vb-audio.com/Voicemeeter/) for more flexible routing.

---

## Audio Trimming

Every recorded track can be trimmed after it has been saved. Open a track from the **Recording Log** to launch the waveform editor.

![Audio trimming editor](docs/screenshots/trim-editor.png)

- **Drag to select** the region you want to keep directly on the waveform
- **Per-song presets**: save a trim range for a specific track and reuse it on re-encode
- **Global presets**: apply the same head/tail trim to every track, useful for consistent intros/outros
- Re-encodes the file in place; the original is not kept

---

## Configuration

All settings are in the **Settings** tab:

| Setting | Default | Description |
|---|---|---|
| Output folder | `~/Music/Autotape 3000` | Where recordings are saved |
| Format | `mp3` | `mp3` or `wav` |
| Bitrate | `320 kbps` | MP3 only |
| Media Source | `auto` | Which app to follow, for metadata and (in Isolated mode) audio |
| Audio Capture Method | `Isolated` (Windows 10 2004+ / build 19041+) | Records the Media Source app's audio directly, or a DirectShow device as a fallback |
| Min save duration | `0 s` | Discard clips shorter than this |
| Discard after paused | `60 s` | Stop and discard the recording once playback has stayed paused this long; `0` disables |
| Duplicate action | `increment` | `skip`, `overwrite`, or `increment` |
| ffmpeg binary | _(auto)_ | Leave blank to auto-detect |

---

## Development
This is optional and not needed to run the app, but if you want to build from source or contribute, here are the instructions:

```bash
pnpm install      # install dependencies
pnpm dev          # start dev server with HMR
pnpm build:win    # build + package Windows installer → dist/
```

`pnpm dev` runs against the isolated-app-capture helper only if you've built it (see below); otherwise it falls back to the DirectShow device picker. `pnpm build:win` requires the helper to be built first — it runs `pnpm build:native` automatically.

### Native helper (`native/loopback-capture`)

The isolated app capture feature is implemented by a small Rust binary using the [`wasapi`](https://crates.io/crates/wasapi) crate, spawned by the main process and piped into ffmpeg for encoding. Building it requires the [Rust toolchain](https://rustup.rs/) (`rustup`) — end users never build it themselves, they get the prebuilt binary bundled in releases, the same way ffmpeg is bundled via `@ffmpeg-installer/ffmpeg`.

```bash
pnpm build:native   # cargo build --release, then copies the binary into resources/native/
```

---

## Tech Stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://evite.netlify.app/)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/)
- [Radix UI](https://www.radix-ui.com/) + [Tailwind CSS](https://tailwindcss.com/) v4
- [node-id3](https://github.com/Zazama/node-id3) — ID3 metadata tagging
- [@ffmpeg-installer/ffmpeg](https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg) — bundled ffmpeg binary
- PowerShell + WinRT — GSMTC integration
- Rust + [`wasapi`](https://crates.io/crates/wasapi) — native WASAPI process-loopback capture helper
