/**
 * Three warnings about a client's Linked Helper campaign, decided on each 5-minute machine report.
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
 *    or a licence bought long ago) is outside the window and never warned. The machine cannot see
 *    a purchase (Linked Helper keeps the licence on its own servers; the local config is
 *    encrypted), so a licence bought DURING the trial is recorded on the row as 'LH Licence
 *    Bought', and a client with that date is never warned. WHY (27 Oct 2026): Alex Solti, Guy
 *    McPhee and Matthew Bulat all bought on a call and still got "your trial ends Saturday" -
 *    a false alarm about their campaign stopping. The client email still says "ignore this if
 *    you've bought", for a purchase nobody has recorded yet.
 *
 * 2. CAMPAIGN GONE QUIET. No invitation sent for QUIET_DAYS, after one was sent within the last
 *    DORMANT_DAYS (a campaign that has been off for months is not "gone quiet" - that is a client
 *    choice, and alerting on it at deploy would be noise). Once per episode; the next invitation
 *    clears it and the coach gets an all-clear. Worded by WHY it is quiet, from the queue:
 *      stopped   - people waiting in a running campaign, yet nothing sent (licence expired,
 *                  LinkedIn signed out, Linked Helper stuck - the machine status line rides along)
 *      paused    - the only people waiting are in paused campaigns that sent within DORMANT_DAYS
 *                  (19 Oct 2026: Julian Davis's two live campaigns ran out of people, and 35 left
 *                  in an old parked one made the email say "paused" - he was right, they were
 *                  only sleeping. A long-parked campaign is a choice; the news is "empty".)
 *      empty     - nobody left to invite: the search needs topping up
 *    It catches what the trial warning cannot: a PAID licence running out a year from now
 *    (the machine cannot see a paid licence's end date).
 *
 * 3. CAMPAIGN PAUSED WITH PEOPLE WAITING - the fast one. WHY (Guy, 16 Oct 2026): on 15 Oct he
 *    paused his own live campaign by hand while copying its settings for a client, forgot, and
 *    a lead who accepted that evening was never checked, visited or sent to Wingguy - a paused
 *    campaign stops LOOKING for acceptances, so people say yes unseen. The four-day rule would
 *    not have spoken until the 19th. So: a campaign the machine reports as PAUSED (not archived)
 *    with people still queued to invite, which sent an invitation within DORMANT_DAYS (a live
 *    campaign, not one parked months ago), and which has stayed that way for PAUSED_HOURS
 *    (first seen stamped on the row; a pause of a few minutes to tweak settings is normal) ->
 *    the coach is emailed once, and the client too, naming the campaign, when it was first seen
 *    paused and the people still waiting to be invited. The episode clears when no such campaign
 *    is left in the report (resumed, emptied or archived), and the coach gets an all-clear.
 *    A machine still on a watchdog without `paused_campaigns` never enters this rule.
 *    Two things the first live alert got wrong (Guy's campaign #40, 16 Oct 2026):
 *      - "paused for 2 hours" - the clock starts when the watchdog FIRST SAW it paused, not when
 *        it was paused, so the wording is "paused since at least <when first seen>", in the
 *        reader's own time zone, never a duration.
 *      - the count is the machine's `waiting`, which must be Linked Helper's own "Profiles to
 *        process" on the invite step (lh-watchdog.py campaign_state reads the table Linked Helper
 *        keeps for it); the email says what the number is: people still waiting to be invited.
 *
 * State on the client's master row (all written by the machine report route):
 *   'LH First Action', 'Last Invite Sent', 'Invites Waiting' - the facts, readable in Airtable
 *   'Trial Warning Sent', 'Quiet Campaign Alerted'           - once-per-episode stamps
 *   'LH Licence Bought'                                      - set by hand (or /onboard): no trial warning
 *   'Campaign Paused Since', 'Paused Campaign Alerted'       - the paused episode: first seen, told
 *
 * Client emails: ON since 8 Oct 2026 (Guy approved the wording), coach copied, replies to the coach.
 * With EMAIL_CLIENT false the coach's alert carries the message ready to forward instead.
 */

const { createSafeLogger } = require('../utils/loggerHelper');
const { whenWords, signoffName } = require('./lhSignoutWatch');

const log = createSafeLogger({ module: 'lhCampaignWatch' });

// On since 8 Oct 2026 - Guy approved the wording.
const EMAIL_CLIENT = true;

const DAY = 86400000;
const TRIAL_DAYS = 14;
const WARN_DAYS_BEFORE = 5;
// Four days, not three: a campaign that sends four days a week can rest three in a row
// (Rick Wong, 3 to 6 Oct 2026), and an alert that fires on a normal weekend stops being read.
const QUIET_DAYS = 4;
const DORMANT_DAYS = 30;
// Two hours, not two reports: a pause to copy settings or fix a message is normal and over in
// minutes; one that outlives a long lunch is a pause somebody forgot.
const HOUR = 3600000;
const PAUSED_HOURS = 2;

const LICENCE_PAGE = 'https://knowaguy.com.au/your-licence';

const FIELDS = {
  firstAction: 'LH First Action',
  lastInvite: 'Last Invite Sent',
  waiting: 'Invites Waiting',
  trialWarned: 'Trial Warning Sent',
  licenceBought: 'LH Licence Bought',
  quietAlerted: 'Quiet Campaign Alerted',
  pausedSince: 'Campaign Paused Since',
  pausedAlerted: 'Paused Campaign Alerted',
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

/**
 * Why the campaign is quiet, from what the machine reported.
 *   exhausted - it is still TRYING (an attempt in the last 2 days) but every invitation fails:
 *               everyone it reaches was invited before or is already connected. Sam Noble's
 *               campaign, 3-8 Oct 2026: 38 "invited previously", 12 "already 1st-degree".
 */
function quietKind({ waitingRunning, waitingPaused, lastAttemptAt, failedRecent, now = Date.now() }) {
  const attempt = ms(lastAttemptAt);
  if (num(failedRecent) > 0 && attempt !== null && now - attempt < 2 * DAY) return 'exhausted';
  if (num(waitingRunning) > 0) return 'stopped';
  if (num(waitingPaused) > 0) return 'paused';
  return 'empty';
}

/**
 * People waiting in paused campaigns that sent an invitation of their own within DORMANT_DAYS -
 * the ones a "paused" quiet alert can honestly blame. A watchdog without `paused_campaigns` can't
 * tell them apart, so it falls back to its plain `waiting_paused` total.
 */
function livePausedWaiting(report, now = Date.now()) {
  if (!Array.isArray(report && report.paused_campaigns)) return num(report && report.waiting_paused);
  let total = 0;
  for (const c of report.paused_campaigns) {
    if (!c || typeof c !== 'object') continue;
    const last = ms(c.last_invite_at);
    if (last !== null && now - last < DORMANT_DAYS * DAY) total += num(c.waiting);
  }
  return total;
}

/**
 * The paused campaign worth shouting about, from the machine's `paused_campaigns` list: paused,
 * people still queued, and an invitation of its own within DORMANT_DAYS. Several -> the one that
 * sent most recently (the live one). Null when none qualifies.
 */
function pausedCampaignOf(report, now = Date.now()) {
  const list = Array.isArray(report && report.paused_campaigns) ? report.paused_campaigns : [];
  let best = null;
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const waiting = num(c.waiting);
    const last = ms(c.last_invite_at);
    if (waiting <= 0 || last === null || now - last >= DORMANT_DAYS * DAY) continue;
    if (!best || last > best.lastInviteAt) {
      best = { id: c.id, name: String(c.name || '').trim() || 'your campaign', waiting, lastInviteAt: last };
    }
  }
  return best;
}

/**
 * What one machine report means for the campaign. Pure.
 *
 * report  - the machine's `campaign` block ({first_action_at, last_invite_at, waiting_running,
 *           waiting_paused, paused_campaigns}); absent on a machine still on the old watchdog ->
 *           nothing happens
 * client  - the stamps already on the row (trialWarningSent, licenceBought, quietCampaignAlerted,
 *           campaignPausedSince, pausedCampaignAlerted)
 *
 * Returns { fields, trialWarn, quietAlert, quietRecovered, kind, pausedAlert, pausedRecovered, paused }
 * where `paused` is the campaign the alert is about ({ name, waiting, since }) - `since` being the
 * ISO time the watchdog first saw it paused, which is as early as anyone can truthfully say.
 */
function campaignStep({ report, client = {}, now = Date.now() } = {}) {
  const out = {
    fields: {}, trialWarn: false, quietAlert: false, quietRecovered: false, kind: null,
    pausedAlert: false, pausedRecovered: false, paused: null,
  };
  if (!report || typeof report !== 'object' || !Object.keys(report).length) return out;

  const first = ms(report.first_action_at);
  const last = ms(report.last_invite_at);
  const waitingRunning = num(report.waiting_running);
  const waitingPaused = num(report.waiting_paused);
  if (first !== null) out.fields[FIELDS.firstAction] = iso(first);
  if (last !== null) out.fields[FIELDS.lastInvite] = iso(last);
  out.fields[FIELDS.waiting] = waitingRunning + waitingPaused;

  // 1. Trial ending - once, inside the last WARN_DAYS_BEFORE days of the trial, unless a licence
  // is already recorded as bought.
  const ends = trialEndsAt(report.first_action_at);
  if (ends !== null && !client.trialWarningSent && !client.licenceBought && now < ends && now >= ends - WARN_DAYS_BEFORE * DAY) {
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
      out.kind = quietKind({ waitingRunning, waitingPaused: livePausedWaiting(report, now), lastAttemptAt: report.last_invite_attempt_at, failedRecent: report.failed_invites_recent, now });
      out.fields[FIELDS.quietAlerted] = iso(now);
    }
  }

  // 3. Paused with people waiting - only on a watchdog that lists the paused campaigns.
  if (Array.isArray(report.paused_campaigns)) {
    const paused = pausedCampaignOf(report, now);
    let since = ms(client.campaignPausedSince);
    const told = ms(client.pausedCampaignAlerted);
    if (!paused) {
      // Nothing paused with people in it any more: resumed, emptied or archived. Episode over.
      if (since !== null || told !== null) {
        out.fields[FIELDS.pausedSince] = null;
        out.fields[FIELDS.pausedAlerted] = null;
        out.pausedRecovered = told !== null;
      }
    } else {
      if (since === null || paused.lastInviteAt > since) {
        // First sight of this pause - or it ran and sent since we first saw it, so this is a new one.
        since = now;
        out.fields[FIELDS.pausedSince] = iso(now);
        if (told !== null) out.fields[FIELDS.pausedAlerted] = null;
      } else if (told === null && now - since >= PAUSED_HOURS * HOUR) {
        out.pausedAlert = true;
        out.fields[FIELDS.pausedAlerted] = iso(now);
      }
      out.paused = { name: paused.name, waiting: paused.waiting, since: iso(since) };
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
  return `${who} Linked Helper trial ends about ${whenWords(iso(ends), timeZone)} - 14 days after the first campaign action on ${dayWords(firstActionAt, timeZone)}. The campaign stops then unless a licence has been bought. Buying page: ${LICENCE_PAGE} - once they have bought, put the date in 'LH Licence Bought' on their row and they are never warned again.`;
}

function quietCoachLine({ clientName, kind, lastInviteAt, waiting, machineStatus, timeZone, self = false, now = Date.now() }) {
  const who = self ? 'Your' : `${clientName}'s`;
  const days = daysSince(lastInviteAt, now);
  const since = `${dayWords(lastInviteAt, timeZone)}${days !== null ? ` (${days} days)` : ''}`;
  if (kind === 'exhausted') {
    return `${who} campaign has run out of fresh people - it is still trying, but every invitation since ${since} has failed: everyone it reaches has been invited before or is already connected. It needs a fresh search.`;
  }
  if (kind === 'empty') {
    return `${who} campaign has run out of people - the last invitation went out ${since}, and nobody is left to invite. The search needs topping up.`;
  }
  if (kind === 'paused') {
    return `${who} campaign is paused - no invitation since ${since}, with ${waiting} people waiting in a paused campaign.`;
  }
  const status = machineStatus ? ` Machine says: ${String(machineStatus).slice(0, 120)}.` : '';
  return `${who} campaign has stopped sending - no invitation since ${since}, with ${waiting} people still waiting. Usual causes: the licence has run out, LinkedIn signed out, or Linked Helper is stuck.${status}`;
}

function pausedCoachLine({ clientName, campaignName, since, waiting, timeZone, self = false }) {
  const who = self ? 'Your' : `${clientName}'s`;
  const people = `${waiting} ${waiting === 1 ? 'person' : 'people'}`;
  return `${who} Linked Helper machine's campaign "${campaignName}" has been paused since at least ${whenWords(since, timeZone)} with ${people} still waiting to be invited - resume it or they will accept unseen.`;
}

function htmlFrom(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function trialClientEmail({ clientFirstName, clientName, coachName, firstActionAt, timeZone }) {
  const first = firstName(clientFirstName || clientName, 'there');
  const coach = signoffName(coachName);
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
  const coach = signoffName(coachName);
  const day = dayWords(lastInviteAt, timeZone);
  let subject;
  let body;
  if (kind === 'exhausted') {
    subject = 'Your campaign has run out of fresh people';
    body = [
      `Your campaign is still running, but it hasn't been able to send an invitation since ${day} - everyone it's reaching has either been invited before or is already one of your connections.`,
      'To keep it going, it needs a fresh search: in Claude, type "Help me with my first campaign" and it walks you through it.',
      "Or reply and we'll do it together.",
    ];
  } else if (kind === 'empty') {
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

function pausedClientEmail({ clientFirstName, clientName, coachName, campaignName, since, waiting, machineLink, timeZone }) {
  const first = firstName(clientFirstName || clientName, 'there');
  const coach = signoffName(coachName);
  const people = `${waiting} ${waiting === 1 ? 'person' : 'people'}`;
  const subject = `Your campaign "${campaignName}" is paused with ${people} waiting`;
  const text = [
    `Hi ${first},`,
    `Your Linked Helper campaign "${campaignName}" has been paused since at least ${whenWords(since, timeZone)}, with ${people} still waiting to be invited.`,
    'While it\'s paused, nothing checks who has accepted your invitation - so people can say yes and neither of us hears about it.',
    `If you paused it on purpose, that's fine - ignore this. If not, open your Linked Helper machine and press play on the campaign:\n${machineLink || 'ask your Claude to "open my Linked Helper machine"'}`,
    'Or reply and I\'ll switch it back on with you.',
    `Cheers,\n${coach}`,
  ].join('\n\n');
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

/**
 * Send the coach's alert, and the client's email when allowed. Returns what happened.
 * alert = 'trial' | 'quiet' (with kind) | 'paused' (with paused = { name, waiting, since }).
 */
async function sendCampaignAlert({ client, alert, kind = null, paused = null, report = {}, deps = {}, now = Date.now() }) {
  const coach = await coachFor(client, deps);
  const self = !client.coach;
  const coachName = (coach && coach.clientName) || 'Guy Wilson';
  const coachTz = (coach && coach.timezone) || client.timezone;
  const name = client.clientName || client.clientId;
  const waiting = num(report.waiting_running) + num(report.waiting_paused);

  const p = paused || { name: 'your campaign', waiting: 0, since: null };
  const line = alert === 'trial'
    ? trialCoachLine({ clientName: name, firstActionAt: report.first_action_at, timeZone: coachTz, self })
    : alert === 'paused'
      ? pausedCoachLine({ clientName: name, campaignName: p.name, since: p.since, waiting: p.waiting, timeZone: coachTz, self })
      : quietCoachLine({ clientName: name, kind, lastInviteAt: report.last_invite_at, waiting, machineStatus: client.machineStatus, timeZone: coachTz, self, now });

  const who = { clientFirstName: client.clientFirstName, clientName: client.clientName, coachName };
  const cm = alert === 'trial'
    ? trialClientEmail({ ...who, firstActionAt: report.first_action_at, timeZone: client.timezone })
    : alert === 'paused'
      ? pausedClientEmail({ ...who, campaignName: p.name, since: p.since, waiting: p.waiting, machineLink: client.machineLink, timeZone: client.timezone })
      : quietClientEmail({ ...who, kind, lastInviteAt: report.last_invite_at, machineLink: client.machineLink, timeZone: client.timezone });

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
      const addr = require('./mailgunCreds').fromEmail();
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
          coachClientId: client.clientId,
          channel: alert === 'trial' ? 'lh-trial-ending' : alert === 'paused' ? 'lh-campaign-paused' : 'lh-campaign-quiet',
          recipient: String(client.clientEmailAddress).trim(), subject: cm.subject,
          summary: alert === 'trial' ? 'Linked Helper trial ending - licence page sent'
            : alert === 'paused' ? `Campaign "${p.name}" paused since at least ${p.since} with ${p.waiting} waiting to be invited - told them`
              : `Campaign quiet (${kind}) - told them`,
          meta: { alert, kind, paused, report },
        });
      } catch (e) {
        result.clientEmailError = e.message;
        tail = `\n\nWingguy tried to email them but it failed (${e.message}) - let them know yourself.`;
      }
    }
  }

  const subject = alert === 'trial'
    ? `${self ? 'Your' : `${name}'s`} Linked Helper trial ends soon`
    : alert === 'paused'
      ? `${self ? 'Your' : `${name}'s`} campaign "${p.name}": paused with ${p.waiting} people waiting`
      : `${self ? 'Your' : `${name}'s`} campaign: ${kind === 'exhausted' ? 'run out of fresh people' : kind === 'empty' ? 'run out of people' : kind === 'paused' ? 'paused' : 'stopped sending'}`;
  const text = `${line}${tail}`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(subject, htmlFrom(text), null, { text });
    result.coachEmailed = true;
  } catch (e) {
    result.coachEmailError = e.message;
  }
  log.warn(`LH-CAMPAIGN ${client.clientId} ${alert}${kind ? `/${kind}` : ''}${paused ? `/"${p.name}" since ${p.since} ${p.waiting} waiting` : ''}: coach ${result.coachEmailed ? 'emailed' : 'NOT emailed'}, client ${result.clientEmailed ? 'emailed' : 'not emailed'}`);
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

/** The all-clear once a paused campaign with people waiting is paused no more. */
async function sendPausedClearedNote({ client, deps = {} }) {
  const who = !client.coach ? 'Your' : `${client.clientName || client.clientId}'s`;
  const text = `${who} paused campaign is no longer paused with people waiting - it has been resumed, emptied or archived.`;
  try {
    const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
    await send(`${who} paused campaign: all clear`, `<p>${text}</p>`, null, { text });
    return { ok: true };
  } catch (e) {
    log.warn(`LH-CAMPAIGN ${client.clientId} paused-cleared note failed: ${e.message}`);
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
  campaignStep, sendCampaignAlert, sendSendingAgainNote, sendPausedClearedNote, quietCampaignAlerts, quietCampaignsForCoach,
  trialClientEmail, quietClientEmail, pausedClientEmail, trialCoachLine, quietCoachLine, pausedCoachLine,
  trialEndsAt, quietKind, livePausedWaiting, pausedCampaignOf, dayWords,
  FIELDS, EMAIL_CLIENT, TRIAL_DAYS, WARN_DAYS_BEFORE, QUIET_DAYS, DORMANT_DAYS, PAUSED_HOURS, LICENCE_PAGE,
};
