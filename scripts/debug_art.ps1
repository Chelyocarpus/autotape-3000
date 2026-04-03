Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await {
    param($WinRtTask, [Type]$ResultType)
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1
    $asTaskGeneric = $asTaskMethod.MakeGenericMethod($ResultType)
    $netTask = $asTaskGeneric.Invoke($null, @($WinRtTask))
    $null = $netTask.ConfigureAwait($false)
    return $netTask.GetAwaiter().GetResult()
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Await ($managerType::RequestAsync()) $managerType
$sessions = $manager.GetSessions()
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

foreach ($s in $sessions) {
    $appId = $s.SourceAppUserModelId
    $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
    $hasThumbnail = ($null -ne $props.Thumbnail)
    Write-Host "Session=$appId Title=$($props.Title) HasThumbnail=$hasThumbnail"

    if ($hasThumbnail) {
        $asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | 
            Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 } |
            Select-Object -First 1

        # --- Approach A: Await via AsTask, then invoke AsStream via reflection ---
        try {
            $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
            $stream = Await ($props.Thumbnail.OpenReadAsync()) $streamType
            Write-Host "  [A] Awaited stream type=$($stream.GetType().FullName)"
            $dotNetStream = $asStreamMethod.Invoke($null, [object[]]@($stream))
            Write-Host "  [A] AsStream ok=$($null -ne $dotNetStream)"
            $ms = [System.IO.MemoryStream]::new()
            $dotNetStream.CopyTo($ms)
            Write-Host "  [A] BytesRead=$($ms.Length)"
            $ms.Dispose()
        } catch {
            Write-Host "  [A] error: $_"
        }

        # --- Approach B: skip AsTask entirely, call GetResults() directly ---
        try {
            $asyncOp = $props.Thumbnail.OpenReadAsync()
            Start-Sleep -Milliseconds 500
            $stream2 = $asyncOp.GetResults()
            Write-Host "  [B] GetResults type=$($stream2.GetType().FullName)"
            $dotNetStream2 = $asStreamMethod.Invoke($null, [object[]]@($stream2))
            Write-Host "  [B] AsStream ok=$($null -ne $dotNetStream2)"
            $ms2 = [System.IO.MemoryStream]::new()
            $dotNetStream2.CopyTo($ms2)
            Write-Host "  [B] BytesRead=$($ms2.Length)"
            $ms2.Dispose()
        } catch {
            Write-Host "  [B] error: $_"
        }
    }
}
