$ErrorActionPreference = "Stop"

$ThisDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $ThisDir
$FrontendDir = Join-Path $RepoRoot "frontend"
$BaseLauncher = Join-Path $ThisDir "record-demo-take3.ps1"
$RuntimeLauncher = Join-Path $ThisDir ".record-demo-take3-polished.runtime.ps1"
$PolishedRecorder = Join-Path $FrontendDir "scripts\record-demo-take3-polished.mjs"

if (-not (Test-Path $BaseLauncher)) {
    throw "Base Take 3 launcher not found at $BaseLauncher"
}
if (-not (Test-Path $PolishedRecorder)) {
    throw "Take 3 Polished recorder not found at $PolishedRecorder"
}

# Fail before starting backend/browser if any patch pattern drifted or the generated
# runtime JavaScript is syntactically invalid.
Write-Host "Preflighting Take 3 Polished recorder patches..." -ForegroundColor Cyan
$OriginalPatchCheck = $env:TAKE3_PATCH_CHECK_ONLY
try {
    $env:TAKE3_PATCH_CHECK_ONLY = "1"
    Push-Location $FrontendDir
    try {
        node $PolishedRecorder
        if ($LASTEXITCODE -ne 0) {
            throw "Take 3 Polished recorder preflight failed. No recording services were started."
        }
    } finally { Pop-Location }
}
finally {
    if ($null -eq $OriginalPatchCheck) {
        Remove-Item Env:TAKE3_PATCH_CHECK_ONLY -ErrorAction SilentlyContinue
    } else {
        $env:TAKE3_PATCH_CHECK_ONLY = $OriginalPatchCheck
    }
}

$source = Get-Content $BaseLauncher -Raw

$oldRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3.mjs"'
$newRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3-polished.mjs"'
if (-not $source.Contains($oldRecorder)) {
    throw "Take 3 Polished launcher patch failed: recorder assignment not found."
}
$source = $source.Replace($oldRecorder, $newRecorder)

# Keep data\video-demo-take3.db unchanged so sitecustomize.py keeps the recording-only
# routing/reuse stabilizers active. Only the recorder and output filename change.
$source = $source.Replace('Sifu_DemoDay_Take3.webm', 'Sifu_DemoDay_Take3_Polished.webm')
$source = $source.Replace('take3-failure.png', 'take3-polished-failure.png')
$source = $source.Replace('Recording polished Sifu Demo Day Take 3...', 'Recording polished Sifu Demo Day Take 3 Polished...')
$source = $source.Replace('Take 3 WEBM:', 'Take 3 Polished WEBM:')

# Verify the recording-only backend stabilizer actually installed before spending time on
# the browser capture. HARVEST_DB has already been set by the base launcher at this point.
$marker = 'Write-Host "Preflighting Sifu-agent backend..." -ForegroundColor Cyan'
if (-not $source.Contains($marker)) {
    throw "Take 3 Polished launcher patch failed: backend preflight marker not found."
}
$stabilizerCheck = @'
Write-Host "Verifying Take 3 demo stabilizer..." -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    & $Python -c "import sitecustomize; assert getattr(sitecustomize, 'TAKE3_STABILIZER_ACTIVE', False), 'Take 3 stabilizer inactive'; print('Take 3 stabilizer active')"
    if ($LASTEXITCODE -ne 0) { throw "Take 3 demo stabilizer did not activate." }
} finally { Pop-Location }

'@
$source = $source.Replace($marker, $stabilizerCheck + $marker)

Set-Content -Path $RuntimeLauncher -Value $source -Encoding UTF8
try {
    & $RuntimeLauncher
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item $RuntimeLauncher -Force -ErrorAction SilentlyContinue
}
