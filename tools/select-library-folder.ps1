param([string]$InitialPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose the folder for your local karaoke song library'
$dialog.ShowNewFolderButton = $true
if ($InitialPath -and (Test-Path -LiteralPath $InitialPath -PathType Container)) { $dialog.SelectedPath = $InitialPath }
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.Text = 'Karaoke - Choose song library folder'
$owner.ShowInTaskbar = $true
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(460, 120)
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Choose a folder in the dialog. Cancel to keep the current library.'
$label.Dock = 'Fill'
$label.Padding = New-Object System.Windows.Forms.Padding(15)
$owner.Controls.Add($label)
try {
    $owner.Show()
    $owner.Activate()
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        @{ path = $dialog.SelectedPath } | ConvertTo-Json -Compress
    } else { @{ cancelled = $true } | ConvertTo-Json -Compress }
} finally { $dialog.Dispose(); $owner.Dispose() }
