@echo off
REM ALSVID V2.0 - initialize cloud-backed service and start port 8089
cd /d "%~dp0server"
if not exist "node_modules" (
  echo Installing server dependencies...
  call npm install --no-audit --no-fund
)
if not exist "..\client\dist\index.html" (
  echo Building frontend...
  cd /d "%~dp0client"
  call npm install --no-audit --no-fund
  call npm run build
  cd /d "%~dp0server"
)
echo Starting ALSVID V2.0 with the active cloud database and object storage at http://localhost:8089
node secret-bootstrap.js
pause
