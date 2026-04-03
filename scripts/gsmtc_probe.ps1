Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]

function Await {
    param($WinRtTask, [Type]$ResultType)
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1
    $asTaskGeneric = $asTaskMethod.MakeGenericMethod($ResultType)
    $netTask = $asTaskGeneric.Invoke($null, @($WinRtTask))
    $null = $netTask.ConfigureAwait($false)
    $netTask.GetAwaiter().GetResult()
}

try {
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $mgr = Await ($mgrType::RequestAsync()) $mgrType
} catch {
    Write-Host "REQ_EXCEPTION=$($_.Exception.Message)"
    exit 1
}
$sessions = $mgr.GetSessions()
Write-Host "SESSION_COUNT=$($sessions.Count)"

$i = 0
foreach ($s in $sessions) {
    $i++
    $app = $s.SourceAppUserModelId
    $status = $s.GetPlaybackInfo().PlaybackStatus

    $title = ''
    $artist = ''
    $mop = $s.TryGetMediaPropertiesAsync()
    while ($mop.Status -eq [Windows.Foundation.AsyncStatus]::Started) {
        Start-Sleep -Milliseconds 20
    }

    if ($mop.Status -eq [Windows.Foundation.AsyncStatus]::Completed) {
        $mp = $mop.GetResults()
        $title = $mp.Title
        $artist = $mp.Artist
    }

    Write-Host ("[{0}] app={1} status={2} artist='{3}' title='{4}'" -f $i, $app, $status, $artist, $title)
}
