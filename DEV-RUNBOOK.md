# Dev Runbook: Start API and Frontend Relia## 🔧 Clean Slate Recovery (when everything is broken)

**When you see: "localhost refused to connect", servers won't start, or weird port conflicts:**

1. **Kill everything:**
   ```bash
   taskkill /IM node.exe /F
   taskkill /IM cmd.exe /F  # kills any lingering cmd windows
   ```

2. **Verify ports are free:**
   ```bash
   netstat -ano | findstr :3000    # should be empty
   netstat -ano | findstr :3001    # should be empty
   ```

3. **Fresh start:**
   ```bash
   ./start-dev-windows.bat
   ```

4. **Wait and verify:**
   ```bash
   sleep 10
   curl http://localhost:3001/basic-test    # should show "BASIC ROUTE WORKING"
   ```

**Still broken?** Check the two terminal windows that opened - look for error messages in red.

---

## ⚠️ Common AI Assistant Mistakes (and fixes)

**DON'T DO THIS:**
- ❌ Running `npm run dev` in the same terminal as curl commands
- ❌ Trying to start servers with `run_in_terminal` tool in background mode
- ❌ Running health checks in the server terminal
- ❌ Starting multiple servers without the batch file

**DO THIS INSTEAD:**
- ✅ Always use `./start-dev-windows.bat` first
- ✅ Run all health checks in separate terminals  
- ✅ Let the batch file handle environment variables
- ✅ Wait 10 seconds before testing connectivity

---(Generic)

This guide is a generic, repeatable playbook for this repo and similar Node/Next.js projects. It prevents the common multi-hour pitfalls: terminal reuse killing servers, port conflicts, missing env, and unclear health checks. Use it when starting fresh, and when something breaks mid-session.

## 🚀 FASTEST START (Use This First!)

**If you're getting "can't reach" or connection errors:**

1. **One-click solution**: Run `./start-dev-windows.bat` from repo root
2. **Wait 10 seconds** for both servers to fully boot
3. **Test in separate terminal**: `curl http://localhost:3001/basic-test` (should show "BASIC ROUTE WORKING")
4. **Open browser**: http://localhost:3000

✅ **Success indicators:**
- Two separate terminal windows opened (API + Frontend)
- `netstat -ano | findstr :3000` shows LISTENING
- `netstat -ano | findstr :3001` shows LISTENING
- Browser shows the portal interface

❌ **If still broken:** Skip to "Clean Slate Recovery" section below.

---

## QuickStart (fresh machine or new chat)
Prereqs
- Node.js LTS installed (check: `node -v`, `npm -v`)
- VS Code installed
- Git installed (optional but recommended)

Initial setup (once per clone)
1) Install backend deps at repo root:
  - `npm install`
2) Install frontend deps:
  - `npm --prefix linkedin-messaging-followup-next install`
3) Environment file:
  - Create `.env` at repo root if missing.
  - Add required keys (Airtable, OpenAI/Vertex, PB_WEBHOOK_SECRET, etc.). You can start without some; endpoints will warn you if missing.

Ports (dev policy)
- API: 3001 (fixed)
- Frontend: 3000 (or 3007 if 3000 is busy)
- Frontend must point to API: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`

## TL;DR
- Use one terminal for the API only. Don’t reuse or close it.
- Use a second terminal for checks and the frontend.
 - If the API is already running: do not restart it. Just verify health, then start the frontend.

## Start the API (dedicated terminal)
Preferred (VS Code task, keeps its own terminal):
- VS Code → Tasks → Run Task → "API: Start (keep running)"

Option A (with nodemon, auto-restart on file changes):
- npm run dev:api

Option B (no auto-restarts, fewer moving parts):
- node index.js

Verify it’s up (generic health):
- curl http://localhost:3001/basic-test  (expect a short OK text)
- or: curl http://localhost:3001/api/test/minimal-json  (expect simple JSON)
- or: use your feature’s status/health endpoint if it has one

Note: If you see exit code 130 or the API “disappears,” the terminal was interrupted/closed (e.g., window reused or closed). Fix: start via the VS Code task above (or a fresh terminal), and leave that terminal alone.

## Start the Frontend (separate terminal)
Always point the frontend at the local API on 3001:
- NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm --prefix linkedin-messaging-followup-next run dev

If port 3000 is busy:
- NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm --prefix linkedin-messaging-followup-next run dev -- --port 3007

Open your feature page (examples):
- Top Scoring Leads: http://localhost:3000/top-scoring-leads?testClient=Guy-Wilson
- If you used 3007: http://localhost:3007/top-scoring-leads?testClient=Guy-Wilson
- For other features: replace the path (e.g., /my-new-feature) as appropriate.

If the API is already running and healthy (HTTP 200 from /api/top-scoring-leads/status), skip any API restart and go straight to starting the frontend.

## Quick port checks (Windows bash)
- netstat -ano | findstr LISTENING | findstr :3000
- netstat -ano | findstr LISTENING | findstr :3001
- netstat -ano | findstr LISTENING | findstr :3007

No LISTENING entries means that port is free.

## Ports overview
- API: 3001 (fixed for local dev)
- Frontend (Next.js): 3000 by default; use --port 3007 if 3000 is busy
- Frontend always needs NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 so it talks to your local API

## Known gotcha and fix
- Symptom: API starts, then status check fails; exit code is 130.
- Cause: The terminal/task was reused or closed (SIGINT), not a crash.
- Fix: Keep the API in its own terminal (or use the VS Code task below), and use a second terminal for everything else.
 - Tip: Avoid combined tasks when debugging. Start API first (dedicated window), then frontend.

## Keep it running (best practices)
- Start via VS Code task: API: Start (keep running) so it gets its own terminal.
- Do not reuse or close that terminal tab; use a separate tab for checks and the frontend.
- When VS Code asks to restart background tasks for a new task, choose not to restart the API task.
- Prefer `node index.js` (no auto-restart) if nodemon restarts are noisy.
- Avoid closing VS Code or letting the machine sleep while you need the API running.

### When it can still stop
- You close/restart VS Code, the terminal, or the task.
- You start another task and accept “restart running tasks.”
- The machine sleeps or reboots.

### If it stops
1) Check: `curl http://localhost:3001/api/test/minimal-json` (expect 200 + JSON) or `curl http://localhost:3001/basic-test` (expect 200).
2) If not 200: re-run the task “API: Start (keep running)” or `npm run dev:api`, or `node index.js`.
3) If the old terminal is gone and port 3001 is occupied:
  - Find PID: `netstat -ano | findstr LISTENING | findstr :3001`
  - Kill PID: `taskkill /PID <PID> /F` (Windows)
  - As a last resort: `taskkill /IM node.exe /F` (kills all Node processes)

## VS Code tasks (optional)
We’ve added two tasks under .vscode/tasks.json:
- API: Start (keep running)
- Frontend: Start (port 3000)
Use the VS Code command palette: “Tasks: Run Task”.

---

## 🤖 For AI Assistant/Agent (automation-safe instructions)

**CRITICAL: Follow this exact sequence to avoid the terminal reuse problem:**

1. **NEVER try to start servers manually** - always use the batch file:
   ```bash
   ./start-dev-windows.bat
   ```

2. **Wait before testing** (servers need time to boot):
   ```bash
   sleep 10
   ```

3. **Test connectivity in a separate terminal**:
   ```bash
   curl http://localhost:3001/basic-test
   netstat -ano | findstr LISTENING | findstr :3000
   netstat -ano | findstr LISTENING | findstr :3001
   ```

4. **If servers aren't responding:** Use "Clean Slate Recovery" section above

**Why this matters:** AI assistants often try to manage servers in the same execution context as other commands, causing exit code 130 (SIGINT) and server shutdowns. The batch file creates proper isolation.

---

## For AI Assistant/Agent (automation-safe instructions)

To avoid interrupting long-running servers when executing automated checks:

1) Never reuse the API’s terminal. Treat it as read-only once started.
2) Prefer VS Code Tasks to ensure isolation:
  - Run Task: "API: Start (keep running)"
  - Run Task: "Frontend: Start (port 3000)"
3) If tasks are unavailable or blocked, use the Windows launcher below (opens two separate terminal windows):

  - Double-click `start-dev-windows.bat` (or run it from Explorer). It will:
    - Open one terminal for the API at port 3001
    - Open another for the Frontend at port 3000 with NEXT_PUBLIC_API_BASE_URL pre-set

4) Do not run curl/health checks in the API terminal. Use a separate terminal.
5) If you accidentally closed the API terminal or see exit code 130, just re-run the task or the batch file.

Health checks (run in a separate terminal):
- `curl http://localhost:3001/basic-test`
- `curl http://localhost:3001/api/test/minimal-json`
- Feature: `curl http://localhost:3001/api/top-scoring-leads/status`

Note: Automation should not attempt to spawn long-running servers in the same execution context as ad-hoc checks; use the dedicated tasks or the batch launcher.

---

## One-click Windows launcher (no VS Code needed)
Use the included batch file to guarantee separate windows:
- Double-click `start-dev-windows.bat` in the repo folder.
- It opens one window for the API (3001) and another for the Frontend (3000) with the correct API base URL.

---

## Health checks you can bookmark (generic)
While the API is running on 3001:
- http://localhost:3001/basic-test (plain text OK)
- http://localhost:3001/api/test/minimal-json (clean JSON)
- http://localhost:3001/ (API landing with quick links, if available)

Feature-specific examples (adapt names accordingly):
- http://localhost:3001/api/top-scoring-leads/status
- UI: http://localhost:3000/top-scoring-leads?testClient=Guy-Wilson

Pattern to reuse for any feature:
- Provide a status endpoint under `/api/<feature>/status` returning 200 when mounted.
- Expose a minimal JSON endpoint somewhere under `/api/test/` for serialization sanity.

---

## 📋 Troubleshooting cookbook (fast answers)

**"localhost refused to connect" or "can't reach localhost:3000"**
- 🚀 **FIRST TRY**: `./start-dev-windows.bat` then wait 10 seconds
- If still broken: Use "Clean Slate Recovery" section above

**"API worked, then died; exit code 130"**
- Cause: Terminal was reused or interrupted (classic AI assistant mistake)
- 🚀 **Fix**: `./start-dev-windows.bat` for proper isolation

**"Port 3001/3000 is in use"**
- 🚀 **Quick fix**: `taskkill /IM node.exe /F` then `./start-dev-windows.bat`
- Manual approach: Find PID with `netstat -ano | findstr :3001` then `taskkill /PID <PID> /F`

**"Frontend shows nothing or Next.js errors"**
- Check the Frontend terminal window that opened - look for red error messages
- Common cause: Component import/export errors (check React console)

**"cross-env not found" or npm errors**
- The batch file handles this - don't run npm commands manually
- If persistent: `cd linkedin-messaging-followup-next && npm install`

**"Everything was working, now it's broken"**
- 🚀 **Nuclear option**: "Clean Slate Recovery" section above
- Usually caused by: machine sleep, VS Code restart, or terminal conflicts

---

## Troubleshooting cookbook (fast answers)

“API worked, then died; exit code 130”
- You (or a task) reused the API’s terminal or closed it. That sends Ctrl+C.
- Fix: Restart via “API: Start (keep running)” and leave that terminal alone.

“Port 3001/3000 is in use”
- Find the PID: `netstat -ano | findstr LISTENING | findstr :3001`
- Kill it: `taskkill /PID <PID> /F`
- If stubborn: `taskkill /IM node.exe /F`

“curl to 3001 fails to connect”
- API isn’t running or wrong port.
- Start API; confirm `basic-test` or `api/test/minimal-json` returns 200.

“Frontend shows nothing or 404”
- Start frontend on 3000 (or 3007) and check console logs.
- Ensure `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` before starting the frontend.

“cross-env not found”
- Use the VS Code task “Frontend: Start (port 3000)” which calls `npm run dev:front`, resolving local devDependencies.
- Or run from a shell where npm scripts can find local binaries.

“Machine slept; servers disappeared”
- Restart API and Frontend tasks; re-run health checks.

“Stuck in a weird state; I just want clean slate”
1) Close all dev terminals (but note which ports were used).
2) Kill leftover node.exe processes.
3) Confirm ports 3000/3001 are free.
4) Start API task; verify health; then start Frontend.

---

## Reusable development pattern (for any new feature)
- Keep API and UI on predictable ports (3001/3000) in dev.
- UI reads API base from a single env var (`NEXT_PUBLIC_API_BASE_URL`).
- Add a simple `/status` endpoint for each feature.
- Prefer dry-run defaults for risky operations; add a clear finalize/reset path.
- Provide a “select all by default” path and a “testPageSize/page” option for safe testing.
- Document a few copy-paste health URLs in the README or the API root page.

With this pattern and the isolation rules above, you shouldn’t spend more than a minute getting any feature up in the future.
