"""
Windows Global System Media Transport Controls (GSMTC) media session integration.

Provides async and synchronous helpers to query the currently active GSMTC session
for track metadata (title, artist, album, playback state, and cover-art thumbnail),
as well as an event-driven watcher that calls a user-supplied callback whenever the
playback state or track changes.

Requires the ``winrt-Windows.Media.Control`` and ``winrt-Windows.Storage.Streams``
packages on Windows 10 or later.  If those packages are unavailable the module
degrades gracefully: ``_GSMTC_AVAILABLE`` is set to ``False`` and the watcher falls
back to a simple polling loop.
"""

import asyncio
import threading

# Fallback poll interval used when GSMTC events are unavailable or as a safety net.
POLL_INTERVAL_MS = 250

try:
    from winrt.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as _MediaManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as _PlaybackStatus,
    )
    from winrt.windows.storage.streams import Buffer, DataReader, InputStreamOptions
    _GSMTC_AVAILABLE = True
except ImportError:
    _GSMTC_AVAILABLE = False


async def _gsmtc_get_media_info() -> dict | None:
    """
    Query the active GSMTC session and return structured track metadata.

    Iterates over all registered GSMTC sessions to find an active one, then
    reads its media properties and playback state.  If a thumbnail stream is
    attached it is downloaded into a ``bytes`` object.

    Returns
    -------
    dict | None
        A dictionary with the following keys, or ``None`` if GSMTC is
        unavailable, no active session is found, or any error occurs::

            {
                "title":          str,         # Track title, empty string if unknown.
                "artist":         str,         # Primary artist, empty string if unknown.
                "album_title":    str,         # Album name, empty string if unknown.
                "is_playing":     bool,        # True when playback status is PLAYING.
                "thumbnail_bytes": bytes | None # Raw cover-art image bytes, or None.
            }
    """
    if not _GSMTC_AVAILABLE:
        return None
    try:
        manager = await _MediaManager.request_async()
        session = None
        for s in manager.get_sessions():
            if "spotify" in s.source_app_user_model_id.lower():
                session = s
                break
        if session is None:
            return None
        props = await session.try_get_media_properties_async()
        if props is None:
            return None
        playback_info = session.get_playback_info()
        is_playing = playback_info.playback_status == _PlaybackStatus.PLAYING
        thumbnail_bytes: bytes | None = None
        if props.thumbnail:
            try:
                stream = await props.thumbnail.open_read_async()
                size = stream.size
                buf = Buffer(size)
                await stream.read_async(buf, size, InputStreamOptions.READ_AHEAD)
                reader = DataReader.from_buffer(buf)
                data = bytearray(size)
                reader.read_bytes(data)
                thumbnail_bytes = bytes(data)
            except Exception:  # noqa: BLE001
                pass
        return {
            "title": props.title or "",
            "artist": props.artist or "",
            "album_title": props.album_title or "",
            "is_playing": is_playing,
            "thumbnail_bytes": thumbnail_bytes,
        }
    except Exception:  # noqa: BLE001
        return None


def _get_media_info_sync() -> dict | None:
    """
    Synchronous wrapper around ``_gsmtc_get_media_info``.

    Creates a temporary event loop via ``asyncio.run`` so the coroutine can be
    called from any non-async background thread without needing an existing loop.
    Returns the same value as ``_gsmtc_get_media_info``, or ``None`` on error.
    """
    try:
        return asyncio.run(_gsmtc_get_media_info())
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Event-driven watcher
# ---------------------------------------------------------------------------

async def _gsmtc_event_watcher(emit_fn: callable, stop_event: threading.Event) -> None:
    """
    Async event-driven watcher that calls ``emit_fn`` on every track or playback change.

    Subscribes to the ``playback_info_changed`` and ``media_properties_changed`` GSMTC
    events on all active sessions so that responses are near-instant rather than
    waiting for the next poll cycle.  A periodic safety-net poll (``POLL_INTERVAL_MS``)
    is kept running alongside the event subscription to recover from missed events.

    A short coalesce delay (100 ms) is applied after each event fires so that
    all session properties have time to settle before being queried; this prevents
    returning transient intermediate states (e.g. an empty title between tracks).

    Session-changed events on the manager are also monitored so that subscriptions
    are refreshed when a new media player session is registered or removed.

    The loop runs until ``stop_event`` is set, after which all event tokens are
    unregistered and the coroutine returns.

    Parameters
    ----------
    emit_fn:
        Callable invoked with the result of ``_gsmtc_get_media_info`` after every
        detected change.  Called from within the async event loop.
    stop_event:
        Threading event used to signal the watcher to shut down.
    """
    loop = asyncio.get_running_loop()
    trigger = asyncio.Event()
    subscribed: list[tuple] = []  # (session, playback_token, props_token)

    def _fire() -> None:
        loop.call_soon_threadsafe(trigger.set)

    def _subscribe_sessions() -> None:
        for s, t1, t2 in subscribed:
            try:
                s.remove_playback_info_changed(t1)
                s.remove_media_properties_changed(t2)
            except Exception:  # noqa: BLE001
                pass
        subscribed.clear()
        try:
            manager_snapshot = asyncio.run_coroutine_threadsafe(
                _MediaManager.request_async(), loop
            ).result(timeout=2)
            for s in manager_snapshot.get_sessions():
                if "spotify" in s.source_app_user_model_id.lower():
                    t1 = s.add_playback_info_changed(lambda *_: _fire())
                    t2 = s.add_media_properties_changed(lambda *_: _fire())
                    subscribed.append((s, t1, t2))
        except Exception:  # noqa: BLE001
            pass

    manager = await _MediaManager.request_async()

    def _on_session_changed(sender, args) -> None:  # noqa: ANN001
        loop.call_soon_threadsafe(_subscribe_sessions)
        _fire()

    mgr_token = manager.add_current_session_changed(_on_session_changed)

    # Subscribe to initial sessions and trigger a first query.
    for s in manager.get_sessions():
        if "spotify" in s.source_app_user_model_id.lower():
            t1 = s.add_playback_info_changed(lambda *_: _fire())
            t2 = s.add_media_properties_changed(lambda *_: _fire())
            subscribed.append((s, t1, t2))
    trigger.set()

    interval = POLL_INTERVAL_MS / 1000
    # After a GSMTC event fires we wait a short time before querying so that
    # all properties (title, artist, playback status) have time to settle.
    # Without this, a query fired immediately after the event can return an
    # intermediate state where title/artist are still empty.
    COALESCE_S = 0.1
    try:
        while not stop_event.is_set():
            trigger.clear()
            try:
                await asyncio.wait_for(trigger.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
            else:
                # Event fired — let rapid follow-up events accumulate before querying.
                await asyncio.sleep(COALESCE_S)
                trigger.clear()
            info = await _gsmtc_get_media_info()
            emit_fn(info)
    finally:
        try:
            manager.remove_current_session_changed(mgr_token)
        except Exception:  # noqa: BLE001
            pass
        for s, t1, t2 in subscribed:
            try:
                s.remove_playback_info_changed(t1)
                s.remove_media_properties_changed(t2)
            except Exception:  # noqa: BLE001
                pass


def run_gsmtc_watcher(emit_fn: callable, stop_event: threading.Event) -> None:
    """
    Run the GSMTC watcher and block until ``stop_event`` is set.

    Intended to be executed in a dedicated background thread.  When the
    ``winrt`` packages are available the function delegates to the
    event-driven ``_gsmtc_event_watcher`` coroutine running on a fresh event
    loop, providing low-latency track-change detection.  When GSMTC is
    unavailable (non-Windows environment or missing packages) it falls back to
    a simple blocking poll that calls ``_get_media_info_sync`` every
    ``POLL_INTERVAL_MS`` milliseconds.

    Parameters
    ----------
    emit_fn:
        Callable invoked with each ``dict | None`` result from the media info
        query.  Will be called from the background thread.
    stop_event:
        Threading event used to signal the watcher to shut down cleanly.
    """
    if not _GSMTC_AVAILABLE:
        while not stop_event.wait(timeout=POLL_INTERVAL_MS / 1000):
            emit_fn(_get_media_info_sync())
        return

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_gsmtc_event_watcher(emit_fn, stop_event))
    except Exception:  # noqa: BLE001
        pass
    finally:
        loop.close()
