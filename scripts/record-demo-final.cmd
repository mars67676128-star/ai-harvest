@echo off
setlocal
cd /d "%~dp0.."

echo.
echo === SIFU final-pass recorder ===
echo Uses the proven final recorder from yesterday with only presentation refinements.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0record-demo-final.ps1"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo Final-pass recording failed with exit code %EXITCODE%.
  exit /b %EXITCODE%
)

set "WEBM=%CD%\artifacts\video\Sifu_DemoDay_Final.webm"
set "MP4=%CD%\artifacts\video\Sifu_DemoDay_Final.mp4"
where ffmpeg >nul 2>nul
if %ERRORLEVEL%==0 if exist "%WEBM%" (
  echo.
  echo Converting to PowerPoint-safe H.264 MP4...
  ffmpeg -y -i "%WEBM%" -c:v libx264 -pix_fmt yuv420p -r 25 -movflags +faststart -an "%MP4%"
  if %ERRORLEVEL%==0 echo Final MP4: %MP4%
)

exit /b 0
