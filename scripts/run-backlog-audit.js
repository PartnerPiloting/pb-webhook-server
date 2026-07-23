/**
 * One-off (re-runnable) backlog audit — see services/wingguyBacklogAudit.js.
 * Reads 12mo LinkedIn + ~90d email, triages every quiet-45d-to-12mo engaged lead into
 * reopen/park/writeoff, pre-writes re-opening drafts, stores the worklist for wingguy_backlog.
 *
 * Usage: node scripts/run-backlog-audit.js [--tenant=Guy-Wilson]
 */
require('dotenv').config();
const arg = process.argv.slice(2).find((a) => a.startsWith('--tenant='));
const tenant = arg ? arg.split('=')[1] : 'Guy-Wilson';
(async () => {
  console.log(`[backlog-audit] starting for ${tenant} at ${new Date().toISOString()}`);
  const { runBacklogAudit } = require('../services/wingguyBacklogAudit');
  const started = Date.now();
  try {
    const counts = await runBacklogAudit(tenant);
    console.log(`[backlog-audit] DONE in ${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(counts)}`);
    process.exit(0);
  } catch (e) {
    console.error(`[backlog-audit] FAILED: ${e.message}`);
    try {
      const { sendAlertEmail } = require('../services/emailNotificationService');
      await sendAlertEmail(`Wingguy backlog audit FAILED (${tenant})`, `<pre>${String(e.message).slice(0, 500)}</pre>`);
    } catch (_) {}
    process.exit(1);
  }
})();
