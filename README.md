# Autotape 3000

Autotape 3000 is a Windows desktop audio recorder that automatically captures music from media players and converts it to MP3, with each track saved as a separate file.

<div align="center">
    <img src="image.png" alt="alt text" />
</div>

## Features

- **Audio recording** — capture from any input device (including virtual cables like VB-CABLE) with configurable sample rate, channels, and bit depth (16-bit, 24-bit, 32-bit float).
- **Media player auto-record** — automatically starts and stops recordings on track changes using the Windows Global System Media Transport Controls (GSMTC) API. Works with any GSMTC-registered media player. Each recording is named after the track being played.
- **WAV-to-MP3 conversion** — optional post-save conversion via LAME, with configurable bitrate (96–320 kbps) and quality presets. MP3 files are tagged with artist, title, album, and cover art (ID3) when metadata is available via GSMTC.
- **Cover art** — pulled automatically from the GSMTC thumbnail stream or manually selected via a fullscreen region picker.
- **Real-time waveform visualization** — displays a smooth, scrolling RMS waveform in real time during recording, providing immediate visual feedback on audio levels and activity.
- **Track label** — the currently recording track title is shown prominently above the waveform while a recording is active.
- **Recording log** — a timestamped history of every recording outcome (Saved / Skipped / Error), showing the track name and duration. Status entries are colour-coded green, amber, and red.
- **Deferred stop** — pressing Stop while auto-record is on sets a *Stopping after song…* state. The recording continues and stops cleanly when the current track ends. A second press stops immediately.
- **Duplicate handling** — configurable behaviour when a file already exists: skip, overwrite, or append a number suffix.
- **Minimum duration filter** — recordings shorter than a configurable threshold are automatically discarded.
- **Persistent settings** — all settings are saved to `settings.json` and restored on next launch.
- **Frameless window** — custom title bar with native Aero Snap support.


## Why Autotape 3000

Unlike playlist downloaders that grab tracks from sources like YouTube, Autotape 3000 captures the exact audio you play in your media player - no ads, intros, or unwanted segments. You get a true-to-playback recording, every time.

- **Track accuracy:** You get the precise version, mix, or edit from your playlist - no mismatches or incorrect tracks.
- **Consistent quality:** Recordings are made at the original playback quality, not limited by YouTube's compression or variable sources.
- **Metadata and cover art:** Tracks are tagged with the correct artist, title, album, and artwork as reported by the media player.

Playlist downloaders cannot guarantee the track will be the exact version you want, and all downloads are subject to the quality and metadata available on sources like YouTube. Autotape 3000 ensures your recordings match your actual listening experience.

**Trade-off:** Autotape 3000 records in real time - capturing a 4-minute song takes 4 minutes. While slower than downloading, this approach ensures you get the exact version and quality you hear in your media player. Just let it run in the background while you enjoy your music; no extra interaction is needed.


## Requirements

- Windows 10 or later (GSMTC and WASAPI are Windows-only)
- Python 3.11+

## Installation

1. Clone or download the repository.

2. Double-click **`run.bat`** — it installs all dependencies and launches the app automatically.

> **Manual alternative** — if you prefer the command line:
> ```bash
> pip install -r requirements.txt
> python main.py
> ```

> [!NOTE]
> Python 3.11 or later must be installed and added to `PATH`. Download it from [python.org](https://www.python.org/downloads/) and check **"Add Python to PATH"** during setup.

## Project Structure

```
autotape-3000/
├── main.py                  # Entry point
├── requirements.txt
├── settings.json            # Persisted settings (auto-generated)
├── core/
│   ├── recorder.py          # Audio capture (sounddevice / soundfile)
│   └── converter.py         # WAV-to-MP3 conversion (lameenc / mutagen)
├── gui/
│   ├── recorder_app.py      # Main application window (PyQt6)
│   ├── region_selector.py   # Fullscreen region picker overlay
│   ├── theme.py             # Color constants and Qt stylesheet
│   ├── titlebar.py          # Custom frameless title bar
│   └── waveform.py          # Real-time waveform widget
├── services/
│   └── media_session.py     # GSMTC media session integration
└── utils/
    └── filename.py          # Filename sanitization helpers
```

## Usage

The main window is organised into four tabs above the always-visible waveform and recording controls.

### Log tab

A live table of every recording outcome. Each row shows the time, status (Saved / Skipped / Error), track name, and duration. Rows are appended automatically after each save attempt; status cells are colour-coded for quick scanning.

### Record tab

Select the audio input device and output folder here. Use the **Refresh** button to re-enumerate devices after connecting new hardware.

### Export tab

Configure the audio format (sample rate, channels, bit depth), MP3 export options (bitrate and quality preset), and cover art. Cover art can be sourced automatically from the media player's GSMTC thumbnail (**Song cover**) or captured from any region of the screen using the fullscreen **Pick region** picker.

### Automation tab

- **Auto-record tracks** — enable to start and stop recordings automatically on each track change from any GSMTC-registered media player.
- **Duplicate handling** — choose what happens when a file with the same name already exists: skip the recording, overwrite the existing file, or append a number suffix (e.g. `Song (2).mp3`).
- **Minimum duration** — set a MM:SS threshold; recordings shorter than this are discarded automatically.

### MP3 conversion

1. Open the **Export** tab and check **Convert to MP3**.
2. Choose a bitrate and quality preset.
3. After each recording is saved as WAV it is converted to MP3, tagged with available metadata, and the source WAV is removed.

### Manual recording

1. Open the **Record** tab and select an input device from the **Device** dropdown.
2. Set an output folder.
3. Configure the audio format on the **Export** tab as needed.
4. Press **Record** to start and **Stop** to finish.

## Recommended Setup

For the cleanest, most reliable audio capture from other applications, use a virtual audio cable driver such as [VB-CABLE](https://vb-audio.com/Cable/). VB-CABLE lets you route audio output from any program directly into Autotape 3000 as an input device. This ensures:

- No background noise or microphone interference
- No system sounds or notifications in your recordings
- Bit-perfect digital audio transfer between apps

**How to use:**
1. Download and install VB-CABLE from the [official site](https://vb-audio.com/Cable/).
2. Set your desired application's output to "CABLE Output" (the virtual cable).
3. In Autotape 3000, select "CABLE Output" as the input device.
4. Record as usual - only the routed application's audio will be captured.

## Dependencies

**Thank you to the authors and maintainers of these excellent open source libraries:**

| Package | Purpose |
|---|---|
| `sounddevice` | Audio input capture |
| `soundfile` | WAV file reading / writing |
| `numpy` | Audio buffer processing |
| `lameenc` | MP3 encoding via LAME |
| `mutagen` | ID3 tag writing |
| `PyQt6` | GUI framework |
| `Pillow` | Image handling and screen capture |
| `winrt-*` | Windows GSMTC (media player metadata / cover art) |
