param(
  [string]$Url = "http://127.0.0.1:5173"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $RepoRoot "frontend"
$Script = Join-Path $Frontend "scripts\record-demo-take2.mjs"
$VideoDir = Join-Path $RepoRoot "artifacts\video"

if (-not (Test-Path $Script)) {
  throw "Missing Take 2 recorder: $Script"
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

  node $Script
  if ($LASTEXITCODE -ne 0) { throw "Take 2 recorder failed. Check artifacts\video\take2-failure.png." }
}
finally {
  Pop-Location
}
