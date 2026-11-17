// services/clientEdition.js
//
// "Hi Network Builders" - the same weekly idea as "Network building, rethought", sent to every
// active CLIENT (designed with Guy in chat, 16 Nov 2026; docs/LIST-EDITIONS.md "The client copy").
//
// Why: the per-client weekly emails (services/clientTouchPlanner.js) need Guy to review each one
// and he does not get to them - on 11 Nov all 7 lapsed. Clients are left off the prospect list, so
// they never saw its ideas either. This is ONE email for all of them, with no claim about any one
// client's situation, so it can go without him.
//
//   - The words are this week's list edition (services/listEditions.js): the same idea, the same
//     paragraphs. Only the greeting ("Hi Network Builders,"), the closing line and the footer
//     differ. So Guy shapes one email a week, and an edit or swap of the edition changes both.
//   - It goes Wednesday from 9:30am Brisbane, straight after the list edition starts going, unless
//     Guy holds it. Holding the list edition holds this too; this can also be held by itself.
//   - Every active client gets it, onboarding or not, whether or not Guy wrote to them that week.
//     Left off: the planner's own never-sent list (services/clientTouchPicker.js neverSentReason) -
//     not active, paused, winding down, on the leave-off list, unsubscribed, no address, a recent
//     bounce, no unsubscribe token, "nothing until <date>".
//   - OFF until Guy starts it ("start the client email" -> wingguy_list_edition clients_on). Before
//     that it can be read and tested but never sends.
//   - From guy@knowaguy.com.au through Mailgun with replies to Guy's mailbox, like the list. The
//     footer link is the client's own weekly-email unsubscribe (services/clientUnsubscribe.js).

const le = require('./listEditions');
const picker = require('./clientTouchPicker');

const { q, getState, setState, esc, para, wrapHtml, dayLabel, sendAtMs } = le.internals;

const GREETING = 'Hi Network Builders,';
// PROPOSED 16 Nov 2026 - Guy to confirm the wording when he sees the first test copy.
const CLIENT_CLOSER = 'If this one raises a question, just hit reply.';
const START_KEY = 'clients:start';
const holdKey = (sendDate) => `clients:hold:${sendDate}`;
const doneKey = (sendDate) => `clients:done:${sendDate}`;
const queuedKey = (sendDate) => `clients:queued:${sendDate}`;

const lower = (s) => String(s || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(String(e || '').trim());

// ---------------------------------------------------------------------------------------------
// The words (pure)

/** The client copy of an idea edition. Same for every client - no name, no claim about anyone. Pure. */
function render({ edition, unsubUrl = '' }) {
  if (!edition || edition.kind !== 'idea') return null;
  const body = (edition.paragraphs || []).map((t) => para(esc(t)));
  const ps = edition.source === 'beth' ? [para(esc('P.S. This week\'s idea comes from my friend Beth Berghan.'))] : [];
  const foot = `<p style="margin-top:28px;font-size:12px;color:#777">Rather not get these weekly emails? ${unsubUrl ? `<a href="${esc(unsubUrl)}" style="color:#777">Unsubscribe</a>` : 'Just reply and say so.'}</p>`;
  const html = wrapHtml([para(esc(GREETING)), ...body, para(esc(CLIENT_CLOSER)), para('Cheers'), para('(I know a) Guy'), ...ps, foot].join('\n'));
  return { subject: `${le.SERIES} - ${edition.title}`, html };
}

// ---------------------------------------------------------------------------------------------
// Who gets it (pure given its inputs)

/**
 * people: [{ client, group, windingDownUntil, leaveOff, bounced, skipUntil }] - one per client on
 * the coach's board. Returns who it goes to and who is left off, each with the planner's reason.
 */
function pickClients(people, { now = Date.now(), tenantId = '', unsubUrlFor = () => null } = {}) {
  const go = [];
  const off = [];
  const seen = new Set();
  for (const p of people || []) {
    const c = p.client;
    if (!c || !c.clientId || c.clientId === tenantId) continue;
    const address = lower(c.clientEmailAddress) || null;
    const facts = {
      status: c.status,
      coachingStatus: c.coachingStatus || null,
      group: p.group === 'paused' || c.coachingStatus === 'Paused' || c.status !== 'Active' ? 'paused' : (p.group || 'running'),
      billingLapsed: false,
      windingDownUntil: p.windingDownUntil || null,
      leaveOff: p.leaveOff || null,
      unsubscribed: !!c.emailUnsubscribed,
      hasUnsubToken: !!c.emailUnsubToken,
      address: address && isEmail(address) ? address : null,
      bounced: !!p.bounced,
      skipUntil: p.skipUntil || null,
      skipThisWeek: false,
    };
    const reason = picker.neverSentReason(facts, now);
    const name = c.clientName || c.clientId;
    if (reason) { off.push({ clientId: c.clientId, name, reason }); continue; }
    if (seen.has(address)) { off.push({ clientId: c.clientId, name, reason: 'same address as another client' }); continue; }
    seen.add(address);
    go.push({ clientId: c.clientId, name, email: address, unsubUrl: unsubUrlFor(c) });
  }
  return { go, off };
}

async function audience(tenantId, { now = Date.now() } = {}) {
  const planner = require('./clientTouchPlanner');
  const planStore = require('./clientTouchPlanStore');
  const unsub = require('./clientUnsubscribe');
  const cs = require('./clientService');
  if (cs.clearCache) cs.clearCache(); // a fresh record: someone who paused or unsubscribed an hour ago is left off
  const [{ pairs }, skips, bounced] = await Promise.all([
    planner.clientsWithCards(tenantId), planStore.skips(), planner.bouncedAddresses(tenantId).catch(() => new Set()),
  ]);
  const leaveOff = planner.leaveOffList();
  const people = [];
  for (const { card, client } of pairs) {
    const skip = skips.get(client.clientId);
    people.push({
      client,
      group: card.group,
      windingDownUntil: await planner.stripeCancellationAt(client),
      leaveOff: leaveOff.get(client.clientId) || null,
      bounced: bounced.has(lower(client.clientEmailAddress)),
      skipUntil: skip ? skip.until : null,
    });
  }
  return pickClients(people, { now, tenantId, unsubUrlFor: (c) => unsub.unsubscribeUrlFor(c) });
}

// ---------------------------------------------------------------------------------------------
// On / off / held (pure decision, stored switches)

/** Why nothing goes to clients for this Wednesday, or null when it does. Pure. */
function blockedReason({ start, sendDate, held, edition }) {
  if (!start) return 'the client email has not been started yet';
  if (sendDate < start) return `the client email starts ${dayLabel(start)}`;
  if (held) return 'you held the client email this week';
  if (!edition) return 'this week\'s edition is not written yet';
  if (edition.kind !== 'idea') return 'this week\'s edition is the launch piece, which is for the list only';
  if (edition.status === 'held') return 'you held this week\'s edition, and the client email goes with it';
  return null;
}

async function switches(sendDate) {
  const [start, held] = await Promise.all([getState(START_KEY), getState(holdKey(sendDate))]);
  return { start: start || null, held: held === '1' };
}

async function turnOn(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  await setState(START_KEY, d);
  return { ok: true, text: `Started - "Hi Network Builders" goes to your clients every Wednesday from 9:30am Brisbane, starting ${dayLabel(d)}, unless you hold it.` };
}
async function turnOff() {
  await setState(START_KEY, '');
  return { ok: true, text: 'Stopped - nothing goes to your clients from this email until you start it again.' };
}
async function hold(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  await setState(holdKey(d), '1');
  return { ok: true, text: `Held - nothing goes to your clients on ${dayLabel(d)}. Your list still gets its edition.` };
}
async function release(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  await setState(holdKey(d), '');
  return { ok: true, text: `Released - the client email goes on ${dayLabel(d)} after all.` };
}

// ---------------------------------------------------------------------------------------------
// What Guy sees

async function statusLine(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  const [sw, edition] = await Promise.all([switches(d), le.editionFor(tenantId, d)]);
  const why = blockedReason({ ...sw, sendDate: d, edition });
  return why ? `  Clients ("Hi Network Builders"): not going - ${why}.` : `  Clients ("Hi Network Builders"): the same idea goes to your clients on ${dayLabel(d)} unless you hold it.`;
}

/** For Monday's heads-up to Guy: the line saying whether it goes, and the email itself when it does. */
async function headsUpPart(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  const [sw, edition] = await Promise.all([switches(d), le.editionFor(tenantId, d)]);
  const why = blockedReason({ ...sw, sendDate: d, edition });
  if (why) return { line: `Clients ("Hi Network Builders"): not going - ${why}.`, mail: null };
  // '#': the heads-up shows the footer as a client sees it; each real email carries their own link.
  return { line: `Clients ("Hi Network Builders"): the same idea goes to your clients on ${dayLabel(d)} unless you hold it.`, mail: render({ edition, unsubUrl: '#' }) };
}

async function showText(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  const [sw, edition] = await Promise.all([switches(d), le.editionFor(tenantId, d)]);
  const why = blockedReason({ ...sw, sendDate: d, edition });
  const { go, off } = await audience(tenantId, { now: nowMs }).catch((e) => ({ go: [], off: [{ name: 'the client list', reason: `could not be read: ${e.message}` }] }));
  const mail = render({ edition });
  return {
    text: [
      `HI NETWORK BUILDERS - the client copy of this week's edition, ${dayLabel(d)} from 9:30am Brisbane`,
      why ? `STATUS: NOT GOING - ${why}.` : 'STATUS: goes by itself unless you hold it.',
      `WHO IT GOES TO (${go.length}): ${go.map((p) => p.name).join(', ') || 'nobody'}`,
      off.length ? ['LEFT OFF:', ...off.map((o) => `  - ${o.name} (${o.reason})`)].join('\n') : 'LEFT OFF: nobody',
      '',
      mail ? ['--- THE EMAIL, AS EVERY CLIENT GETS IT ---', `Subject: ${mail.subject}`, '', le.htmlToText(mail.html), '--- END ---'].join('\n') : 'Nothing to show yet - the edition is not written.',
      '',
      'The words come from the list edition: edit or swap that and this changes with it.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------------------------
// Sending

async function mailClient({ to, subject, html, replyTo, unsubUrl = '', tag = 'client-edition' }) {
  const mg = require('./mailgunCreds');
  return mg.sendMailgunMessage({
    from: mg.fromAddress('Guy Wilson'),
    to,
    subject,
    html,
    text: le.htmlToText(html),
    'h:Reply-To': replyTo,
    // The link only - never the list's mailto, which the list's own watcher would read as a list unsubscribe.
    ...(unsubUrl ? { 'h:List-Unsubscribe': `<${unsubUrl}>`, 'h:List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
    'o:tag': tag,
  });
}

/** A test copy to Guy only. Works whether or not the client email has been started. */
async function testSend(tenantId, { sendDate, nowMs = Date.now() } = {}) {
  const d = sendDate || le.nextSendDate(nowMs);
  const mail = render({ edition: await le.editionFor(tenantId, d) });
  if (!mail) return { ok: false, text: 'There is no idea edition written for that Wednesday yet.' };
  const replyTo = await le.internals.replyToFor(tenantId);
  await mailClient({ to: replyTo, subject: `[TEST clients] ${mail.subject}`, html: mail.html, replyTo, tag: 'client-edition-test' });
  return { ok: true, text: `Sent a test copy of the client email to ${replyTo}. Its footer has no unsubscribe link - the real ones carry each client's own.` };
}

async function queueSends(tenantId, sendDate, deps = {}) {
  const { go, off } = await (deps.audience || audience)(tenantId);
  for (const p of go) {
    await q(`INSERT INTO client_edition_sends (tenant_id, send_date, client_id, email, name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, send_date, client_id) DO NOTHING`,
      [tenantId, sendDate, p.clientId, p.email, p.name]);
  }
  await setState(queuedKey(sendDate), JSON.stringify({ off }));
  return { queued: go.length, off };
}

async function sendQueued(tenantId, sendDate, edition, deps = {}) {
  const rows = await q("SELECT * FROM client_edition_sends WHERE tenant_id = $1 AND send_date = $2 AND status = 'queued' ORDER BY id LIMIT 50", [tenantId, sendDate]);
  if (!rows.length) return 0;
  const getClient = deps.getClient || ((id) => require('./clientService').getClientById(id));
  const unsubUrlFor = deps.unsubUrlFor || ((c) => require('./clientUnsubscribe').unsubscribeUrlFor(c));
  const recordTouch = deps.recordTouch || ((t) => require('./clientTouchStore').record(t));
  const mail = deps.mail || mailClient;
  const replyTo = await (deps.replyToFor || le.internals.replyToFor)(tenantId);
  for (const r of rows) {
    try {
      const client = await getClient(r.client_id);
      // Their own link, read fresh. No link, no email - the same rule as every other client email.
      const unsubUrl = (client && unsubUrlFor(client)) || '';
      if (!unsubUrl) throw new Error('no unsubscribe link for this client');
      const { subject, html } = render({ edition, unsubUrl });
      const res = await mail({ to: r.email, subject, html, replyTo, unsubUrl });
      await q("UPDATE client_edition_sends SET status = 'sent', mailgun_id = $2, sent_at = now() WHERE id = $1", [r.id, res && res.id ? res.id : null]);
      // On their record as the newsletter kind, so it never counts as Guy having touched base.
      try { await recordTouch({ clientId: r.client_id, kind: 'mindset', key: subject, form: 'full', source: 'planner', recipient: r.email, reason: 'Hi Network Builders - the weekly email to all clients', meta: { clientEdition: true, ideaId: edition.ideaId || null } }); }
      catch (e) { console.error(`[clientEdition] touch not recorded for ${r.client_id}: ${e.message}`); }
    } catch (e) {
      await q("UPDATE client_edition_sends SET status = 'failed', error = $2 WHERE id = $1", [r.id, String(e.message).slice(0, 300)]);
    }
  }
  return rows.length;
}

async function finishIfDone(tenantId, sendDate, edition, deps = {}) {
  if (await getState(doneKey(sendDate))) return false;
  const counts = await q('SELECT status, COUNT(*)::int AS n FROM client_edition_sends WHERE tenant_id = $1 AND send_date = $2 GROUP BY status', [tenantId, sendDate]);
  const n = (s) => (counts.find((c) => c.status === s) || { n: 0 }).n;
  if (n('queued') > 0) return false;
  await setState(doneKey(sendDate), '1');
  let off = [];
  try { off = (JSON.parse((await getState(queuedKey(sendDate))) || '{}').off) || []; } catch (_) { off = []; }
  await (deps.notify || le.internals.notifyGuy)(tenantId, `Hi Network Builders went out - ${n('sent')} ${n('sent') === 1 ? 'client' : 'clients'}`, [
    `This week's idea ("${edition.title}") went to ${n('sent')} of your clients${n('failed') ? `, ${n('failed')} failed` : ''}.`,
    off.length ? ['Left off:', ...off.map((o) => `- ${o.name} (${o.reason})`)].join('\n') : 'Nobody was left off.',
  ].join('\n\n'));
  return true;
}

/** Called from the list edition's own tick, straight after it - so the edition has already started going. */
async function tick(nowMs = Date.now(), tenantId, deps = {}) {
  const sendDate = le.nextSendDate(nowMs);
  if (nowMs < sendAtMs(sendDate)) return 'before';
  if (!le.internals.sendSwitchOn()) return 'switch-off';
  const [sw, edition] = await Promise.all([switches(sendDate), le.editionFor(tenantId, sendDate)]);
  if (blockedReason({ ...sw, sendDate, edition })) return 'blocked';
  if (!['sending', 'sent'].includes(edition.status)) return 'list-not-going'; // the list goes first; follow it, never lead it
  if (await getState(doneKey(sendDate))) return 'done';
  if (!(await getState(queuedKey(sendDate)))) await queueSends(tenantId, sendDate, deps);
  await sendQueued(tenantId, sendDate, edition, deps);
  await finishIfDone(tenantId, sendDate, edition, deps);
  return 'ran';
}

module.exports = {
  // pure, tested
  render, pickClients, blockedReason,
  // actions
  audience, statusLine, headsUpPart, showText, turnOn, turnOff, hold, release, testSend, tick,
  GREETING, CLIENT_CLOSER, START_KEY,
};
