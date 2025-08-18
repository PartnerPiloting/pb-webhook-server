@echo off
REM start-dev-windows.bat - Launch API and Frontend in separate terminals (Windows)

setlocal ENABLEEXTENSIONS
cd /d %~dp0

REM Start API in its own window and keep it running
start "API Server (3001)" cmd /k "npm run dev:api"

REM Give API a moment to boot before opening the frontend window
powershell -NoProfile -Command "Start-Sleep -Seconds 3"

REM Start Frontend in its own window, with API base URL set
start "Frontend (3000)" cmd /k "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && npm run dev"

echo Servers launching in separate windows...
endlocal
