/**
 * Pending-lead notifier — the "you met someone who isn't in your database yet" email to the COACH.
 *
 * WHY: when a recording's participant matches no lead, the meeting now files with that person
 * parked on it (recall_meetings.pending_leads — see recallWebhookDb). This makes that state VISIBLE:
 * one email to the coach per unknown person, benefit-first ("I saved the transcript but can't pull
 * it up by their name or draft follow-ups until they're in your database"), asking for their
 * LinkedIn via Wingguy chat. Ignoring the email is a valid "no" — the notifiedAt stamp on the
 * pending entry guarantees we never nag twice about the same person (markPendingLeadNotified).
 *
 * DESIGN (agreed with Guy 2026-07-29):
 *   - ONE EMAIL PER PERSON, not a digest — so any future reply unambiguously belongs to one person.
 *   - NEVER auto-create a lead from an email alone (no LinkedIn URL = thin record + dedup collision).
 *   - Copy says "your Wingguy database", never "Airtable".
 *   - Copy directs to CHAT for now — the reply-reading loop isn't built yet, so the email must not
 *     promise "just reply" until it is. Update the copy when that phase lands.
 *
 * DELIVERY: Mailgun (the operational alerts domain — MAILGUN_API_KEY + MAILGUN_DOMAIN), From
 * "Wingguy", BCC to Guy so the operator sees every send during rollout. NOT the coach's own
 * Unipile/Nylas grant: the mail seam is draft-only by design, and this is a system notification
 * TO the coach, not mail sent as them.
 *
 * SAFETY: runs only when PENDING_NOTIFY_ENABLED=true (default OFF — ships dormant); notifyPendingLeads
 * accepts { force, onlyClientId } so a one-off job can test a single tenant while the flag is off.
 * Bounded sends per pass. Rides the fathom poll heartbeat AFTER the reconcile sweep, so someone who
 * became a lead within the last few minutes is linked, not emailed about.
 */

const https = require('https');
const querystring = require('querystring');
const clientService = require('./clientService');
const { findPendingLeadMeetings, markPendingLeadNotified } = require('./recallWebhookDb');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'pending_notify');

const MAX_PER_PASS = Number(process.env.PENDING_NOTIFY_MAX_PER_PASS) || 10;
const BCC = (process.env.PENDING_NOTIFY_BCC || 'guyralphwilson@gmail.com').trim();

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
    return new Date(d).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || 'Australia/Brisbane' });
  } catch (_) {
    return String(d).slice(0, 10);
  }
}

// The email itself. Reader-facing copy: " - " (never an em dash), "Wingguy database" (never
// "Airtable"), benefit first, an explicit easy "no".
function buildEmail({ coachFirstName, person, meetings, tz }) {
  const who = person.name ? `${person.name} (${person.email})` : person.email;
  const shortWho = person.name || person.email;
  const newest = meetings[0];
  const when = newest ? fmtDate(newest.meeting_start || newest.created_at, tz) : 'recently';
  const meetingWord = meetings.length > 1 ? `${meetings.length} meetings (latest ${when})` : `your meeting on ${when}`;

  const subject = `Want me to add ${shortWho} to your contacts?`;
  const text =
`Hi ${coachFirstName},

You met ${who} - I've saved the transcript from ${meetingWord}, but they're not in your Wingguy database yet. That means I can't pull the meeting up by their name, or draft follow-ups to them in your voice.

Want me to add them? Just tell me in a Wingguy chat - something like "add ${shortWho}, here's their LinkedIn: ..." - and paste their LinkedIn profile link (plus their phone or a better email if you have one). I'll create the record and attach the transcript automatically.

Not someone you want to track? Just ignore this - I won't ask about them again.

- Wingguy`;
  return { subject, text };
}

/**
 * One notify pass. Sends at most MAX_PER_PASS emails, one per (tenant, person) not yet notified.
 * @param {object} [opts] { force, onlyClientId } — force bypasses the env gate (manual test job).
 */
async function notifyPendingLeads(opts = {}) {
  const { force = false, onlyClientId = null } = opts;
  if (!force && !notifyEnabled()) return { skipped: 'PENDING_NOTIFY_ENABLED not true', sent: 0 };

  const rows = await findPendingLeadMeetings({ coachClientId: onlyClientId || undefined, limit: 200 });
  // Group meetings per (tenant, email) where at least one entry is NOT yet notified.
  const byPerson = new Map();
  for (const m of rows) {
    for (const p of m.pending) {
      if (p.notifiedAt) continue;
      const key = `${m.coach_client_id}|${p.email}`;
      const cur = byPerson.get(key) || { coachClientId: m.coach_client_id, person: p, meetings: [] };
      if (!cur.person.name && p.name) cur.person = p; // prefer an entry that carries a name
      cur.meetings.push(m);
      byPerson.set(key, cur);
    }
  }
  const summary = { checkedAt: new Date().toISOString(), waitingPeople: byPerson.size, sent: 0, failed: 0, details: [] };
  if (!byPerson.size) return summary;

  const coachCache = new Map();
  for (const { coachClientId, person, meetings } of byPerson.values()) {
    if (summary.sent + summary.failed >= MAX_PER_PASS) { log.info(`pending notify: cap ${MAX_PER_PASS} hit — rest next pass`); break; }
    try {
      let coach = coachCache.get(coachClientId);
      if (coach === undefined) { coach = await clientService.getClientById(coachClientId); coachCache.set(coachClientId, coach || null); }
      const to = coach && String(coach.clientEmailAddress || '').trim();
      if (!to) { summary.details.push({ coachClientId, email: person.email, skipped: 'no client email address on record' }); continue; }

      const coachFirstName = String(coach.clientName || '').trim().split(/\s+/)[0] || 'there';
      const { subject, text } = buildEmail({ coachFirstName, person, meetings, tz: coach.timezone });
      const payload = {
        from: `Wingguy <wingguy@${process.env.MAILGUN_DOMAIN}>`,
        to,
        subject,
        text,
      };
      if (BCC && BCC.toLowerCase() !== to.toLowerCase()) payload.bcc = BCC;
      await sendMailgun(payload);
      await markPendingLeadNotified({ coachClientId, email: person.email });
      summary.sent++;
      summary.details.push({ coachClientId, email: person.email, to, meetings: meetings.length });
      log.info(`pending notify: emailed ${coachClientId} (${to}) about ${person.email} (${meetings.length} meeting(s))`);
    } catch (e) {
      // NOT stamped on failure — next pass retries the send.
      summary.failed++;
      summary.details.push({ coachClientId, email: person.email, error: e.message });
      log.warn(`pending notify: ${coachClientId} / ${person.email} failed: ${e.message}`);
    }
  }
  return summary;
}

module.exports = { notifyPendingLeads, notifyEnabled, buildEmail };
