"""Audio recorder module using sounddevice and soundfile."""

import threading
from collections.abc import Callable

import sounddevice as sd
import soundfile as sf
import numpy as np


DEFAULT_SAMPLERATE = 48000
DEFAULT_CHANNELS = 2


class BitDepth:
    """Maps a human-readable label to a sounddevice dtype and a soundfile PCM subtype.

    sounddevice has no int24 dtype; 24-bit audio is captured as int32
    (the device places 24 significant bits in the most-significant bytes)
    and written by soundfile as PCM_24.
    """

    def __init__(self, label: str, dtype: str, sf_subtype: str) -> None:
        self.label = label
        self.dtype = dtype
        self.sf_subtype = sf_subtype

    def __repr__(self) -> str:
        return f"BitDepth({self.label!r})"


BIT_DEPTHS: list[BitDepth] = [
    BitDepth("16-bit",       "int16",   "PCM_16"),
    BitDepth("24-bit",       "int32",   "PCM_24"),
    BitDepth("32-bit float", "float32", "FLOAT"),
]

DEFAULT_BIT_DEPTH: BitDepth = BIT_DEPTHS[1]  # 24-bit


class AudioDevice:
    """Represents an audio input/output device."""

    def __init__(self, index: int, name: str, max_input_channels: int, max_output_channels: int):
        self.index = index
        self.name = name
        self.max_input_channels = max_input_channels
        self.max_output_channels = max_output_channels

    def __repr__(self) -> str:
        return f"AudioDevice(index={self.index}, name={self.name!r})"


def _build_friendly_name_map() -> dict[str, str]:
    """Return a prefix-keyed map of full Windows friendly names for capture devices.

    Uses the Windows Core Audio API (via pycaw) – the same approach as NAudio's
    MMDeviceEnumerator / FriendlyName used in spy-spotify. Capture endpoints are
    identified by the '{0.0.1.' segment in their WASAPI device id.

    PortAudio (sounddevice) truncates device names, so every prefix of length >= 10
    is stored as a key so truncated names still resolve to the full friendly name.
    Falls back gracefully to an empty dict if pycaw is unavailable.
    """
    try:
        from pycaw.pycaw import AudioUtilities  # noqa: PLC0415

        name_map: dict[str, str] = {}
        for dev in AudioUtilities.GetAllDevices():
            full_name: str | None = dev.FriendlyName
            if not full_name:
                continue
            # Capture endpoints contain '{0.0.1.' in their WASAPI device id
            if not dev.id or "{0.0.1." not in dev.id:
                continue
            for prefix_len in range(10, len(full_name) + 1):
                name_map.setdefault(full_name[:prefix_len], full_name)
        return name_map
    except Exception:  # noqa: BLE001
        return {}


def get_all_devices() -> list[AudioDevice]:
    """Return all available audio devices with full Windows friendly names where possible."""
    name_map = _build_friendly_name_map()
    return [
        AudioDevice(
            index=i,
            name=name_map.get(dev["name"], dev["name"]),
            max_input_channels=dev["max_input_channels"],
            max_output_channels=dev["max_output_channels"],
        )
        for i, dev in enumerate(sd.query_devices())
    ]


def find_device_by_name(name_fragment: str) -> AudioDevice | None:
    """Return the first device whose name contains the given fragment (case-insensitive)."""
    fragment_lower = name_fragment.lower()
    for device in get_all_devices():
        if fragment_lower in device.name.lower():
            return device
    return None


class Recorder:
    """Records audio from a device in a background thread."""

    def __init__(
        self,
        device: AudioDevice,
        samplerate: int = DEFAULT_SAMPLERATE,
        channels: int = DEFAULT_CHANNELS,
        bit_depth: BitDepth = DEFAULT_BIT_DEPTH,
        data_callback: Callable[[np.ndarray], None] | None = None,
    ):
        self.device = device
        self.samplerate = samplerate
        self.channels = channels
        self.bit_depth = bit_depth

        self._data_callback = data_callback
        self._frames: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._running = False

    @property
    def is_recording(self) -> bool:
        return self._running

    def start(self) -> None:
        """Begin recording in a background thread."""
        if self._running:
            raise RuntimeError("Recording is already in progress.")

        self._frames = []
        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(target=self._record_loop, daemon=True)
        self._thread.start()

    def stop(self) -> np.ndarray:
        """Stop recording and return the captured audio data.

        Waits up to 10 seconds for the record thread to finish.  If PortAudio
        stalls (e.g. the device is unplugged mid-recording), the thread is
        abandoned rather than hanging the caller forever.
        """
        if not self._running:
            raise RuntimeError("No recording is in progress.")

        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10.0)
        self._running = False

        if self._frames:
            return np.concatenate(self._frames, axis=0)
        return np.empty((0, self.channels), dtype=self.bit_depth.dtype)

    def save(self, audio: np.ndarray, filepath: str) -> None:
        """Write audio data to a WAV file using the configured bit depth."""
        sf.write(filepath, audio, self.samplerate, subtype=self.bit_depth.sf_subtype)

    def stop_and_save(self, filepath: str) -> int:
        """Stop recording and save directly to a file. Returns the sample count."""
        audio = self.stop()
        self.save(audio, filepath)
        return len(audio)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _record_loop(self) -> None:
        """Open an InputStream and collect frames until stop() is called."""
        def callback(indata: np.ndarray, frames: int, time, status) -> None:  # noqa: ANN001
            self._frames.append(indata.copy())
            if self._data_callback is not None:
                self._data_callback(indata)

        with sd.InputStream(
            device=self.device.index,
            samplerate=self.samplerate,
            channels=self.channels,
            dtype=self.bit_depth.dtype,
            callback=callback,
        ):
            self._stop_event.wait()
