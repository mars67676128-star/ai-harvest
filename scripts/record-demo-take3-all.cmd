@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found in PATH.
  exit /b 1
)

node "%~dp0run-demo-take3.mjs"
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo Take 3 session failed with exit code %EXITCODE%.
)

exit /b %EXITCODE%
