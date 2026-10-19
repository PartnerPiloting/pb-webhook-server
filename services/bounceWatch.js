/**
 * Bounce watch - a bounced email never goes unnoticed.
 *
 * Craig Carolan's calendar invite went to an address that does not exist (2026-10-19). Microsoft
 * bounced it inside a minute; the bounce then sat in Guy's inbox for four hours until he happened
 * to read it, while Craig waited for an invite that was never coming. Every guard before a send
 * can be fooled by a case nobody imagined - a lead's own typo, LinkedIn changing its page - so this
 * is the net under all of them: whatever the cause, the coach hears about a bounce within minutes,
 * with the lead named and the fix spelled out.
 *
 * How: every few minutes, for each active client with a connected mailbox, list the messages that
 * arrived since the last pass, keep the ones that are delivery failures (sender mailer-daemon /
 * postmaster, or the usual subjects), pull the failed address out of the body, match it to a lead
 * by email (primary or Alt Emails), and email the coach once per bounce. Postgres remembers which
 * bounces were already reported, so a redeploy or a long window never re-alerts.
 *
 * Own setInterval heartbeat (same shape as captureReleaseSweep). A pass with nothing new costs one
 * mailbox list per tenant. Failure semantics: per tenant, per message - one bad mailbox or one
 * unreadable bounce never stops the rest.
 */

const { createSafeLogger } = require('../utils/loggerHelper');
const { getPool } = require('./recallWebhookDb');
const { sendAlertEmail } = require('./emailNotificationService');
const { coachOwnEmails } = require('../utils/coachOwnEmails');

const log = createSafeLogger('SYSTEM', null, 'bounce_watch');

const SWEEP_INTERVAL_MS = Number(process.env.BOUNCE_WATCH_INTERVAL_MS) || 10 * 60 * 1000; // 10 min
const FIRST_WINDOW_MS = Number(process.env.BOUNCE_WATCH_FIRST_WINDOW_MS) || 24 * 60 * 60 * 1000; // first pass after a start
const OVERLAP_MS = 15 * 60 * 1000;  // re-read a little behind the last pass; the table de-dupes
const MAX_PER_TENANT = 300;

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECT_RE = /delivery status notification|undeliverable|mail delivery failed|delivery failure|delivery has failed|returned mail|could not be delivered|failure notice|message blocked|not delivered/i;
// Addresses that appear in every bounce and are never the failed recipient.
const NOISE_LOCAL_RE = /^(mailer-daemon|postmaster|mail-daemon|noreply|no-reply|donotreply|do-not-reply|bounce[s]?|abuse)$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

let intervalHandle = null;
let lastPass = null;
let lastPassAt = null;
let ensured = false;

async function ensureTable(client) {
  if (ensured) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_bounce_alerts (
      coach_client_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      address TEXT NOT NULL,
      lead_record_id TEXT,
      lead_name TEXT,
      alerted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (coach_client_id, message_id, address)
    );
  `);
  ensured = true;
}

// ── Pure helpers (tested in tests/bounce-watch.test.js) ───────────────────────────────────────────

/** Is this mailbox listing entry a delivery failure? */
function isBounceMessage(m) {
  if (!m) return false;
  const from = String(m.fromEmail || '').trim();
  const subject = String(m.subject || '');
  return BOUNCE_SENDER_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject);
}

/** HTML -> readable text, enough to find addresses and the sentence around them. */
function bodyToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * The address(es) the bounce is about. Looks first for the phrases the big providers use ("Your
 * message to X", "Delivery has failed to these recipients or groups: X", "<X>: host said"), then
 * falls back to every address in the body that is not the coach's own and not bounce plumbing.
 * @param {string} text  bodyToText output
 * @param {Set<string>} exclude  lowercased addresses never to report (the coach's own)
 * @returns {string[]} lowercased, unique, in order of confidence
 */
function extractBouncedAddresses(text, exclude = new Set()) {
  const t = String(text || '');
  const keep = (e) => {
    const lower = String(e || '').toLowerCase().replace(/^mailto:/, '');
    if (!lower.includes('@')) return null;
    const local = lower.split('@')[0];
    if (NOISE_LOCAL_RE.test(local)) return null;
    if (exclude.has(lower)) return null;
    return lower;
  };
  const out = [];
  const add = (e) => { const k = keep(e); if (k && !out.includes(k)) out.push(k); };
  // Google: "Your message to X has been blocked" / "wasn't delivered to X" / "The email account that you tried to reach"
  for (const m of t.matchAll(/(?:your message to|wasn't delivered to|was not delivered to|couldn't be delivered to|could not be delivered to|delivery to the following recipient[s]? failed[^:]*:?)\s*(?:<)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) add(m[1]);
  // Microsoft: "Delivery has failed to these recipients or groups:" then the address on the next line(s)
  const ms = t.match(/recipients? or groups?:?([\s\S]{0,300})/i);
  if (ms) { const first = ms[1].match(EMAIL_RE); if (first) add(first[0]); }
  // Generic DSN: "<X>: host ... said" / "Final-Recipient: rfc822; X" / "Original-Recipient: rfc822;X"
  for (const m of t.matchAll(/(?:final-recipient|original-recipient)\s*:\s*rfc822\s*;\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) add(m[1]);
  for (const m of t.matchAll(/<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>\s*(?::|\(|said|host)/gi)) add(m[1]);
  if (out.length) return out;
  // Fallback: anything left that is not plumbing.
  for (const m of t.match(EMAIL_RE) || []) add(m);
  return out;
}

function alertHtml({ coachFirst, address, leadName, subject, when }) {
  const who = leadName ? `<strong>${leadName}</strong>` : 'someone not in your Portal';
  return [
    `<p>Hi ${coachFirst || 'there'},</p>`,
    `<p>An email you sent to <strong>${address}</strong> bounced - that mailbox does not exist, so nothing reached ${leadName || 'them'}.</p>`,
    `<p>The address belongs to ${who}${subject ? ` (the bounce was "${subject}"${when ? `, ${when}` : ''})` : ''}.</p>`,
    '<p>What to do:</p>',
    '<ol>',
    '<li>Check the address with them - the usual cause is a word stuck to the front of it (like "iscraig.carolan@") or a typo.</li>',
    leadName ? `<li>Fix it on ${leadName}'s record in your Portal (or tell Wingguy "update ${leadName}'s email to ...").</li>` : '<li>If they are a lead, add them to your Portal with the right address.</li>',
    '<li>If it was a calendar invite, move the invite to the right address (or ask Wingguy to re-send it) - they are still waiting for it.</li>',
    '</ol>',
    '<p>- Wingguy</p>',
  ].join('');
}

// ── The sweep ─────────────────────────────────────────────────────────────────────────────────────

async function sweepTenant(coach, { since, mailProvider, inbound, pool, send, now }) {
  const after = Math.floor(since / 1000);
  const listed = await mailProvider.listRecent(coach, { after, max: MAX_PER_TENANT });
  if (!listed.ok) { log.warn(`${coach.clientId}: mailbox list failed - ${listed.error}`); return { bounces: 0, alerted: 0 }; }
  const bounces = (listed.messages || []).filter(isBounceMessage);
  if (!bounces.length) return { bounces: 0, alerted: 0 };

  const own = coachOwnEmails(coach);
  let alerted = 0;
  for (const m of bounces) {
    try {
      const full = await mailProvider.getMessage(coach, m.id);
      const text = bodyToText(full.ok && full.message ? full.message.body : '') || String(m.snippet || '');
      const addresses = extractBouncedAddresses(text, own);
      if (!addresses.length) { log.info(`${coach.clientId}: bounce ${m.id} - no recipient address found in body`); continue; }
      for (const address of addresses.slice(0, 3)) {
        // Claim it in the table FIRST: a row already there means this bounce was reported.
        const claim = await pool.query(
          `INSERT INTO wingguy_bounce_alerts (coach_client_id, message_id, address) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING message_id`,
          [coach.clientId, String(m.id), address],
        );
        if (!claim.rowCount) continue;

        let lead = null;
        try { lead = await inbound.findLeadByEmail(coach, address); } catch (e) { log.warn(`${coach.clientId}: lead lookup for ${address} failed - ${e.message}`); }
        const leadName = lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : '';
        const when = m.date ? new Date(m.date).toLocaleString('en-AU', { timeZone: coach.timezone || 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' }) : '';
        const subject = `Wingguy: your email to ${address} bounced${leadName ? ` (${leadName})` : ''} - check the address`;
        const html = alertHtml({ coachFirst: String(coach.clientName || '').split(' ')[0], address, leadName, subject: m.subject, when });
        const textBody = bodyToText(html);
        const to = String(coach.clientEmailAddress || '').trim() || null;
        await send(subject, html, to, { text: textBody });
        // Guy sees every bounce across the fleet too - it is how the next glued-address shape gets found.
        const admin = String(process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim().toLowerCase();
        if (to && to.toLowerCase() !== admin) await send(`[${coach.clientId}] ${subject}`, html, null, { text: textBody });
        await pool.query(`UPDATE wingguy_bounce_alerts SET lead_record_id = $4, lead_name = $5 WHERE coach_client_id = $1 AND message_id = $2 AND address = $3`,
          [coach.clientId, String(m.id), address, lead ? lead.id : null, leadName || null]);
        alerted++;
        log.info(`${coach.clientId}: bounce to ${address}${leadName ? ` (${leadName})` : ''} reported to ${to || 'admin'}`);
      }
    } catch (e) {
      log.warn(`${coach.clientId}: bounce ${m.id} failed - ${e.message}`);
    }
  }
  return { bounces: bounces.length, alerted };
}

/** One pass over every active client with a mailbox. `deps` = test injection. */
async function sweepBounces(deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const pool = deps.pool || getPool();
  if (!pool) return { ok: false, reason: 'no database' };
  const clientService = deps.clientService || require('./clientService');
  const mailProvider = deps.mailProvider || require('./mailProvider');
  const inbound = deps.inbound || require('./inboundEmailService');
  const send = deps.sendEmail || sendAlertEmail;

  const c = await pool.connect();
  try { await ensureTable(c); } finally { c.release(); }

  const since = lastPassAt ? lastPassAt - OVERLAP_MS : now - FIRST_WINDOW_MS;
  const clients = (await clientService.getAllClients()).filter((x) => String(x.status || '').toLowerCase() === 'active' && mailProvider.hasMailbox(x));
  let bounces = 0; let alerted = 0; let failed = 0;
  for (const coach of clients) {
    try {
      const r = await sweepTenant(coach, { since, mailProvider, inbound, pool, send, now });
      bounces += r.bounces; alerted += r.alerted;
    } catch (e) {
      failed++;
      log.warn(`${coach.clientId}: sweep failed - ${e.message}`);
    }
  }
  lastPassAt = now;
  lastPass = { at: new Date(now).toISOString(), tenants: clients.length, bounces, alerted, failed };
  if (bounces || failed) log.info(`pass: ${clients.length} tenants, ${bounces} bounces, ${alerted} alerted, ${failed} failed`);
  return { ok: true, ...lastPass };
}

function startBounceWatch() {
  if (intervalHandle) return;
  if (!(process.env.DATABASE_URL || '').trim()) { log.info('bounce-watch: no DATABASE_URL - not starting'); return; }
  if (String(process.env.BOUNCE_WATCH_ENABLED || 'true').trim().toLowerCase() === 'false') { log.info('bounce-watch: disabled'); return; }
  log.info(`bounce-watch: starting (every ${Math.round(SWEEP_INTERVAL_MS / 60000)} min)`);
  setTimeout(() => { sweepBounces().catch((e) => log.error(`first pass: ${e.message}`)); }, 20000);
  intervalHandle = setInterval(() => { sweepBounces().catch((e) => log.error(`pass: ${e.message}`)); }, SWEEP_INTERVAL_MS);
}

function getBounceWatchStatus() {
  return { running: !!intervalHandle, intervalMs: SWEEP_INTERVAL_MS, lastPass };
}

module.exports = { startBounceWatch, sweepBounces, getBounceWatchStatus, isBounceMessage, bodyToText, extractBouncedAddresses, alertHtml };
