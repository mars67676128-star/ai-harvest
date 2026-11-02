$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot "frontend"
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$Recorder = Join-Path $FrontendDir "scripts\record-demo-take2.mjs"
$VideoDb = Join-Path $RepoRoot "data\video-demo-take2.db"
$VideoDir = Join-Path $RepoRoot "artifacts\video"
$Webm = Join-Path $VideoDir "Sifu_DemoDay_Take2.webm"

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
    } catch { return $false }
}

function Wait-Http([string]$Url, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "Timed out waiting for $Url"
}

function Get-JsonArrayCount([string]$Value, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return 0 }
    try {
        $parsed = $Value | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $parsed) { return 0 }
        return @($parsed).Count
    } catch {
        throw "$Name must contain a valid JSON array. Current value could not be parsed."
    }
}

if (-not (Test-Path $Recorder)) {
    throw "Take 2 recorder not found at $Recorder. Make sure you are on demo/take2-sifu-agent."
}
if (-not (Test-Path $Python)) {
    throw "Python virtual environment not found at $Python. Create .venv and install requirements-dev.lock first."
}
if (-not $env:HARVEST_LLM_API_KEY) {
    throw "HARVEST_LLM_API_KEY is not set in this PowerShell session."
}
if (Test-LocalPort 8000) {
    throw "Port 8000 is already in use. Stop the currently running backend before recording Take 2."
}
if (Test-LocalPort 5173) {
    throw "Port 5173 is already in use. Stop the currently running frontend before recording Take 2."
}

$OriginalDb = $env:HARVEST_DB
$OriginalProvider = $env:HARVEST_LLM_PROVIDER
$OriginalBaseUrl = $env:HARVEST_LLM_BASE_URL
$OriginalModel = $env:HARVEST_LLM_MODEL
$OriginalReasoning = $env:HARVEST_LLM_REASONING_EFFORT
$OriginalDemoUrl = $env:SIFU_DEMO_URL
$OriginalExpertDirectory = $env:SIFU_EXPERT_DIRECTORY
$OriginalKnowledgeOwners = $env:SIFU_KNOWLEDGE_OWNERS

$BackendProcess = $null
$FrontendProcess = $null

try {
    New-Item -ItemType Directory -Force -Path (Split-Path $VideoDb) | Out-Null
    New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null
    if (Test-Path $VideoDb) { Remove-Item $VideoDb -Force }
    if (Test-Path $Webm) { Remove-Item $Webm -Force }

    # A Take 2 capture always starts from a clean database and the live Sifu agent.
    $env:HARVEST_DB = $VideoDb
    $env:HARVEST_LLM_PROVIDER = "openai"
    $env:HARVEST_LLM_BASE_URL = "https://api.openai.com/v1"
    if (-not $env:HARVEST_LLM_MODEL) { $env:HARVEST_LLM_MODEL = "gpt-6-luna" }
    if (-not $env:HARVEST_LLM_REASONING_EFFORT) { $env:HARVEST_LLM_REASONING_EFFORT = "high" }
    $env:SIFU_DEMO_URL = "http://127.0.0.1:5173"

    # The recording story requires one relevant expert and one Knowledge Owner. An
    # environment variable containing [] is technically set, but gives Sifu nobody to
    # route to, so treat an empty list the same as an omitted demo configuration.
    $expertCount = Get-JsonArrayCount $env:SIFU_EXPERT_DIRECTORY "SIFU_EXPERT_DIRECTORY"
    if ($expertCount -eq 0) {
        $env:SIFU_EXPERT_DIRECTORY = '[{"id":"expert","name":"Tan Wei Ming","role":"Senior M&E Technician","skills":["sump systems","drainage","pump maintenance"],"domains":["Technical Services"]}]'
        $expertCount = 1
        Write-Host "Take 2 expert directory was empty; using demo expert Tan Wei Ming." -ForegroundColor Yellow
    }

    $ownerCount = Get-JsonArrayCount $env:SIFU_KNOWLEDGE_OWNERS "SIFU_KNOWLEDGE_OWNERS"
    if ($ownerCount -eq 0) {
        $env:SIFU_KNOWLEDGE_OWNERS = '[{"id":"approver","name":"Jennifer Lim","domains":["Technical Services"]}]'
        $ownerCount = 1
        Write-Host "Take 2 Knowledge Owner list was empty; using demo owner Jennifer Lim." -ForegroundColor Yellow
    }

    Write-Host "Take 2 routing config: $expertCount expert(s), $ownerCount Knowledge Owner(s)." -ForegroundColor DarkGray

    Write-Host "Preparing Take 2 Playwright environment..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium install failed" }
    } finally { Pop-Location }

    Write-Host "Preflighting Sifu-agent backend..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        & $Python -c "from harvest.config import Settings; s=Settings.from_env(); assert len(s.expert_directory)>0, 'empty expert directory'; assert len(s.knowledge_owners)>0, 'empty Knowledge Owner list'; from harvest.main import app; print(f'Sifu-agent backend import OK; experts={len(s.expert_directory)} owners={len(s.knowledge_owners)} provider={s.provider}')"
        if ($LASTEXITCODE -ne 0) { throw "Sifu-agent backend preflight failed." }
    } finally { Pop-Location }

    Write-Host "Starting clean Sifu-agent backend..." -ForegroundColor Cyan
    $BackendProcess = Start-Process -FilePath $Python `
        -ArgumentList @("-m", "uvicorn", "harvest.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $RepoRoot -PassThru
    Wait-Http "http://127.0.0.1:8000/health" 60

    Write-Host "Starting Sifu frontend..." -ForegroundColor Cyan
    $FrontendProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort") `
        -WorkingDirectory $FrontendDir -PassThru
    Wait-Http "http://127.0.0.1:5173" 60

    Write-Host "Recording cinematic Sifu Demo Day Take 2..." -ForegroundColor Green
    Push-Location $FrontendDir
    try {
        node $Recorder
        $RecordExitCode = $LASTEXITCODE
    } finally { Pop-Location }

    if ($RecordExitCode -ne 0) {
        throw "Take 2 stopped before completion. Check artifacts\video\take2-failure.png and the partial WEBM."
    }

    Write-Host "Take 2 WEBM: $Webm" -ForegroundColor Green
    Write-Host "Fresh recording database: $VideoDb" -ForegroundColor DarkGray
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
    if ($null -eq $OriginalDemoUrl) { Remove-Item Env:SIFU_DEMO_URL -ErrorAction SilentlyContinue } else { $env:SIFU_DEMO_URL = $OriginalDemoUrl }
    if ($null -eq $OriginalExpertDirectory) { Remove-Item Env:SIFU_EXPERT_DIRECTORY -ErrorAction SilentlyContinue } else { $env:SIFU_EXPERT_DIRECTORY = $OriginalExpertDirectory }
    if ($null -eq $OriginalKnowledgeOwners) { Remove-Item Env:SIFU_KNOWLEDGE_OWNERS -ErrorAction SilentlyContinue } else { $env:SIFU_KNOWLEDGE_OWNERS = $OriginalKnowledgeOwners }
}
