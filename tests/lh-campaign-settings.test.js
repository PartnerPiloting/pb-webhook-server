/**
 * Campaign message + working hours from Claude (7 Nov 2026): the template both ways, the checks,
 * the hours words, and the chat tool's preview -> confirm flow with the store and the client
 * directory stubbed. No Postgres, no machine.
 *
 * Run: node tests/lh-campaign-settings.test.js
 */
const assert = require('assert');
const path = require('path');

let failures = 0;
let chain = Promise.resolve();   // one at a time - the stubbed queue is shared
const check = (name, fn) => {
  chain = chain.then(async () => {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
  });
};

const s = require('../services/lhCampaignSettings');

// The real shape, from Guy's campaign 32 (scripts/linked-helper/campaigns/02-top-scorers.json).
const INVITE = {
  type: 'variants',
  variants: [{ type: 'variant', child: { type: 'group', children: [
    { type: 'text', value: 'Hi ' }, { type: 'var', name: 'firstName' }, { type: 'text', value: ', great to connect.\n\nGuy' },
  ] } }],
};

check('a template reads as the text people know', () => {
  const t = s.templateToText(INVITE);
  assert.deepStrictEqual(t.variants, ['Hi {firstName}, great to connect.\n\nGuy']);
  assert.deepStrictEqual(t.vars, ['firstName']);
});

check('text goes back to the same template', () => {
  assert.deepStrictEqual(s.textToTemplate('Hi {firstName}, great to connect.\n\nGuy'), INVITE);
});

const step = { id: 7, type: 'InvitePerson', template: INVITE, template_hash: 'abc' };

check('a good new note passes, with its template', () => {
  const r = s.checkMessage('Hi {firstName} - saw your post on supply chains, would be good to connect.', step);
  assert.strictEqual(r.ok, true, r.problem);
  assert.strictEqual(r.template.variants[0].child.children[1].name, 'firstName');
});

check('a typo in a name placeholder is refused, not sent with braces', () => {
  const r = s.checkMessage('Hi {firstname}, keen to connect', step);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problem.includes('{firstname}'));
});

check('a stray brace is refused', () => {
  const r = s.checkMessage('Hi {firstName}, keen to connect :}', step);
  assert.strictEqual(r.ok, false);
});

check('an invitation note over 300 is refused; over 200 warns about free accounts', () => {
  assert.strictEqual(s.checkMessage(`Hi {firstName} ${'x'.repeat(300)}`, step).ok, false);
  const mid = s.checkMessage(`Hi {firstName} ${'x'.repeat(200)}`, step);
  assert.strictEqual(mid.ok, true);
  assert.ok(mid.warnings[0].includes('free account'));
});

check('a banned word is refused', () => {
  const r = s.checkMessage('Hi {firstName}, keen to connect with folks like you', step, ['folks']);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problem.includes('folks'));
});

check('the same message again is a no-op, said so', () => {
  const r = s.checkMessage('Hi {firstName}, great to connect.\n\nGuy', step);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.same, true);
});

check('a step rotating several versions is refused rather than guessed', () => {
  const two = { ...step, template: { type: 'variants', variants: [INVITE.variants[0], INVITE.variants[0]] } };
  assert.strictEqual(s.checkMessage('Hi {firstName}', two).ok, false);
});

check('hours from chat become the machine spec, in words', () => {
  const r = s.checkHours([{ days: 'weekdays', from: '08:00', to: '18:00' }, { days: ['sat'], from: '09:00', to: '12:00' }]);
  assert.strictEqual(r.ok, true, r.problem);
  assert.deepStrictEqual(r.spec[0], { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [['08:00', '18:00']] });
  assert.strictEqual(r.words, 'Mon-Fri 8am-6pm; Sat 9am-12pm');
});

check('hours that run backwards are refused', () => {
  assert.strictEqual(s.checkHours([{ days: 'all', from: '18:00', to: '08:00' }]).ok, false);
  assert.strictEqual(s.checkHours([{ days: 'funday', from: '08:00', to: '09:00' }]).ok, false);
});

check('the machine\'s hours read as words', () => {
  assert.strictEqual(s.hoursWords('always'), 'every day, all day');
  assert.strictEqual(s.hoursWords({ days: 'all', windows: [['00:00', '03:00']] }), 'every day 12am-3am');
  assert.strictEqual(s.hoursWords([{ days: ['mon', 'tue', 'wed'], windows: [['09:00', '17:30']] }]), 'Mon-Wed 9am-5:30pm');
});

check('walking the week: 25 every 6½ hours, 9-5 weekdays = 50 a day, 250 a week', () => {
  const w = s.walkWeek({ hours: { days: 'weekdays', windows: [['09:00', '17:00']] }, batch: 25, waitMin: 390 });
  assert.deepStrictEqual(w.perDay, [0, 50, 50, 50, 50, 50, 0]);
  assert.strictEqual(w.week, 250);
});

check('no cap in Linked Helper reads as unknown, not zero', () => {
  assert.strictEqual(s.walkWeek({ hours: 'always', batch: -1, waitMin: 0 }).week, null);
});

check('planning 100 a week over 9-5 weekdays lands on 100, never over', () => {
  const p = s.planPace(100, { days: 'weekdays', windows: [['09:00', '17:00']] });
  assert.strictEqual(p.ok, true, p.problem);
  assert.strictEqual(p.week, 100);
  assert.ok(p.batch <= 50);
});

check('planning refuses more than 100 across all campaigns', () => {
  const p = s.planPace(60, { days: 'weekdays', windows: [['09:00', '17:00']] }, 50);
  assert.strictEqual(p.ok, false);
  assert.ok(p.problem.includes('The most this one can have is 50'), p.problem);
  assert.strictEqual(s.planPace(120, 'always').ok, false);
});

// ------------------------------------------------------------------ the chat tool, stubbed

const SNAP = {
  tz: 'Australia/Brisbane', offset_min: 600,
  campaigns: [
    { id: 49, name: 'HEQS Builder Leads', paused: false, steps: [
      { id: 7, type: 'InvitePerson', template: INVITE, template_hash: 'abc', batch: 25, wait_ms: 390 * 60000, hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [['09:00', '17:00']] } },
      { id: 8, type: 'SendPersonToWebhook', template: null, hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [['09:00', '17:00']] } },
    ] },
    { id: 50, name: 'Travel- Pre Retires', paused: true, steps: [
      { id: 9, type: 'InvitePerson', template: INVITE, template_hash: 'def', batch: 10, wait_ms: 8 * 3600000, hours: 'always' },
    ] },
  ],
};
const queued = [];
function stub(rel, exportsObj) {
  const file = require.resolve(path.join('..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}
stub('services/lhCampaignSettingsStore', {
  getSnapshot: async () => ({ snapshot: SNAP, reportedAt: new Date().toISOString() }),
  latestFor: async () => null,
  request: async (j) => { queued.push(j); return { ok: true, changeId: 'sX' }; },
});
const realTopUp = require('../services/wingguyTopUpMcp');
realTopUp.resolveTarget = async () => ({ client: { clientId: 'Alex-Solti', clientName: 'Alex Solti', machineLink: 'x' }, own: true });
delete process.env.DATABASE_URL;   // no banned-word read

const tool = require('../services/wingguyCampaignSettingsMcp');

check('show lists both campaigns, paused one marked, hours in words', async () => {
  const r = await tool.runSettings({}, 'Alex-Solti');
  assert.ok(r.text.includes('"HEQS Builder Leads" - running'), r.text);
  assert.ok(r.text.includes('"Travel- Pre Retires" - PAUSED'));
  assert.ok(r.text.includes('Hi {firstName}, great to connect.'));
  assert.ok(r.text.includes('Days and times: Mon-Fri 9am-5pm'), r.text);
  assert.ok(r.text.includes('How many: about 50 a day, so about 250 a week'), r.text);
  assert.ok(r.text.includes("You're set to send about 250 invitations a week. LinkedIn's limit is about 100"), r.text);
  assert.ok(r.text.includes('A quick refresher'));
});

check('pace change previews in a-day / a-week words, then queues batch + wait', async () => {
  queued.length = 0;
  const r = await tool.runSettings({ action: 'pace', campaign: 'HEQS', per_week: 100 }, 'Alex-Solti');
  assert.ok(r.text.includes('NOW: about 50 a day, about 250 a week'), r.text);
  assert.ok(r.text.includes('NEW: about 20 a day, about 100 a week'), r.text);
  assert.strictEqual(queued.length, 0);
  const r2 = await tool.runSettings({ action: 'pace', campaign: 'HEQS', per_week: 100, confirm: true }, 'Alex-Solti');
  assert.ok(r2.text.startsWith('Sent.'), r2.text);
  assert.strictEqual(queued[0].kind, 'pace');
  assert.strictEqual(queued[0].payload.step_id, 7);
  assert.ok(queued[0].payload.batch > 0 && queued[0].payload.wait_ms > 0);
});

check('pace over the limit is refused', async () => {
  const r = await tool.runSettings({ action: 'pace', campaign: 'HEQS', per_week: 150 }, 'Alex-Solti');
  assert.ok(r.text.includes('Not changed'), r.text);
  assert.ok(r.text.includes('100'));
});

check('a message change previews first and queues nothing', async () => {
  queued.length = 0;
  const r = await tool.runSettings({ action: 'message', campaign: 'HEQS', message: 'Hi {firstName}, would be good to connect.' }, 'Alex-Solti');
  assert.ok(r.text.includes('NOW:') && r.text.includes('NEW:'), r.text);
  assert.ok(r.text.includes('Nothing has changed yet'));
  assert.strictEqual(queued.length, 0);
});

check('confirm queues it with the hash the client saw', async () => {
  queued.length = 0;
  const r = await tool.runSettings({ action: 'message', campaign: 'HEQS', message: 'Hi {firstName}, would be good to connect.', confirm: true }, 'Alex-Solti');
  assert.ok(r.text.startsWith('Sent.'), r.text);
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].payload.expect_hash, 'abc');
  assert.strictEqual(queued[0].payload.step_id, 7);
  assert.strictEqual(queued[0].campaignId, 49);
});

check('hours change on a paused campaign says it stays paused, and covers every step', async () => {
  queued.length = 0;
  const r = await tool.runSettings({ action: 'hours', campaign: 'Travel', hours: [{ days: 'weekdays', from: '08:00', to: '18:00' }], confirm: true }, 'Alex-Solti');
  assert.ok(r.text.includes('leaves the campaign paused'), r.text);
  assert.deepStrictEqual(queued[0].payload.step_ids, [9]);
});

check('an hours change moves only the sending steps - the webhook step is left alone', async () => {
  queued.length = 0;
  await tool.runSettings({ action: 'hours', campaign: 'HEQS', hours: [{ days: 'weekdays', from: '08:00', to: '18:00' }], confirm: true }, 'Alex-Solti');
  assert.deepStrictEqual(queued[0].payload.step_ids, [7]);   // not 8, the webhook
});

check('bringing a campaign down is allowed even when the others are already over 100', () => {
  const H = { days: 'weekdays', windows: [['09:00', '17:00']] };
  assert.strictEqual(s.planPace(40, H, 220, 60).ok, true);          // 60 -> 40 while others send 220
  const up = s.planPace(80, H, 220, 60);
  assert.strictEqual(up.ok, false);
  assert.ok(up.problem.includes('Bring one of those down first'), up.problem);
  assert.ok(!/-\d/.test(up.problem), 'no negative numbers in the words');
});

check('show does not list plumbing steps\' hours', async () => {
  const r = await tool.runSettings({}, 'Alex-Solti');
  assert.ok(!r.text.includes('Send person to webhook'), r.text);
  assert.ok(!r.text.includes('each step has its own'), r.text);
});

check('no campaign named and two campaigns with messages -> asks which', async () => {
  const r = await tool.runSettings({ action: 'message', message: 'Hi {firstName}' }, 'Alex-Solti');
  // Only one RUNNING campaign sends a message, so that one is the default.
  assert.ok(r.text.includes('HEQS Builder Leads'), r.text);
});

chain.then(() => {
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
});
