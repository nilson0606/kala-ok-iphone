param(
    [string]$Url,
    [ValidateRange(0,120)][int]$Seconds = 15,
    [switch]$DownloadOnly
)
$ErrorActionPreference = 'Stop'
$taskPython = Join-Path $PSScriptRoot '.runtime\venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run setup-local.ps1 first.' }
if (-not $Url) { $Url = Read-Host 'Paste a YouTube video URL' }
$taskArgs = @((Join-Path $PSScriptRoot 'tools\audio_pipeline.py'), '--url', $Url, '--seconds', [string]$Seconds)
if (-not $DownloadOnly) { $taskArgs += '--separate' }
& $taskPython @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'Local audio processing failed. See the stage message above.' }
