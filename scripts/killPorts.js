#!/usr/bin/env node
/**
 * Safe cross-platform (Windows + Git Bash) port inspector / killer.
 * Usage:
 *   npm run ports:check          # show status of 3000/3001
 *   npm run ports:free           # attempt graceful kill of 3000/3001 listeners
 *   node scripts/killPorts.js 8080 9229          # custom ports check
 *   node scripts/killPorts.js --kill 8080 9229   # custom ports kill
 *
 * Strategy:
 * 1. For each port, use 'netstat -ano' to find LISTENING PIDs.
 * 2. Display a concise table.
 * 3. If --kill specified, send taskkill /PID <pid> /F (only targets Node.exe by default for safety).
 * 4. Re-check to verify freed.
 */

const { execSync } = require('child_process');

// Hard timeout (ms) for any netstat / tasklist command to prevent perceived hangs.
const CMD_TIMEOUT = 2500; // keep small to stay snappy; if exceeded we degrade gracefully

let warnedTimeout = false;

const args = process.argv.slice(2);
const doKill = args.includes('--kill');
const ports = args.filter(a => /^\d+$/.test(a));
if (ports.length === 0) {
  // default
  ports.push(3000, 3001);
}

function findPidForPort(port) {
  // Narrow the netstat output using findstr (native on Windows) to reduce volume & chance of slowdown.
  const cmd = process.platform === 'win32'
    ? `netstat -ano -p tcp | findstr :${port}`
    : `netstat -anp tcp | grep :${port}`; // fallback for non-Windows (best effort)
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: CMD_TIMEOUT });
    const lines = out.split(/\r?\n/).filter(l => /LISTENING/.test(l));
    const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()))];
    return pids.filter(Boolean);
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') {
      if (!warnedTimeout) {
        console.log(`Timeout while checking port ${port}. Showing partial results (if any).`);
        warnedTimeout = true;
      }
    }
    return [];
  }
}

function pidCommand(pid) {
  return `tasklist /FI "PID eq ${pid}"`;
}

function isNodeProcess(pid) {
  try {
    const out = execSync(pidCommand(pid), { encoding: 'utf8', timeout: CMD_TIMEOUT });
    return /node\.exe/i.test(out) || /node\.js/i.test(out);
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') {
      if (!warnedTimeout) {
        console.log('Timeout while identifying processes. Skipping detailed node.exe check.');
        warnedTimeout = true;
      }
    }
    // Fall back to treating it as node (conservative) so we TRY to kill if user requested.
    return true;
  }
}

function killPid(pid) {
  try {
    const forceFlag = '/F';
    execSync(`taskkill /PID ${pid} ${forceFlag}`, { stdio: 'ignore', timeout: CMD_TIMEOUT }); // no /T to avoid killing parent shells
    return true;
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') {
      console.log(`Timeout while killing PID ${pid}`);
    }
    return false;
  }
}

function status() {
  const rows = [];
  for (const port of ports) {
    const pids = findPidForPort(port);
    rows.push({ port, pids });
  }
  return rows;
}

function printStatus(rows, header) {
  console.log(`\n${header}`);
  console.log('PORT\tPIDS (LISTENING)');
  rows.forEach(r => {
    console.log(`${r.port}\t${r.pids.length ? r.pids.join(',') : '- (free)'}`);
  });
}

const initial = status();
printStatus(initial, 'Current Port Status');
if (initial.every(r => r.pids.length === 0) && !doKill) {
  console.log('\nAll target ports already free. (Fast path)');
}

if (doKill) {
  let anyKilled = false;
  for (const row of initial) {
    for (const pid of row.pids) {
      if (!isNodeProcess(pid)) {
        console.log(`Skip PID ${pid} on port ${row.port} (not node.exe)`);
        continue;
      }
      const ok = killPid(pid);
      console.log(`${ok ? 'Killed' : 'Failed'} PID ${pid} (port ${row.port})`);
      if (ok) anyKilled = true;
    }
  }
  const after = status();
  printStatus(after, 'After Kill Attempt');
  const stillBusy = after.filter(r => r.pids.length > 0);
  if (stillBusy.length) {
    console.log('\nSome ports still occupied (maybe not Node processes). Manual fallback:');
    console.log('  1. netstat -ano | findstr :<port>');
    console.log('  2. taskkill /PID <pid> /F');
  } else if (anyKilled) {
    console.log('\nAll targeted Node listeners freed.');
  } else {
    console.log('\nNo Node listeners were killed (maybe already free).');
  }
}
