#!/usr/bin/env node
/**
 * Contacts sweep - nightly top-up of the contacts warehouse (services/contactsStore.js).
 *
 * Walks every active client with a leads base and runs both feeds (leads + comms log) via
 * services/contactsSweep.js. The first run per tenant reads the whole base; every later run
 * asks only for rows modified since the last sweep, so a nightly pass is seconds.
 *
 * Setup in Render Dashboard (crons live there, NOT in render.yaml):
 *   - Create Cron Job on the prod service's repo/env
 *   - Schedule: 0 16 * * *   (16:00 UTC = 02:00 Brisbane)
 *   - Command:  node scripts/contacts-sweep-cron/index.js
 *
 * Flags / env:
 *   --full                     force a full re-read for every tenant swept
 *   --client <id> [--client x] sweep only these client ids (skips the Active check)
 *   CONTACTS_SWEEP_CLIENT_IDS  comma-separated equivalent of --client
 */

require('dotenv').config();

function parseArgs(argv) {
  const out = { full: false, clients: [], skipMail: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full') out.full = true;
    else if (argv[i] === '--no-mail') out.skipMail = true;
    else if (argv[i] === '--client' && argv[i + 1]) { out.clients.push(String(argv[++i]).trim()); }
  }
  const env = String(process.env.CONTACTS_SWEEP_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  out.clients.push(...env);
  return out;
}

async function main() {
  const { full, clients, skipMail } = parseArgs(process.argv.slice(2));
  const { sweepAll } = require('../../services/contactsSweep');
  const t0 = Date.now();
  console.log(`[contacts-sweep] start${full ? ' (FULL)' : ''}${skipMail ? ' (no mail)' : ''}${clients.length ? ` clients=${clients.join(',')}` : ' (all active)'}`);
  const results = await sweepAll({ full, skipMail, onlyClientIds: clients.length ? clients : null });
  let errors = 0;
  for (const r of results) {
    const l = r.leads || {};
    const c = r.commsLog || {};
    const m = r.mail;
    if (l.ok === false && !l.skipped) errors++;
    if (c.ok === false) errors++;
    if (m && m.ok === false && !m.skipped) errors++;
    const mailPart = !m ? 'skipped'
      : m.ok ? `${m.messages} msgs -> ${m.contacts} contacts (${m.mode}${m.truncated ? ', truncated' : ''})`
        : (m.skipped || m.error);
    console.log(`[contacts-sweep] ${r.clientId}: leads ${l.ok ? `${l.leads} rows -> ${l.contacts} contacts (${l.mode})` : (l.skipped || l.error)}; comms ${c.ok ? `${c.rows} rows -> ${c.contacts} contacts (${c.mode})` : c.error}; mail ${mailPart}`);
  }
  console.log(`[contacts-sweep] done: ${results.length} tenant(s), ${errors} error(s), ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(errors ? 1 : 0);
}

main().catch((e) => {
  console.error('[contacts-sweep] fatal:', e.message);
  process.exit(1);
});
