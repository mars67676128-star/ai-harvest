$ErrorActionPreference = "Stop"

$ThisDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $ThisDir
$FrontendDir = Join-Path $RepoRoot "frontend"
$BaseLauncher = Join-Path $ThisDir "record-demo-take3.ps1"
$RuntimeLauncher = Join-Path $ThisDir ".record-demo-final.runtime.ps1"
$FinalRecorder = Join-Path $FrontendDir "scripts\record-demo-final.mjs"

if (-not (Test-Path $BaseLauncher)) {
    throw "Base Take 3 launcher not found at $BaseLauncher"
}
if (-not (Test-Path $FinalRecorder)) {
    throw "Final recorder not found at $FinalRecorder"
}

Write-Host "Preflighting final recorder patches and JavaScript syntax..." -ForegroundColor Cyan
$OriginalCheck = $env:TAKE3_FINAL_PATCH_CHECK_ONLY
try {
    $env:TAKE3_FINAL_PATCH_CHECK_ONLY = "1"
    Push-Location $FrontendDir
    try {
        node $FinalRecorder
        if ($LASTEXITCODE -ne 0) {
            throw "Final recorder preflight failed. No recording services were started."
        }
    } finally { Pop-Location }
}
finally {
    if ($null -eq $OriginalCheck) {
        Remove-Item Env:TAKE3_FINAL_PATCH_CHECK_ONLY -ErrorAction SilentlyContinue
    } else {
        $env:TAKE3_FINAL_PATCH_CHECK_ONLY = $OriginalCheck
    }
}

$source = Get-Content $BaseLauncher -Raw

$oldRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-take3.mjs"'
$newRecorder = '$Recorder = Join-Path $FrontendDir "scripts\record-demo-final.mjs"'
if (-not $source.Contains($oldRecorder)) {
    throw "Final launcher patch failed: base recorder assignment not found."
}
$source = $source.Replace($oldRecorder, $newRecorder)

# Keep the Take 3 DB filename so sitecustomize.py's recording-only routing/reuse
# stabilizers activate. Only the video filename and diagnostics are renamed.
$source = $source.Replace('Sifu_DemoDay_Take3.webm', 'Sifu_DemoDay_Final.webm')
$source = $source.Replace('take3-failure.png', 'final-recording-failure.png')
$source = $source.Replace('Recording polished Sifu Demo Day Take 3...', 'Recording final Sifu demo — zoom-only emphasis...')
$source = $source.Replace('Take 3 WEBM:', 'FINAL VIDEO:')

# Insert a real stabilizer check after the base launcher has configured HARVEST_DB.
$marker = 'Write-Host "Preflighting Sifu-agent backend..." -ForegroundColor Cyan'
if (-not $source.Contains($marker)) {
    throw "Final launcher patch failed: backend preflight marker not found."
}
$check = @'
Write-Host "Verifying deterministic demo routing/reuse stabilizer..." -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    & $Python -c "import sitecustomize; assert getattr(sitecustomize, 'TAKE3_STABILIZER_ACTIVE', False), 'demo stabilizer inactive'; print('Demo stabilizer active')"
    if ($LASTEXITCODE -ne 0) { throw "Demo stabilizer did not activate." }
} finally { Pop-Location }

'@
$source = $source.Replace($marker, $check + $marker)

Set-Content -Path $RuntimeLauncher -Value $source -Encoding UTF8
try {
    & $RuntimeLauncher
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item $RuntimeLauncher -Force -ErrorAction SilentlyContinue
}
