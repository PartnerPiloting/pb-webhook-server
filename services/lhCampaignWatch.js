/**
 * Two warnings about a client's Linked Helper campaign, decided on each 5-minute machine report.
 *
 * WHY (Guy, 8 Oct 2026): Rick Wong's campaign sent nothing for two days and nobody knew, and his
 * trial was five days from running out with no licence bought. Guy normally emails about the
 * licence himself; these are the net underneath, so a client is never left with a campaign that
 * has quietly stopped.
 *
 * 1. TRIAL ENDING. Linked Helper's 14-day trial starts when the first campaign runs, and the
 *    machine reports the first campaign action it ever recorded (lh-watchdog.py campaign_state).
 *    Five days before day 14, once, the coach is emailed - and the client too, once EMAIL_CLIENT
 *    is on - with the licence page. A machine whose first action is long past (history imported,
 *    or a licence bought long ago) is outside the window and never warned. A client who has
 *    already bought is told "ignore this": the machine cannot see a purchase.
 *
 * 2. CAMPAIGN GONE QUIET. No invitation sent for QUIET_DAYS, after one was sent within the last
 *    DORMANT_DAYS (a campaign that has been off for months is not "gone quiet" - that is a client
 *    choice, and alerting on it at deploy would be noise). Once per episode; the next invitation
 *    clears it and the coach gets an all-clear. Worded by WHY it is quiet, from the queue:
 *      stopped   - people waiting in a running campaign, yet nothing sent (licence expired,
 *                  LinkedIn signed out, Linked Helper stuck - the machine status line rides along)
 *      paused    - the only people waiting are in paused campaigns
 *      empty     - nobody left to invite: the search needs topping up
 *    It catches what the trial warning cannot: a PAID licence running out a year from now
 *    (the machine cannot see a paid licence's end date).
 *
 * State on the client's master row (all written by the machine report route):
 *   'LH First Action', 'Last Invite Sent', 'Invites Waiting' - the facts, readable in Airtable
 *   'Trial Warning Sent', 'Quiet Campaign Alerted'           - once-per-episode stamps
 *
 * Client emails: built, but OFF (EMAIL_CLIENT) until Guy approves the wording - his alert carries
 * the message ready to forward, exactly as services/lhSignoutWatch.js does.
 */

const { createSafeLogger } = require('../utils/loggerHelper');
const { whenWords } = require('./lhSignoutWatch');

const log = createSafeLogger({ module: 'lhCampaignWatch' });

// Guy approves the client wording, then this goes true (8 Oct 2026: held for his OK).
const EMAIL_CLIENT = false;

const DAY = 86400000;
const TRIAL_DAYS = 14;
const WARN_DAYS_BEFORE = 5;
// Four days, not three: a campaign that sends four days a week can rest three in a row
// (Rick Wong, 3 to 6 Oct 2026), and an alert that fires on a normal weekend stops being read.
const QUIET_DAYS = 4;
const DORMANT_DAYS = 30;

const LICENCE_PAGE = 'https://knowaguy.com.au/your-licence';

const FIELDS = {
  firstAction: 'LH First Action',
  lastInvite: 'Last Invite Sent',
  waiting: 'Invites Waiting',
  trialWarned: 'Trial Warning Sent',
  quietAlerted: 'Quiet Campaign Alerted',
};

function ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
}
const iso = (t) => new Date(t).toISOString();
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

/** When the trial ends: TRIAL_DAYS after the first campaign action, or null. */
function trialEndsAt(firstActionAt) {
  const t = ms(firstActionAt);
  return t === null ? null : t + TRIAL_DAYS * DAY;
}

/** Why the campaign is quiet, from the queue the machine reported. */
function quietKind({ waitingRunning, waitingPaused }) {
  if (num(waitingRunning) > 0) return 'stopped';
  if (num(waitingPaused) > 0) return 'paused';
  return 'empty';
}

/**
 * What one machine report means for the campaign. Pure.
 *
 * report  - the machine's `campaign` block ({first_action_at, last_invite_at, waiting_running,
 *           waiting_paused}); absent on a machine still on the old watchdog -> nothing happens
 * client  - the stamps already on the row (trialWarningSent, quietCampaignAlerted)
 *
 * Returns { fields, trialWarn, quietAlert, quietRecovered, kind }.
 */
function campaignStep({ report, client = {}, now = Date.now() } = {}) {
  const out = { fields: {}, trialWarn: false, quietAlert: false, quietRecovered: false, kind: null };
  if (!report || typeof report !== 'object' || !Object.keys(report).length) return out;

  const first = ms(report.first_action_at);
  const last = ms(report.last_invite_at);
  const waitingRunning = num(report.waiting_running);
  const waitingPaused = num(report.waiting_paused);
  if (first !== null) out.fields[FIELDS.firstAction] = iso(first);
  if (last !== null) out.fields[FIELDS.lastInvite] = iso(last);
  out.fields[FIELDS.waiting] = waitingRunning + waitingPaused;

  // 1. Trial ending - once, inside the last WARN_DAYS_BEFORE days of the trial.
  const ends = trialEndsAt(report.first_action_at);
  if (ends !== null && !client.trialWarningSent && now < ends && now >= ends - WARN_DAYS_BEFORE * DAY) {
    out.trialWarn = true;
    out.fields[FIELDS.trialWarned] = iso(now);
  }

  // 2. Campaign gone quiet.
  const alerted = ms(client.quietCampaignAlerted);
  if (alerted !== null && last !== null && last > alerted) {
    // An invitation has gone out since the alert: the episode is over.
    out.fields[FIELDS.quietAlerted] = null;
    out.quietRecovered = true;
  } else if (alerted === null && last !== null) {
    const idle = now - last;
    if (idle >= QUIET_DAYS * DAY && idle < DORMANT_DAYS * DAY) {
      out.quietAlert = true;
      out.kind = quietKind({ waitingRunning, waitingPaused });
      out.fields[FIELDS.quietAlerted] = iso(now);
    }
  }
  return out;
}

/** "Tuesday 13 October" in the given time zone (falls back to Brisbane). */
function dayWords(isoOrMs, timeZone) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : ms(isoOrMs);
  if (t === null) return 'soon';
  const fmt = (tz) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(t));
  try { return fmt(timeZone || 'Australia/Brisbane').replace(',', ''); } catch (_e) { return fmt('Australia/Brisbane').replace(',', ''); }
}

const firstName = (s, fallback) => String(s || '').trim().split(/\s+/)[0] || fallback;
const daysSince = (isoStr, now = Date.now()) => {
  const t = ms(isoStr);
  return t === null ? null : Math.floor((now - t) / DAY);
};

// ---------------------------------------------------------------------------
// Wording - the coach's line (email and queue) and the client's email
// ---------------------------------------------------------------------------

function trialCoachLine({ clientName, firstActionAt, timeZone, self = false }) {
  const ends = trialEndsAt(firstActionAt);
  const who = self ? 'Your' : `${clientName}'s`;
  return `${who} Linked Helper trial ends about ${whenWords(iso(ends), timeZone)} - 14 days after the first campaign action on ${dayWords(firstActionAt, timeZone)}. The campaign stops then unless a licence has been bought. Buying page: ${LICENCE_PAGE}`;
}

function quietCoachLine({ clientName, kind, lastInviteAt, waiting, machineStatus, timeZone, self = false, now = Date.now() }) {
  const who = self ? 'Your' : `${clientName}'s`;
  const days = daysSince(lastInviteAt, now);
  const since = `${dayWords(lastInviteAt, timeZone)}${days !== null ? ` (${days} days)` : ''}`;
  if (kind === 'empty') {
    return `${who} campaign has run out of people - the last invitation went out ${since}, and nobody is left to invite. The search needs topping up.`;
  }
  if (kind === 'paused') {
    return `${who} campaign is paused - no invitation since ${since}, with ${waiting} people waiting in a paused campaign.`;
  }
  const status = machineStatus ? ` Machine says: ${String(machineStatus).slice(0, 120)}.` : '';
  return `${who} campaign has stopped sending - no invitation since ${since}, with ${waiting} people still waiting. Usual causes: the licence has run out, LinkedIn signed out, or Linked Helper is stuck.${status}`;
}

function htmlFrom(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function trialClientEmail({ clientFirstName, clientName, coachName, firstActionAt, timeZone }) {
  const first = firstName(clientFirstName || clientName, 'there');
  const coach = firstName(coachName, 'Guy');
  const day = dayWords(trialEndsAt(firstActionAt), timeZone);
  const subject = `Your Linked Helper trial ends on ${day}`;
  const text = [
    `Hi ${first},`,
    `A heads-up: your Linked Helper free trial ends on ${day}. When it does, your campaign stops sending until there's a licence on your account.`,
    `Buying one takes about five minutes. Which one to get, my promo code and where to click are all here:\n${LICENCE_PAGE}`,
    'Put the promo code in before you press Proceed to Payment. Buy it any time before then - it switches on by itself when the trial ends.',
    'If you\'ve already bought it, you\'re all set - ignore this.',
    `Cheers,\n${coach}`,
  ].join('\n\n');
  return { subject, text, html: htmlFrom(text) };
}

function quietClientEmail({ clientFirstName, clientName, coachName, kind, lastInviteAt, machineLink, timeZone }) {
  const first = firstName(clientFirstName || clientName, 'there');
  const coach = firstName(coachName, 'Guy');
  const day = dayWords(lastInviteAt, timeZone);
  let subject;
  let body;
  if (kind === 'empty') {
    subject = 'Your campaign has run out of people';
    body = [
      `Your campaign has invited everyone in your search - the last invitation went out on ${day}.`,
      'To keep it going, top up your search: in Claude, type "Help me with my first campaign" and it walks you through it.',
      'Or reply and we\'ll do it together.',
    ];
  } else if (kind === 'paused') {
    subject = 'Your campaign is paused';
    body = [
      `Your Linked Helper campaign is paused, so nothing has gone out since ${day}.`,
      'If you paused it on purpose, that\'s fine - ignore this. If not, just reply and I\'ll switch it back on with you.',
    ];
  } else {
    subject = 'Your campaign has stopped sending';
    body = [
      `Your Linked Helper campaign hasn't sent any invitations since ${day}, so nobody new is hearing from you.`,
      `The usual reasons are your licence running out or LinkedIn signing you out. Open your machine and have a look:\n${machineLink || 'ask your Claude to "open my Linked Helper machine"'}`,
      `If Linked Helper is asking you to sign in, sign in and it carries on. If it's asking for a licence, here's how to buy one:\n${LICENCE_PAGE}`,
      'If it all looks normal, just reply and I\'ll take a look.',
    ];
  }
  const text = [`Hi ${first},`, ...body, `Cheers,\n${coach}`].join('\n\n');
  return { subject, text, html: htmlFrom(text) };
}

// ---------------------------------------------------------------------------
// Sending - best-effort throughout, never fails the machine's report
// ---------------------------------------------------------------------------

async function coachFor(client, deps) {
  if (!client || !client.coach) return null;
  try {
    const getById = deps.getClientById || require('./clientService').getClientById;
    return await getById(client.coach);
  } catch (_e) { return null; }
}

/** Send the coach's alert, and the client's email when allowed. Returns what happened. */
async function sendCampaignAlert({ client, alert, kind = null, report = {}, deps = {}, now = Date.now() }) {
  const coach = await coachFor(client, deps);
  const self = !client.coach;
  const coachName = (coach && coach.clientName) || 'Guy Wilson';
  const coachTz = (coach && coach.timezone) || client.timezone;
  const name = client.clientName || client.clientId;
  const waiting = num(report.waiting_running) + num(report.waiting_paused);

  const line = alert === 'trial'
    ? trialCoachLine({ clientName: name, firstActionAt: report.first_action_at, timeZone: coachTz, self })
    : quietCoachLine({ clientName: name, kind, lastInviteAt: report.last_invite_at, waiting, machineStatus: client.machineStatus, timeZone: coachTz, self, now });

  const cm = alert === 'trial'
    ? trialClientEmail({ clientFirstName: client.clientFirstName, clientName: client.clientName, coachName, firstActionAt: report.first_action_at, timeZone: client.timezone })
    : quietClientEmail({ clientFirstName: client.clientFirstName, clientName: client.clientName, coachName, kind, lastInviteAt: report.last_invite_at, machineLink: client.machineLink, timeZone: client.timezone });

  const result = { clientId: client.clientId, alert, kind, clientEmailed: false };
  let tail = '';
  if (!self) {
    let blocker = null;
    if (!EMAIL_CLIENT) blocker = 'the client email is switched off until you approve its wording';
    else if (!String(client.clientEmailAddress || '').trim()) blocker = 'there is no email address on their record';
    if (blocker) {
      tail = `\n\nThey have NOT been emailed: ${blocker}.\n\nThe message, ready to forward:\n\nSubject: ${cm.subject}\n\n${cm.text}`;
    } else {
      const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
      const addr = String(process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`).trim();
      try {
        const sendClient = deps.sendClientEmail || require('./emailNotificationService').sendMailgunEmail;
        await sendClient({
          from: addr.includes('<') ? addr : `${coachName} <${addr}>`,
          to: String(client.clientEmailAddress).trim(), cc: coachEmail, 'h:Reply-To': coachEmail,
          subject: cm.subject, text: cm.text, html: cm.html,
        });
        result.clientEmailed = true;
        tail = '\n\nWingguy has emailed them - you are copied.';
        const record = deps.recordComm || require('./commsLog').recordComm;
        await record({
          coachClientId: client.clientId, channel: alert === 'trial' ? 'lh-trial-ending' : 'lh-campaign-quiet',
          recipient: String(client.clientEmailAddress).trim(), subject: cm.subject,
          summary: alert === 'trial' ? 'Linked Helper trial ending - licence page sent' : `Campaign quiet (${kind}) - told them`,
          meta: { alert, kind, report },
        });
      } catch (e) {
        result.clientEmailError = e.message;
        tail = `\n\nWingguy tried to email them but it failed (${e.message}) - let them know yourself.`;
      }
    }
  }

  const subject = alert === 'trial'
    ? `${self ? 'Your' : `${name}'s`} Linked Helper trial ends soon`
    : `${self ? 'Your' : `${name}'s`} campaign: ${kind === 'empty' ? 'run out of people' : kind === 'paused' ? 'paused' : 'stopped sending'}`;
  const text = `${line}${tail}`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(subject, htmlFrom(text), null, { text });
    result.coachEmailed = true;
  } catch (e) {
    result.coachEmailError = e.message;
  }
  log.warn(`LH-CAMPAIGN ${client.clientId} ${alert}${kind ? `/${kind}` : ''}: coach ${result.coachEmailed ? 'emailed' : 'NOT emailed'}, client ${result.clientEmailed ? 'emailed' : 'not emailed'}`);
  return result;
}

/** The all-clear once a quiet campaign sends again. */
async function sendSendingAgainNote({ client, deps = {} }) {
  const who = !client.coach ? 'Your' : `${client.clientName || client.clientId}'s`;
  const text = `${who} campaign is sending invitations again.`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(`${who} campaign is sending again`, `<p>${text}</p>`, null, { text });
    return { ok: true };
  } catch (e) {
    log.warn(`LH-CAMPAIGN ${client.clientId} sending-again note failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// The queue's Machine check lines
// ---------------------------------------------------------------------------

/**
 * Every machine of this coach's (their clients' and their own) whose campaign has been alerted
 * as quiet and has not sent since. Pure: `clients` from getAllClients(). Same shape as the other
 * Machine check lines, so all ride one list.
 */
function quietCampaignAlerts({ coachClientId, clients = [], now = Date.now() } = {}) {
  if (!coachClientId) return [];
  const out = [];
  for (const c of clients || []) {
    if (!c) continue;
    const self = c.clientId === coachClientId;
    if (!self && c.coach !== coachClientId) continue;
    if (String(c.status || '').trim() !== 'Active' || c.coachingStatus === 'Paused') continue;
    const alerted = ms(c.quietCampaignAlerted);
    if (alerted === null) continue;
    const last = ms(c.lastInviteSent);
    if (last !== null && last > alerted) continue; // sending again; the next report clears it
    if (last !== null && now - last >= DORMANT_DAYS * DAY) continue; // a month quiet: a choice, not news
    const waiting = num(c.invitesWaiting);
    out.push({
      clientId: c.clientId,
      clientName: c.clientName || c.clientId,
      kind: 'campaign-quiet',
      line: quietCoachLine({
        clientName: c.clientName || c.clientId,
        kind: waiting > 0 ? 'stopped' : 'empty',
        lastInviteAt: c.lastInviteSent, waiting, machineStatus: c.machineStatus, timeZone: c.timezone, self, now,
      }),
    });
  }
  return out;
}

async function quietCampaignsForCoach(coachClientId) {
  if (!coachClientId) return [];
  try {
    const clients = await require('./clientService').getAllClients();
    return quietCampaignAlerts({ coachClientId, clients });
  } catch (e) {
    log.warn(`quiet-campaign check skipped for ${coachClientId}: ${e.message}`);
    return [];
  }
}

module.exports = {
  campaignStep, sendCampaignAlert, sendSendingAgainNote, quietCampaignAlerts, quietCampaignsForCoach,
  trialClientEmail, quietClientEmail, trialCoachLine, quietCoachLine, trialEndsAt, quietKind, dayWords,
  FIELDS, EMAIL_CLIENT, TRIAL_DAYS, WARN_DAYS_BEFORE, QUIET_DAYS, DORMANT_DAYS, LICENCE_PAGE,
};
