# gsmtc.ps1 - Reads current media info from Windows GSMTC and outputs JSON to stdout
# Usage: powershell -NonInteractive -ExecutionPolicy Bypass -File gsmtc.ps1

param(
    [string]$SourceAppId = 'auto',
    [switch]$List
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Ensure JSON stdout is UTF-8 when invoked from Node/Electron
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Helper: await a WinRT IAsyncOperation using AsTask<T>
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

# Load required WinRT types
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]

# Cache the AsStream(IRandomAccessStream) reflection method once.
# PowerShell can't implicitly convert System.__ComObject (returned by AsTask) to
# IRandomAccessStream, but MethodInfo.Invoke() lets the CLR do the COM QueryInterface
# internally — so we invoke via reflection instead of the PS static-call syntax.
$script:AsStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1

# Request session manager
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = $null
try {
    $manager = Await ($managerType::RequestAsync()) $managerType
} catch {
    if ($List) {
        Write-Output '[]'
    } else {
        Write-Output '{"artist":"","title":"","album":"","albumArtFile":"","albumArtMime":"","sourceAppId":"","positionMs":0,"isPlaying":false}'
    }
    exit 0
}

$session = $manager.GetCurrentSession()

function Get-TrackFromSession {
    param($Session)

    if ($null -eq $Session) { return $null }

    # Get media properties
    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    $props = $null
    try {
        $props = Await ($Session.TryGetMediaPropertiesAsync()) $propsType
    } catch {
        return $null
    }

    # Get playback info
    $playback = $Session.GetPlaybackInfo()
    $playingStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
    $isPlaying = ($playback.PlaybackStatus -eq $playingStatus)
    $appId = if ($Session.SourceAppUserModelId) { "$($Session.SourceAppUserModelId)" } else { "" }

    $positionMs = 0
    try {
        $timeline = $Session.GetTimelineProperties()
        if ($null -ne $timeline) {
            $positionMs = [int64]$timeline.Position.TotalMilliseconds
            if ($positionMs -lt 0) { $positionMs = 0 }
        }
    } catch {
        $positionMs = 0
    }

    $artist = if ($props.Artist) { $props.Artist } else { "" }
    $title  = if ($props.Title)  { $props.Title  } else { "" }
    $album  = if ($props.AlbumTitle) { $props.AlbumTitle } else { "" }

    # If metadata is missing but a session is actively playing, keep it visible
    # so the app can still indicate activity and optionally record.
    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($artist)) {
        if (-not $isPlaying) {
            return $null
        }
        # No metadata available — leave title/artist empty so the recording
        # layer can discard this session rather than saving a garbage filename.
        $title  = ""
        $artist = ""
    }

    # Try to get album art thumbnail
    $albumArtFile = ""
    $albumArtMime = ""

    function Get-ImageMeta {
        param([byte[]]$Bytes)

        if ($null -eq $Bytes -or $Bytes.Length -lt 12) {
            return @{ ext = 'jpg'; mime = 'image/jpeg' }
        }

        # JPEG
        if ($Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xD8 -and $Bytes[2] -eq 0xFF) {
            return @{ ext = 'jpg'; mime = 'image/jpeg' }
        }

        # PNG
        if ($Bytes[0] -eq 0x89 -and $Bytes[1] -eq 0x50 -and $Bytes[2] -eq 0x4E -and $Bytes[3] -eq 0x47) {
            return @{ ext = 'png'; mime = 'image/png' }
        }

        # GIF
        if ($Bytes[0] -eq 0x47 -and $Bytes[1] -eq 0x49 -and $Bytes[2] -eq 0x46 -and $Bytes[3] -eq 0x38) {
            return @{ ext = 'gif'; mime = 'image/gif' }
        }

        # WEBP (RIFF....WEBP)
        if (
            $Bytes[0] -eq 0x52 -and $Bytes[1] -eq 0x49 -and $Bytes[2] -eq 0x46 -and $Bytes[3] -eq 0x46 -and
            $Bytes[8] -eq 0x57 -and $Bytes[9] -eq 0x45 -and $Bytes[10] -eq 0x42 -and $Bytes[11] -eq 0x50
        ) {
            return @{ ext = 'webp'; mime = 'image/webp' }
        }

        return @{ ext = 'jpg'; mime = 'image/jpeg' }
    }

    function Try-ReadThumbnail {
        param($ThumbnailRef)

        if ($null -eq $ThumbnailRef) {
            return @{ file = ""; mime = "" }
        }

        $stream = $null
        try {
            $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
            $stream = Await ($ThumbnailRef.OpenReadAsync()) $streamType
            if ($null -eq $stream) {
                return @{ file = ""; mime = "" }
            }

            # $stream is System.__ComObject — PowerShell can't implicitly convert it to
            # IRandomAccessStream for the AsStream() static call.  Invoke via reflection
            # so the CLR does the COM QueryInterface internally.
            $dotNetStream = $script:AsStreamMethod.Invoke($null, [object[]]@($stream))
            if ($null -eq $dotNetStream) {
                return @{ file = ""; mime = "" }
            }

            $ms = [System.IO.MemoryStream]::new()
            $dotNetStream.CopyTo($ms)
            $bytes = $ms.ToArray()
            $ms.Dispose()

            if ($null -eq $bytes -or $bytes.Length -eq 0 -or $bytes.Length -gt 20MB) {
                return @{ file = ""; mime = "" }
            }

            $meta = Get-ImageMeta -Bytes $bytes

            # ContentType is also inaccessible on the raw COM object; detect from bytes only.
            # Use GUID for unique filename (GetRandomFileName() includes its own extension, causing doubles)
            $guid = [guid]::NewGuid().ToString().Substring(0, 8)
            $tempFile = [System.IO.Path]::Combine(
                [System.IO.Path]::GetTempPath(),
                "autotape_art_$guid.$($meta.ext)"
            )
            [System.IO.File]::WriteAllBytes($tempFile, $bytes)

            return @{ file = $tempFile; mime = $meta.mime }
        } catch {
            return @{ file = ""; mime = "" }
        } finally {
            try { if ($null -ne $stream) { $stream.Dispose() } } catch { }
        }
    }

    # GSMTC metadata can lag briefly after a track change; retry a few times.
    if ($null -ne $props.Thumbnail) {
        $thumbResult = Try-ReadThumbnail -ThumbnailRef $props.Thumbnail
        if ([string]::IsNullOrWhiteSpace($thumbResult.file) -and $isPlaying) {
            foreach ($delayMs in @(120, 250)) {
                Start-Sleep -Milliseconds $delayMs
                try {
                    $props = Await ($Session.TryGetMediaPropertiesAsync()) $propsType
                } catch {
                    continue
                }
                if ($null -eq $props -or $null -eq $props.Thumbnail) {
                    continue
                }

                $thumbResult = Try-ReadThumbnail -ThumbnailRef $props.Thumbnail
                if (-not [string]::IsNullOrWhiteSpace($thumbResult.file)) {
                    break
                }
            }
        }

        $albumArtFile = $thumbResult.file
        $albumArtMime = $thumbResult.mime
    }

    return [PSCustomObject]@{
        artist       = $artist
        title        = $title
        album        = $album
        albumArtFile = $albumArtFile
        albumArtMime = $albumArtMime
        sourceAppId  = $appId
        positionMs   = $positionMs
        isPlaying    = $isPlaying
    }
}

function New-ArtCacheKey {
    param($Track)

    if ($null -eq $Track) { return "" }
    $sourceAppId = if ($null -ne $Track.sourceAppId) { "$($Track.sourceAppId)" } else { "" }
    $artist = if ($null -ne $Track.artist) { "$($Track.artist)" } else { "" }
    $title = if ($null -ne $Track.title) { "$($Track.title)" } else { "" }
    $album = if ($null -ne $Track.album) { "$($Track.album)" } else { "" }

    $parts = @(
        $sourceAppId.ToLowerInvariant().Trim(),
        $artist.ToLowerInvariant().Trim(),
        $title.ToLowerInvariant().Trim(),
        $album.ToLowerInvariant().Trim()
    )
    return ($parts -join '|')
}

function Read-ArtCache {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
        return @{}
    }

    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }

        $obj = $raw | ConvertFrom-Json
        $map = @{}
        if ($obj -ne $null) {
            foreach ($p in $obj.PSObject.Properties) {
                $map[$p.Name] = $p.Value
            }
        }
        return $map
    } catch {
        return @{}
    }
}

function Write-ArtCache {
    param(
        [string]$Path,
        [hashtable]$Cache
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or $null -eq $Cache) {
        return
    }

    try {
        ($Cache | ConvertTo-Json -Compress -Depth 4) | Set-Content -LiteralPath $Path -Encoding UTF8
    } catch {
        # ignore cache write failures
    }
}

$candidates = @()

# 1) Try current session first
if ($null -ne $session) {
    $currentTrack = Get-TrackFromSession -Session $session
    if ($null -ne $currentTrack) {
        $candidates += $currentTrack
    }
}

# 2) Also inspect all sessions (current can exist but be metadata-empty)
$allSessions = $null
try {
    $allSessions = $manager.GetSessions()
} catch {
    $allSessions = $null
}

if ($null -ne $allSessions -and $allSessions.Count -gt 0) {
    foreach ($s in $allSessions) {
        $trackCandidate = Get-TrackFromSession -Session $s
        if ($null -eq $trackCandidate) { continue }

        $duplicateIndex = -1
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            $existing = $candidates[$i]
            if ($existing.artist -eq $trackCandidate.artist -and $existing.title -eq $trackCandidate.title -and $existing.isPlaying -eq $trackCandidate.isPlaying) {
                $duplicateIndex = $i
                break
            }
        }

        if ($duplicateIndex -ge 0) {
            $existing = $candidates[$duplicateIndex]
            $existingHasArt = -not [string]::IsNullOrWhiteSpace($existing.albumArtFile)
            $candidateHasArt = -not [string]::IsNullOrWhiteSpace($trackCandidate.albumArtFile)

            # Prefer the candidate that actually has album art
            if ($candidateHasArt -and -not $existingHasArt) {
                $candidates[$duplicateIndex] = $trackCandidate
            }
        } else {
            $candidates += $trackCandidate
        }
    }
}

if ($candidates.Count -eq 0) {
    if ($List) {
        Write-Output '[]'
    } else {
        Write-Output '{"artist":"","title":"","album":"","albumArtFile":"","albumArtMime":"","sourceAppId":"","positionMs":0,"isPlaying":false}'
    }
    exit 0
}

$artCachePath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'autotape_art_cache.json')
$artCache = Read-ArtCache -Path $artCachePath

# Persist all artwork we do have for later fallback when GSMTC metadata lags.
foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate.albumArtFile)) { continue }
    if (-not (Test-Path -LiteralPath $candidate.albumArtFile)) { continue }

    $key = New-ArtCacheKey -Track $candidate
    if ([string]::IsNullOrWhiteSpace($key)) { continue }

    $artCache[$key] = [PSCustomObject]@{
        file = $candidate.albumArtFile
        mime = if ($null -ne $candidate.albumArtMime) { "$($candidate.albumArtMime)" } else { '' }
    }
}

if ($List) {
    Write-Output ($candidates | ConvertTo-Json -Compress)
    exit 0
}

$requestedSource = if ([string]::IsNullOrWhiteSpace($SourceAppId)) { 'auto' } else { $SourceAppId.Trim() }

if ($requestedSource -ne 'auto') {
    $filteredCandidates = $candidates | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.sourceAppId) -and
        $_.sourceAppId.Equals($requestedSource, [System.StringComparison]::OrdinalIgnoreCase)
    }

    if ($filteredCandidates.Count -eq 0) {
        Write-Output '{"artist":"","title":"","album":"","albumArtFile":"","albumArtMime":"","sourceAppId":"","positionMs":0,"isPlaying":false}'
        exit 0
    }

    $candidates = @($filteredCandidates)
}

# Prefer currently playing track if available
$playing = $candidates | Where-Object { $_.isPlaying }
$selected = $null

function Is-SpotifyCandidate {
    param($Candidate)

    if ($null -eq $Candidate) { return $false }
    if ([string]::IsNullOrWhiteSpace($Candidate.sourceAppId)) { return $false }

    $app = $Candidate.sourceAppId.ToLowerInvariant()
    return ($app -like '*spotify*')
}

if ($playing.Count -gt 0) {
    # 1) Prefer Spotify + has artwork
    $spotifyPlayingWithArt = $playing | Where-Object {
        (Is-SpotifyCandidate $_) -and -not [string]::IsNullOrWhiteSpace($_.albumArtFile)
    }
    if ($spotifyPlayingWithArt.Count -gt 0) {
        $selected = $spotifyPlayingWithArt[0]
    } else {
        # 2) Any playing candidate with artwork
        $playingWithArt = $playing | Where-Object { -not [string]::IsNullOrWhiteSpace($_.albumArtFile) }
        if ($playingWithArt.Count -gt 0) {
            $selected = $playingWithArt[0]
        } else {
            # 3) Spotify playing candidate even without artwork
            $spotifyPlaying = $playing | Where-Object { Is-SpotifyCandidate $_ }
            if ($spotifyPlaying.Count -gt 0) {
                $selected = $spotifyPlaying[0]
            } else {
                # 4) Fallback first playing candidate
                $selected = $playing[0]
            }
        }
    }
} else {
    # No currently-playing candidates
    $spotifyWithArt = $candidates | Where-Object {
        (Is-SpotifyCandidate $_) -and -not [string]::IsNullOrWhiteSpace($_.albumArtFile)
    }
    if ($spotifyWithArt.Count -gt 0) {
        $selected = $spotifyWithArt[0]
    } else {
        $withArt = $candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_.albumArtFile) }
        if ($withArt.Count -gt 0) {
            $selected = $withArt[0]
        } else {
            $spotifyAny = $candidates | Where-Object { Is-SpotifyCandidate $_ }
            if ($spotifyAny.Count -gt 0) {
                $selected = $spotifyAny[0]
            } else {
                $selected = $candidates[0]
            }
        }
    }
}

# If selected track has no art, try borrowing from same track metadata in this run.
if ($null -ne $selected -and [string]::IsNullOrWhiteSpace($selected.albumArtFile)) {
    $sameTrackWithArt = $candidates | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.albumArtFile) -and
        ($_.artist -eq $selected.artist) -and
        ($_.title -eq $selected.title) -and
        ($_.album -eq $selected.album)
    } | Select-Object -First 1

    if ($null -ne $sameTrackWithArt) {
        $selected.albumArtFile = $sameTrackWithArt.albumArtFile
        $selected.albumArtMime = $sameTrackWithArt.albumArtMime
    }
}

# If still missing, use last known artwork from local cache for same track.
if ($null -ne $selected -and [string]::IsNullOrWhiteSpace($selected.albumArtFile)) {
    $selectedKey = New-ArtCacheKey -Track $selected
    if (-not [string]::IsNullOrWhiteSpace($selectedKey) -and $artCache.ContainsKey($selectedKey)) {
        $cached = $artCache[$selectedKey]
        if ($null -ne $cached -and $cached.file -and (Test-Path -LiteralPath $cached.file)) {
            $selected.albumArtFile = $cached.file
            $selected.albumArtMime = if ($cached.mime) { $cached.mime } else { '' }
        }
    }
}

# Update cache with final selected candidate too.
if ($null -ne $selected -and -not [string]::IsNullOrWhiteSpace($selected.albumArtFile)) {
    $selectedKey = New-ArtCacheKey -Track $selected
    if (-not [string]::IsNullOrWhiteSpace($selectedKey) -and (Test-Path -LiteralPath $selected.albumArtFile)) {
        $artCache[$selectedKey] = [PSCustomObject]@{
            file = $selected.albumArtFile
            mime = if ($null -ne $selected.albumArtMime) { "$($selected.albumArtMime)" } else { '' }
        }
    }
}

Write-ArtCache -Path $artCachePath -Cache $artCache

Write-Output ($selected | ConvertTo-Json -Compress)
