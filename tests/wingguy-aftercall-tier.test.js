/**
 * Tests for the AFTER A CALL follow-up tier (Guy 4 Nov 2026, the Bernard Kassab call): a recorded
 * call in the last week puts the person in front of the overnight triage, which reads how the call
 * was left and recommends park / draft / drop. Nothing is written by the system.
 *
 * Covers: classifyLead() with lastCallMs (window, parked, ceased before/after, reply still wins) ·
 * entrySig() leaves call-less signatures untouched · recentCalls.aftercallOn() switch ·
 * recentCallsByLead() + callForTriage() against a fake pool · gatherPersonContext() puts the call
 * first in the ground-truth block. Synthetic content only.
 *
 * Run: node tests/wingguy-aftercall-tier.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { classifyLead } = require('../services/wingguyMailMcp');
const brief = require('../services/wingguyFollowupBrief');
const recentCalls = require('../services/recentCalls');

const MS_DAY = 86400000;
const nowMs = Date.UTC(2026, 10, 4, 8, 0, 0); // 2026-11-04
const todayMidMs = Date.UTC(2026, 10, 4);
const lead = (extra = {}) => ({ first: 'Sam', last: 'Example', email: 'sam@example.com', cease: false, onSeries: false, reconnectOn: null, ...extra });

(async () => {
  console.log('classifyLead - after a call');

  await check('a call today with no messages surfaces as aftercall', () => {
    const c = classifyLead(lead(), { lastCallMs: nowMs - 3 * 3600000, nowMs, todayMidMs });
    assert.strictEqual(c && c.tier, 'aftercall');
    assert.match(c.why, /today/);
  });

  await check('a call 7 days ago still counts, 8 days does not', () => {
    assert.strictEqual(classifyLead(lead(), { lastCallMs: nowMs - 7 * MS_DAY, nowMs, todayMidMs }).tier, 'aftercall');
    assert.strictEqual(classifyLead(lead(), { lastCallMs: nowMs - 8 * MS_DAY, nowMs, todayMidMs }), null);
  });

  await check('a call outranks a went-quiet timer', () => {
    const c = classifyLead(lead(), { lastOutboundMs: nowMs - 20 * MS_DAY, lastInboundMs: nowMs - 30 * MS_DAY, everInbound: true, lastCallMs: nowMs - MS_DAY, nowMs, todayMidMs });
    assert.strictEqual(c.tier, 'aftercall');
  });

  await check('a reply owed still wins over the call', () => {
    const c = classifyLead(lead(), { lastInboundMs: nowMs - 2 * 3600000, lastOutboundMs: nowMs - MS_DAY, lastCallMs: nowMs - MS_DAY, nowMs, todayMidMs });
    assert.strictEqual(c.tier, 'reply');
  });

  await check('someone already parked to a future date is left alone', () => {
    const c = classifyLead(lead({ reconnectOn: '2026-11-30' }), { lastCallMs: nowMs - 3600000, nowMs, todayMidMs });
    assert.strictEqual(c, null);
  });

  await check('a person dropped BEFORE the call surfaces only if the call came after the drop', () => {
    const before = classifyLead(lead({ cease: true, ceaseAtMs: nowMs - 2 * MS_DAY }), { lastCallMs: nowMs - MS_DAY, nowMs, todayMidMs });
    assert.strictEqual(before && before.tier, 'aftercall');
    const after = classifyLead(lead({ cease: true, ceaseAtMs: nowMs - 3600000 }), { lastCallMs: nowMs - MS_DAY, nowMs, todayMidMs });
    assert.strictEqual(after, null);
    const noMoment = classifyLead(lead({ cease: true }), { lastCallMs: nowMs - MS_DAY, nowMs, todayMidMs });
    assert.strictEqual(noMoment, null);
  });

  await check('no call = exactly the old behaviour', () => {
    assert.strictEqual(classifyLead(lead(), { nowMs, todayMidMs }), null);
  });

  console.log('entrySig');

  await check('a call-less signature is unchanged (nothing re-preps the day this ships)', () => {
    const item = { tier: 'cadence', lead: { reconnectOn: null }, signals: { lastInboundMs: 5, lastOutboundMs: 9 } };
    assert.strictEqual(brief.entrySig(item), 's4|cadence|5|9||');
  });

  await check('a call is part of the signature when present', () => {
    const item = { tier: 'aftercall', lead: { reconnectOn: null }, signals: { lastInboundMs: 0, lastOutboundMs: 0, lastCallMs: 123 } };
    assert.strictEqual(brief.entrySig(item), 's4|aftercall|0|0|||c123');
  });

  console.log('switch');

  await check('off by default, on for listed clients, on for everyone with FOLLOWUP_AFTERCALL=on', () => {
    const save = { a: process.env.FOLLOWUP_AFTERCALL, b: process.env.FOLLOWUP_AFTERCALL_CLIENTS };
    delete process.env.FOLLOWUP_AFTERCALL; delete process.env.FOLLOWUP_AFTERCALL_CLIENTS;
    assert.strictEqual(recentCalls.aftercallOn('Guy-Wilson'), false);
    process.env.FOLLOWUP_AFTERCALL_CLIENTS = 'Guy-Wilson, David-Gould';
    assert.strictEqual(recentCalls.aftercallOn('guy-wilson'), true);
    assert.strictEqual(recentCalls.aftercallOn('Roland-Illyes'), false);
    process.env.FOLLOWUP_AFTERCALL = 'on';
    assert.strictEqual(recentCalls.aftercallOn('Roland-Illyes'), true);
    if (save.a === undefined) delete process.env.FOLLOWUP_AFTERCALL; else process.env.FOLLOWUP_AFTERCALL = save.a;
    if (save.b === undefined) delete process.env.FOLLOWUP_AFTERCALL_CLIENTS; else process.env.FOLLOWUP_AFTERCALL_CLIENTS = save.b;
  });

  console.log('store reads (fake pool)');

  const transcript = 'X'.repeat(20000) + '\n[00:48:53] Sam Example: let\'s reconnect in about three weeks';
  const fakePool = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/DISTINCT ON/.test(sql)) return { rows: [{ lead_id: 'recA', meeting_id: 77, meeting_start: new Date(nowMs - 3600000) }] };
      if (/WHERE id = \$1/.test(sql)) {
        return { rows: [{ title: 'Impromptu Zoom Meeting', meeting_start: new Date(nowMs - 3600000), transcript_text: transcript,
          summary_json: JSON.stringify({ purpose: 'Intro call', nextSteps: ['Reconnect in about three weeks'], actionItems: [{ owner: 'Guy', task: 'Send pricing' }] }) }] };
      }
      return { rows: [] };
    },
  };
  recentCalls._setPool(fakePool);

  await check('recentCallsByLead filters by coach and maps lead -> newest call', async () => {
    const m = await recentCalls.recentCallsByLead('Guy-Wilson', { days: 7, nowMs });
    assert.deepStrictEqual(m.get('recA'), { ms: nowMs - 3600000, meetingId: 77 });
    const q = fakePool.queries.find((x) => /DISTINCT ON/.test(x.sql));
    assert.match(q.sql, /coach_client_id = \$1/);
    assert.strictEqual(q.params[0], 'Guy-Wilson');
  });

  await check('callForTriage gives summary steps and THIS person\'s stretch of the call', async () => {
    const lines = await recentCalls.callForTriage(77, { leadName: 'Sam Example' });
    const all = lines.join('\n');
    assert.match(all, /agreed next steps: Reconnect in about three weeks/);
    assert.match(all, /Guy: Send pricing/);
    assert.match(all, /reconnect in about three weeks/);
    assert.match(all, /FROM WHERE THEY JOIN/);
    assert.ok(!all.includes('XXXX'), 'the earlier conversation is left out');
  });

  await check('callForTriage with no name falls back to the bounded end of the call', async () => {
    const all = (await recentCalls.callForTriage(77)).join('\n');
    assert.match(all, /END OF THE TRANSCRIPT/);
    assert.ok(all.length < recentCalls.TAIL_CHARS + 2000, 'tail is bounded');
  });

  console.log('personSegment (the Alex-then-Bernard recording)');

  const lumped = [
    '[00:00:17] Guy Wilson: Can you tell me exactly what we need to do?',
    '[00:01:06] QLDBDM: Yeah, absolutely.',
    '[00:21:51] QLDBDM: Bye.',
    '[00:22:15] Bernard Kassab: Hey, how are you?',
    '[00:48:53] Bernard Kassab: let\'s reconnect in about three weeks.',
    '[00:49:05] Guy Wilson: I\'m off overseas at the end of next week.',
    '[00:49:12] Guy Wilson: I\'m back towards the end of the month.',
    '[00:49:18] Guy Wilson: Yeah, that\'ll be perfect timing.',
  ].join('\n');

  await check('starts where the lead first speaks and keeps the coach\'s lines after it', () => {
    const s = recentCalls.personSegment(lumped, 'Bernard Kassab');
    assert.strictEqual(s.from, 'segment');
    assert.ok(s.text.startsWith('[00:22:15] Bernard Kassab'));
    assert.match(s.text, /back towards the end of the month/);
    assert.ok(!/QLDBDM/.test(s.text));
  });

  await check('first-name match works ("Bernard" label)', () => {
    const s = recentCalls.personSegment(lumped.replace(/Bernard Kassab/g, 'Bernard'), 'Bernard Kassab');
    assert.strictEqual(s.from, 'segment');
  });

  await check('a stretch over the cap keeps the END, where it was left', () => {
    const long = '[00:00:01] Sam Example: hi\n' + 'y'.repeat(50) + '\n[00:59:00] Guy Wilson: back end of month';
    const s = recentCalls.personSegment(long, 'Sam Example', { segmentChars: 40 });
    assert.strictEqual(s.from, 'tail');
    assert.match(s.text, /back end of month$/);
  });

  await check('gatherPersonContext puts the call first for an aftercall person', async () => {
    const mailProvider = { async findMessages() { return { ok: true, messages: [] }; } };
    const item = { tier: 'aftercall', lead: { first: 'Sam', last: 'Example', email: 'sam@example.com', notes: '' }, signals: { callMeetingId: 77 } };
    const ctx = await brief.gatherPersonContext(mailProvider, { clientName: 'Guy Wilson' }, item, null);
    assert.match(ctx.callOutcome[0], /^THE CALL /);
  });

  await check('gatherPersonContext reads no call for other tiers', async () => {
    const mailProvider = { async findMessages() { return { ok: true, messages: [] }; } };
    const item = { tier: 'cadence', lead: { first: 'Sam', last: 'Example', email: 'sam@example.com', notes: '' }, signals: { callMeetingId: 77 } };
    const ctx = await brief.gatherPersonContext(mailProvider, { clientName: 'Guy Wilson' }, item, null);
    assert.strictEqual(ctx.callOutcome.length, 0);
  });

  await check('a failed store read degrades to no calls, never throws', async () => {
    recentCalls._setPool({ async query() { throw new Error('db down'); } });
    const m = await recentCalls.recentCallsByLead('Guy-Wilson', { nowMs });
    assert.strictEqual(m.size, 0);
    assert.strictEqual(await recentCalls.callForTriage(77), null);
  });

  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})();
