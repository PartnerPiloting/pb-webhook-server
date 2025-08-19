#!/usr/bin/env node
/*
  reset-front.js
  - Kills any process listening on FRONT_PORT (default 3007)
  - Removes the Next.js .next cache folder
  - Starts the frontend dev server on that port
*/
const { execSync, spawn } = require('child_process');
const { existsSync, rmSync } = require('fs');
const { join } = require('path');

const FRONT_PORT = process.env.FRONT_PORT ? Number(process.env.FRONT_PORT) : 3007;
const FRONT_DIR = join(process.cwd(), 'linkedin-messaging-followup-next');

function info(msg){ console.log(`[reset-front] ${msg}`); }
function tryExec(cmd){
  try { return execSync(cmd, { stdio: 'inherit', windowsHide: true }); } catch (e) { /* ignore */ }
}

// 1) Find and kill process on FRONT_PORT (Windows-friendly)
(function killPort(){
  info(`Checking for process on port ${FRONT_PORT}...`);
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${FRONT_PORT} -State Listen).OwningProcess"`, { encoding: 'utf8' }).trim();
    const pid = parseInt(out, 10);
    if (pid && Number.isFinite(pid)) {
      info(`Killing PID ${pid} on port ${FRONT_PORT}...`);
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'inherit' });
    } else {
      info('No PID found on that port.');
    }
  } catch (_) {
    info('No listener found or PowerShell not available.');
  }
})();

// 2) Remove Next.js cache (.next)
(function cleanNext(){
  const dir = join(FRONT_DIR, '.next');
  if (existsSync(dir)) {
    info('Deleting .next cache...');
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { info(`Warning: could not delete .next: ${e.message}`); }
  } else {
    info('.next cache not present.');
  }
})();

// 3) Start the dev server on specified port
(function startDev(){
  info(`Starting Next.js dev on port ${FRONT_PORT}...`);
  const script = FRONT_PORT === 3007 ? 'dev' : 'dev:3010';
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', script], {
    cwd: FRONT_DIR,
    stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001' }
  });
  child.on('exit', (code) => {
    info(`Next.js dev exited with code ${code}`);
  });
})();
