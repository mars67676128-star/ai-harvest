param(
  [string]$Url = "http://127.0.0.1:5173"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $RepoRoot "frontend"
$Recorder = Join-Path $Frontend "scripts\record-demo-take2.mjs"
$VideoDir = Join-Path $RepoRoot "artifacts\video"
$VenvDir = Join-Path $RepoRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$ReqFile = Join-Path $RepoRoot "requirements-dev.lock"
$BackendOut = Join-Path $VideoDir "take2-backend.stdout.log"
$BackendErr = Join-Path $VideoDir "take2-backend.stderr.log"

function Test-Http([string]$Target) {
  try {
    $r = Invoke-WebRequest -Uri $Target -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Show-LogTail([string]$Path, [string]$Label) {
  if (Test-Path $Path) {
    Write-Host "`n--- $Label (last 80 lines) ---" -ForegroundColor Yellow
    Get-Content $Path -Tail 80 | ForEach-Object { Write-Host $_ }
  }
}

function Wait-Http([string]$Target, [string]$Name, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Http $Target) {
      Write-Host "$Name is ready: $Target" -ForegroundColor Green
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if (-not (Test-Path $Recorder)) {
  throw "Missing Take 2 recorder: $Recorder"
}

New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null

# ---------------------------------------------------------------------------
# Backend preflight: create/repair the venv synchronously before starting
# Uvicorn. This avoids timing out while pip is still installing packages.
# ---------------------------------------------------------------------------
if (-not (Test-Http "http://127.0.0.1:8000/health")) {
  if (-not (Test-Path $VenvPython)) {
    Write-Host "Python virtual environment not found. Creating .venv..." -ForegroundColor Cyan
    python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to create .venv. Make sure Python is installed and available as 'python'." }
  }

  Write-Host "Checking backend Python dependencies..." -ForegroundColor Cyan
  & $VenvPython -c "import fastapi, uvicorn, httpx, pydantic" 2>$null
  if ($LASTEXITCODE -ne 0) {
    if (-not (Test-Path $ReqFile)) { throw "Missing dependency lockfile: $ReqFile" }
    Write-Host "Backend dependencies are incomplete. Installing requirements-dev.lock..." -ForegroundColor Cyan
    & $VenvPython -m pip install -r $ReqFile
    if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
  }

  # Import the application before spawning Uvicorn so startup exceptions are
  # shown immediately instead of becoming a generic 60-second timeout.
  Write-Host "Preflighting harvest.main..." -ForegroundColor Cyan
  Push-Location $RepoRoot
  try {
    & $VenvPython -c "import harvest.main; print('Backend import OK')"
    if ($LASTEXITCODE -ne 0) {
      throw "Backend import failed. The traceback above is the actual startup error."
    }
  }
  finally { Pop-Location }

  Remove-Item $BackendOut, $BackendErr -Force -ErrorAction SilentlyContinue
  Write-Host "Backend is not running. Starting FastAPI on 127.0.0.1:8000..." -ForegroundColor Cyan
  $backendProcess = Start-Process -FilePath $VenvPython `
    -ArgumentList @("-m", "uvicorn", "harvest.main:app", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr `
    -PassThru

  if (-not (Wait-Http "http://127.0.0.1:8000/health" "Backend" 90)) {
    Write-Host "Backend did not become ready." -ForegroundColor Red
    if ($backendProcess.HasExited) {
      Write-Host "Backend process exited with code $($backendProcess.ExitCode)." -ForegroundColor Red
    } else {
      Write-Host "Backend process is still running but /health is not responding." -ForegroundColor Red
    }
    Show-LogTail $BackendOut "backend stdout"
    Show-LogTail $BackendErr "backend stderr"
    throw "Backend startup failed. See the log output above and artifacts\video\take2-backend.*.log."
  }
} else {
  Write-Host "Backend already running on 127.0.0.1:8000." -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
  Write-Host "frontend/node_modules not found. Installing frontend dependencies..." -ForegroundColor Cyan
  Push-Location $Frontend
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }
  finally { Pop-Location }
}

if (-not (Test-Http $Url)) {
  Write-Host "Frontend is not running. Starting Vite on 127.0.0.1:5173..." -ForegroundColor Cyan
  $frontendCommand = "Set-Location -LiteralPath '$($Frontend.Replace("'", "''"))'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-Command", $frontendCommand
  ) | Out-Null
  if (-not (Wait-Http $Url "Frontend" 90)) {
    throw "Frontend did not become ready at $Url. Run 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort' from frontend to see the Vite error."
  }
} else {
  Write-Host "Frontend already running: $Url" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------------
# Playwright recording
# ---------------------------------------------------------------------------
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
