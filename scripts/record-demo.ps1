$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot "frontend"
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$VideoDb = Join-Path $RepoRoot "data\video-demo.db"
$VideoDir = Join-Path $RepoRoot "artifacts\video"
$Webm = Join-Path $VideoDir "Sifu_DemoDay.webm"
$Mp4 = Join-Path $VideoDir "Sifu_DemoDay.mp4"

function Test-LocalPort([int]$Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $connected = $result.AsyncWaitHandle.WaitOne(250)
        if ($connected) {
            $client.EndConnect($result)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Wait-Http([string]$Url, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Timed out waiting for $Url"
}

if (-not (Test-Path $Python)) {
    throw "Python virtual environment not found at $Python. Create .venv first."
}
if (-not $env:HARVEST_LLM_API_KEY) {
    throw "HARVEST_LLM_API_KEY is not set in this PowerShell session."
}
if (-not $env:SIFU_EXPERT_DIRECTORY) {
    throw "SIFU_EXPERT_DIRECTORY is not set in this PowerShell session."
}
if (-not $env:SIFU_KNOWLEDGE_OWNERS) {
    throw "SIFU_KNOWLEDGE_OWNERS is not set in this PowerShell session."
}
if (Test-LocalPort 8000) {
    throw "Port 8000 is already in use. Stop the currently running backend before recording."
}
if (Test-LocalPort 5173) {
    throw "Port 5173 is already in use. Stop the currently running frontend before recording."
}

$OriginalDb = $env:HARVEST_DB
$OriginalProvider = $env:HARVEST_LLM_PROVIDER
$OriginalBaseUrl = $env:HARVEST_LLM_BASE_URL
$OriginalModel = $env:HARVEST_LLM_MODEL
$OriginalReasoning = $env:HARVEST_LLM_REASONING_EFFORT

$BackendProcess = $null
$FrontendProcess = $null

try {
    New-Item -ItemType Directory -Force -Path (Split-Path $VideoDb) | Out-Null
    New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null
    if (Test-Path $VideoDb) { Remove-Item $VideoDb -Force }
    if (Test-Path $Webm) { Remove-Item $Webm -Force }
    if (Test-Path $Mp4) { Remove-Item $Mp4 -Force }

    # This is a fresh, empty recording database. Nothing is seeded into it.
    $env:HARVEST_DB = $VideoDb
    if (-not $env:HARVEST_LLM_PROVIDER) { $env:HARVEST_LLM_PROVIDER = "openai" }
    if (-not $env:HARVEST_LLM_BASE_URL) { $env:HARVEST_LLM_BASE_URL = "https://api.openai.com/v1" }
    if (-not $env:HARVEST_LLM_MODEL) { $env:HARVEST_LLM_MODEL = "gpt-6-luna" }
    if (-not $env:HARVEST_LLM_REASONING_EFFORT) { $env:HARVEST_LLM_REASONING_EFFORT = "high" }

    Write-Host "Preparing Playwright..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium install failed" }
    } finally {
        Pop-Location
    }

    Write-Host "Starting clean video backend..." -ForegroundColor Cyan
    $BackendProcess = Start-Process -FilePath $Python `
        -ArgumentList @("-m", "uvicorn", "harvest.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $RepoRoot -PassThru
    Wait-Http "http://127.0.0.1:8000/health"

    Write-Host "Starting frontend..." -ForegroundColor Cyan
    $FrontendProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "npm run dev -- --host 127.0.0.1") `
        -WorkingDirectory $FrontendDir -PassThru
    Wait-Http "http://127.0.0.1:5173"

    Write-Host "Recording Sifu Demo Day walkthrough..." -ForegroundColor Green
    Push-Location $FrontendDir
    try {
        npm run record-demo
        $RecordExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($RecordExitCode -ne 0) {
        throw "The automated walkthrough stopped before completion. A partial WEBM may still exist in artifacts\video."
    }

    $Ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($Ffmpeg -and (Test-Path $Webm)) {
        Write-Host "Converting WEBM to MP4..." -ForegroundColor Cyan
        & $Ffmpeg.Source -y -i $Webm -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart -an $Mp4
        if ($LASTEXITCODE -eq 0) {
            Write-Host "MP4: $Mp4" -ForegroundColor Green
        } else {
            Write-Warning "FFmpeg conversion failed; the WEBM recording is still available."
        }
    } else {
        Write-Host "FFmpeg not found; keeping the Playwright WEBM recording." -ForegroundColor Yellow
    }

    Write-Host "WEBM: $Webm" -ForegroundColor Green
    Write-Host "Recording used fresh database: $VideoDb" -ForegroundColor DarkGray
}
finally {
    if ($FrontendProcess) {
        try { & taskkill /PID $FrontendProcess.Id /T /F | Out-Null } catch {}
    }
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        try { Stop-Process -Id $BackendProcess.Id -Force } catch {}
    }

    if ($null -eq $OriginalDb) { Remove-Item Env:HARVEST_DB -ErrorAction SilentlyContinue } else { $env:HARVEST_DB = $OriginalDb }
    if ($null -eq $OriginalProvider) { Remove-Item Env:HARVEST_LLM_PROVIDER -ErrorAction SilentlyContinue } else { $env:HARVEST_LLM_PROVIDER = $OriginalProvider }
    if ($null -eq $OriginalBaseUrl) { Remove-Item Env:HARVEST_LLM_BASE_URL -ErrorAction SilentlyContinue } else { $env:HARVEST_LLM_BASE_URL = $OriginalBaseUrl }
    if ($null -eq $OriginalModel) { Remove-Item Env:HARVEST_LLM_MODEL -ErrorAction SilentlyContinue } else { $env:HARVEST_LLM_MODEL = $OriginalModel }
    if ($null -eq $OriginalReasoning) { Remove-Item Env:HARVEST_LLM_REASONING_EFFORT -ErrorAction SilentlyContinue } else { $env:HARVEST_LLM_REASONING_EFFORT = $OriginalReasoning }
}
