# gsmtc_loop.ps1 - Persistent GSMTC polling loop. Outputs one compact JSON line per interval.
# Amortizes WinRT assembly loading and session manager init across all polls.
# Does NOT fetch thumbnails — caller should request artwork via gsmtc.ps1 on track change.
#
# Usage: powershell -NoProfile -STA -NonInteractive -ExecutionPolicy Bypass -File gsmtc_loop.ps1
#        [-SourceAppId <appId|auto>] [-IntervalMs <ms>]

param(
    [string]$SourceAppId = 'auto',
    [int]$IntervalMs = 50
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Helper: await a WinRT IAsyncOperation<T> via reflection (avoids PS COM-cast issues)
function Await {
    param($WinRtTask, [Type]$ResultType)

    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1

    if ($null -eq $asTaskMethod) {
        throw 'Could not locate generic System.WindowsRuntimeSystemExtensions.AsTask<T>(IAsyncOperation<T>)'
    }

    $asTaskGeneric = $asTaskMethod.MakeGenericMethod($ResultType)
    $netTask = $asTaskGeneric.Invoke($null, @($WinRtTask))
    $null = $netTask.ConfigureAwait($false)
    return $netTask.GetAwaiter().GetResult()
}

# Load required WinRT types once
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]

$emptyJson = '{"artist":"","title":"","album":"","albumArtFile":"","albumArtMime":"","sourceAppId":"","positionMs":0,"positionUpdatedAtMs":0,"isPlaying":false}'

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = $null
try {
    $manager = Await ($managerType::RequestAsync()) $managerType
} catch {
    # Cannot acquire GSMTC session manager — exit so the Node side can restart later
    exit 1
}

$playingStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$requestedSource = if ([string]::IsNullOrWhiteSpace($SourceAppId) -or $SourceAppId -eq 'auto') { '' } else { $SourceAppId.Trim() }

function Get-SessionTrack {
    param($Session)

    if ($null -eq $Session) { return $null }

    $appId = if ($Session.SourceAppUserModelId) { "$($Session.SourceAppUserModelId)" } else { "" }

    # Filter by requested source when one is specified
    if ($requestedSource -ne '') {
        if (-not $appId.Equals($requestedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $null
        }
    }

    $playback = $Session.GetPlaybackInfo()
    $isPlaying = ($playback.PlaybackStatus -eq $playingStatus)

    $positionMs = 0
    $positionUpdatedAtMs = 0
    try {
        $timeline = $Session.GetTimelineProperties()
        if ($null -ne $timeline) {
            $positionMs = [int64]$timeline.Position.TotalMilliseconds
            if ($positionMs -lt 0) { $positionMs = 0 }
            # LastUpdatedTime is when the source app last pushed this Position value —
            # it does not auto-advance between pushes, so callers need this to
            # extrapolate a live position rather than trusting a possibly-stale snapshot.
            $positionUpdatedAtMs = [int64]$timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
        }
    } catch { }

    $props = $null
    try {
        $props = Await ($Session.TryGetMediaPropertiesAsync()) $propsType
    } catch { return $null }

    if ($null -eq $props) { return $null }

    $artist = if ($props.Artist)     { $props.Artist     } else { "" }
    $title  = if ($props.Title)      { $props.Title      } else { "" }
    $album  = if ($props.AlbumTitle) { $props.AlbumTitle } else { "" }

    return [PSCustomObject]@{
        artist              = $artist
        title               = $title
        album               = $album
        albumArtFile        = ""
        albumArtMime        = ""
        sourceAppId         = $appId
        positionMs          = $positionMs
        positionUpdatedAtMs = $positionUpdatedAtMs
        isPlaying           = $isPlaying
    }
}

function Get-TrackKey {
    param($Track)
    if ($null -eq $Track) { return '' }
    return "$($Track.sourceAppId)|$($Track.artist)|$($Track.title)"
}

# Remembers the currently-locked-on track across polls (see Select-StickyTrack).
$script:lockedTrackKey = ''

# Picks a track from this poll's candidates, preferring to keep reporting whichever
# track was locked on last poll over re-ranking from scratch every tick.
#
# GetSessions()/GetCurrentSession() ordering is not guaranteed stable poll-to-poll,
# and a single requested source can expose more than one session at once (e.g. a
# browser with several tabs, each its own session under the same AUMID). Re-deriving
# "the best candidate" independently on every ~50ms poll turns any near-tie — most
# commonly two idle (non-playing) sessions, where there's no playing/Spotify signal
# to break the tie — into a rapid trackChanged oscillation upstream. Instead: once
# locked onto a track, keep reporting it until it's no longer among the candidates,
# or a genuinely playing candidate shows up while the locked one isn't playing.
function Select-StickyTrack {
    param([array]$Candidates)

    if ($Candidates.Count -eq 0) {
        $script:lockedTrackKey = ''
        return $null
    }

    if ($script:lockedTrackKey) {
        $sticky = $Candidates | Where-Object { (Get-TrackKey $_) -eq $script:lockedTrackKey } | Select-Object -First 1
        if ($null -ne $sticky) {
            $playingChallenger = $Candidates | Where-Object { $_.isPlaying } | Select-Object -First 1
            if ($sticky.isPlaying -or $null -eq $playingChallenger) {
                $script:lockedTrackKey = Get-TrackKey $sticky
                return $sticky
            }
            # A playing challenger exists and the locked track isn't playing — let it take over below.
        }
    }

    $playing = $Candidates | Where-Object { $_.isPlaying }
    if ($playing.Count -gt 0) {
        $spotifyPlaying = $playing | Where-Object { $_.sourceAppId -like '*spotify*' } | Select-Object -First 1
        $chosen = if ($null -ne $spotifyPlaying) { $spotifyPlaying } else { $playing[0] }
    } else {
        $chosen = $Candidates[0]
    }
    $script:lockedTrackKey = Get-TrackKey $chosen
    return $chosen
}

# Main polling loop — runs until the parent process closes stdin or kills us
while ($true) {
    try {
        $candidates = @()
        $allSessions = $null
        try { $allSessions = $manager.GetSessions() } catch { }
        if ($null -ne $allSessions) {
            foreach ($s in $allSessions) {
                $t = Get-SessionTrack -Session $s
                if ($null -ne $t) { $candidates += $t }
            }
        }

        $track = Select-StickyTrack -Candidates $candidates

        if ($null -ne $track) {
            Write-Output ($track | ConvertTo-Json -Compress)
        } else {
            Write-Output $emptyJson
        }
    } catch {
        Write-Output $emptyJson
    }

    [System.Console]::Out.Flush()
    Start-Sleep -Milliseconds $IntervalMs
}
