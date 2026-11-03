$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Keep any existing HARVEST_LLM_PROVIDER / MODEL / API_KEY values in this shell.
# This launcher only normalises the local demo identities and uses a clean recording DB.
$env:HARVEST_ENV = 'demo'
$env:HARVEST_DB = 'data/harvest_take3.db'
$env:SIFU_EXPERT_DIRECTORY = '[{"id":"expert","name":"Tan Wei Ming","role":"Senior M&E Technician","skills":["sump systems","drainage","pump maintenance"],"domains":["Technical Services"]}]'
$env:SIFU_KNOWLEDGE_OWNERS = '[{"id":"approver","name":"Jennifer Lim","domains":["Technical Services"]}]'

if ($env:HARVEST_AUTH_TOKENS) {
    Write-Warning 'HARVEST_AUTH_TOKENS is already set. Ensure it contains actor id "expert" for the expert token and actor id "approver" for the approver token, or unset it for the bundled demo identities.'
}

if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & '.venv/Scripts/python.exe' -m pip install -r requirements-dev.lock
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# A recording run must start without stale conversations/candidates from previous attempts.
$take3Db = Join-Path $projectRoot 'data\harvest_take3.db'
if (Test-Path -LiteralPath $take3Db) {
    Remove-Item -LiteralPath $take3Db -Force
}

Write-Host 'Starting Sifu backend with deterministic Take 3 demo state:'
Write-Host '  Clean database -> data/harvest_take3.db'
Write-Host '  Tan Wei Ming -> actor id expert'
Write-Host '  Jennifer Lim -> actor id approver'
Write-Host 'Existing live-AI provider variables are preserved.'

& '.venv/Scripts/python.exe' -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
