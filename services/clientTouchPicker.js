// services/clientTouchPicker.js
//
// THE PICKER for the weekly client touch planner (docs/CLIENT-TOUCH-PLANNER.md). Pure: facts
// about one client + the labelled shelf + that client's touch record IN, one pick OUT. Nothing here
// reads a store or sends anything; services/clientTouchPlanner.js gathers the facts live every
// Monday and hands them in, and tests/client-touch-picker.test.js pins every rule below.
//
// What comes back:
//   { leftOut: true, reason }                       - never sent anything this week, and why
//   { what: null, reason, rule }                    - a deliberate quiet week
//   { what: { kind, key, title }, form, reason, rule, event? }   - the one email to prepare
//
// `kind` is a touch-record kind (one-pager | habit | setup | one-off | call); `key` is the piece
// slug, the setup step key, the pin's key, or 'check-in' for a call offer. `form` is full | short |
// one-off. `reason` is the one line Guy reads on the Monday screen - it never appears in the email.
//
// THE FACTS (every one plain data, gathered elsewhere):
//   clientId, clientName
//   status            Airtable Status ('Active' or not)
//   coachingStatus    'Graduated' | 'Paused' | null
//   group             'onboarding' | 'running' | 'paused'  (the client board's grouping)
//   billingLapsed     true when the billing lapse chain has paused them
//   unsubscribed      Series Unsubscribed ticked
//   hasUnsubToken     an unsubscribe link can be built
//   address           the address the client reads (null = none known)
//   bounced           recent mail to that address bounced
//   skipUntil         ISO date Guy said "nothing until" (null = none)
//   skipThisWeek      Guy marked skip on the Monday screen
//   lastInviteSent    ISO - the record's Last Invite Sent (the opening-run trigger)
//   seriesStartDate   ISO - Email Series Start Date (Guy starting the run early)
//   daysSinceLastCall          days since a one-to-one with Guy (null = never)
//   daysSinceLastSubstantial   days since Guy's last substantial touch (call, real email, intro)
//   sessionBooked              a session with Guy is in the calendar ahead
//   todayHasRecords            their Today tab has records
//   events            [{ key, at }] - things that happened recently (config/clientTouchLabels EVENTS keys)
//   callProblems      [problem keys] tagged on recent calls (config PROBLEMS)
//   stuckStop         journey stop key they have sat on, and stuckDays
//   quietOrBusy       no logins for weeks while the campaign runs, or Guy's note says flat out
//   note              { length: 'full'|'short', ... } - the client note (lasting things only)
//   pin               { kind, key, title, form?, note? } Guy pinned for THIS client this week
//   pinForEveryone    the same shape, pinned for everyone this week
//   nextSetupStep     { key, title } - the next not-done setup to-do, or null
//
// THE SHELF: [{ slug, title, labels: { kind, stops, problems, resend, event, teases } }] from
// onePagerContent.listPieces() plus the orientation; `order` = config/onePagerSeriesManifest.client.
//
// THE RECORD: this client's rows from services/clientTouchStore (kind, key, form, sent_at).

const { ORIENTATION, eventKeysFor } = require('../config/clientTouchLabels');
const MANIFEST = require('../config/onePagerSeriesManifest');

const DAY = 24 * 60 * 60 * 1000;
const NOT_THIS_WEEK_DAYS = 6;      // Guy wrote to them, or had a session, in the last 6 days
const STUCK_DAYS = 14;             // sat on a journey stop this long
const MINDSET_EVERY = 4;           // every fourth email is a mindset piece
const REINFORCE_AFTER_WEEKS = 8;   // a short re-send, never within 8 weeks of the full piece
const CALL_EVERY_DAYS = 42;        // the six-weekly check-in
const MAX_PER_WEEK = 2;            // at most two emails a week from Guy (habit first)
const EMAIL_KINDS = ['one-pager', 'habit', 'setup', 'one-off', 'personal'];
const WEEK_WINDOW_MS = 6.5 * DAY;  // see emailsThisWeek
const CALL_OFFER_WAIT_DAYS = 14;   // an offer of times went - give them two weeks to answer before another
const LIKELY_WEEKS = 5;            // how far "likely next" looks ahead

const ORIENTATION_PIECE = { slug: ORIENTATION.slug, title: "What you've actually joined", labels: ORIENTATION };

// ---------------------------------------------------------------------------------------------
// Small helpers over the record

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; };
const daysBetween = (later, earlier) => Math.floor((later - earlier) / DAY);

/** Monday 00:00 (local clock of `now`) - the week the plan is for. */
function weekStart(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/**
 * Emails in the last week - "a week" is rolling, so Monday never forgets Saturday. The window is
 * six and a half days, not seven: last Monday's weekly email went a few seconds after 8am, and
 * this Monday's check runs at 8am - a seven-day window would count it and starve every other week.
 */
function emailsThisWeek(record, now) {
  const start = now - WEEK_WINDOW_MS;
  return record.filter((r) => EMAIL_KINDS.includes(r.kind) && ms(r.sent_at) !== null && ms(r.sent_at) >= start);
}

function sentToday(record, now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  return record.some((r) => EMAIL_KINDS.includes(r.kind) && ms(r.sent_at) !== null && ms(r.sent_at) >= d.getTime());
}

/** Rows for one piece (any form). */
function rowsFor(record, kind, key) {
  return record.filter((r) => r.kind === kind && r.key === key);
}
const had = (record, kind, key) => rowsFor(record, kind, key).length > 0;

/** The one-pager and habit emails the planner (or Guy) has sent, oldest first - the run so far. */
function piecesSent(record) {
  return record
    .filter((r) => (r.kind === 'one-pager' || r.kind === 'habit') && ms(r.sent_at) !== null)
    .sort((a, b) => ms(a.sent_at) - ms(b.sent_at));
}

// ---------------------------------------------------------------------------------------------
// The shelf

function shelfWithOrientation(shelf) {
  const list = (shelf || []).filter((p) => p && p.slug && p.labels && p.labels.kind);
  if (!list.some((p) => p.slug === ORIENTATION.slug)) list.unshift(ORIENTATION_PIECE);
  return list;
}

function pieceKind(piece) {
  return piece.labels.kind === 'habit' ? 'habit' : 'one-pager';
}

/** Eligible = not had in full yet, and a habit piece only once Today has records. */
function eligible(piece, facts, record) {
  if (had(record, pieceKind(piece), piece.slug)) return false;
  if (piece.labels.kind === 'habit' && !facts.todayHasRecords) return false;
  return true;
}

function formFor(piece, facts) {
  const note = facts.note || {};
  if (pieceKind(piece) === 'habit') return 'one-off';
  return note.length === 'short' ? 'short' : 'full';
}

function pick(piece, facts, rule, reason, extra = {}) {
  return {
    what: { kind: pieceKind(piece), key: piece.slug, title: piece.title || piece.slug },
    form: formFor(piece, facts),
    rule,
    reason,
    ...extra,
  };
}

const nothing = (rule, reason) => ({ what: null, rule, reason });
const leftOut = (reason) => ({ leftOut: true, reason });

/** How-pieces first, then the rest in manifest order - the doc's "how-pieces first". */
function howFirst(pieces, order) {
  const pos = (p) => { const i = order.indexOf(p.slug); return i < 0 ? 999 : i; };
  return [...pieces].sort((a, b) => {
    const ah = a.labels.kind === 'how' ? 0 : 1;
    const bh = b.labels.kind === 'how' ? 0 : 1;
    return ah - bh || pos(a) - pos(b);
  });
}

// ---------------------------------------------------------------------------------------------
// The rules, in the doc's order

/** "Who is never sent anything" - checked every time, on the day of sending. */
function neverSentReason(facts, now) {
  if (facts.status !== 'Active') return 'not an active client (Status is not Active)';
  if (facts.coachingStatus === 'Paused' || facts.group === 'paused') return 'paused - on the board\'s paused group';
  if (facts.billingLapsed) return 'billing has lapsed';
  if (facts.unsubscribed) return 'unsubscribed from the weekly emails';
  if (!facts.address) return 'no working email address on the record';
  if (facts.bounced) return 'recent mail to their address bounced';
  if (!facts.hasUnsubToken) return 'no unsubscribe token on the record - every email would ship a dead link';
  if (facts.skipThisWeek) return 'Guy said skip this week';
  const until = ms(facts.skipUntil);
  if (until !== null && until > now) return `Guy said nothing until ${String(facts.skipUntil).slice(0, 10)}`;
  return null;
}

/** A pin (this client's, or everyone's) as a pick, if it still makes sense. */
function pinPick(pin, facts, shelf, record, who) {
  if (!pin || !pin.key) return null;
  const kind = pin.kind || 'one-off';
  if (kind === 'one-pager' || kind === 'habit') {
    const piece = shelf.find((p) => p.slug === pin.key);
    if (!piece) return null;
    if (had(record, pieceKind(piece), piece.slug) && who === 'everyone') return null; // they already had it
    return pick(piece, facts, 'pinned', `Guy pinned it ${who === 'everyone' ? 'for everyone this week' : 'for them this week'}`, { form: pin.form || formFor(piece, facts) });
  }
  return {
    what: { kind, key: pin.key, title: pin.title || pin.key },
    form: pin.form || 'one-off',
    rule: 'pinned',
    reason: `Guy pinned it ${who === 'everyone' ? 'for everyone this week' : 'for them this week'}${pin.note ? ` - ${pin.note}` : ''}`,
  };
}

/** Habit pieces first (Guy's rule: a habit email takes the first slot), then manifest order. */
function habitFirst(pieces, order) {
  const pos = (p) => { const i = order.indexOf(p.slug); return i < 0 ? 999 : i; };
  return [...pieces].sort((a, b) => {
    const ah = a.labels.kind === 'habit' ? 0 : 1;
    const bh = b.labels.kind === 'habit' ? 0 : 1;
    return ah - bh || pos(a) - pos(b);
  });
}

/** An event that happened -> the piece labelled for it, if they have not had it. */
function eventPick(facts, shelf, record, order) {
  for (const ev of facts.events || []) {
    const answers = habitFirst(shelf.filter((p) => eventKeysFor(p.labels.event).includes(ev.key)), order);
    const fresh = answers.filter((p) => eligible(p, facts, record));
    if (fresh.length) return pick(fresh[0], facts, 'event', `${eventLabel(ev)} - the piece written for that moment`, { event: ev.key });
    // Everything for this event has gone out in full; a resendable one can go again, short.
    const again = answers.find((p) => p.labels.resend && !resentRecently(record, p, Date.now()));
    if (again) return pick(again, facts, 'event', `${eventLabel(ev)} - a short reminder of ${again.title}`, { form: 'short', event: ev.key });
  }
  return null;
}

function eventLabel(ev) {
  const { EVENTS } = require('../config/clientTouchLabels');
  return (EVENTS[ev.key] && EVENTS[ev.key].label) || ev.key;
}

function resentRecently(record, piece, now) {
  const rows = rowsFor(record, pieceKind(piece), piece.slug);
  return rows.some((r) => ms(r.sent_at) !== null && now - ms(r.sent_at) < REINFORCE_AFTER_WEEKS * 7 * DAY);
}

/**
 * Six weeks since the last call and nothing booked -> "time for a call" (Guy approves the offer).
 * Not again while an offer is still waiting for an answer - one offer, then two weeks' grace.
 */
function callDue(facts, record = [], now = Date.now()) {
  if (facts.group !== 'running') return false;
  if (facts.sessionBooked) return false;
  const offered = record.some((r) => r.kind === 'personal' && r.key === 'check-in' && ms(r.sent_at) !== null && now - ms(r.sent_at) < CALL_OFFER_WAIT_DAYS * DAY);
  if (offered) return false;
  if (facts.daysSinceLastCall === null || facts.daysSinceLastCall === undefined) return true; // never had one
  return facts.daysSinceLastCall >= CALL_EVERY_DAYS;
}

function callPick(facts) {
  const why = facts.daysSinceLastCall === null || facts.daysSinceLastCall === undefined
    ? 'no call with Guy on record and nothing booked'
    : `${facts.daysSinceLastCall} days since the last call and nothing booked`;
  return {
    what: { kind: 'call', key: 'check-in', title: 'Time for a call' },
    form: 'one-off',
    rule: 'time-for-a-call',
    reason: `${why} - offer two or three times (never a booking link)`,
  };
}

/** A call problem -> a piece that answers it, how-pieces first. */
function problemPick(facts, shelf, record, order) {
  for (const key of facts.callProblems || []) {
    const answers = howFirst(shelf.filter((p) => p.labels.problems.includes(key) && eligible(p, facts, record)), order);
    if (answers.length) return pick(answers[0], facts, 'call-problem', `a recent call showed "${key}" - ${answers[0].title} answers it`, { problem: key });
  }
  return null;
}

/** Stuck on a journey stop 14+ days -> a piece for that stop, how-pieces first. */
function stuckPick(facts, shelf, record, order) {
  if (!facts.stuckStop || !(facts.stuckDays >= STUCK_DAYS)) return null;
  const answers = howFirst(shelf.filter((p) => p.labels.stops.includes(facts.stuckStop) && eligible(p, facts, record)), order);
  if (!answers.length) return null;
  return pick(answers[0], facts, 'stuck', `${facts.stuckDays} days on the "${facts.stuckStop}" stop - ${answers[0].title} helps with it`);
}

/** The tease rule: the last piece sent promised "that's next"; keep the pair together. */
function promisePick(facts, shelf, record, order) {
  const sent = piecesSent(record);
  const last = sent[sent.length - 1];
  if (!last) return null;
  const piece = shelf.find((p) => p.slug === last.key);
  if (!piece || !piece.labels.teases) return null;
  const i = order.indexOf(last.key);
  const nextSlug = i >= 0 ? order[i + 1] : (last.key === ORIENTATION.slug ? order[0] : null);
  const next = nextSlug ? shelf.find((p) => p.slug === nextSlug) : null;
  if (!next || !eligible(next, facts, record)) return null;
  return pick(next, facts, 'promised', `${piece.title} ended "that's next" - ${next.title} is what it promised`);
}

/** Every fourth email is a mindset piece, when one is left. */
function mindsetPick(facts, shelf, record, order) {
  const n = piecesSent(record).length;
  if ((n + 1) % MINDSET_EVERY !== 0) return null;
  const left = howFirst(shelf.filter((p) => p.labels.kind === 'mindset' && eligible(p, facts, record)), order);
  if (!left.length) return null;
  return pick(left[0], facts, 'mindset-rhythm', `email ${n + 1} - every fourth one is a mindset piece`);
}

/** Next in the default order: the orientation, then the client run in manifest order. */
function nextInOrderPick(facts, shelf, record, order) {
  const run = [ORIENTATION.slug, ...order];
  for (const slug of run) {
    const piece = shelf.find((p) => p.slug === slug);
    if (!piece || !eligible(piece, facts, record)) continue;
    const pos = run.indexOf(slug) + 1;
    return pick(piece, facts, 'next-in-order', `next in the run (${pos} of ${run.length})`);
  }
  return null;
}

/** Everything sent: a short re-send of the oldest resendable piece, never within 8 weeks. */
function reinforcePick(facts, shelf, record, order, now) {
  const sent = piecesSent(record);
  const candidates = [];
  for (const row of sent) {
    const piece = shelf.find((p) => p.slug === row.key);
    if (!piece || !piece.labels.resend) continue;
    if (candidates.some((c) => c.slug === piece.slug)) continue;
    if (resentRecently(record, piece, now)) continue;
    const first = rowsFor(record, pieceKind(piece), piece.slug).map((r) => ms(r.sent_at)).filter((t) => t !== null).sort()[0];
    candidates.push({ slug: piece.slug, piece, first });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.first - b.first);
  const c = candidates[0];
  return pick(c.piece, facts, 'reinforce', `everything has gone out - a short reminder of ${c.piece.title} (first sent ${new Date(c.first).toISOString().slice(0, 10)})`, { form: 'short' });
}

// ---------------------------------------------------------------------------------------------

/**
 * The pick for one client this week.
 * @param {object} facts   see the top of the file
 * @param {object[]} shelf listPieces() output (labels on every piece)
 * @param {object[]} record this client's touch rows
 * @param {{ now?: Date|number, order?: string[] }} opts
 */
function pickFor(facts, shelf, record, opts = {}) {
  const now = ms(opts.now) !== null ? ms(opts.now) : Date.now();
  const order = opts.order || MANIFEST.client;
  const rows = Array.isArray(record) ? record : [];
  const pieces = shelfWithOrientation(shelf);

  // A. Never sent anything.
  const never = neverSentReason(facts, now);
  if (never) return leftOut(never);

  // Limits that hold whatever else is true.
  if (sentToday(rows, now)) return nothing('limit', 'something already went today - never two on the same day');
  const week = emailsThisWeek(rows, now);
  if (week.length >= MAX_PER_WEEK) return nothing('limit', `already ${week.length} this week - two is the most`);

  // B. During onboarding: only setup steps and event-set-off emails, at most one a week.
  if (facts.group === 'onboarding') {
    if (week.length >= 1) return nothing('onboarding', 'in onboarding and one email has gone this week - the session is the touch');
    const mine = pinPick(facts.pin, facts, pieces, rows, 'them');
    if (mine) return mine;
    const ev = eventPick(facts, pieces, rows, order);
    if (ev) return ev;
    if (facts.nextSetupStep && facts.nextSetupStep.key) {
      if (!had(rows, 'setup', facts.nextSetupStep.key)) {
        return {
          what: { kind: 'setup', key: facts.nextSetupStep.key, title: facts.nextSetupStep.title || facts.nextSetupStep.key },
          form: 'one-off',
          rule: 'setup-step',
          reason: 'in onboarding - the next small to-do, because the previous one is done',
        };
      }
    }
    return nothing('onboarding', 'in onboarding - the session is the touch, nothing scheduled');
  }

  // 1. Not this week.
  const since = facts.daysSinceLastSubstantial;
  if (since !== null && since !== undefined && since <= NOT_THIS_WEEK_DAYS) {
    return nothing('not-this-week', `Guy touched base ${since === 0 ? 'today' : `${since} day${since === 1 ? '' : 's'} ago`} (a call, a real email or an introduction) - nothing on top of that`);
  }

  // 2. Pinned - this client first, then everyone.
  const mine = pinPick(facts.pin, facts, pieces, rows, 'them');
  if (mine) return mine;
  const all = pinPick(facts.pinForEveryone, facts, pieces, rows, 'everyone');
  if (all) return all;

  // 3. An event fired - these go even before the opening run has started.
  const ev = eventPick(facts, pieces, rows, order);
  if (ev) return ev;

  // Time for a call - six weeks since the last one, nothing booked (running clients only).
  if (callDue(facts, rows, now)) return callPick(facts);

  // The opening run starts the week the first invitations actually go out (Last Invite Sent
  // fills in), or when Guy starts it early (Email Series Start Date). Not the machine's IDLE word.
  const started = ms(facts.lastInviteSent) !== null || (ms(facts.seriesStartDate) !== null && ms(facts.seriesStartDate) <= now);
  if (!started) return nothing('waiting-for-invitations', 'no invitation has gone out yet - the opening run starts the week they do (or pin something)');

  // 4. A call problem.
  const prob = problemPick(facts, pieces, rows, order);
  if (prob) return prob;

  // 5. Stuck on a journey stop.
  const stuck = stuckPick(facts, pieces, rows, order);
  if (stuck) return stuck;

  // The last piece promised "that's next" - keep the pair together (piece-labels note, 22 Oct).
  const promised = promisePick(facts, pieces, rows, order);
  if (promised) return promised;

  // 6. Mindset rhythm.
  const mind = mindsetPick(facts, pieces, rows, order);
  if (mind) return mind;

  // 7. Next in the default order.
  const next = nextInOrderPick(facts, pieces, rows, order);
  if (next) return next;

  // 8. Reinforce.
  const again = reinforcePick(facts, pieces, rows, order, now);
  if (again) return again;

  // 9. Nothing.
  return nothing('nothing-left', 'everything on the shelf has gone out and nothing is due a reminder yet');
}

/** The touch row a pick would leave behind once sent (the planner's own send). */
function simulatedTouch(p, at) {
  return { kind: p.what.kind === 'call' ? 'personal' : p.what.kind, key: p.what.key, form: p.form, sent_at: new Date(at).toISOString(), source: 'planner', simulated: true };
}

/**
 * "Likely next": the picks the following weeks would get IF NOTHING CHANGES - the picker run
 * forward on today's facts, each earlier pick treated as sent. Provisional by nature: an event
 * (a first call booked, a campaign running low) can jump the queue any week.
 *
 * @param {object} facts     the facts the week's plan was built on (as at `at`, the sending morning)
 * @param {object[]} shelf
 * @param {object[]} record  this client's real touch rows
 * @param {{ at, order?, weeks?, thisPick?, pinsByWeek? }} opts
 *   thisPick     this Monday's pick - treated as sent at `at` (omit when nothing is going this week)
 *   pinsByWeek   [weekIndex] -> { pin, pinForEveryone } for the weeks ahead (1 = the Monday after)
 * @returns {{ weekIndex, at, what, form, rule, reason, leftOut? }[]}
 */
function projectAhead(facts, shelf, record, opts = {}) {
  const start = ms(opts.at) !== null ? ms(opts.at) : Date.now();
  const weeks = opts.weeks || LIKELY_WEEKS;
  const rows = Array.isArray(record) ? [...record] : [];
  if (opts.thisPick && opts.thisPick.what) rows.push(simulatedTouch(opts.thisPick, start));
  const plus = (v, d) => (v === null || v === undefined ? v : v + d);
  const out = [];
  for (let i = 1; i <= weeks; i++) {
    const at = start + i * 7 * DAY;
    const shift = i * 7;
    const pins = (opts.pinsByWeek && opts.pinsByWeek[i]) || {};
    const wf = {
      ...facts,
      daysSinceLastCall: plus(facts.daysSinceLastCall, shift),
      daysSinceLastSubstantial: plus(facts.daysSinceLastSubstantial, shift),
      stuckDays: facts.stuckStop ? plus(facts.stuckDays || 0, shift) : facts.stuckDays,
      events: (facts.events || []).filter((ev) => ms(ev.at) !== null && daysBetween(at, ms(ev.at)) <= 14),
      skipThisWeek: false,
      pin: pins.pin || null,
      pinForEveryone: pins.pinForEveryone || null,
    };
    const p = pickFor(wf, shelf, rows, { now: at, order: opts.order });
    out.push({ weekIndex: i, at: new Date(at).toISOString(), ...p });
    if (p.what) rows.push(simulatedTouch(p, at));
  }
  return out;
}

module.exports = {
  pickFor,
  projectAhead,
  simulatedTouch,
  neverSentReason,
  callDue,
  weekStart,
  emailsThisWeek,
  NOT_THIS_WEEK_DAYS,
  STUCK_DAYS,
  MINDSET_EVERY,
  REINFORCE_AFTER_WEEKS,
  CALL_EVERY_DAYS,
  CALL_OFFER_WAIT_DAYS,
  LIKELY_WEEKS,
  MAX_PER_WEEK,
  ORIENTATION_PIECE,
};
