@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where uv >nul 2>&1
if errorlevel 1 (
  echo Install uv and add it to PATH before starting the lab.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" goto missing
if not exist "student-web\dist\index.html" goto missing
if not defined UVICORN_PORT set "UVICORN_PORT=8776"
echo Open /explore/ on the loopback address reported below.
uv run --no-project --python 3.12 --with-requirements requirements-edu.lock python -m uvicorn services.simulation.api:app --host 127.0.0.1 --no-proxy-headers
set "launch_code=%ERRORLEVEL%"
if not "%launch_code%"=="0" pause
exit /b %launch_code%
:missing
echo Extract the full lab archive, or build both frontends using README.md.
pause
exit /b 1
