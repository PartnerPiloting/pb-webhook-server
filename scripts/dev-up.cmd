@echo off
setlocal ENABLEDELAYEDEXPANSION

echo ===== PartnerPiloting Dev Up (API 3001 + Frontend 3007 with 3010 fallback) =====

REM 1) Kill listeners on ports 3001, 3007, 3010 (if any)
for %%P in (3001 3007 3010) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    echo Killing PID %%a on port %%P...
    taskkill /F /PID %%a >nul 2>&1
  )
)

REM 2) Clear Next.js cache
if exist "linkedin-messaging-followup-next\.next" (
  echo Deleting frontend .next cache...
  rmdir /S /Q "linkedin-messaging-followup-next\.next"
)

REM 3) Start API on 3001 in a background window
echo Starting API on port 3001...
start "API3001" cmd /c "npm run -s dev:api:3001"

REM 4) Wait for API /status to respond 200
echo Waiting for API readiness...
powershell -NoProfile -Command "$u='http://localhost:3001/api/top-scoring-leads/status'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -s 1 }; exit 1"
if errorlevel 1 (
  echo API did not become ready in time. Please check logs.
  goto :end
)

REM 5) Start Next.js on 3007 in background
echo Starting Frontend on port 3007...
start "Next3007" cmd /c "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && npm --prefix linkedin-messaging-followup-next run -s dev"

REM 6) Probe frontend for readiness; fallback to 3010 if needed
echo Probing http://localhost:3007/top-scoring-leads ...
powershell -NoProfile -Command "$u='http://localhost:3007/top-scoring-leads'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -s 1 }; exit 1"
if errorlevel 1 (
  echo Port 3007 didn^'t respond; switching to 3010...
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3007 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
  start "Next3010" cmd /c "set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 && npm --prefix linkedin-messaging-followup-next run -s dev:3010"
  echo Probing http://localhost:3010/top-scoring-leads ...
  powershell -NoProfile -Command "$u='http://localhost:3010/top-scoring-leads'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -s 1 }; exit 1"
  if errorlevel 1 (
    echo Frontend did not become ready on 3010. Please check the Next.js window.
  ) else (
    echo Ready: http://localhost:3010/top-scoring-leads
  )
) else (
  echo Ready: http://localhost:3007/top-scoring-leads
)

:end
endlocal
