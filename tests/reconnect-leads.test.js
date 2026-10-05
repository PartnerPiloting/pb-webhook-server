/**
 * Tests for carrying the conversation score onto leads (services/reconnectLeads.js) - Reconnect,
 * brick 3.
 *
 * Covers planLeads(): an existing lead is matched by vanity slug OR member id and only gets the
 * conversation fields; a prefix slug never matches; a new lead is created only at the cut-off;
 * a name already in the base without a matching link is UNSURE, not a create; a re-run changes
 * nothing. Plus the shape of a new lead (no Notes - see the file header for why).
 * Pure functions - no Airtable, no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/reconnect-leads.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { planLeads, newLeadFields, conversationFields, summarise, FIELDS } = require('../services/reconnectLeads');

const SCORED = '2026-10-05T03:00:00.123Z';
const person = (key, extra = {}) => ({
  person_key: key, member_id: key, public_identifier: `slug-${key.toLowerCase()}`, profile_url: `https://www.linkedin.com/in/slug-${key.toLowerCase()}`,
  name: `First${key} Last${key}`, first_name: `First${key}`, last_name: `Last${key}`, headline: 'Director at Somewhere',
  connected_at: '2023-01-15T00:00:00.000Z', ending: 'not_now', warmth: 4, why: 'Said try me after the trip.', pick_up_on: 'the trip', scored_at: SCORED, ...extra,
});
const lead = (id, url, first = 'Someone', last = 'Else', extra = {}) => ({ id, fields: { 'First Name': first, 'Last Name': last, 'LinkedIn Profile URL': url, ...extra } });

(async () => {
  console.log('planLeads - matching');

  await check('matches an existing lead by vanity slug, whatever the link looks like', () => {
    const plan = planLeads([person('A')], [lead('rec1', 'https://au.linkedin.com/in/Slug-A/?trk=x')]);
    assert.strictEqual(plan.updates.length, 1);
    assert.strictEqual(plan.updates[0].leadId, 'rec1');
    assert.strictEqual(plan.creates.length, 0);
  });
  await check('matches a lead stored under the member id form of the link', () => {
    const plan = planLeads([person('ACoAAB12')], [lead('rec1', 'https://www.linkedin.com/in/ACoAAB12')]);
    assert.strictEqual(plan.updates[0].leadId, 'rec1');
  });
  await check('a slug that merely starts the same is a different person', () => {
    const plan = planLeads([person('A', { public_identifier: 'andrewdb', name: 'Andrew Bognar' })], [lead('rec1', 'https://www.linkedin.com/in/andrewdbyrne', 'Andrew', 'Byrne')]);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.creates.length, 1);
  });
  await check('an existing lead only ever gets the five conversation fields', () => {
    const plan = planLeads([person('A', { warmth: 1, ending: 'declined' })], [lead('rec1', 'https://www.linkedin.com/in/slug-a')]);
    assert.deepStrictEqual(Object.keys(plan.updates[0].fields).sort(), Object.values(FIELDS).sort());
    assert.strictEqual(plan.updates[0].fields[FIELDS.ending], 'Declined');
  });

  console.log('planLeads - creating');

  await check('not a lead and at the cut-off -> created; below it -> left out', () => {
    const plan = planLeads([person('A', { warmth: 3 }), person('B', { warmth: 2 })], []);
    assert.deepStrictEqual(plan.creates.map((c) => c.person.person_key), ['A']);
    assert.strictEqual(plan.leftOut, 1);
  });
  await check('the cut-off is the client setting', () => {
    const plan = planLeads([person('A', { warmth: 3 }), person('B', { warmth: 4 })], [], { cutOff: 4 });
    assert.deepStrictEqual(plan.creates.map((c) => c.person.person_key), ['B']);
  });
  await check('same name already in the base under another link -> unsure, never a create', () => {
    const plan = planLeads([person('A')], [lead('rec1', 'https://www.linkedin.com/sales/lead/ACwAxyz', 'FirstA', 'LastA')]);
    assert.strictEqual(plan.creates.length, 0);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.unsure.length, 1);
  });
  await check('nobody is created without a profile link', () => {
    const plan = planLeads([person('A', { public_identifier: null, profile_url: null })], []);
    assert.strictEqual(plan.creates.length, 0);
    assert.strictEqual(plan.noLink, 1);
  });

  console.log('planLeads - re-running');

  await check('a lead already carrying this exact score is left alone', () => {
    const plan = planLeads([person('A')], [lead('rec1', 'https://www.linkedin.com/in/slug-a', 'x', 'y', { [FIELDS.scoredAt]: '2026-10-05T03:00:00.000Z' })]);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.upToDate.length, 1);
  });
  await check('a newer score updates it', () => {
    const plan = planLeads([person('A', { scored_at: '2026-11-01T00:00:00.000Z' })], [lead('rec1', 'https://www.linkedin.com/in/slug-a', 'x', 'y', { [FIELDS.scoredAt]: '2026-10-05T03:00:00.000Z' })]);
    assert.strictEqual(plan.updates.length, 1);
  });

  console.log('the new lead');

  await check('carries what LinkedIn gave us, the real date connected, and NO notes', () => {
    const f = newLeadFields(person('A'));
    assert.strictEqual(f['First Name'], 'FirstA');
    assert.strictEqual(f['LinkedIn Profile URL'], 'https://www.linkedin.com/in/slug-a');
    assert.strictEqual(f['Date Connected'], '2023-01-15T00:00:00.000Z');
    assert.strictEqual(f['LinkedIn Connection Status'], 'Connected');
    assert.strictEqual(f[FIELDS.score], 4);
    assert.strictEqual(f[FIELDS.ending], 'Not now');
    assert.strictEqual(f[FIELDS.pickUp], 'the trip');
    assert.ok(!('Notes' in f), 'a new lead must not carry messages in Notes yet');
    assert.ok(!('AI Score' in f));
  });
  await check('an unknown ending is stored as Other', () => {
    assert.strictEqual(conversationFields(person('A', { ending: 'weird' }))[FIELDS.ending], 'Other');
  });
  await check('the summary adds up', () => {
    const people = [person('A'), person('B', { warmth: 5 }), person('C', { warmth: 1 }), person('D')];
    const plan = planLeads(people, [lead('rec1', 'https://www.linkedin.com/in/slug-a'), lead('rec2', '', 'FirstD', 'LastD')]);
    const s = summarise(plan, 3);
    assert.strictEqual(s.alreadyLeads + s.toCreate + s.unsure + s.leftOutBelowCutOff + s.leftOutNoProfileLink, people.length);
    assert.deepStrictEqual(s.createByScore, { 5: 1 });
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
