$ErrorActionPreference = "Stop"

$ThisDir = $PSScriptRoot
$BaseLauncher = Join-Path $ThisDir "record-demo-take3.ps1"
$RuntimeLauncher = Join-Path $ThisDir ".record-demo-take3-polished.runtime.ps1"

if (-not (Test-Path $BaseLauncher)) {
    throw "Base Take 3 launcher not found at $BaseLauncher"
}

$source = Get-Content $BaseLauncher -Raw

$oldRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3.mjs"'
$newRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3-polished.mjs"'
if (-not $source.Contains($oldRecorder)) {
    throw "Take 3 Polished launcher patch failed: recorder assignment not found."
}
$source = $source.Replace($oldRecorder, $newRecorder)

# Keep data\video-demo-take3.db unchanged so sitecustomize.py keeps the recording-only
# expert-routing stabilizer active. Only the recorder and output filename change.
$source = $source.Replace('Sifu_DemoDay_Take3.webm', 'Sifu_DemoDay_Take3_Polished.webm')
$source = $source.Replace('take3-failure.png', 'take3-polished-failure.png')
$source = $source.Replace('Recording polished Sifu Demo Day Take 3...', 'Recording polished Sifu Demo Day Take 3 Polished...')
$source = $source.Replace('Take 3 WEBM:', 'Take 3 Polished WEBM:')

Set-Content -Path $RuntimeLauncher -Value $source -Encoding UTF8
try {
    & $RuntimeLauncher
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item $RuntimeLauncher -Force -ErrorAction SilentlyContinue
}
