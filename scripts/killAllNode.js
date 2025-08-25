#!/usr/bin/env node
// Minimal, fast reset for dev: kill all node.exe processes (Windows) or node (other).
// Intent: provide a predictable clean slate without netstat scanning.
// Safe in this repo because only dev servers use node processes locally.

const { execSync } = require('child_process');

function windowsKillAllNode() {
  try {
    const list = execSync('tasklist /FI "IMAGENAME eq node.exe"', { encoding: 'utf8' });
  const lines = list.split(/\r?\n/).filter(l => /node\.exe/i.test(l));
    if (!lines.length) {
      console.log('No node.exe processes found.');
      return;
    }
    // Lines look like: node.exe           12345 Console    1    50,000 K
    const selfPid = String(process.pid);
    const pids = lines.map(l => l.trim().split(/\s+/)[1]).filter(Boolean).filter(pid => pid !== selfPid);
    const unique = [...new Set(pids)];
    if (!unique.length) {
      console.log('No other node.exe processes (only this script).');
      return;
    }
    console.log('Killing node PIDs (excluding self):', unique.join(', '));
    for (const pid of unique) {
      try {
        execSync(`taskkill /PID ${pid} /F >NUL 2>&1`);
      } catch (_) {
        // ignore individual failures
      }
    }
  console.log('Kill attempt complete.');
  } catch (e) {
    console.error('Failed to enumerate node.exe processes:', e.message);
  }
}

function unixKillAllNode() {
  try {
    execSync('pkill -f node');
    console.log('Issued pkill -f node');
  } catch (e) {
    console.log('pkill returned non-zero (maybe no processes).');
  }
}

if (process.platform === 'win32') windowsKillAllNode(); else unixKillAllNode();

// Always exit cleanly (some taskkill operations can set a non-zero code indirectly)
process.on('uncaughtException', (e) => {
  console.log('Non-fatal exception during killAllNode:', e.message);
  process.exit(0);
});
process.on('unhandledRejection', (e) => {
  console.log('Non-fatal rejection during killAllNode:', e && e.message ? e.message : e);
  process.exit(0);
});
process.exit(0);
