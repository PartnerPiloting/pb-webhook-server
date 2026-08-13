// Manual trigger for the Wingguy monitor — runs the daily check immediately (ignores the clock and
// the already-ran-today gate, and does NOT stamp state, so the real 7am run still happens).
// Usage (Render one-off job): node scripts/wingguy-monitor-run-now.js [--heartbeat]
const monitor = require('../services/wingguyMonitor');

(async () => {
  const heartbeat = process.argv.includes('--heartbeat');
  const r = heartbeat
    ? await monitor.runWeeklyHeartbeat({ force: true })
    : await monitor.runDailyCheck({ force: true });
  console.log('WINGGUY-MONITOR run-now result:', JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
