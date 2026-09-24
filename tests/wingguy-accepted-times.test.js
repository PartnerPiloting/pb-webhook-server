/**
 * Tests for "they said yes to a time and nothing is in your diary"
 * (services/wingguyAcceptedTimes.js, Guy 2026-09-14 - the Max Dagenais miss: three slots offered
 * 9 Sep, "Thursday 17 September, 2:00 pm will work for me" on 10 Sep, invite never sent).
 * Contracts:
 *   1. acceptedTimeSignal: the coach offered slots, the lead's later reply names one of them ->
 *      the accepted slot + when. A fresh offer from the coach afterwards supersedes it. The
 *      lead naming a date that was never offered is not an acceptance. Quoted tails are the
 *      caller's job (the sweep strips them) - a message here is just its own words.
 *   2. pickAcceptCandidates: from the sweep's mailbox window, the LEADS who spoke recently and
 *      whom the coach had written to (to or cc, any thread - thread ids are unreliable across
 *      mail clients; cc'd third people are fine): their last few messages newest first,
 *      calendar notices skipped, plus every coach message addressed to them. Capped.
 *   3. stripQuotedDeep cuts the wrapped Gmail "On ... wrote:" and the spaced Outlook header block
 *      the line-anchored stripper misses; a reply naming three or more dates is a counter-offer.
 *
 * Pure. Synthetic content only. Run: node tests/wingguy-accepted-times.test.js
 */
const assert = require('assert');
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const { acceptedTimeSignal, pickAcceptCandidates, unbookedLine, shortDay } = require('../services/wingguyAcceptedTimes');

const COACH = 'coach@example.com';
const LEAD = 'lead@example.com';
const THIRD = 'third@example.com';
const who = { coachEmails: new Set([COACH]), leadEmail: LEAD };

const OFFER = `Hi Max

Let's start with the first of the two sessions. Would any of these work?

Tuesday 15 September, 11:30 am
Thursday 17 September, 10:00 am
Thursday 17 September, 2:00 pm

(all times are Sydney time)

Cheers
Guy`;

console.log('acceptedTimeSignal');

check('the Max case: picks the offered slot named in the reply', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-09T23:50:00Z', text: 'Hi Guy,\n\nThank you for your kind words.\n\nThursday 17 September, 2:00 pm will work for me if you want to lock it in and send me an invite.\n\nMax' },
  ], who);
  assert.ok(sig, 'expected a signal');
  assert.strictEqual(sig.slot.iso, '2026-09-17');
  assert.strictEqual(sig.slot.label, 'Thu 17 Sep 2:00 pm');
  assert.strictEqual(sig.acceptedOn, '2026-09-09');
  assert.strictEqual(sig.offeredOn, '2026-09-09');
});

check('order of arrival does not matter - messages are sorted by date', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works.' },
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
  ], who);
  assert.ok(sig && sig.slot.iso === '2026-09-17');
});

check('a date-only reply matches an offered slot on that date', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Tuesday 15 September suits me best.' },
  ], who);
  assert.ok(sig);
  assert.strictEqual(sig.slot.label, 'Tue 15 Sep 11:30 am'); // the offered slot, with its time, is what gets booked
});

check('a time that was never offered is not an acceptance', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'None of those work - could you do Friday 18 September, 9:00 am?' },
  ], who);
  assert.strictEqual(sig, null);
});

check('same day, different clock time, is not an acceptance', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 4:00 pm would be better for me.' },
  ], who);
  assert.strictEqual(sig, null);
});

check('a fresh offer from the coach after the yes supersedes it', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works.' },
    { fromEmail: COACH, date: '2026-09-10T03:00:00Z', text: 'Sorry Max, Thursday just fell over on me. Could you do Monday 21 September, 10:00 am instead?' },
  ], who);
  assert.strictEqual(sig, null);
});

check('a coach reply WITHOUT new slots leaves the yes standing (the calendar decides)', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works.' },
    { fromEmail: COACH, date: '2026-09-10T03:00:00Z', text: 'Great - invite on its way.' },
  ], who);
  assert.ok(sig && sig.slot.iso === '2026-09-17');
});

check('a third party naming the slot is not the lead accepting', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: THIRD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works for me, Guy.' },
  ], who);
  assert.strictEqual(sig, null);
});

check('no coach offer at all -> null', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works.' },
  ], who);
  assert.strictEqual(sig, null);
});

check('the lead accepts the SECOND offer after a renegotiation', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Thursday 17 September, 2:00 pm works.' },
    { fromEmail: COACH, date: '2026-09-10T03:00:00Z', text: 'Thursday fell over - Monday 21 September, 10:00 am instead?' },
    { fromEmail: LEAD, date: '2026-09-10T05:00:00Z', text: 'Monday 21 September, 10:00 am it is.' },
  ], who);
  assert.ok(sig);
  assert.strictEqual(sig.slot.label, 'Mon 21 Sep 10:00 am');
  assert.strictEqual(sig.offeredOn, '2026-09-10');
});

console.log('pickAcceptCandidates');

const NOW = Date.parse('2026-09-14T00:00:00Z');
const D = 86400000;
const msg = (id, threadId, from, to, cc, ms, subject) => ({ id, threadId, subject: subject || 'Re: hello', fromEmail: from, toEmails: to, ccEmails: cc, date: new Date(ms).toISOString() });
const opts = (o) => ({ leadEmails: new Set([LEAD]), coachEmails: new Set([COACH]), nowMs: NOW, ...o });

check('the Max shape: coach -> lead with a third party cc\'d, reply on a DIFFERENT thread id', () => {
  const c = pickAcceptCandidates([
    msg('m1', 't1', COACH, [LEAD], [THIRD], NOW - 5 * D),
    msg('m2', 't2', LEAD, [COACH], [THIRD], NOW - 4 * D, 'Re: Intro - Thursday 17 September, 2:00 pm'),
  ], opts());
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].leadEmail, LEAD);
  assert.deepStrictEqual(c[0].leadMsgs.map((x) => x.id), ['m2']);
  assert.deepStrictEqual(c[0].coachMsgs.map((x) => x.id), ['m1']);
});

check('the lead\'s last few messages are kept, newest first, and calendar notices are skipped', () => {
  const c = pickAcceptCandidates([
    msg('c1', 't1', COACH, [LEAD], [], NOW - 9 * D),
    msg('a', 't1', LEAD, [COACH], [], NOW - 8 * D),
    msg('b', 't1', LEAD, [COACH], [], NOW - 7 * D),
    msg('cal', 't9', LEAD, [COACH], [], NOW - 6 * D, 'Accepted: Max & Guy @ Thu 17 Sep'),
    msg('c', 't2', LEAD, [COACH], [], NOW - 5 * D),
    msg('d', 't3', LEAD, [COACH], [], NOW - 4 * D),
    msg('e', 't4', LEAD, [COACH], [], NOW - 3 * D),
  ], opts({ perLead: 4 }));
  assert.deepStrictEqual(c[0].leadMsgs.map((x) => x.id), ['e', 'd', 'c', 'b']);
});

check('the lead speaking last too long ago is skipped', () => {
  const c = pickAcceptCandidates([
    msg('m1', 't1', COACH, [LEAD], [], NOW - 40 * D),
    msg('m2', 't1', LEAD, [COACH], [], NOW - 30 * D),
  ], opts({ lookbackDays: 21 }));
  assert.strictEqual(c.length, 0);
});

check('a lead the coach never wrote to before they last spoke is skipped', () => {
  const c = pickAcceptCandidates([
    msg('m1', 't1', LEAD, [COACH], [], NOW - 2 * D),
    msg('m2', 't1', COACH, [LEAD], [], NOW - 1 * D),
  ], opts());
  assert.strictEqual(c.length, 0);
});

check('coach messages to the lead are oldest-first, whatever thread, to or cc', () => {
  const c = pickAcceptCandidates([
    msg('b', 't2', COACH, [THIRD], [LEAD], NOW - 8 * D),
    msg('a', 't1', COACH, [LEAD], [], NOW - 9 * D),
    msg('x', 't3', LEAD, [COACH], [], NOW - 6 * D),
    msg('d', 't1', COACH, [LEAD], [], NOW - 5 * D),
  ], opts());
  assert.deepStrictEqual(c[0].coachMsgs.map((x) => x.id), ['a', 'b', 'd']);
});

check('newest lead first across leads, capped by max', () => {
  const c = pickAcceptCandidates([
    msg('m1', 't1', COACH, [LEAD], [], NOW - 5 * D),
    msg('m2', 't1', LEAD, [COACH], [], NOW - 4 * D),
    msg('m3', 't2', COACH, ['other@example.com'], [], NOW - 3 * D),
    msg('m4', 't2', 'other@example.com', [COACH], [], NOW - 1 * D),
  ], { leadEmails: new Set([LEAD, 'other@example.com']), coachEmails: new Set([COACH]), nowMs: NOW, max: 1 });
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].leadEmail, 'other@example.com');
});

check('no coach addresses known -> no candidates (never guess who the coach is)', () => {
  const c = pickAcceptCandidates([
    msg('m1', 't1', COACH, [LEAD], [], NOW - 5 * D),
    msg('m2', 't1', LEAD, [COACH], [], NOW - 4 * D),
  ], { leadEmails: new Set([LEAD]), coachEmails: new Set(), nowMs: NOW });
  assert.strictEqual(c.length, 0);
});

console.log('stripQuotedDeep + the counter-offer rule');

const { stripQuotedDeep } = require('../services/wingguyAcceptedTimes');

check('a wrapped Gmail attribution is cut where the "On" sentence starts', () => {
  const t = `Wednesday 9 September, 3:30 pm works for me.

On Wed, 2 Sep 2026 at 5:31 pm, Guy Wilson
<guy@example.com> wrote:
> Would any of these work?
> Wednesday 9 September, 3:30 pm
> Thursday 10 September, 11:00 am`;
  const out = stripQuotedDeep(t);
  assert.strictEqual(out, 'Wednesday 9 September, 3:30 pm works for me.');
});

check('an Outlook header block with blank lines between From: and Sent: is cut', () => {
  const t = `Thursday 17 September, 2:00 pm will work for me.

Kind regards

From: Guy Wilson <guy@example.com>

Sent: Wednesday, September 09, 2026 7:30 PM

To: Max

Tuesday 15 September, 11:30 am`;
  assert.strictEqual(stripQuotedDeep(t), `Thursday 17 September, 2:00 pm will work for me.

Kind regards`);
});

check('a reply listing three or more dates is a counter-offer, not a yes', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'I could do Tuesday 15 September, 11:30 am, Thursday 17 September, 2:00 pm or Friday 18 September, 9:00 am - your pick.' },
  ], who);
  assert.strictEqual(sig, null);
});

check('"either of two" still counts as a yes to the first offered one named', () => {
  const sig = acceptedTimeSignal([
    { fromEmail: COACH, date: '2026-09-09T09:30:00Z', text: OFFER },
    { fromEmail: LEAD, date: '2026-09-10T01:00:00Z', text: 'Either Tuesday 15 September, 11:30 am or Thursday 17 September, 2:00 pm works.' },
  ], who);
  assert.ok(sig && sig.slot.label === 'Tue 15 Sep 11:30 am');
});

console.log('wording');

check('one line, spaced short dash, no em dash', () => {
  const line = unbookedLine({ slot: { iso: '2026-09-17', label: 'Thu 17 Sep 2:00 pm' }, acceptedOn: '2026-09-10', offeredOn: '2026-09-09' });
  assert.strictEqual(line, 'they said yes to Thu 17 Sep 2:00 pm on 10 Sep - nothing is in your diary with them');
  assert.ok(!/[—–]/.test(line));
  assert.strictEqual(shortDay('2026-09-10T23:50:00Z'), '10 Sep');
});

console.log('brief entry + rendering (wingguyFollowupBrief)');

const brief = require('../services/wingguyFollowupBrief');
const maxItem = {
  lead: { recId: 'recMAX', first: 'Max', last: 'Dagenais', email: LEAD, linkedinUrl: 'https://www.linkedin.com/in/max' },
  tier: 'unbooked',
  why: 'they said yes to Thu 17 Sep 2:00 pm on 10 Sep - nothing is in your diary with them',
  unbooked: { slot: { iso: '2026-09-17', label: 'Thu 17 Sep 2:00 pm' }, acceptedOn: '2026-09-10', offeredOn: '2026-09-09' },
  signals: { lastInboundMs: 1, lastOutboundMs: 2, acceptedSlot: '2026-09-17|Thu 17 Sep 2:00 pm' },
};

check('unbookedEntry: attention verdict, fixed advice, no draft, slot carried', () => {
  const e = brief.unbookedEntry(maxItem, brief.entrySig(maxItem));
  assert.strictEqual(e.verdict, 'attention');
  assert.strictEqual(e.recommendation, 'Send the invite - they said yes to Thu 17 Sep 2:00 pm on 10 Sep - nothing is in your diary with them.');
  assert.strictEqual(e.draftText, null);
  assert.strictEqual(e.unbooked.slot.label, 'Thu 17 Sep 2:00 pm');
  assert.ok(!/[—–]/.test(e.recommendation));
});

check('entrySig changes when the agreed slot changes, so a renegotiated yes is re-prepped', () => {
  const a = brief.entrySig(maxItem);
  const b = brief.entrySig({ ...maxItem, signals: { ...maxItem.signals, acceptedSlot: '2026-09-21|Mon 21 Sep 10:00 am' } });
  assert.notStrictEqual(a, b);
});

check('formatBrief lists the unbooked pile first, ahead of replies owed', () => {
  const e = brief.unbookedEntry(maxItem, brief.entrySig(maxItem));
  const other = { name: 'Someone Else', verdict: 'draft', recommendation: 'Reply to her', channel: 'email', draftText: 'hi' };
  const text = brief.formatBrief({ payload: { preparedAt: new Date().toISOString(), items: [other, e], totalSurfaced: 2 } });
  const iU = text.indexOf('TIME AGREED, NOT BOOKED (1)');
  const iR = text.indexOf('REPLIES OWED (1)');
  assert.ok(iU > -1 && iR > -1 && iU < iR, `expected the unbooked pile before replies owed:\n${text}`);
  assert.ok(text.includes('[Max Dagenais](https://www.linkedin.com/in/max) - Send the invite - they said yes to Thu 17 Sep 2:00 pm on 10 Sep'));
});

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
