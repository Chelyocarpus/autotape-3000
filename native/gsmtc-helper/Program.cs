using System.Text;
using System.Text.Json;
using Windows.Foundation;
using Windows.Media.Control;

// GsmtcHelper — replaces the old gsmtc_loop.ps1 polling loop. Subscribes to real WinRT
// GSMTC events and writes one compact JSON line (matching GsmtcTrack from
// src/shared/types.ts) to stdout per change, instead of polling on an interval.
//
// Usage: GsmtcHelper.exe [sourceAppId|auto]

Console.OutputEncoding = Encoding.UTF8;
Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), Encoding.UTF8) { AutoFlush = true });

var requestedSourceArg = args.Length > 0 ? args[0].Trim() : "auto";
var requestedSource = string.Equals(requestedSourceArg, "auto", StringComparison.OrdinalIgnoreCase)
    ? ""
    : requestedSourceArg;

var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();

// Serializes all resync/emit work so overlapping WinRT events (manager- and session-level
// events can fire back-to-back) can't race on `watcher` or interleave stdout writes.
var gate = new SemaphoreSlim(1, 1);
SessionWatcher? watcher = null;

async Task EmitAsync()
{
    GsmtcTrack track = GsmtcTrack.Empty;
    var session = watcher?.Session;
    if (session != null)
    {
        track = await GetSessionTrackAsync(session, requestedSource) ?? GsmtcTrack.Empty;
    }
    Console.WriteLine(JsonSerializer.Serialize(track));
}

async Task ResyncAsync()
{
    await gate.WaitAsync();
    try
    {
        var target = await SelectTargetSessionAsync(manager, requestedSource);
        var targetAppId = target?.SourceAppUserModelId ?? "";
        var currentAppId = watcher?.Session.SourceAppUserModelId ?? "";
        var sameSession = watcher != null && target != null &&
            string.Equals(targetAppId, currentAppId, StringComparison.OrdinalIgnoreCase);

        if (!sameSession)
        {
            watcher?.Dispose();
            watcher = target != null ? new SessionWatcher(target, () => _ = OnSessionChangedAsync()) : null;
        }

        await EmitAsync();
    }
    catch
    {
        // Transient WinRT/COM failures (e.g. a session vanished mid-call) — stay alive,
        // the next event or manager-level change will resync.
    }
    finally
    {
        gate.Release();
    }
}

async Task OnSessionChangedAsync()
{
    await gate.WaitAsync();
    try
    {
        await EmitAsync();
    }
    catch
    {
        // Same rationale as ResyncAsync — don't let a transient failure kill the process.
    }
    finally
    {
        gate.Release();
    }
}

manager.CurrentSessionChanged += (s, e) => _ = ResyncAsync();
manager.SessionsChanged += (s, e) => _ = ResyncAsync();

await ResyncAsync();

// Real async wait — no polling, no message pump needed (confirmed by the validation spike).
await Task.Delay(Timeout.Infinite);

static bool IsSpotify(GlobalSystemMediaTransportControlsSession session)
{
    var appId = session.SourceAppUserModelId ?? "";
    return appId.Contains("spotify", StringComparison.OrdinalIgnoreCase);
}

static bool IsPlayingSafe(GlobalSystemMediaTransportControlsSession session)
{
    try
    {
        return session.GetPlaybackInfo().PlaybackStatus ==
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    }
    catch
    {
        return false;
    }
}

static async Task<GsmtcTrack?> GetSessionTrackAsync(
    GlobalSystemMediaTransportControlsSession? session, string requestedSource)
{
    if (session == null) return null;

    var appId = session.SourceAppUserModelId ?? "";
    if (requestedSource != "" && !string.Equals(appId, requestedSource, StringComparison.OrdinalIgnoreCase))
    {
        return null;
    }

    bool isPlaying;
    try
    {
        isPlaying = session.GetPlaybackInfo().PlaybackStatus ==
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    }
    catch
    {
        return null;
    }

    long positionMs = 0;
    try
    {
        var timeline = session.GetTimelineProperties();
        positionMs = (long)timeline.Position.TotalMilliseconds;
        if (positionMs < 0) positionMs = 0;
    }
    catch
    {
        // Position is best-effort — leave at 0 if unavailable.
    }

    GlobalSystemMediaTransportControlsSessionMediaProperties props;
    try
    {
        props = await session.TryGetMediaPropertiesAsync();
    }
    catch
    {
        return null;
    }
    if (props == null) return null;

    return new GsmtcTrack
    {
        artist = props.Artist ?? "",
        title = props.Title ?? "",
        album = props.AlbumTitle ?? "",
        albumArtFile = "",
        albumArtMime = "",
        sourceAppId = appId,
        positionMs = positionMs,
        isPlaying = isPlaying
    };
}

static async Task<GlobalSystemMediaTransportControlsSession?> SelectTargetSessionAsync(
    GlobalSystemMediaTransportControlsSessionManager manager, string requestedSource)
{
    if (requestedSource != "")
    {
        IReadOnlyList<GlobalSystemMediaTransportControlsSession> sessions;
        try { sessions = manager.GetSessions(); } catch { return null; }

        foreach (var s in sessions)
        {
            if (await GetSessionTrackAsync(s, requestedSource) != null) return s;
        }
        return null;
    }

    GlobalSystemMediaTransportControlsSession? current = null;
    try { current = manager.GetCurrentSession(); } catch { /* fall through to session scan */ }
    if (current != null && await GetSessionTrackAsync(current, "") != null) return current;

    IReadOnlyList<GlobalSystemMediaTransportControlsSession> all;
    try { all = manager.GetSessions(); } catch { return null; }

    foreach (var s in all)
    {
        if (IsSpotify(s) && IsPlayingSafe(s) && await GetSessionTrackAsync(s, "") != null) return s;
    }
    foreach (var s in all)
    {
        if (IsPlayingSafe(s) && await GetSessionTrackAsync(s, "") != null) return s;
    }
    return null;
}

sealed class GsmtcTrack
{
    public string artist { get; set; } = "";
    public string title { get; set; } = "";
    public string album { get; set; } = "";
    public string albumArtFile { get; set; } = "";
    public string albumArtMime { get; set; } = "";
    public string sourceAppId { get; set; } = "";
    public long positionMs { get; set; }
    public bool isPlaying { get; set; }

    public static GsmtcTrack Empty => new();
}

/// <summary>
/// Holds one session plus its three subscribed handler delegates. C# can only unsubscribe
/// the exact delegate instance that was subscribed, so these must be kept — re-registering
/// on every session switch without unsubscribing the old handlers would leak registrations
/// on this long-running process.
/// </summary>
sealed class SessionWatcher : IDisposable
{
    public GlobalSystemMediaTransportControlsSession Session { get; }

    private readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> _mediaHandler;
    private readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> _playbackHandler;
    private readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs> _timelineHandler;

    public SessionWatcher(GlobalSystemMediaTransportControlsSession session, Action onChanged)
    {
        Session = session;
        _mediaHandler = (s, e) => onChanged();
        _playbackHandler = (s, e) => onChanged();
        _timelineHandler = (s, e) => onChanged();

        session.MediaPropertiesChanged += _mediaHandler;
        session.PlaybackInfoChanged += _playbackHandler;
        session.TimelinePropertiesChanged += _timelineHandler;
    }

    public void Dispose()
    {
        Session.MediaPropertiesChanged -= _mediaHandler;
        Session.PlaybackInfoChanged -= _playbackHandler;
        Session.TimelinePropertiesChanged -= _timelineHandler;
    }
}
