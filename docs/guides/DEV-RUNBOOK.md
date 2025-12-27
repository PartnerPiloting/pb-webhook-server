# Dev Runbook (Simplified Reliable Workflow)

## ✅ Everyday Start / Restart (Use This First)
This is the only process you normally need.

1. Start API (VS Code Task): `API: Start (keep running)` → wait for “Server running on port 3001.”  
2. Start Frontend (VS Code Task): `Frontend: Start (port 3000)` → wait for the Next.js local URL.  
3. Open: http://localhost:3000/?testClient=Guy-Wilson

### To Restart Both Servers (normal case)
Say/Type: “Restart both servers” (agent will):
1. Run `npm run dev:reset` (kills stray node processes).  
2. Start API task, wait for healthy log line.  
3. Start Frontend task.  
4. Confirm ready.

### If Frontend Port 3000 Is Busy
Run `npm run dev:reset` and repeat the steps above. (Manual Task Manager kill of node.exe is the fallback.)

### When To Escalate
| Symptom | Action |
|---------|--------|
| API task won’t bind to 3001 after dev:reset | Kill node.exe in Task Manager, retry. |
| Still blocked / unknown process on 3001 | Clean Slate Recovery (below). |
| Repeated abnormal crashes | Investigate recent code changes, then Clean Slate. |
| Ports free but requests hang | Browser cache / frontend rebuild → restart frontend only. |
| Nothing works after multiple clean cycles | Reboot (rare). |

### Golden Rules
* Only the two VS Code tasks for daily work.  
* Avoid accumulating terminals (>3 is a smell).  
* Don’t use `dev:simple` unless explicitly testing concurrency behavior.  
* Prefer restart via `npm run dev:reset` over manual netstat hunting.

---

## 🧪 Health Checks (Quick)
API basic: `http://localhost:3001/basic-test`  
API json: `http://localhost:3001/api/test/minimal-json`  
Feature (example): `http://localhost:3001/api/top-scoring-leads/status`  
UI: `http://localhost:3000/?testClient=Guy-Wilson`

---

## 🔧 Clean Slate Recovery (when everything is broken)

Use only if normal restart failed twice.

**Symptoms:** ports stuck, repeated nodemon loops, unexplained hangs.

1. **Kill all node:**
   ```bash
   taskkill /IM node.exe /F
   ```

2. **Verify ports are free:**
   ```bash
   netstat -ano | findstr :3000    # should be empty
   netstat -ano | findstr :3001    # should be empty
   ```

3. **Fresh start (preferred now):** Start API task → then Frontend task.  
   (Legacy batch file acceptable: `start-dev-windows.bat`)

4. **Wait and verify:**
   ```bash
   sleep 10
   curl http://localhost:3001/basic-test    # should show "BASIC ROUTE WORKING"
   ```

**Still broken?** Check API task logs for the first error lines; copy those into an issue / ask the agent.

---

## ⚠️ Common Pitfalls (Avoid)

**DON'T**
* Start extra combined scripts while tasks already run.
* Accumulate 10+ terminals and lose track.
* Run curl checks inside the API task terminal.

**DO**
* Keep API + Frontend tasks isolated.
* Use `npm run dev:reset` before a restart if there’s any doubt.
* Keep everything else in a single throwaway terminal.

---(Generic)

This guide is a generic, repeatable playbook for this repo and similar Node/Next.js projects. It prevents the common multi-hour pitfalls: terminal reuse killing servers, port conflicts, missing env, and unclear health checks. Use it when starting fresh, and when something breaks mid-session.

## (Legacy) Batch Start Shortcut
`start-dev-windows.bat` still works (opens two windows). Prefer tasks for clarity.

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

## TL;DR (Updated)
API task first → Frontend task next → Use `npm run dev:reset` before restarts → Health check → Continue.

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

## 🤖 Agent Automation (Updated Minimal Set)

**CRITICAL: Follow this exact sequence to avoid the terminal reuse problem:**

1. Run `npm run dev:reset` (optional if fresh).  
2. Run API task.  
3. After “Server running,” run Frontend task.  
4. Health check (basic-test).  
5. Report ready.  
Avoid spawning servers in same terminal as ad‑hoc commands.

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

## One-click Windows launcher (legacy convenience)
Still available: `start-dev-windows.bat` (opens API 3001 + Frontend 3000). Prefer tasks + `dev:reset` for controlled restarts.

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

### NEW: Frontend keeps starting then stops (exit code 130) repeatedly
**Cause:** The same terminal session was reused for another command (health check, netstat, etc.) after launching the frontend (or API) process. VS Code / shell sends an interrupt (Ctrl+C) which gracefully stops the running Next.js dev server, producing exit code 130.

**Fix (simplest, do every time it happens):**
1. Do NOT try to restart inside that same terminal.
2. Close that terminal tab.
3. Run `npm run dev:reset` in a fresh terminal.
4. Start API (dedicated terminal) — DO NOT type anything more in that tab.
5. Start Frontend (second dedicated terminal) — again, leave it alone.
6. Open / reload the browser page.
7. Run health checks ONLY from a third throw‑away terminal.

**Golden Rule Reinforced:** Once a terminal is running `nodemon` or `next dev`, treat it as READ‑ONLY. Any additional command typed (or automation reusing it) risks sending Ctrl+C.

**Agent / Automation Safe Sequence (copy/paste logic):**
```
npm run dev:reset
 (start API via task or: npm run dev:api)   # leave terminal alone after logs show "Server running on port 3001"
 (start Frontend via task or: npm run dev:front)  # leave terminal alone after Next.js prints "Ready"
curl http://localhost:3001/basic-test      # run in a DIFFERENT terminal
```

**Optional Hard Guard (future improvement):** Add a lightweight wrapper script that spawns detached child processes so the parent terminal can exit without killing servers (e.g. using `start` on Windows or `nohup` on Unix). For now, disciplined terminal separation is lighter and documented here.

---

## Reusable development pattern (for any new feature)
- Keep API and UI on predictable ports (3001/3000) in dev.
- UI auto-detects backend environment (staging vs production) from the site hostname and `VERCEL_ENV`. `NEXT_PUBLIC_API_BASE_URL` is primarily for local overrides (e.g., pointing to `http://localhost:3001`) and is not required for staging/production.
- Add a simple `/status` endpoint for each feature.
- Prefer dry-run defaults for risky operations; add a clear finalize/reset path.
- Provide a “select all by default” path and a “testPageSize/page” option for safe testing.
- Document a few copy-paste health URLs in the README or the API root page.

With this pattern and the isolation rules above, you shouldn’t spend more than a minute getting any feature up in the future.
