/**
 * LinkedIn signed out on a client's Linked Helper machine - tell someone.
 *
 * WHY IT EXISTS. On Tue 6 Oct 2026 at about 3:25pm Sydney, LinkedIn signed Rick Wong out on his
 * Linked Helper machine. His campaign stopped dead. The machine knew - its watchdog reported
 * "LinkedIn LOGGED OUT" onto his row every five minutes - but nothing read that line, so nobody
 * found out for two days, and then only because Guy asked a question. It was Rick's third
 * sign-out in three weeks. Whatever the cause, a sign-out is a five-minute fix for the client;
 * two silent days is the real cost.
 *
 * HOW. routes/linkedHelperMachineRoutes.js receives the watchdog report every five minutes and
 * asks signoutStep() what to do. Two fields on the client's row carry the state:
 *   'LinkedIn Last Signed In'  - stamped on every report that reads LinkedIn ok
 *   'LinkedIn Sign-Out Alerted' - stamped when the alert goes; cleared when it reads ok again
 * The alert fires once per episode, when the machine reads LOGGED OUT / RESTRICTED / CHALLENGE
 * and was last signed in more than an hour ago. Readings of "unknown" (Linked Helper closed for
 * an update, window not open) change nothing - they neither start nor end an episode.
 *
 * A machine that has NEVER read signed in (a new client who has not signed in for the first time
 * yet - that machine sits on the LinkedIn login page by design) never alerts: 'LinkedIn Last
 * Signed In' is blank, and "signed out" is not news there.
 *
 * Trust: since 6 Oct 2026 (b28ffd64) the watchdog says LOGGED OUT only when the window title
 * names a LinkedIn login / signup / authwall / home page. All eight machines carried that reader
 * on 8 Oct 2026, so the reading can be acted on. Before it, a busy machine read LOGGED OUT.
 *
 * Who is told:
 *   - the coach (Guy), by email the moment it fires, and on the queue's Machine check box (chat
 *     and the Follow-Ups screen) for as long as it lasts - signedOutMachineAlerts();
 *   - the coach again, briefly, when the machine reads signed in again;
 *   - the client, with their machine link and two steps - ONLY when EMAIL_CLIENT is true. It is
 *     false until Guy has approved the wording; until then Guy's alert carries the exact message
 *     so he can forward it.
 */

const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger({ module: 'lhSignoutWatch' });

// On since 8 Oct 2026 - Guy approved the wording ("(I know a) Guy", "Linked Helper machine").
const EMAIL_CLIENT = true;

// An hour. A sign-in page for a few minutes is LinkedIn being LinkedIn; an hour is a stopped
// campaign. Short enough that a sign-out at 3:25pm is fixed the same afternoon.
const ALERT_AFTER_MS = 60 * 60 * 1000;

const FIELDS = {
  lastSignedIn: 'LinkedIn Last Signed In',
  alerted: 'LinkedIn Sign-Out Alerted',
};

const NEEDS_PERSON = new Set(['LOGGED OUT', 'RESTRICTED', 'CHALLENGE']);

function ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
}

/**
 * What one watchdog report means for the sign-out state. Pure.
 *
 * Returns { fields, alert, recovered }:
 *   fields    - extra fields to write on the client's row with this report (may be {})
 *   alert     - true when the alert should go now (once per episode)
 *   recovered - true when an alerted episode just ended (LinkedIn reads ok again)
 */
function signoutStep({ linkedin, lastSignedIn, alertedAt, now = Date.now() } = {}) {
  const state = String(linkedin || '').trim();
  const nowIso = new Date(now).toISOString();
  if (state === 'ok') {
    const fields = { [FIELDS.lastSignedIn]: nowIso };
    if (alertedAt) fields[FIELDS.alerted] = null;
    return { fields, alert: false, recovered: !!alertedAt };
  }
  if (!NEEDS_PERSON.has(state)) return { fields: {}, alert: false, recovered: false };
  const last = ms(lastSignedIn);
  if (last === null) return { fields: {}, alert: false, recovered: false }; // never signed in here
  if (alertedAt) return { fields: {}, alert: false, recovered: false };     // already told
  if (now - last < ALERT_AFTER_MS) return { fields: {}, alert: false, recovered: false };
  return { fields: { [FIELDS.alerted]: nowIso }, alert: true, recovered: false };
}

/** "Tue 6 Oct, 3:20pm" in the given time zone; falls back to Brisbane. */
function whenWords(iso, timeZone) {
  const t = ms(iso);
  if (t === null) return 'some time ago';
  const fmt = (tz) => new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(t)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  let p;
  try { p = fmt(timeZone || 'Australia/Brisbane'); } catch (_e) { p = fmt('Australia/Brisbane'); }
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}${String(p.dayPeriod || '').toLowerCase().replace(/\s/g, '')}`;
}

function firstName(s, fallback) {
  return String(s || '').trim().split(/\s+/)[0] || fallback;
}

/** How a client email is signed: Guy signs "(I know a) Guy" (his own sign-off, 8 Oct 2026). */
function signoffName(coachName) {
  const coach = firstName(coachName, 'Guy');
  return coach === 'Guy' ? '(I know a) Guy' : coach;
}

/**
 * The one plain line for the coach - email body and the queue's Machine check box alike.
 * `self` = the coach's own machine, worded to them.
 */
function coachLine({ clientName, state, lastSignedIn, machineLink, timeZone, self = false }) {
  const who = self ? 'Your' : `${clientName}'s`;
  const since = whenWords(lastSignedIn, timeZone);
  const link = machineLink ? ` at ${machineLink}` : '';
  if (state === 'RESTRICTED') {
    return `${who} LinkedIn account shows as RESTRICTED on the Linked Helper machine (last fine ${since}). The campaign is stopped - this needs a look on LinkedIn itself, not just a sign-in.`;
  }
  if (state === 'CHALLENGE') {
    return `LinkedIn is asking ${self ? 'you' : clientName} to confirm it's really ${self ? 'you' : 'them'} on the Linked Helper machine (last fine ${since}). The campaign is paused until ${self ? 'you answer' : 'they answer'} it${link}.`;
  }
  return `${who} Linked Helper machine has been signed out of LinkedIn since about ${since}. The campaign is paused until ${self ? 'you sign' : 'they sign'} in again${link}.`;
}

/**
 * The email to the CLIENT. Short on purpose (Guy's edits only ever cut). Sent only when
 * EMAIL_CLIENT is true; until then its text rides inside the coach's alert, ready to forward.
 * Not sent for RESTRICTED - a restricted account needs a conversation, not two steps.
 */
function buildClientEmail({ clientFirstName, clientName, coachName, machineLink, state }) {
  const first = firstName(clientFirstName || clientName, 'there');
  const coach = signoffName(coachName);
  const challenge = state === 'CHALLENGE';
  const subject = challenge ? 'LinkedIn wants to check it\'s you' : 'Your LinkedIn needs you to sign in again';
  const text = [
    `Hi ${first},`,
    challenge
      ? 'LinkedIn is asking you to confirm it\'s really you on your Linked Helper machine, so your campaign has paused until you do.'
      : 'LinkedIn has signed you out on your Linked Helper machine, so your campaign has paused - no invitations go out until you sign back in.',
    `It takes a minute:\n1. Open your machine: ${machineLink}\n2. ${challenge ? 'Do what LinkedIn asks on the screen (usually a code it sends you).' : 'Sign in to LinkedIn there with your usual email and password, plus the code LinkedIn sends you if it asks.'}`,
    'That\'s it - your campaign picks up where it left off.',
    'If anything looks odd, just reply and I\'ll help.',
    `Cheers,\n${coach}`,
  ].join('\n\n');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = text.split('\n\n').map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('');
  return { subject, text, html };
}

/** Why the client cannot be emailed, or null when they can. */
function clientEmailBlocker({ client, state }) {
  if (!EMAIL_CLIENT) return 'the client email is switched off until Guy approves its wording';
  if (state === 'RESTRICTED') return 'a restricted account needs you, not a sign-in email';
  if (!String((client && client.clientEmailAddress) || '').trim()) return 'there is no email address on their record';
  if (!String((client && client.machineLink) || '').trim()) return 'they have no machine link on their record';
  return null;
}

async function coachFor(client, deps) {
  if (!client || !client.coach) return null;
  try {
    const getById = deps.getClientById || require('./clientService').getClientById;
    return await getById(client.coach);
  } catch (_e) { return null; }
}

/**
 * Send the alert for one client. Best-effort throughout: it runs after the status write and must
 * never fail the machine's report. Returns what happened, for the log.
 */
async function sendSignoutAlert({ client, state, lastSignedIn, deps = {} }) {
  const coach = await coachFor(client, deps);
  const self = !client.coach; // a coach's own machine (Guy's) has no Coach on its row
  const coachName = (coach && coach.clientName) || 'Guy Wilson';
  const line = coachLine({
    clientName: client.clientName || client.clientId, state, lastSignedIn,
    machineLink: client.machineLink, timeZone: (coach && coach.timezone) || client.timezone, self,
  });
  const result = { clientId: client.clientId, state, clientEmailed: false };

  let tail = '';
  if (!self) {
    const cm = buildClientEmail({
      clientFirstName: client.clientFirstName, clientName: client.clientName, coachName,
      machineLink: client.machineLink, state,
    });
    const blocker = clientEmailBlocker({ client, state });
    if (blocker) {
      tail = `\n\nThey have NOT been emailed: ${blocker}.`;
      if (state !== 'RESTRICTED') tail += `\n\nThe message, ready to forward:\n\nSubject: ${cm.subject}\n\n${cm.text}`;
    } else {
      const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
      const addr = String(process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`).trim();
      try {
        const sendClient = deps.sendClientEmail || require('./emailNotificationService').sendMailgunEmail;
        await sendClient({
          from: addr.includes('<') ? addr : `${coachName} <${addr}>`,
          to: String(client.clientEmailAddress).trim(),
          cc: coachEmail,
          'h:Reply-To': coachEmail,
          subject: cm.subject, text: cm.text, html: cm.html,
        });
        result.clientEmailed = true;
        tail = `\n\nWingguy has emailed them the two steps to sign in again - you are copied.`;
        const record = deps.recordComm || require('./commsLog').recordComm;
        await record({
          coachClientId: client.clientId, channel: 'lh-signout', recipient: String(client.clientEmailAddress).trim(),
          subject: cm.subject, summary: `LinkedIn ${state} on their Linked Helper machine - sign-in steps sent`,
          meta: { state, lastSignedIn },
        });
      } catch (e) {
        result.clientEmailError = e.message;
        tail = `\n\nWingguy tried to email them but it failed (${e.message}) - let them know yourself.`;
      }
    }
  }

  const subject = self
    ? 'Your Linked Helper machine: LinkedIn signed out'
    : `${client.clientName || client.clientId}'s Linked Helper machine: LinkedIn signed out`;
  const text = `${line}${tail}`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    const html = `<p>${text.split('\n\n').map((p) => p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')).join('</p><p>')}</p>`;
    await send(subject, html, null, { text });
    result.coachEmailed = true;
  } catch (e) {
    result.coachEmailError = e.message;
  }
  log.warn(`LH-SIGNOUT ${client.clientId} ${state}: coach ${result.coachEmailed ? 'emailed' : 'NOT emailed'}, client ${result.clientEmailed ? 'emailed' : 'not emailed'}`);
  return result;
}

/** The short all-clear to the coach once an alerted machine reads signed in again. */
async function sendRecoveredNote({ client, deps = {} }) {
  const self = !client.coach;
  const who = self ? 'Your' : `${client.clientName || client.clientId}'s`;
  const text = `${who} Linked Helper machine is signed in to LinkedIn again - the campaign is running.`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(`${who} Linked Helper machine is signed in again`, `<p>${text}</p>`, null, { text });
    return { ok: true };
  } catch (e) {
    log.warn(`LH-SIGNOUT ${client.clientId} recovered note failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** The LinkedIn part of a Machine Status line ("RUNNING | LinkedIn LOGGED OUT | ..."). */
function linkedinFromStatus(status) {
  const m = String(status || '').match(/\|\s*LinkedIn (ok|LOGGED OUT|RESTRICTED|CHALLENGE|unknown)\s*(\||$)/);
  return m ? m[1] : null;
}

/**
 * The queue's Machine check lines for one coach: every machine of theirs (their clients', and
 * their own) that has alerted and still reads signed out. Pure: `clients` from getAllClients().
 * Same shape as extensionDistStore.darkMachineAlerts, so both ride one list.
 */
function signedOutMachineAlerts({ coachClientId, clients = [] } = {}) {
  if (!coachClientId) return [];
  const out = [];
  for (const c of clients || []) {
    if (!c) continue;
    const self = c.clientId === coachClientId;
    if (!self && c.coach !== coachClientId) continue;
    if (String(c.status || '').trim() !== 'Active' || c.coachingStatus === 'Paused') continue;
    if (!c.linkedinSignOutAlerted) continue;
    const state = linkedinFromStatus(c.machineStatus);
    if (!state || !NEEDS_PERSON.has(state)) continue; // the next ok report clears the field
    out.push({
      clientId: c.clientId,
      clientName: c.clientName || c.clientId,
      kind: 'signed-out',
      since: c.linkedinLastSignedIn || null,
      line: coachLine({
        clientName: c.clientName || c.clientId, state, lastSignedIn: c.linkedinLastSignedIn,
        machineLink: c.machineLink, timeZone: c.timezone, self,
      }),
    });
  }
  return out;
}

/** Live version for one coach. Best-effort: [] on any failure, never blocks the queue. */
async function signedOutMachinesForCoach(coachClientId) {
  if (!coachClientId) return [];
  try {
    const clients = await require('./clientService').getAllClients();
    return signedOutMachineAlerts({ coachClientId, clients });
  } catch (e) {
    log.warn(`signed-out machine check skipped for ${coachClientId}: ${e.message}`);
    return [];
  }
}

module.exports = {
  signoutStep, sendSignoutAlert, sendRecoveredNote, signedOutMachineAlerts, signedOutMachinesForCoach,
  buildClientEmail, coachLine, whenWords, signoffName, linkedinFromStatus, clientEmailBlocker,
  FIELDS, ALERT_AFTER_MS, EMAIL_CLIENT,
};
