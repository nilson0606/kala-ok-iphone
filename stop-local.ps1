$ErrorActionPreference = 'Stop'
$taskPidFile = Join-Path $PSScriptRoot '.runtime\helper.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No helper PID recorded.'; exit }
$taskProcessId = [int](Get-Content -LiteralPath $taskPidFile -Raw)
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
$taskExpected = Join-Path $PSScriptRoot 'helper-local.mjs'
if ($taskProcess -and $taskProcess.CommandLine -and $taskProcess.CommandLine.Contains($taskExpected)) {
    $taskHeaders = @{ Origin = 'https://nilson0606.github.io' }
    try {
        $taskSession = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/session' -Headers $taskHeaders -TimeoutSec 5
        $taskHeaders['X-Karaoke-Token'] = $taskSession.token
        Invoke-RestMethod -Uri 'http://127.0.0.1:4174/shutdown' -Method Post -Headers $taskHeaders -TimeoutSec 20 | Out-Null
    } catch {
        # Terminate only the verified helper process and its descendants.
        & taskkill /PID $taskProcessId /T /F | Out-Null
    }
    Write-Host 'Local helper stopped.'
} elseif ($taskProcess) { throw 'PID now belongs to another process; left it untouched.' }
Remove-Item -LiteralPath $taskPidFile
