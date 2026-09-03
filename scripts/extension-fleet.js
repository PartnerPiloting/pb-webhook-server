/**
 * Who is running which extension version - the fleet view for the pull-updater lane.
 *
 *   node scripts/extension-fleet.js
 *
 * Reads the latest check-in per client. Detection matters more than the fix: a client whose
 * last check-in is days old has a machine that has stopped collecting updates, and that is
 * exactly the silent failure this lane exists to make visible (the Linked Helper lesson -
 * Roland's ran dead for ~10 weeks because nobody noticed).
 *
 * Clients on the OneDrive lane never appear here; they are covered by ship-extension.js's
 * own per-client OK/FAIL table.
 */
require('dotenv').config();

const { latestPerClient } = require('../services/extensionDistStore');

function ageLabel(ts) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 90) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

(async () => {
  const rows = await latestPerClient();
  if (!rows.length) {
    console.log('No extension check-ins yet. Either no client is on the pull-updater lane, or DATABASE_URL is unset.');
    process.exit(0);
  }
  console.log(`\nExtension fleet - ${rows.length} machine(s) reporting\n`);
  for (const r of rows) {
    const stale = (Date.now() - new Date(r.checked_in_at).getTime()) > 3 * 24 * 3600 * 1000;
    const flag = r.action === 'error' ? 'ERROR ' : (stale ? 'STALE ' : '      ');
    console.log(
      `  ${flag}${String(r.client_id).padEnd(18)} ${String(r.version || '?').padEnd(9)} ` +
      `${String(r.action || '').padEnd(8)} ${ageLabel(r.checked_in_at).padEnd(9)} ${r.machine || ''}` +
      (r.note ? `\n         note: ${r.note}` : '')
    );
  }
  console.log('\nSTALE = no check-in for 3+ days: that machine has stopped collecting updates.\n');
  process.exit(0);
})().catch((e) => { console.error('FLEET ERROR:', e.message); process.exit(1); });
