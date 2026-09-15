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
 * BROKEN vs NOT-YET-TRIED - the bit that stops this crying wolf. A feed with NO ROW at all was
 * never attempted: a brand new client, or a feed that shipped today. Silent, always. The first
 * draft flagged "no success stamp while other feeds have one", which read correctly on paper and
 * would have emailed a fault for EVERY tenant the night the mail feed shipped, since none of
 * them could have a mail stamp yet. So a fault now needs a recorded ATTEMPT: sweepTenant writes
 * last_error_at when a feed genuinely fails, and recordSweep clears it on the next success.
 *   no row                      -> silent (never tried)
 *   success, recent             -> healthy
 *   success, older than N days  -> stale
 *   error and no/old success    -> broken
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
// An OUTSIDE feed is judged far more slowly, because silence is usually innocent: Make's contact
// watcher only fires when a contact actually changes, so a fortnight of nothing just means the
// coach added nobody. Three days would cry wolf constantly; a month means something is wrong.
const DEFAULT_INGEST_STALE_DAYS = 30;
const DEFAULT_MIN_HOURS_BETWEEN = 72;

function isIngestFeed(feed) {
  return String(feed || '').startsWith('ingest:');
}

/**
 * Which feeds SHOULD this tenant have?
 *
 * The built-in ones are derived from what they have connected. An outside feed (Make, Zapier, a
 * spreadsheet) cannot be - nothing on the client record says a coach means to send contacts from
 * somewhere else. So an ingest feed becomes expected only once it has actually delivered, which
 * is exactly the right moment: before the first delivery there is nothing to miss, and after it
 * a feed going quiet is worth mentioning.
 * @param {string[]} [knownIngestFeeds] ingest sources already seen for this tenant
 */
function expectedFeeds(coach, mailProvider, knownIngestFeeds = []) {
  const feeds = [];
  if (coach && coach.airtableBaseId) feeds.push('lead');
  if (mailProvider && mailProvider.hasMailbox(coach)) feeds.push('mail');
  if (feeds.length) feeds.push('comms-log');
  for (const f of knownIngestFeeds) if (isIngestFeed(f) && !feeds.includes(f)) feeds.push(f);
  return feeds;
}

/**
 * Compare expected feeds against the sweep rows. Pure, so the "is this actually broken?"
 * judgement is testable without a database.
 * @param {Array<{clientId:string, feeds:string[]}>} tenants
 * @param {Map<string, {lastRunAt:Date|null, lastErrorAt:Date|null, lastError:string|null}>} rows
 *        keyed `${clientId}::${feed}`; a MISSING key means the feed was never attempted.
 * @returns {Array<{clientId, feed, lastRunAt, lastError, daysStale}>}
 */
function findStale(tenants, rows, { staleDays = DEFAULT_STALE_DAYS, ingestStaleDays = DEFAULT_INGEST_STALE_DAYS, now = new Date() } = {}) {
  const out = [];
  for (const t of tenants) {
    for (const feed of t.feeds || []) {
      const row = rows.get(`${t.clientId}::${feed}`);
      if (!row) continue;                       // never attempted - not a fault
      const limit = isIngestFeed(feed) ? ingestStaleDays : staleDays;
      const last = row.lastRunAt || null;
      const erroredAt = row.lastErrorAt || null;
      const daysSinceSuccess = last ? (now - last) / 86400000 : null;
      // Broken: it was tried and failed, and there is no recent success behind that failure.
      const brokenNow = !!erroredAt && (!last || last < erroredAt) && (daysSinceSuccess === null || daysSinceSuccess > limit);
      // Stale: it used to work and has not since, whether or not an error was captured.
      const goneQuiet = daysSinceSuccess !== null && daysSinceSuccess > limit;
      if (!brokenNow && !goneQuiet) continue;
      out.push({
        clientId: t.clientId,
        feed,
        lastRunAt: last,
        lastError: row.lastError || null,
        daysStale: daysSinceSuccess === null ? null : Math.floor(daysSinceSuccess),
      });
    }
  }
  return out;
}

/**
 * One line a human can act on. An outside feed gets softer wording on purpose: nothing arriving
 * from Make may simply mean the coach has added no contacts, and an alert that asserts a fault
 * it cannot prove is how people learn to ignore alerts.
 */
function describeStale(s) {
  const why = s.lastError ? ` - ${String(s.lastError).slice(0, 120)}` : '';
  if (isIngestFeed(s.feed)) {
    const name = s.feed.slice('ingest:'.length);
    if (s.lastRunAt === null) return `${s.clientId} - ${name} feed: a delivery failed and none has ever succeeded${why}`;
    return `${s.clientId} - ${name} feed: nothing delivered in ${s.daysStale} days (last ${s.lastRunAt.toISOString().slice(0, 10)}) - either no new contacts, or the connection has stopped${why}`;
  }
  if (s.lastRunAt === null) return `${s.clientId} - ${s.feed}: tried and failed, has never worked${why}`;
  return `${s.clientId} - ${s.feed}: last worked ${s.daysStale} day${s.daysStale === 1 ? '' : 's'} ago (${s.lastRunAt.toISOString().slice(0, 10)})${why}`;
}

async function readStamps(client) {
  const r = await client.query(
    `SELECT coach_client_id, source, last_run_at, last_error_at, last_error
       FROM wingguy_contacts_sweeps WHERE coach_client_id <> $1`,
    [SYSTEM_TENANT],
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(`${row.coach_client_id}::${row.source}`, {
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
      lastErrorAt: row.last_error_at ? new Date(row.last_error_at) : null,
      lastError: row.last_error || null,
    });
  }
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
  ingestStaleDays = DEFAULT_INGEST_STALE_DAYS,
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
    const stamps = await readStamps(client);
    // Outside feeds are discovered from what has actually delivered, not from the client record.
    const ingestByTenant = new Map();
    for (const key of stamps.keys()) {
      const [tenantId, feed] = key.split('::');
      if (!isIngestFeed(feed)) continue;
      if (!ingestByTenant.has(tenantId)) ingestByTenant.set(tenantId, []);
      ingestByTenant.get(tenantId).push(feed);
    }
    const tenants = clients
      .map((c) => ({ clientId: c.clientId, feeds: expectedFeeds(c, mp, ingestByTenant.get(c.clientId) || []) }))
      .filter((t) => t.feeds.length);
    const stale = findStale(tenants, stamps, { staleDays, ingestStaleDays, now });
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
      '<p>A mail feed usually means the client\'s mailbox is refusing reads (the Unipile Outlook outage did this). A lead feed usually means their Airtable base moved or lost access. An outside feed going quiet usually means the Make or Zapier scenario has stopped, its Google connection has expired, or the monthly operation limit ran out.</p>',
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

module.exports = { alertOnStaleFeeds, findStale, expectedFeeds, describeStale, isIngestFeed, SYSTEM_TENANT, ALERT_SOURCE };
