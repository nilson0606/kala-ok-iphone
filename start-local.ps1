param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$taskOrigin = @{ Origin = 'https://nilson0606.github.io' }
$taskReady = $false
try {
    $taskStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/health' -Headers $taskOrigin -TimeoutSec 8
    $taskReady = $taskStatus.app -eq 'karaoke-local-helper'
} catch { }
if (-not $taskReady) {
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $taskRuntime = Join-Path $PSScriptRoot '.runtime'
    New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
    $taskHelper = Join-Path $PSScriptRoot 'helper-local.mjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskHelper + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'helper.stdout.log') -RedirectStandardError (Join-Path $taskRuntime 'helper.stderr.log') -PassThru
    $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskRuntime 'helper.pid')
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $taskStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/health' -Headers $taskOrigin -TimeoutSec 8
            if ($taskStatus.app -eq 'karaoke-local-helper') { $taskReady = $true; break }
        } catch { }
        if ($taskProcess.HasExited) { break }
    }
}
if (-not $taskReady) { throw 'Could not start local helper. Check .runtime/helper.stderr.log.' }
Write-Host ('Local helper started. Audio tools ready: ' + $taskStatus.ready)
Write-Host 'The helper runs only on this computer. Restart it after reboot.'
if (-not $NoOpen) { Start-Process 'https://nilson0606.github.io/kala-ok-iphone/' }
