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


def convert_wav_to_mp3(wav_path: str, mp3_path: str, bitrate: int, quality: int) -> float:
    """Convert a WAV file to MP3 and return the duration in seconds."""
    import numpy as np  # noqa: PLC0415
    import lameenc  # noqa: PLC0415

    data, samplerate = sf.read(wav_path, always_2d=True)

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
