param([string]$InitialPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -Path (Join-Path $PSScriptRoot 'FolderPicker.cs')
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.Text = '唱一下 · 本機歌曲庫'
$owner.ShowInTaskbar = $true
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(460, 120)
$label = New-Object System.Windows.Forms.Label
$owner.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 27)
$owner.ForeColor = [System.Drawing.Color]::FromArgb(216, 250, 133)
$owner.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI', 10)
$label.Text = '選擇歌曲庫的保存位置。取消不會變更原歌曲庫。'
$label.Dock = 'Fill'
$label.Padding = New-Object System.Windows.Forms.Padding(15)
$owner.Controls.Add($label)
try {
    $owner.Show()
    $owner.Activate()
    $selectedPath = [KaraokeFolderPicker]::Choose($owner.Handle, $InitialPath, '選擇歌曲庫資料夾', '使用此資料夾')
    if ($selectedPath) {
        @{ path = $selectedPath } | ConvertTo-Json -Compress
    } else { @{ cancelled = $true } | ConvertTo-Json -Compress }
} finally { $owner.Dispose() }
