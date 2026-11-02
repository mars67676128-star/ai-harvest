$ErrorActionPreference = "Stop"

$ThisDir = $PSScriptRoot
$BaseLauncher = Join-Path $ThisDir "record-demo-take3.ps1"
$RuntimeLauncher = Join-Path $ThisDir ".record-demo-take3-final.runtime.ps1"

if (-not (Test-Path $BaseLauncher)) {
    throw "Base Take 3 launcher not found at $BaseLauncher"
}

$source = Get-Content $BaseLauncher -Raw

$oldRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3.mjs"'
$newRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3-final.mjs"'
if (-not $source.Contains($oldRecorder)) {
    throw "Take 3 Final launcher patch failed: recorder assignment not found."
}
$source = $source.Replace($oldRecorder, $newRecorder)

# Preserve data\video-demo-take3.db exactly so the recording-only routing stabilizer remains active.
$source = $source.Replace('Sifu_DemoDay_Take3.webm', 'Sifu_DemoDay_Take3_Final.webm')
$source = $source.Replace('take3-failure.png', 'take3-final-failure.png')
$source = $source.Replace('Recording polished Sifu Demo Day Take 3...', 'Recording polished Sifu Demo Day Take 3 Final...')
$source = $source.Replace('Take 3 WEBM:', 'Take 3 Final WEBM:')

Set-Content -Path $RuntimeLauncher -Value $source -Encoding UTF8
try {
    & $RuntimeLauncher
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item $RuntimeLauncher -Force -ErrorAction SilentlyContinue
}
