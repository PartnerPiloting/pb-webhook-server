@echo off
REM Detached launcher: starts API (3001) and Frontend (3000) in separate windows safely
echo [start-dev-detached] Starting API on 3001...
start "API-3001" cmd /C "npm run dev:api"
REM Small delay so API boot messages begin before frontend starts
ping 127.0.0.1 -n 3 >nul
echo [start-dev-detached] Starting Frontend on 3000...
start "FRONTEND-3000" cmd /C "npm run dev:front"
echo [start-dev-detached] Both processes launched. Close this window; servers keep running.
exit /B 0
