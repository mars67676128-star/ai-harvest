$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & '.venv/Scripts/python.exe' -m pip install -r requirements-dev.lock
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& '.venv/Scripts/python.exe' -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
