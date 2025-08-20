@echo off
REM start-dev-windows-3007.bat - Launch API (3001) and Frontend on port 3007 (Windows)

setlocal ENABLEEXTENSIONS
cd /d %~dp0

REM Start API only if port 3001 is free (avoid conflicts with an already running API)
cmd /c "netstat -ano | findstr LISTENING | findstr :3001" >nul 2>&1
if errorlevel 1 (
	echo API port 3001 is free - starting API...
	start "API Server (3001)" cmd /k "npm run dev:api"
) else (
	echo API already running on port 3001 - skipping API start.
)

REM Give API a moment to boot before opening the frontend window
powershell -NoProfile -Command "Start-Sleep -Seconds 3"

REM Start Frontend in its own window on port 3007, with API base URL set
REM Clear the Next.js cache first to avoid stale /_next chunk 404s
start "Frontend (3007)" cmd /k "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && if exist .next (rmdir /s /q .next) && npm run dev -- --port 3007"

echo Servers launching in separate windows (API:3001, Frontend:3007)...
endlocal
