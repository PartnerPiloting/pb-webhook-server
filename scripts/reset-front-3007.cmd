@echo off
REM Kill any process on port 3007, clear .next, start Next on 3007
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3007 ^| findstr LISTENING') do set PID=%%a
if defined PID (
  echo Killing PID %PID% on 3007...
  taskkill /F /PID %PID% >nul 2>&1
)
if exist "linkedin-messaging-followup-next\.next" (
  echo Deleting .next cache...
  rmdir /S /Q "linkedin-messaging-followup-next\.next"
)
set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
cd /d linkedin-messaging-followup-next
npm run dev
