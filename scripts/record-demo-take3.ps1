param(
  [string]$Url = "http://127.0.0.1:5173"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $RepoRoot "frontend"
$Recorder = Join-Path $Frontend "scripts\record-demo-take3.mjs"
$VideoDir = Join-Path $RepoRoot "artifacts\video"

if (-not (Test-Path $Recorder)) {
  throw "Missing Take 3 recorder: $Recorder"
}

New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null
$env:SIFU_DEMO_URL = $Url
$env:SIFU_VIDEO_DIR = $VideoDir

Push-Location $Frontend
try {
  node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Playwright is not installed in frontend/node_modules. Installing a local no-save copy..."
    npm install --no-save --package-lock=false playwright
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Playwright." }
  }

  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "Failed to install Playwright Chromium." }

  Write-Host "Recording Sifu Demo Day Take 3..."
  node $Recorder
  if ($LASTEXITCODE -ne 0) {
    throw "Take 3 recorder failed. Check artifacts\video\take3-failure.png and take3-diagnostics.txt."
  }
}
finally {
  Pop-Location
}

$Webm = Join-Path $VideoDir "Sifu_DemoDay_Take3.webm"
$Mp4 = Join-Path $VideoDir "Sifu_DemoDay_Take3.mp4"

if (Test-Path $Webm) {
  $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($ffmpeg) {
    Write-Host "Converting Take 3 to PowerPoint-safe H.264 MP4..."
    & $ffmpeg.Source -y -i $Webm -c:v libx264 -pix_fmt yuv420p -r 25 -movflags +faststart -an $Mp4
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Take 3 MP4: $Mp4"
    } else {
      Write-Warning "WebM was recorded successfully, but ffmpeg MP4 conversion failed."
    }
  } else {
    Write-Host "Take 3 WebM: $Webm"
    Write-Host "ffmpeg was not found, so MP4 conversion was skipped."
  }
}
