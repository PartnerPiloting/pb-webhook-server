/**
 * The Monday campaign numbers - how each client's Linked Helper campaigns did last week.
 *
 * WHY (Guy, 16 Oct 2026): a weekly note to each client - how many people are left in each
 * campaign's queue, roughly how long that lasts at the current pace, how many invitations went
 * out and how many accepted. A client who can see the queue running down tops up the search
 * before it runs dry, instead of finding out from the four-day "gone quiet" alert.
 *
 * WHO GETS IT. Every Monday after 7am Brisbane ONE email goes to Guy (sendAlertEmail ->
 * ALERT_EMAIL) with a section per client, worded the way the client's own email reads, so he can
 * check the numbers against Linked Helper's screens. A client gets their OWN email only when
 * 'Monday Campaign Email' is ticked on their master Clients row - opt-in, unticked by default, so
 * nobody is sent numbers by accident (a campaign not started yet, a client winding down). Guy's
 * email says who was sent theirs and who was skipped and why. Skipped: no coach (the coach's own
 * row - Guy has his numbers already), no email address, no live campaigns, or numbers older than
 * two days (a machine that has stopped reporting - old numbers would mislead).
 *
 * Where the numbers come from: each machine's 5-minute report carries `campaign.campaigns`
 * (lh-watchdog.py campaign_numbers - read from Linked Helper's own database). The latest list
 * per client is kept in Postgres (lh_campaign_snapshots); a machine on an older watchdog sends
 * no list and simply has no section.
 *
 * The wording rules:
 *   - Pace = invitations over the last 28 days / 4. One week swings (Guy's ran 49 to 74 a week
 *     in Sep-Oct 2026), so "how long will it last" uses the steadier figure.
 *   - Acceptance is judged on people invited 14-35 days ago, "so far". Last week's invites are
 *     too fresh - people take days to accept - and would always look bad.
 *   - Under three weeks of people left = "time to top up the search".
 *   - A paused campaign says so: a paused campaign stops looking for acceptances too.
 *
 * House style: wingguyMonitor.js - lazy Pool, CREATE-IF-NOT-EXISTS, Brisbane clock, state row in
 * Postgres so a restart never double-sends. The week is claimed BEFORE sending: a crash mid-send
 * costs one Monday, never two copies. LH_WEEKLY_REPORT=off switches it off.
 */

const { Pool } = require('pg');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'lh_weekly_report');

const RUN_HOUR = Number(process.env.LH_WEEKLY_REPORT_HOUR) || 7;   // Brisbane, Mondays
const TICK_MS = 15 * 60 * 1000;
const TOP_UP_WEEKS = 3;
const MIN_COHORT = 10;                    // fewer invites than this and a percentage means nothing
const STALE_MS = 2 * 86400000;            // a machine silent this long - say the numbers are old

let pool;
let schemaEnsured = false;
let intervalHandle = null;
let ticking = false;

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
    pool.on('error', (e) => log.error(`lh-weekly-report pool error: ${e.message}`));
  }
  return pool;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS lh_campaign_snapshots (
      client_id    TEXT        PRIMARY KEY,
      campaigns    JSONB       NOT NULL,
      reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS lh_weekly_report_state (
      key         TEXT        PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// The machine's list, kept
// ---------------------------------------------------------------------------

const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);
const intOrNull = (v) => (v === null || v === undefined ? null : int(v));

/** Only the fields we use, as numbers - the machine is trusted for its own client only. */
function cleanCampaigns(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 20).filter((c) => c && typeof c === 'object').map((c) => ({
    id: int(c.id),
    name: String(c.name || '').slice(0, 80),
    paused: !!c.paused,
    waiting: int(c.waiting),
    invited_7d: int(c.invited_7d),
    invited_28d: int(c.invited_28d),
    accepted_7d: intOrNull(c.accepted_7d),
    cohort_invited: int(c.cohort_invited),
    cohort_accepted: intOrNull(c.cohort_accepted),
  }));
}

/** Called on every machine report that carries a list. Never throws. */
async function saveSnapshot(clientId, list) {
  const campaigns = cleanCampaigns(list);
  if (!clientId || !campaigns) return false;
  try {
    await withClient((client) => client.query(
      `INSERT INTO lh_campaign_snapshots (client_id, campaigns, reported_at) VALUES ($1, $2, now())
       ON CONFLICT (client_id) DO UPDATE SET campaigns = $2, reported_at = now()`,
      [String(clientId), JSON.stringify(campaigns)],
    ));
    return true;
  } catch (e) {
    log.error(`lh-weekly-report snapshot for ${clientId} not saved (non-fatal): ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wording - pure, tested
// ---------------------------------------------------------------------------

const n = (v) => Number(v).toLocaleString('en-AU');
const plural = (v, one, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

function weeksWords(weeks) {
  if (weeks < 1) return 'less than a week';
  if (weeks > 52) return 'well over a year';
  const w = Math.round(weeks);
  return `about ${w} week${w === 1 ? '' : 's'}`;
}

/** One campaign's lines, as the client would read them, plus whether it needs topping up. */
function campaignLines(c) {
  const lines = [];
  const pace = Math.round(c.invited_28d / 4);
  let topUp = false;

  if (c.paused) {
    lines.push(`Paused - nothing is going out, and acceptances aren't being picked up. ${plural(c.waiting, 'person', 'people')} waiting to be invited.`);
    return { name: c.name, lines, topUp, paused: true };
  }

  lines.push(c.accepted_7d === null
    ? `Last week: ${plural(c.invited_7d, 'invitation')} sent.`
    : `Last week: ${plural(c.invited_7d, 'invitation')} sent, ${n(c.accepted_7d)} accepted.`);

  if (!c.waiting) {
    lines.push('Nobody left to invite - time to top up the search.');
    topUp = true;
  } else if (!pace) {
    lines.push(`${plural(c.waiting, 'person', 'people')} waiting to be invited, but nothing has gone out in the last 4 weeks.`);
  } else {
    const weeks = c.waiting / pace;
    let line = `${plural(c.waiting, 'person', 'people')} left to invite - ${weeksWords(weeks)} at your current pace (about ${n(pace)} a week).`;
    if (weeks < TOP_UP_WEEKS) { line += ' Time to top up the search.'; topUp = true; }
    lines.push(line);
  }

  if (c.cohort_accepted !== null && c.cohort_invited >= MIN_COHORT) {
    const pct = Math.round((100 * c.cohort_accepted) / c.cohort_invited);
    lines.push(`Of the people invited 2 to 5 weeks ago, ${pct}% have accepted so far.`);
  }
  return { name: c.name, lines, topUp, paused: false };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function dateWords(iso, timeZone = 'Australia/Brisbane') {
  return new Date(iso).toLocaleString('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Guy's Monday email. `rows` = [{ clientId, clientName, reportedAt, campaigns }].
 * Returns { subject, text, html, topUps } - topUps lists "Client - Campaign" needing a new search.
 */
function buildDigest(rows, { now = Date.now(), date = '', sent = [], skipped = [] } = {}) {
  const sections = [];
  const topUps = [];
  const sorted = [...rows].sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
  for (const r of sorted) {
    const camps = (r.campaigns || []).map(campaignLines);
    camps.filter((c) => c.topUp).forEach((c) => topUps.push(`${r.clientName} - ${c.name}`));
    const stale = r.reportedAt && now - Date.parse(r.reportedAt) > STALE_MS
      ? `Machine has not reported since ${dateWords(r.reportedAt)} - these numbers are from then.` : '';
    const ticked = !!(r.client && r.client.mondayCampaignEmail);
    sections.push({ name: `${r.clientName}${ticked ? '' : ' (not ticked - only you see this)'}`, stale, camps });
  }

  const intro = "Each client's Linked Helper week. Clients with 'Monday Campaign Email' ticked were sent their own section.";
  const sentLine = sent.length ? `Sent their own email: ${sent.join(', ')}.` : 'No client was sent their own email this week.';
  const textParts = [intro, sentLine];
  if (skipped.length) textParts.push(`Ticked but NOT sent:\n${skipped.map((t) => `- ${t}`).join('\n')}`);
  if (topUps.length) textParts.push(`Needs a new search soon:\n${topUps.map((t) => `- ${t}`).join('\n')}`);
  for (const s of sections) {
    const body = s.camps.length
      ? s.camps.map((c) => `${c.name}\n${c.lines.map((l) => `  - ${l}`).join('\n')}`).join('\n\n')
      : '  No live campaigns.';
    textParts.push(`== ${s.name} ==${s.stale ? `\n  (${s.stale})` : ''}\n${body}`);
  }

  const htmlParts = [`<p>${esc(intro)}</p>`, `<p>${esc(sentLine)}</p>`];
  if (skipped.length) htmlParts.push(`<p><b>Ticked but NOT sent:</b></p><ul>${skipped.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  if (topUps.length) htmlParts.push(`<p><b>Needs a new search soon:</b></p><ul>${topUps.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  for (const s of sections) {
    htmlParts.push(`<h3 style="margin-bottom:4px">${esc(s.name)}</h3>`);
    if (s.stale) htmlParts.push(`<p style="color:#a15c00;margin-top:0">${esc(s.stale)}</p>`);
    if (!s.camps.length) htmlParts.push('<p style="margin-top:0">No live campaigns.</p>');
    for (const c of s.camps) {
      htmlParts.push(`<p style="margin:8px 0 2px"><b>${esc(c.name)}</b></p><ul style="margin-top:0">${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    }
  }

  return {
    subject: `Monday campaign numbers${date ? ` - ${date}` : ''}${topUps.length ? ` (${topUps.length} need${topUps.length === 1 ? 's' : ''} a top-up)` : ''}`,
    text: textParts.join('\n\n'),
    html: htmlParts.join('\n'),
    topUps,
  };
}

// ---------------------------------------------------------------------------
// The Monday run
// ---------------------------------------------------------------------------

function brisbaneNow() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday: get('weekday') };
}

async function loadRows(client, deps = {}) {
  const snaps = (await client.query('SELECT client_id, campaigns, reported_at FROM lh_campaign_snapshots')).rows;
  const getAll = deps.getAllClients || require('./clientService').getAllClients;
  const clients = await getAll();
  const byId = new Map((clients || []).map((c) => [String(c.clientId), c]));
  return snaps
    .filter((s) => byId.has(String(s.client_id)))   // a client no longer on the books has no section
    .map((s) => ({
      clientId: s.client_id,
      clientName: byId.get(String(s.client_id)).clientName || s.client_id,
      reportedAt: new Date(s.reported_at).toISOString(),
      campaigns: s.campaigns || [],
      client: byId.get(String(s.client_id)),
    }));
}

/** The client's own email: their campaigns' lines, short. */
function clientEmail({ clientFirstName, clientName, coachName, campaigns, machineLink }) {
  const first = String(clientFirstName || '').trim() || String(clientName || '').trim().split(/\s+/)[0] || 'there';
  const { signoffName } = require('./lhSignoutWatch');
  const camps = campaigns.map(campaignLines);
  const tail = camps.some((c) => c.topUp)
    ? 'When a campaign is close to empty, a fresh search keeps the invitations going - just reply if you want a hand with it.'
    : '';
  // Their own machine's web link, so checking a number or topping up a search is one click away.
  const open = `To open your Linked Helper machine: ${machineLink || 'ask your Claude to "open my Linked Helper machine"'}`;
  const text = [
    `Hi ${first},`,
    "Here's how your Linked Helper campaigns went last week.",
    camps.map((c) => `${c.name}\n${c.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n'),
    tail,
    open,
    `Cheers,\n${signoffName(coachName)}`,
  ].filter(Boolean).join('\n\n');
  const html = [
    `<p>Hi ${esc(first)},</p>`,
    "<p>Here's how your Linked Helper campaigns went last week.</p>",
    ...camps.map((c) => `<p style="margin:12px 0 2px"><b>${esc(c.name)}</b></p><ul style="margin-top:0">${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`),
    tail ? `<p>${esc(tail)}</p>` : '',
    machineLink ? `<p><a href="${esc(machineLink)}">Open your Linked Helper machine</a></p>` : `<p>${esc(open)}</p>`,
    `<p>Cheers,<br>${esc(signoffName(coachName))}</p>`,
  ].filter(Boolean).join('\n');
  return { subject: 'Your campaign numbers this week', text, html };
}

/** Why a ticked client is NOT sent theirs this week, or null to send. */
function skipReason(r, now = Date.now()) {
  const c = r.client || {};
  if (!c.coach) return 'their own row has no coach - your numbers are above';
  if (!String(c.clientEmailAddress || '').trim()) return 'no email address on their record';
  if (!(r.campaigns || []).length) return 'no live campaigns';
  if (!r.reportedAt || now - Date.parse(r.reportedAt) > STALE_MS) return 'their machine has not reported for over two days';
  return null;
}

async function sendClientEmails(rows, deps = {}, now = Date.now()) {
  const sent = [];
  const skipped = [];
  for (const r of rows.filter((x) => x.client && x.client.mondayCampaignEmail)) {
    const why = skipReason(r, now);
    if (why) { skipped.push(`${r.clientName} - ${why}`); continue; }
    try {
      const getById = deps.getClientById || require('./clientService').getClientById;
      const coach = await Promise.resolve(getById(r.client.coach)).catch(() => null);
      const coachName = (coach && coach.clientName) || 'Guy Wilson';
      const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
      const addr = String(process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`).trim();
      const to = String(r.client.clientEmailAddress).trim();
      const cm = clientEmail({ clientFirstName: r.client.clientFirstName, clientName: r.clientName, coachName, campaigns: r.campaigns, machineLink: r.client.machineLink });
      const sendClient = deps.sendClientEmail || require('./emailNotificationService').sendMailgunEmail;
      await sendClient({
        from: addr.includes('<') ? addr : `${coachName} <${addr}>`,
        to, cc: coachEmail, 'h:Reply-To': coachEmail,
        subject: cm.subject, text: cm.text, html: cm.html,
      });
      sent.push(r.clientName);
      const record = deps.recordComm || require('./commsLog').recordComm;
      await Promise.resolve(record({
        coachClientId: r.clientId, channel: 'lh-weekly-numbers', recipient: to, subject: cm.subject,
        summary: `Monday campaign numbers - ${r.campaigns.length} campaign(s)`, meta: { campaigns: r.campaigns },
      })).catch((e) => log.error(`lh-weekly-report comms log for ${r.clientId} failed: ${e.message}`));
    } catch (e) {
      skipped.push(`${r.clientName} - sending failed (${e.message})`);
    }
  }
  return { sent, skipped };
}

/**
 * force=true (scripts/run-lh-weekly-report.js) skips the clock and the once-a-week claim.
 * dryRun=true builds and returns the email without sending it.
 */
async function runWeeklyReport({ force = false, dryRun = false, deps = {} } = {}) {
  const r = await withClient(async (client) => {
    const now = brisbaneNow();
    if (!force) {
      if (now.weekday !== 'Mon' || now.hour < RUN_HOUR) return { ran: false, reason: 'not Monday morning' };
      // Claim the week first: only one tick (or instance) gets a row back.
      const claim = await client.query(
        `INSERT INTO lh_weekly_report_state (key, value, updated_at) VALUES ('last_sent', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()
           WHERE lh_weekly_report_state.value IS DISTINCT FROM $1
         RETURNING key`, [now.date]);
      if (!claim.rows.length) return { ran: false, reason: 'already sent today' };
    }
    const rows = await loadRows(client, deps);
    if (!rows.length) {
      log.info('lh-weekly-report: no machine has sent campaign numbers yet - no email');
      return { ran: true, emailed: false, clients: 0 };
    }
    if (dryRun) {
      const would = rows.filter((x) => x.client && x.client.mondayCampaignEmail);
      const sent = would.filter((x) => !skipReason(x)).map((x) => `${x.clientName} (dry run - not sent)`);
      const skipped = would.filter((x) => skipReason(x)).map((x) => `${x.clientName} - ${skipReason(x)}`);
      const digest = buildDigest(rows, { date: now.date, sent, skipped });
      return { ran: true, emailed: false, dryRun: true, clients: rows.length, ...digest };
    }
    const { sent, skipped } = await sendClientEmails(rows, deps);
    const digest = buildDigest(rows, { date: now.date, sent, skipped });
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    const res = await send(digest.subject, digest.html, null, { text: digest.text });
    const emailed = !!(res && res.success);
    log.info(`lh-weekly-report: ${rows.length} client(s), ${sent.length} client email(s), ${skipped.length} skipped, ${digest.topUps.length} top-up(s), Guy's email ${emailed ? 'sent' : 'FAILED'}`);
    return { ran: true, emailed, clients: rows.length, sent, skipped, subject: digest.subject };
  });
  return r || { ran: false, reason: 'no database' };
}

function startLhWeeklyReport() {
  if (String(process.env.LH_WEEKLY_REPORT || 'on').toLowerCase() === 'off') {
    log.info('lh-weekly-report: disabled via LH_WEEKLY_REPORT=off');
    return;
  }
  if (intervalHandle) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runWeeklyReport();
    } catch (e) {
      log.error(`lh-weekly-report tick failed (non-fatal): ${e.message}`);
    } finally {
      ticking = false;
    }
  };
  intervalHandle = setInterval(tick, TICK_MS);
  setTimeout(tick, 2 * 60 * 1000);
  log.info(`lh-weekly-report: starting (Mondays after ${RUN_HOUR}:00 Brisbane, clients only when ticked)`);
}

module.exports = { saveSnapshot, cleanCampaigns, campaignLines, buildDigest, clientEmail, skipReason, sendClientEmails, runWeeklyReport, startLhWeeklyReport };
