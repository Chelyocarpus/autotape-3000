"""WAV to MP3 conversion logic."""

import soundfile as sf

BITRATES: list[int] = [96, 128, 160, 192, 256, 320]
DEFAULT_BITRATE: int = 192

QUALITY_OPTIONS: dict[str, int] = {
    "Best (slowest)": 2,
    "Good": 5,
    "Fast": 7,
}
DEFAULT_QUALITY: str = "Good"

# Target integrated loudness used by major streaming platforms (EBU R128 / AES streaming).
LUFS_TARGET: float = -14.0


def _peak_normalization_gain(data, lufs_target: float) -> float:
    """Compute a linear gain scalar that approximates the LUFS target.

    Uses a simple RMS-based estimate: LUFS ≈ RMS_dBFS + 0.691 (a close
    empirical offset for typical programme material).  This is not a true
    ITU-R BS.1770 measurement but is always safe — the result is clamped so
    the output never clips.
    """
    import numpy as np  # noqa: PLC0415

    rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
    if rms < 1e-9:
        return 1.0  # silence — nothing to do
    rms_dbfs = 20.0 * np.log10(rms)
    estimated_lufs = rms_dbfs - 0.691
    gain_db = lufs_target - estimated_lufs
    gain_linear = 10.0 ** (gain_db / 20.0)
    # Clamp: never exceed what the signal can hold without clipping.
    peak = float(np.max(np.abs(data)))
    if peak > 0:
        gain_linear = min(gain_linear, 1.0 / peak)
    return gain_linear


def convert_wav_to_mp3(
    wav_path: str,
    mp3_path: str,
    bitrate: int,
    quality: int,
    normalize_lufs: bool = False,
) -> float:
    """Convert a WAV file to MP3 and return the duration in seconds.

    When *normalize_lufs* is ``True`` a peak-normalization gain is applied
    that targets :data:`LUFS_TARGET` (-14 LUFS) using an RMS-based
    approximation before int16 quantisation.  The gain is clamped so the
    output never clips.
    """
    import numpy as np  # noqa: PLC0415
    import lameenc  # noqa: PLC0415

    data, samplerate = sf.read(wav_path, always_2d=True)

    if normalize_lufs:
        gain = _peak_normalization_gain(data, LUFS_TARGET)
        data = data * gain

    # lameenc expects int16 PCM
    pcm = (data * 32767).astype(np.int16)

    channels = pcm.shape[1]
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate)
    encoder.set_in_sample_rate(samplerate)
    encoder.set_channels(channels)
    encoder.set_quality(quality)
    encoder.silence()

    # Encode in one shot; lameenc wants interleaved samples as bytes
    mp3_data = encoder.encode(pcm.tobytes())
    mp3_data += encoder.flush()

    with open(mp3_path, "wb") as fh:
        fh.write(mp3_data)

    duration = len(data) / samplerate
    return duration


def write_mp3_tags(
    mp3_path: str,
    artist: str,
    title: str,
    cover_art: bytes | None = None,
    album: str = "",
) -> None:
    """Write ID3 artist, title, album, and optional cover-art tags to an existing MP3 file."""
    try:
        from mutagen.id3 import APIC, ID3, ID3NoHeaderError, TALB, TIT2, TPE1  # noqa: PLC0415
        try:
            tags = ID3(mp3_path)
        except ID3NoHeaderError:
            tags = ID3()
        if artist:
            tags["TPE1"] = TPE1(encoding=3, text=artist)
        if title:
            tags["TIT2"] = TIT2(encoding=3, text=title)
        if album:
            tags["TALB"] = TALB(encoding=3, text=album)
        if cover_art:
            mime = "image/png" if cover_art[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
            tags["APIC:Cover"] = APIC(
                encoding=0,
                mime=mime,
                type=3,
                desc="Cover",
                data=cover_art,
            )
        tags.save(mp3_path)
    except Exception:  # noqa: BLE001
        pass
