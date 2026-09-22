param([string]$PythonPath, [ValidateSet('auto', 'cpu', 'cuda')][string]$Device = 'auto')
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
Push-Location -LiteralPath $taskRoot
try {
    foreach ($command in @('node', 'ffmpeg', 'ffprobe')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Missing $command. Install it and add it to PATH before setup."
        }
    }
    if (-not $PythonPath) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            $candidate = & py -3.12 -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0) { $PythonPath = $candidate.Trim() }
        }
        if (-not $PythonPath) {
            $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
            if (Test-Path -LiteralPath $bundled) { $PythonPath = $bundled }
        }
    }
    if (-not $PythonPath) { throw 'Python 3.12 is required. Run setup-local.ps1 -PythonPath C:\path\to\python.exe' }
    & $PythonPath -c 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 is required"'
    if ($LASTEXITCODE -ne 0) { throw 'Selected Python is not version 3.12.' }
    & $PythonPath -m venv '.runtime/venv'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create local Python environment.' }
    $taskPython = Join-Path $taskRoot '.runtime\venv\Scripts\python.exe'
    $taskUseCuda = $Device -eq 'cuda'
    if ($Device -eq 'auto' -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        $taskGpu = & nvidia-smi --query-gpu=name --format=csv,noheader 2>$null
        $taskUseCuda = $LASTEXITCODE -eq 0 -and [bool]$taskGpu
    }
    $taskVariant = if ($taskUseCuda) { 'cu124' } else { 'cpu' }
    Write-Host "Installing PyTorch ($taskVariant). CUDA download is about 2.5 GB."
    & $taskPython -m pip install --upgrade "torch==2.5.1+$taskVariant" "torchaudio==2.5.1+$taskVariant" --index-url "https://download.pytorch.org/whl/$taskVariant"
    if ($LASTEXITCODE -ne 0) {
        if ($Device -ne 'auto' -or -not $taskUseCuda) { throw 'Could not install PyTorch.' }
        Write-Warning 'CUDA installation failed. Installing the CPU version instead.'
        & $taskPython -m pip install --upgrade torch==2.5.1+cpu torchaudio==2.5.1+cpu --index-url https://download.pytorch.org/whl/cpu
        if ($LASTEXITCODE -ne 0) { throw 'Could not install CPU PyTorch.' }
    }
    & $taskPython -m pip install -r tools/requirements-audio.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install audio tools.' }
    & $taskPython -c 'import torch, torchaudio, demucs, yt_dlp, soundfile; print("Local audio environment ready:", torch.__version__, "GPU: " + torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")'
    if ($LASTEXITCODE -ne 0) { throw 'Audio environment verification failed.' }
    Write-Host 'Ready. Run .\start-local.ps1 to open the web app.'
    Write-Host 'Model weights are downloaded on the first separation and kept in .runtime/models.'
} finally { Pop-Location }
