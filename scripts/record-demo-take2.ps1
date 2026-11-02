param(
  [string]$Url = "http://127.0.0.1:5173"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $RepoRoot "frontend"
$Recorder = Join-Path $Frontend "scripts\record-demo-take2.mjs"
$VideoDir = Join-Path $RepoRoot "artifacts\video"
$BackendStart = Join-Path $RepoRoot "scripts\start.ps1"

function Test-Http([string]$Target) {
  try {
    $r = Invoke-WebRequest -Uri $Target -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Wait-Http([string]$Target, [string]$Name, [int]$Seconds = 45) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Http $Target) {
      Write-Host "$Name is ready: $Target" -ForegroundColor Green
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name did not become ready at $Target within $Seconds seconds."
}

if (-not (Test-Path $Recorder)) {
  throw "Missing Take 2 recorder: $Recorder"
}

New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null

# Start FastAPI if it is not already running.
if (-not (Test-Http "http://127.0.0.1:8000/health")) {
  Write-Host "Backend is not running. Starting FastAPI on 127.0.0.1:8000..." -ForegroundColor Cyan
  if (-not (Test-Path $BackendStart)) { throw "Missing backend launcher: $BackendStart" }
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $BackendStart + '"')
  ) | Out-Null
  Wait-Http "http://127.0.0.1:8000/health" "Backend" 60
} else {
  Write-Host "Backend already running on 127.0.0.1:8000." -ForegroundColor DarkGreen
}

# Make sure frontend dependencies exist before trying to start Vite.
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  Write-Host "frontend/node_modules not found. Installing frontend dependencies..." -ForegroundColor Cyan
  Push-Location $Frontend
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  finally { Pop-Location }
}

# Start Vite if it is not already running.
if (-not (Test-Http $Url)) {
  Write-Host "Frontend is not running. Starting Vite on 127.0.0.1:5173..." -ForegroundColor Cyan
  $frontendCommand = "Set-Location -LiteralPath '$($Frontend.Replace("'", "''"))'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-Command", $frontendCommand
  ) | Out-Null
  Wait-Http $Url "Frontend" 60
} else {
  Write-Host "Frontend already running: $Url" -ForegroundColor DarkGreen
}

$env:SIFU_DEMO_URL = $Url
$env:SIFU_VIDEO_DIR = $VideoDir

Push-Location $Frontend
try {
  node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Playwright is not installed in frontend/node_modules. Installing a local no-save copy..." -ForegroundColor Cyan
    npm install --no-save --package-lock=false playwright
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Playwright." }
  }

  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "Failed to install Playwright Chromium." }

  Write-Host "Recording Sifu Demo Day Take 2..." -ForegroundColor Cyan
  node $Recorder
  if ($LASTEXITCODE -ne 0) {
    throw "Take 2 recorder failed. Check artifacts\video\take2-failure.png."
  }
}
finally {
  Pop-Location
}
