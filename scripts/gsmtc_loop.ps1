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

$emptyJson = '{"artist":"","title":"","album":"","albumArtFile":"","albumArtMime":"","sourceAppId":"","positionMs":0,"isPlaying":false}'

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
    try {
        $timeline = $Session.GetTimelineProperties()
        if ($null -ne $timeline) {
            $positionMs = [int64]$timeline.Position.TotalMilliseconds
            if ($positionMs -lt 0) { $positionMs = 0 }
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
        artist       = $artist
        title        = $title
        album        = $album
        albumArtFile = ""
        albumArtMime = ""
        sourceAppId  = $appId
        positionMs   = $positionMs
        isPlaying    = $isPlaying
    }
}

function Is-SpotifySession {
    param($Session)
    if ($null -eq $Session) { return $false }
    $app = if ($Session.SourceAppUserModelId) { "$($Session.SourceAppUserModelId)".ToLowerInvariant() } else { "" }
    return ($app -like '*spotify*')
}

# Main polling loop — runs until the parent process closes stdin or kills us
while ($true) {
    try {
        $track = $null

        if ($requestedSource -ne '') {
            # Scan all sessions to find the one matching the requested source
            $allSessions = $null
            try { $allSessions = $manager.GetSessions() } catch { }
            if ($null -ne $allSessions) {
                foreach ($s in $allSessions) {
                    $t = Get-SessionTrack -Session $s
                    if ($null -ne $t) { $track = $t; break }
                }
            }
        } else {
            # 'auto' mode: prefer current session, fall back to Spotify among all sessions
            $current = $manager.GetCurrentSession()
            $track = Get-SessionTrack -Session $current

            if ($null -eq $track) {
                $allSessions = $null
                try { $allSessions = $manager.GetSessions() } catch { }
                if ($null -ne $allSessions) {
                    # Prefer Spotify playing session
                    foreach ($s in $allSessions) {
                        if (-not (Is-SpotifySession -Session $s)) { continue }
                        $t = Get-SessionTrack -Session $s
                        if ($null -ne $t -and $t.isPlaying) { $track = $t; break }
                    }
                    # Fall back to any playing session
                    if ($null -eq $track) {
                        foreach ($s in $allSessions) {
                            $t = Get-SessionTrack -Session $s
                            if ($null -ne $t -and $t.isPlaying) { $track = $t; break }
                        }
                    }
                }
            }
        }

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
