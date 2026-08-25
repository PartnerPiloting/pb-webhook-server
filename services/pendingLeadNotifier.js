/**
 * Pending-lead digest — the weekly "you've met people who aren't in Wingguy yet" email.
 *
 * V2 (2026-08-26, agreed with Guy). V1 sent ONE EMAIL PER PERSON with a reply-to-add token;
 * fifteen bare-address emails in a row taught the client to ignore all of them and none was
 * ever answered. Now the portal's New Leads page is the door (list + Add + Skip), and email's
 * only job is a nudge:
 *
 *   - ONE email per client per week, and only when someone is actually waiting. Nothing
 *     waiting = no email. The week guard is the comms log (channel 'pending-digest'), which
 *     this send also writes to — first brick of the unified Wingguy comms record.
 *   - The email lists who's waiting (name where known - see pendingLeadFilter's transcript
 *     pairing - else the address) and links straight to the portal's New Leads page with the
 *     client's portal token.
 *   - No more per-person reply tokens. Old tokens from V1 emails still resolve through
 *     pendingReplyHandler; replies to the digest itself just land in the inbound pipe.
 *
 * DELIVERY unchanged: Mailgun alerts domain, From "Wingguy", BCC to Guy (PENDING_NOTIFY_BCC,
 * default on) while the feature is young. SAFETY unchanged: PENDING_NOTIFY_ENABLED gates the
 * whole pass; { force, onlyClientId } lets a one-off job test a single tenant.
 */

const https = require('https');
const querystring = require('querystring');
const clientService = require('./clientService');
const { findPendingLeadMeetings, getMeetingsTranscriptHeads } = require('./recallWebhookDb');
const { nameFromTranscript, isSelfOrOperatorEmail } = require('./pendingLeadFilter');
const { recordComm, lastCommAt } = require('./commsLog');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'pending_notify');

const BCC = (process.env.PENDING_NOTIFY_BCC || 'guyralphwilson@gmail.com').trim();
const PORTAL_BASE = (process.env.PORTAL_BASE_URL || 'https://pb-webhook-server.vercel.app').replace(/\/$/, '');
const DIGEST_INTERVAL_DAYS = Number(process.env.PENDING_DIGEST_INTERVAL_DAYS) || 7;

function notifyEnabled() {
  return String(process.env.PENDING_NOTIFY_ENABLED || '').trim().toLowerCase() === 'true';
}

/** Bare-bones Mailgun send (same REST shape as emailNotificationService). */
function sendMailgun(emailData) {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    return Promise.reject(new Error('Mailgun not configured - missing MAILGUN_API_KEY / MAILGUN_DOMAIN'));
  }
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(emailData);
    const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');
    const req = https.request({
      hostname: 'api.mailgun.net',
      port: 443,
      path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`Mailgun ${res.statusCode}: ${String(body).slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fmtDate(d, tz) {
  try {
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: tz || 'Australia/Brisbane' });
  } catch (_) {
    return String(d).slice(0, 10);
  }
}

/**
 * Group a tenant's ACTIVE pending entries into one person per email, with meeting count and
 * latest date, and fill missing names off the transcripts.
 */
async function collectWaitingPeople(coachClientId, coach) {
  const rows = await findPendingLeadMeetings({ coachClientId, limit: 200, activeOnly: true });
  const byEmail = new Map();
  const namelessMeetingIds = new Set();
  for (const m of rows) {
    for (const p of m.pending) {
      // Pre-filter junk entries (role mailboxes stored before 2026-08-26) still show — the
      // coach skips them himself. Operator/self addresses are never offered, full stop.
      if (isSelfOrOperatorEmail(p.email, coach)) continue;
      const cur = byEmail.get(p.email) || { email: p.email, name: p.name || null, meetings: 0, latest: null, latestTitle: null, meetingIds: [] };
      if (!cur.name && p.name) cur.name = p.name;
      cur.meetings++;
      cur.meetingIds.push(String(m.id));
      const when = m.meeting_start || m.created_at;
      if (when && (!cur.latest || new Date(when) > new Date(cur.latest))) { cur.latest = when; cur.latestTitle = m.title || null; }
      byEmail.set(p.email, cur);
    }
  }
  for (const person of byEmail.values()) if (!person.name) person.meetingIds.forEach((id) => namelessMeetingIds.add(id));
  if (namelessMeetingIds.size) {
    const heads = await getMeetingsTranscriptHeads([...namelessMeetingIds]);
    for (const person of byEmail.values()) {
      if (person.name) continue;
      for (const id of person.meetingIds) {
        const name = nameFromTranscript(heads.get(id), person.email);
        if (name) { person.name = name; break; }
      }
    }
  }
  return [...byEmail.values()].sort((a, b) => new Date(b.latest || 0) - new Date(a.latest || 0));
}

// Reader-facing copy rules: " - " (never an em dash), "Wingguy database" (never "Airtable").
function buildDigestEmail({ coachFirstName, people, portalUrl, tz }) {
  const n = people.length;
  const subject = n === 1
    ? `You've met someone who isn't in Wingguy yet`
    : `You've met ${n} people who aren't in Wingguy yet`;
  const lines = people.map((p) => {
    const who = p.name ? `${p.name} (${p.email})` : p.email;
    const when = p.latest ? ` - met ${fmtDate(p.latest, tz)}` : '';
    const extra = p.meetings > 1 ? `, ${p.meetings} meetings` : '';
    return `  - ${who}${when}${extra}`;
  });
  const text =
`Hi ${coachFirstName},

I've saved transcripts from your recent meetings, but ${n === 1 ? 'one person on them isn\'t' : 'some people on them aren\'t'} in your Wingguy database yet - so I can't pull those meetings up by name or draft follow-ups to them:

${lines.join('\n')}

Add or skip them here (takes about a minute):
${portalUrl}

Anyone you skip I'll never ask about again. I'll only email you about this once a week, and only when someone new is waiting.

- Wingguy`;
  return { subject, text };
}

/**
 * One digest pass — safe to call every poll heartbeat; the comms log's last-sent stamp makes it
 * fire at most once per DIGEST_INTERVAL_DAYS per tenant.
 * @param {object} [opts] { force, onlyClientId } — force bypasses the env gate AND the week guard.
 */
async function notifyPendingLeads(opts = {}) {
  const { force = false, onlyClientId = null } = opts;
  if (!force && !notifyEnabled()) return { skipped: 'PENDING_NOTIFY_ENABLED not true', sent: 0 };

  const rows = await findPendingLeadMeetings({ coachClientId: onlyClientId || undefined, limit: 200, activeOnly: true });
  const tenants = [...new Set(rows.map((m) => m.coach_client_id))];
  const summary = { checkedAt: new Date().toISOString(), tenantsWaiting: tenants.length, sent: 0, failed: 0, details: [] };

  for (const coachClientId of tenants) {
    try {
      if (!force) {
        const last = await lastCommAt({ coachClientId, channel: 'pending-digest' });
        if (last && (Date.now() - last.getTime()) < DIGEST_INTERVAL_DAYS * 24 * 3600 * 1000) {
          summary.details.push({ coachClientId, skipped: `digest sent ${last.toISOString()}` });
          continue;
        }
      }
      const coach = await clientService.getClientById(coachClientId);
      const to = coach && String(coach.clientEmailAddress || '').trim();
      if (!to) { summary.details.push({ coachClientId, skipped: 'no client email address on record' }); continue; }

      const people = await collectWaitingPeople(coachClientId, coach);
      if (!people.length) { summary.details.push({ coachClientId, skipped: 'nothing waiting after filters' }); continue; }

      const coachFirstName = String(coach.clientName || '').trim().split(/\s+/)[0] || 'there';
      const portalUrl = coach.portalToken
        ? `${PORTAL_BASE}/new-leads?token=${encodeURIComponent(coach.portalToken)}`
        : `${PORTAL_BASE}/new-leads`;
      const { subject, text } = buildDigestEmail({ coachFirstName, people, portalUrl, tz: coach.timezone });
      const payload = { from: `Wingguy <wingguy@${process.env.MAILGUN_DOMAIN}>`, to, subject, text };
      if (BCC && BCC.toLowerCase() !== to.toLowerCase()) payload.bcc = BCC;
      await sendMailgun(payload);
      await recordComm({
        coachClientId,
        channel: 'pending-digest',
        recipient: to,
        subject,
        summary: `${people.length} waiting: ${people.map((p) => p.name || p.email).join(', ').slice(0, 500)}`,
        meta: { people: people.map((p) => ({ email: p.email, name: p.name, meetings: p.meetings })) },
      });
      summary.sent++;
      summary.details.push({ coachClientId, to, people: people.length });
      log.info(`pending digest: emailed ${coachClientId} (${to}) - ${people.length} waiting`);
    } catch (e) {
      summary.failed++;
      summary.details.push({ coachClientId, error: e.message });
      log.warn(`pending digest: ${coachClientId} failed: ${e.message}`);
    }
  }
  return summary;
}

module.exports = { notifyPendingLeads, notifyEnabled, buildDigestEmail, collectWaitingPeople };
