@echo off
REM clean-slate-start.bat - Robust deterministic reset & startup.
REM Goals:
REM  * Never hangs silently
REM  * Waits for API to be truly LISTENING (basic-test 200) before launching frontend
REM  * Chooses 3000 else 3007 automatically
REM  * Emits clear PASS / FAIL summary
REM  * HEADLESS=1 environment variable runs everything in THIS window (no new windows) for automation

setlocal ENABLEEXTENSIONS
cd /d %~dp0
set START_TIME=%TIME%

echo === CLEAN SLATE START (robust) ===
echo Start time: %DATE% %TIME%

set LOG_FILE=startup-log.txt
echo (log) %DATE% %TIME% Clean slate start initiated > %LOG_FILE%

echo [1/8] Killing lingering node processes (safe)...
taskkill /IM node.exe /F >nul 2>&1 && echo   node.exe processes killed || echo   (none running)

echo [2/8] Verifying ports 3000 / 3001 are free...
for %%P in (3000 3001) do (
  netstat -ano | findstr LISTENING | findstr :%%P >nul 2>&1 && (
    echo   WARNING: Port %%P still LISTENING – will try forced PID kill.
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr LISTENING ^| findstr :%%P') do taskkill /PID %%A /F >nul 2>&1
    powershell -NoProfile -Command "Start-Sleep -Seconds 1"
    netstat -ano | findstr LISTENING | findstr :%%P >nul 2>&1 && echo   ERROR: Port %%P still occupied. Aborting. && goto :FAIL
  ) || echo   Port %%P is FREE
)

if defined HEADLESS (
  echo [3/8] Starting API (3001) headless...
  echo (log) Starting API headless >> %LOG_FILE%
  start /b cmd /c "npm run dev:api" > api-headless.log 2>&1
) else (
  echo [3/8] Starting API (3001) window...
  start "API Server (3001)" cmd /k "npm run dev:api"
  echo   Launched API window.
  echo (log) API window launched >> %LOG_FILE%
)

echo [4/8] Waiting for API health (timeout 25s)...
set /a COUNTER=0
:WAIT_API
REM Try both port LISTENING and basic-test endpoint
netstat -ano | findstr LISTENING | findstr :3001 >nul 2>&1 && set PORT_UP=1 || set PORT_UP=0
if %PORT_UP%==1 (
  powershell -NoProfile -Command "try { $r = iwr -UseBasicParsing http://localhost:3001/basic-test -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1 && set API_OK=1 || set API_OK=0
) else (
  set API_OK=0
)
if %API_OK%==1 goto :API_READY
set /a COUNTER+=1
if %COUNTER% GEQ 25 echo   ERROR: API did not become healthy in 25s. && goto :FAIL
powershell -NoProfile -Command "Start-Sleep -Seconds 1"
goto :WAIT_API

:API_READY
echo   API healthy after %COUNTER%s.

echo [5/8] Selecting frontend port (prefer 3000)...
netstat -ano | findstr LISTENING | findstr :3000 >nul 2>&1 && set FRONT_PORT=3007 || set FRONT_PORT=3000
if %FRONT_PORT%==3007 (echo   Port 3000 busy; using 3007) else (echo   Using 3000)

echo [6/8] Launching Frontend on %FRONT_PORT%...
if defined HEADLESS (
  if %FRONT_PORT%==3000 (
    start /b cmd /c "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && npm run dev" > frontend-headless.log 2>&1
  ) else (
    start /b cmd /c "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && if exist .next (rmdir /s /q .next) && npm run dev -- --port 3007" > frontend-headless.log 2>&1
  )
  echo   Frontend (headless) launching...
  echo (log) Frontend headless launching on %FRONT_PORT% >> %LOG_FILE%
) else (
  if %FRONT_PORT%==3000 (
    start "Frontend (3000)" cmd /k "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && npm run dev"
  ) else (
    start "Frontend (3007)" cmd /k "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && cd /d %~dp0\linkedin-messaging-followup-next && if exist .next (rmdir /s /q .next) && npm run dev -- --port 3007"
  )
  echo (log) Frontend window launched on %FRONT_PORT% >> %LOG_FILE%
)

echo [7/8] Waiting 5s for frontend boot stub...
powershell -NoProfile -Command "Start-Sleep -Seconds 5"

echo [8/8] Summary / quick checks:
netstat -ano | findstr LISTENING | findstr :3001 >nul 2>&1 && echo   API LISTENING :3001 OK || echo   API NOT LISTENING (ERROR)
netstat -ano | findstr LISTENING | findstr :%FRONT_PORT% >nul 2>&1 && echo   Frontend LISTENING :%FRONT_PORT% (expected) || echo   Frontend NOT LISTENING (maybe still compiling)
echo   Open: http://localhost:%FRONT_PORT%/?testClient=Guy-Wilson
echo   API  health URL: curl http://localhost:3001/basic-test
echo --- DONE (see %LOG_FILE% / windows / headless logs) ---
goto :EOF

:FAIL
echo !!! CLEAN SLATE START FAILED – see messages above. !!!
echo If port still stuck: run "taskkill /IM node.exe /F" manually and retry.
exit /b 1

endlocal