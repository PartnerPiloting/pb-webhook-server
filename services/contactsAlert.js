/**
 * Contacts feed staleness alert - the answer to "a broken client feed fails silently".
 *
 * WHY THIS EXISTS (Guy, 2026-09-15): the nightly sweep deliberately returns success even when one
 * tenant's feed errors, so a single bad mailbox does not read as a dead cron. The cost of that
 * choice is silence - Julian's mail could fail every night for a month and nobody would know,
 * because Render only emails when the WHOLE job fails. This closes that gap.
 *
 * THE SIGNAL IS STALENESS, NOT ERRORS. A one-off 504 is noise; a feed that has not succeeded in
 * days is a real fault. services/contactsStore.recordSweep only stamps on SUCCESS, so
 * `wingguy_contacts_sweeps.last_run_at` going old IS the fault, with no extra bookkeeping.
 *
 * WHICH FEEDS SHOULD HAVE RUN is derived per tenant, not assumed: 'lead' only if they have a
 * leads base, 'mail' only if mailProvider says they have a mailbox, 'comms-log' whenever either
 * is true. A client with no mailbox is not "broken" for having no mail sweep.
 *
 * NEVER-RUN vs STALE: a brand new client has no stamps at all, and that is not a fault - it just
 * means the first sweep has not happened. A never-run feed only counts as stale once ANOTHER
 * feed for that same tenant has a stamp, which proves the tenant has been through a sweep and
 * this feed specifically did not make it.
 *
 * NAG CONTROL: one email at most every `minHoursBetweenAlerts` while anything is stale - EXCEPT
 * when the stale set grows, which is new news and goes out immediately. The marker lives in the
 * sweeps table under the reserved tenant id '_system' (no client is ever called that), so there
 * is no new table and no new config.
 */

const { getPool } = require('./recallWebhookDb');
const { sendAlertEmail } = require('./emailNotificationService');

const SYSTEM_TENANT = '_system';
const ALERT_SOURCE = 'stale-alert';
const DEFAULT_STALE_DAYS = 3;
const DEFAULT_MIN_HOURS_BETWEEN = 72;

/** Which feeds SHOULD this tenant have? Derived from what they actually have connected. */
function expectedFeeds(coach, mailProvider) {
  const feeds = [];
  if (coach && coach.airtableBaseId) feeds.push('lead');
  if (mailProvider && mailProvider.hasMailbox(coach)) feeds.push('mail');
  if (feeds.length) feeds.push('comms-log');
  return feeds;
}

/**
 * Compare expected feeds against the sweep stamps. Pure, so the "is this actually broken?"
 * judgement is testable without a database.
 * @param {Array<{clientId:string, feeds:string[]}>} tenants
 * @param {Map<string, Date>} stamps  key `${clientId}::${feed}` -> last successful run
 * @returns {Array<{clientId:string, feed:string, lastRunAt:Date|null, daysStale:number|null}>}
 */
function findStale(tenants, stamps, { staleDays = DEFAULT_STALE_DAYS, now = new Date() } = {}) {
  const out = [];
  for (const t of tenants) {
    // Has this tenant EVER been swept? If not, nothing here is a fault yet.
    const sweptBefore = (t.feeds || []).some((f) => stamps.get(`${t.clientId}::${f}`));
    for (const feed of t.feeds || []) {
      const last = stamps.get(`${t.clientId}::${feed}`) || null;
      if (!last) {
        if (sweptBefore) out.push({ clientId: t.clientId, feed, lastRunAt: null, daysStale: null });
        continue;
      }
      const days = (now - last) / 86400000;
      if (days > staleDays) out.push({ clientId: t.clientId, feed, lastRunAt: last, daysStale: Math.floor(days) });
    }
  }
  return out;
}

/** One line a human can act on. */
function describeStale(s) {
  if (!s.lastRunAt) return `${s.clientId} - ${s.feed}: has never worked (other feeds for them have)`;
  return `${s.clientId} - ${s.feed}: last worked ${s.daysStale} day${s.daysStale === 1 ? '' : 's'} ago (${s.lastRunAt.toISOString().slice(0, 10)})`;
}

async function readStamps(client) {
  const r = await client.query(
    `SELECT coach_client_id, source, last_run_at FROM wingguy_contacts_sweeps WHERE coach_client_id <> $1`,
    [SYSTEM_TENANT],
  );
  const map = new Map();
  for (const row of r.rows) map.set(`${row.coach_client_id}::${row.source}`, new Date(row.last_run_at));
  return map;
}

async function readAlertMarker(client) {
  const r = await client.query(
    `SELECT last_run_at, note FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 AND source = $2`,
    [SYSTEM_TENANT, ALERT_SOURCE],
  );
  if (!r.rows.length) return { at: null, keys: [] };
  return {
    at: r.rows[0].last_run_at ? new Date(r.rows[0].last_run_at) : null,
    keys: String(r.rows[0].note || '').split('|').filter(Boolean),
  };
}

/**
 * Check every sweepable tenant and email Guy when a feed has been broken for days.
 * Never throws - an alert failing must not fail the sweep that called it.
 * @returns {Promise<{ok:boolean, stale:number, emailed:boolean, reason?:string, lines?:string[]}>}
 */
async function alertOnStaleFeeds({
  staleDays = DEFAULT_STALE_DAYS,
  minHoursBetweenAlerts = DEFAULT_MIN_HOURS_BETWEEN,
  clientService,
  mailProvider,
  sendEmail,
  now = new Date(),
} = {}) {
  const cs = clientService || require('./clientService');
  const mp = mailProvider || require('./mailProvider');
  const send = sendEmail || sendAlertEmail;
  const p = getPool();
  if (!p) return { ok: false, stale: 0, emailed: false, reason: 'no database' };

  let client;
  try {
    client = await p.connect();
    const clients = (await cs.getAllClients()).filter((c) => String(c.status || '').toLowerCase() === 'active');
    const tenants = clients
      .map((c) => ({ clientId: c.clientId, feeds: expectedFeeds(c, mp) }))
      .filter((t) => t.feeds.length);

    const stamps = await readStamps(client);
    const stale = findStale(tenants, stamps, { staleDays, now });
    const keys = stale.map((s) => `${s.clientId}::${s.feed}`).sort();

    const marker = await readAlertMarker(client);
    if (!stale.length) {
      // Everything healthy - clear the marker so the NEXT fault alerts immediately.
      if (marker.at) {
        await client.query(`DELETE FROM wingguy_contacts_sweeps WHERE coach_client_id = $1 AND source = $2`, [SYSTEM_TENANT, ALERT_SOURCE]);
      }
      return { ok: true, stale: 0, emailed: false };
    }

    // New news (a feed that was not in the last alert) always goes out; otherwise wait out the cooldown.
    const grew = keys.some((k) => !marker.keys.includes(k));
    const hoursSince = marker.at ? (now - marker.at) / 3600000 : Infinity;
    const lines = stale.map(describeStale);
    if (!grew && hoursSince < minHoursBetweenAlerts) {
      return { ok: true, stale: stale.length, emailed: false, reason: `same faults, alerted ${Math.round(hoursSince)}h ago`, lines };
    }

    const subject = `Wingguy contacts: ${stale.length} feed${stale.length === 1 ? '' : 's'} not working`;
    const html = [
      '<p>These contacts feeds have stopped working. The nightly sweep still runs - these tenants just are not getting new people.</p>',
      '<ul>', ...lines.map((l) => `<li>${l}</li>`), '</ul>',
      '<p>A mail feed usually means the client\'s mailbox is refusing reads (the Unipile Outlook outage did this). A lead feed usually means their Airtable base moved or lost access.</p>',
    ].join('');
    let emailed = false;
    try {
      const r = await send(subject, html, null, { text: `${subject}\n\n${lines.join('\n')}` });
      emailed = !r || r.success !== false;
    } catch (e) {
      console.warn(`[contactsAlert] email failed: ${e.message}`);
    }
    if (emailed) {
      await client.query(
        `INSERT INTO wingguy_contacts_sweeps (coach_client_id, source, last_run_at, rows_seen, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (coach_client_id, source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, rows_seen = EXCLUDED.rows_seen, note = EXCLUDED.note`,
        [SYSTEM_TENANT, ALERT_SOURCE, now, stale.length, keys.join('|').slice(0, 300)],
      );
    }
    return { ok: true, stale: stale.length, emailed, lines };
  } catch (e) {
    console.warn(`[contactsAlert] check failed: ${e.message}`);
    return { ok: false, stale: 0, emailed: false, reason: e.message };
  } finally {
    if (client) client.release();
  }
}

module.exports = { alertOnStaleFeeds, findStale, expectedFeeds, describeStale, SYSTEM_TENANT, ALERT_SOURCE };
