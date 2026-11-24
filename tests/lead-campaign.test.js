/**
 * Tests for the Campaign field on a lead (services/leadCampaign.js, 2026-11-23, Roland Illyes).
 *
 * What must hold:
 *   - a lead Linked Helper sent gets its campaign name, and a client can never change it
 *   - a lead nobody sent is blank, and the client may pick ONLY from their own campaign list
 *   - "No campaign" is a real filter choice
 *   - a base with no Campaign field yet never loses a lead: the write goes again without it
 *   - a campaign name on leads that is not on the machine today still shows in the filter
 * No Airtable, no database - fake bases. Synthetic data.
 *
 * Run: node tests/lead-campaign.test.js
 */
const assert = require('assert');
const leadCampaign = require('../services/leadCampaign');
const lhCampaignList = require('../services/lhCampaignList');
const writeLeadFields = (write, fields) => leadCampaign.writeFields(write, fields, { warn() {} });
const { planFor } = require('../scripts/backfill-lead-campaign');

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const raw = (campaign) => JSON.stringify({ id: 'x', campaign_id: 5, campaign_name: campaign });
const unknownField = () => Object.assign(new Error('Unknown field name: "Campaign"'), { error: 'UNKNOWN_FIELD_NAME', statusCode: 422 });

/** A fake leads base: records = [{id, fields}]. Records every update. */
function fakeBase(records, { failSelect = null } = {}) {
  const updates = [];
  const table = () => ({
    find: async (id) => {
      const r = records.find((x) => x.id === id);
      if (!r) throw Object.assign(new Error('not found'), { statusCode: 404 });
      return r;
    },
    select: () => ({
      eachPage: (onPage, done) => {
        if (failSelect) return done(failSelect);
        const rows = records.filter((r) => r.fields.Campaign).map((r) => ({ ...r, get: (k) => r.fields[k] }));
        onPage(rows, () => done());
      },
    }),
    update: async (rows) => { updates.push(...rows); return rows; },
  });
  table.updates = updates;
  return table;
}

// The machine's list is the source of the choices - stub it per test.
let machine = [];
lhCampaignList.listCampaigns = async () => ({ campaigns: machine, source: 'machine' });
const live = (...names) => names.map((name, i) => ({ id: i + 1, name, paused: false, live: true, leads: 0 }));

console.log('lead-campaign tests');

check('the name comes off Raw Profile Data - string, object, or a clipped cell; none = blank', () => {
  assert.strictEqual(leadCampaign.campaignNameFromRaw(raw('Legal ICP 50-201')), 'Legal ICP 50-201');
  assert.strictEqual(leadCampaign.campaignNameFromRaw({ campaign_name: ' Campaign 1 ' }), 'Campaign 1');
  assert.strictEqual(leadCampaign.campaignNameFromRaw('{"campaign_name":"Campaign 1","about":"cut off he'), 'Campaign 1');
  assert.strictEqual(leadCampaign.campaignNameFromRaw(JSON.stringify({ id: 'x' })), '');
  assert.strictEqual(leadCampaign.campaignNameFromRaw(undefined), '');
});

check('filter: all = no formula; "No campaign" = blank field; a name = exact match, quotes escaped', () => {
  assert.strictEqual(leadCampaign.filterFormula(undefined), null);
  assert.strictEqual(leadCampaign.filterFormula('all'), null);
  assert.strictEqual(leadCampaign.filterFormula(leadCampaign.NONE), 'NOT({Campaign})');
  assert.strictEqual(leadCampaign.filterFormula('Legal ICP 50-201'), '{Campaign} = "Legal ICP 50-201"');
  assert.strictEqual(leadCampaign.filterFormula('The "A" list'), '{Campaign} = "The \\"A\\" list"');
});

check('a lead Linked Helper sent is locked; it shows the field (which follows a rename), not the name saved on the day', () => {
  assert.deepStrictEqual(leadCampaign.describeLead({ 'Raw Profile Data': raw('Legal ICP 50-201'), Campaign: 'Partner Campaign' }),
    { campaign: 'Partner Campaign', campaignLocked: true });
  // not caught up yet: the field is blank but the lead still shows its campaign
  assert.deepStrictEqual(leadCampaign.describeLead({ 'Raw Profile Data': raw('Campaign 1') }), { campaign: 'Campaign 1', campaignLocked: true });
});

check('a lead nobody sent shows the client\'s own choice (or blank) and is open to change', () => {
  assert.deepStrictEqual(leadCampaign.describeLead({ Campaign: 'Campaign 1' }), { campaign: 'Campaign 1', campaignLocked: false });
  assert.deepStrictEqual(leadCampaign.describeLead({}), { campaign: '', campaignLocked: false });
});

check('a base with no Campaign field: the lead is saved without it, once, and nothing else is retried', async () => {
  const sent = [];
  const write = async (f) => { sent.push(f); if ('Campaign' in f) throw unknownField(); return 'saved'; };
  assert.strictEqual(await writeLeadFields(write, { 'First Name': 'Ann', Campaign: 'Campaign 1' }), 'saved');
  assert.deepStrictEqual(sent, [{ 'First Name': 'Ann', Campaign: 'Campaign 1' }, { 'First Name': 'Ann' }]);

  // any other failure is NOT retried - a second create could file the lead twice
  let calls = 0;
  const boom = async () => { calls++; throw Object.assign(new Error('Unknown field name: "Nope"'), { error: 'UNKNOWN_FIELD_NAME' }); };
  await assert.rejects(writeLeadFields(boom, { Campaign: 'Campaign 1' }), /Nope/);
  await assert.rejects(writeLeadFields(async () => { calls++; throw new Error('socket hang up'); }, { Campaign: 'Campaign 1' }), /socket/);
  // and a lead with no campaign is never retried either
  await assert.rejects(writeLeadFields(async () => { calls++; throw unknownField(); }, { 'First Name': 'Ann' }));
  assert.strictEqual(calls, 3);
});

check('choosing a campaign: refused when Linked Helper set it', async () => {
  machine = live('Legal ICP 50-201', 'Campaign 1');
  const base = fakeBase([{ id: 'rec1', fields: { 'Raw Profile Data': raw('Legal ICP 50-201') } }]);
  const res = await leadCampaign.setLeadCampaign({ clientId: 't1', base, leadId: 'rec1', value: 'Campaign 1' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.campaignLocked, true);
  assert.strictEqual(base.updates.length, 0);
});

check('choosing a campaign: only a name on the client\'s own list - never free text', async () => {
  machine = live('Legal ICP 50-201', 'Campaign 1');
  const base = fakeBase([{ id: 'rec2', fields: {} }]);
  const bad = await leadCampaign.setLeadCampaign({ clientId: 't2', base, leadId: 'rec2', value: 'My made up campaign' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(base.updates.length, 0);
  const ok = await leadCampaign.setLeadCampaign({ clientId: 't2', base, leadId: 'rec2', value: 'Campaign 1' });
  assert.deepStrictEqual([ok.ok, ok.campaign, ok.campaignLocked], [true, 'Campaign 1', false]);
  assert.deepStrictEqual(base.updates, [{ id: 'rec2', fields: { Campaign: 'Campaign 1' } }]);
});

check('choosing a campaign: a client can clear their own choice; an unknown lead is a 404', async () => {
  machine = live('Campaign 1');
  const base = fakeBase([{ id: 'rec3', fields: { Campaign: 'Campaign 1' } }]);
  const cleared = await leadCampaign.setLeadCampaign({ clientId: 't3', base, leadId: 'rec3', value: '' });
  assert.strictEqual(cleared.ok, true);
  assert.deepStrictEqual(base.updates, [{ id: 'rec3', fields: { Campaign: '' } }]);
  assert.strictEqual((await leadCampaign.setLeadCampaign({ clientId: 't3', base, leadId: 'recNope', value: '' })).status, 404);
});

check('the filter list: machine campaigns + every name on leads; a renamed one is kept and marked not live', async () => {
  machine = live('Legal ICP 50-201', 'Campaign 1');
  const base = fakeBase([
    { id: 'a', fields: { Campaign: 'Legal ICP 50-201' } },
    { id: 'b', fields: { Campaign: 'Legal ICP 50-201' } },
    { id: 'c', fields: { Campaign: 'Legal ICP (old name)' } },
    { id: 'd', fields: {} },
  ]);
  const o = await leadCampaign.getOptions('Roland-Illyes', base, { fresh: true });
  assert.strictEqual(o.filterReady, true);
  assert.deepStrictEqual(o.campaigns, [
    { name: 'Legal ICP 50-201', count: 2, live: true },
    { name: 'Campaign 1', count: 0, live: true },
    { name: 'Legal ICP (old name)', count: 1, live: false },
  ]);
  // only campaigns on the machine today can be chosen for a blank lead
  assert.deepStrictEqual(o.choices, ['Campaign 1', 'Legal ICP 50-201']);
});

check('the filter stays hidden for a client whose catch-up has not run, and for a base without the field', async () => {
  machine = live('Campaign 1');
  const notYet = await leadCampaign.getOptions('Someone-Else', fakeBase([{ id: 'a', fields: { Campaign: 'Campaign 1' } }]), { fresh: true });
  assert.strictEqual(notYet.filterReady, false);
  assert.deepStrictEqual(notYet.choices, ['Campaign 1']);
  const noField = await leadCampaign.getOptions('Roland-Illyes', fakeBase([], { failSelect: unknownField() }), { fresh: true });
  assert.strictEqual(noField.filterReady, false);
});

check('no machine list (Linked Helper on their own computer): the names on their leads are the choices', async () => {
  machine = [];
  const o = await leadCampaign.getOptions('Roland-Illyes', fakeBase([{ id: 'a', fields: { Campaign: 'Home campaign' } }]), { fresh: true });
  assert.deepStrictEqual(o.choices, ['Home campaign']);
});

check('catch-up: fills a blank, skips one already right, never touches a lead nobody sent', () => {
  assert.deepStrictEqual(planFor({ 'Raw Profile Data': raw('Campaign 1') }), { action: 'set', name: 'Campaign 1', was: '' });
  assert.deepStrictEqual(planFor({ 'Raw Profile Data': raw('Campaign 1'), Campaign: 'Campaign 1' }), { action: 'skip', name: 'Campaign 1', was: 'Campaign 1' });
  assert.deepStrictEqual(planFor({ Campaign: 'Campaign 1' }), { action: 'none', name: '', was: 'Campaign 1' });
  assert.deepStrictEqual(planFor({}), { action: 'none', name: '', was: '' });
  // a lead that already carries a campaign is left alone - it may hold the new name after a rename
  assert.strictEqual(planFor({ 'Raw Profile Data': raw('Legal ICP 50-201'), Campaign: 'Partner Campaign' }).action, 'skip');
});

check('a big base: a first ask answers with the names found so far (no counts), the next one has it all', async () => {
  machine = live('Fractional in profile');
  let finish;
  const slow = () => ({
    select: () => ({
      eachPage: (onPage, done) => {
        // first page arrives at once, the rest of the base a little later
        onPage([{ get: () => 'Old campaign' }], () => { finish = () => { onPage([{ get: () => 'Old campaign' }], () => done()); }; });
      },
    }),
  });
  leadCampaign._setQuickMs(20);
  const early = await leadCampaign.getOptions('Big-Client', slow);
  leadCampaign._setQuickMs(8000);
  assert.strictEqual(early.countsCapped, true);
  assert.deepStrictEqual(early.campaigns.map((c) => c.name), ['Fractional in profile', 'Old campaign']);
  finish();
  const full = await leadCampaign.getOptions('Big-Client', slow, { fresh: true });
  assert.strictEqual(full.countsCapped, false);
  assert.deepStrictEqual(full.campaigns.find((c) => c.name === 'Old campaign'), { name: 'Old campaign', count: 2, live: false });
  // and it is remembered: the next ordinary ask gets the full answer without reading again
  assert.strictEqual(await leadCampaign.getOptions('Big-Client', slow), full);
});

check('"Recently connected" and the no-tag marker: Guy only for now; the filter means Search Terms is blank', async () => {
  machine = live('Campaign 1');
  const base = fakeBase([{ id: 'a', fields: { Campaign: 'Campaign 1' } }]);
  assert.strictEqual((await leadCampaign.getOptions('Guy-Wilson', base, { fresh: true })).recentShortcut, true);
  assert.strictEqual((await leadCampaign.getOptions('Roland-Illyes', base, { fresh: true })).recentShortcut, false);
  // "connect on LinkedIn and they arrive by themselves" is only said where the nightly collection runs
  assert.strictEqual((await leadCampaign.getOptions('Guy-Wilson', base, { fresh: true })).ownConnectionsArrive, true);
  assert.strictEqual((await leadCampaign.getOptions('Roland-Illyes', base, { fresh: true })).ownConnectionsArrive, false);
  assert.strictEqual(leadCampaign.UNLABELLED_FORMULA, 'NOT({Search Terms})');
});

check('"My own connections" never replaces a campaign a lead already has', () => {
  const own = JSON.stringify({ id: 'x', campaign_id: 51, campaign_name: 'My own connections', headline: 'new' });
  // sent by a real campaign: name and id are put back on the incoming profile
  const real = leadCampaign.keepRealCampaign({ 'Raw Profile Data': raw('Legal ICP'), Campaign: 'Legal ICP' }, own);
  assert.strictEqual(real.name, 'Legal ICP');
  assert.strictEqual(real.raw.campaign_name, 'Legal ICP');
  assert.strictEqual(real.raw.campaign_id, 5);
  assert.strictEqual(real.raw.headline, 'new');
  assert.strictEqual(real.raw.wingguy_also_seen_in, 'My own connections');
  // the client chose one by hand on a lead nobody sent: kept, and still theirs to change
  const chosen = leadCampaign.keepRealCampaign({ Campaign: 'Partner Campaign' }, JSON.parse(own));
  assert.strictEqual(chosen.name, 'Partner Campaign');
  assert.strictEqual(chosen.raw.campaign_name, undefined);
  assert.strictEqual(chosen.raw.campaign_id, undefined);
  assert.strictEqual(leadCampaign.describeLead({ Campaign: 'Partner Campaign', 'Raw Profile Data': JSON.stringify(chosen.raw) }).campaignLocked, false);
  // nothing to protect: a brand new person, a lead with no campaign, one already "My own connections"
  assert.strictEqual(leadCampaign.keepRealCampaign({}, own), null);
  assert.strictEqual(leadCampaign.keepRealCampaign({ 'Raw Profile Data': '{"id":"x"}' }, own), null);
  assert.strictEqual(leadCampaign.keepRealCampaign({ 'Raw Profile Data': own, Campaign: 'My own connections' }, own), null);
  // and a real campaign arriving is never held back, whatever was there
  assert.strictEqual(leadCampaign.keepRealCampaign({ 'Raw Profile Data': own, Campaign: 'My own connections' }, raw('Legal ICP')), null);
});

/** A leads base that understands the one formula followRenames uses: {Campaign} = "name". */
function namedBase(records) {
  const updates = [];
  const match = (formula) => {
    const m = String(formula || '').match(/^\{Campaign\} = "(.*)"$/);
    const want = m ? m[1].replace(/\\"/g, '"') : null;
    return records.filter((r) => (want === null ? r.fields.Campaign : r.fields.Campaign === want)).map((r) => ({ id: r.id, fields: r.fields, get: (k) => r.fields[k] }));
  };
  const table = () => ({
    select: (opts = {}) => ({
      firstPage: async () => match(opts.filterByFormula).slice(0, opts.maxRecords || 100),
      eachPage: (onPage, done) => onPage(match(opts.filterByFormula), () => done()),
    }),
    update: async (rows) => { for (const u of rows) { updates.push(u); Object.assign(records.find((r) => r.id === u.id).fields, u.fields); } return rows; },
  });
  table.updates = updates;
  return table;
}
const rawOf = (id, name) => JSON.stringify({ id: 'x', campaign_id: id, campaign_name: name });

check('a renamed campaign: its older leads take the new name - matched on the campaign id, never the name', async () => {
  const records = [
    { id: 'a', fields: { Campaign: 'Legal ICP 50-201', 'Raw Profile Data': rawOf(5, 'Legal ICP 50-201') } },
    { id: 'b', fields: { Campaign: 'Legal ICP 50-201', 'Raw Profile Data': rawOf(5, 'Legal ICP 50-201') } },
    { id: 'c', fields: { Campaign: 'Partner Campaign', 'Raw Profile Data': rawOf(5, 'Partner Campaign') } },
    // same old NAME, but a different campaign (#9) that is no longer on the machine: keeps its name
    { id: 'd', fields: { Campaign: 'Legal ICP 50-201', 'Raw Profile Data': rawOf(9, 'Legal ICP 50-201') } },
    // an archived campaign nobody renamed: untouched
    { id: 'e', fields: { Campaign: 'Old visits', 'Raw Profile Data': rawOf(1, 'Old visits') } },
    // the client's own choice on a lead nobody sent: untouched even though the name is an old one
    { id: 'f', fields: { Campaign: 'Legal ICP 50-201' } },
  ];
  const base = namedBase(records);
  const live = { 3: 'Legal ICP', 5: 'Partner Campaign' };
  const dry = await leadCampaign.followRenames(base, live, { apply: false });
  assert.deepStrictEqual(dry, { changes: [{ id: 5, from: 'Legal ICP 50-201', to: 'Partner Campaign', count: 2 }], updated: 0 });
  assert.strictEqual(base.updates.length, 0);
  const done = await leadCampaign.followRenames(base, live);
  assert.strictEqual(done.updated, 2);
  assert.deepStrictEqual(records.map((r) => r.fields.Campaign), ['Partner Campaign', 'Partner Campaign', 'Partner Campaign', 'Legal ICP 50-201', 'Old visits', 'Legal ICP 50-201']);
  // the saved profile is never touched - scoring reads the campaign id off it
  assert.strictEqual(records[0].fields['Raw Profile Data'], rawOf(5, 'Legal ICP 50-201'));
  // and a second run finds nothing to do
  assert.deepStrictEqual(await leadCampaign.followRenames(base, live), { changes: [], updated: 0 });
});

check('the machine list: a rename is spotted by id; our own plumbing campaign is never listed', () => {
  assert.deepStrictEqual(
    lhCampaignList.renamesBetween(
      [{ id: 5, name: 'Legal ICP 50-201' }, { id: 3, name: 'Legal ICP' }, { id: 1, name: '' }],
      [{ id: 5, name: 'Partner Campaign' }, { id: 3, name: 'Legal ICP' }, { id: 1, name: 'Named at last' }, { id: 6, name: 'Brand new' }]),
    [{ id: 5, from: 'Legal ICP 50-201', to: 'Partner Campaign' }]);
  assert.deepStrictEqual(lhCampaignList.renamesBetween(null, [{ id: 5, name: 'Partner Campaign' }]), []);
  const cleaned = lhCampaignList.cleanList([{ id: 50, name: 'My connections - holding list (collect only)', paused: true }, { id: 51, name: 'My own connections' }]);
  assert.deepStrictEqual(cleaned.map((c) => c.name), ['My own connections']);
  assert.deepStrictEqual(lhCampaignList.withoutInternal([{ id: 50, name: 'My connections - holding list (collect only)' }, { id: 40, name: 'Fractional in profile' }]).map((c) => c.id), [40]);
});

check('a campaign that can never send anyone to Wingguy is left out of the list - unless leads carry its name', async () => {
  machine = [
    { id: 40, name: 'Fractional in profile', live: true, sends: true },
    { id: 45, name: 'Remove approved connections', live: true, sends: false },
    { id: 48, name: 'Top-up test', live: true, sends: false },
    { id: 7, name: 'Old style, no webhook step', live: true, sends: false },
    { id: 9, name: 'From an older watchdog', live: true },          // says nothing = assume it sends
  ];
  const base = fakeBase([{ id: 'a', fields: { Campaign: 'Old style, no webhook step' } }]);
  const o = await leadCampaign.getOptions('Guy-Wilson', base, { fresh: true });
  assert.deepStrictEqual(o.campaigns.map((c) => c.name).sort(), ['Fractional in profile', 'From an older watchdog', 'Old style, no webhook step']);
  assert.deepStrictEqual(o.campaigns.find((c) => c.name === 'Old style, no webhook step'), { name: 'Old style, no webhook step', count: 1, live: true });
  assert.deepStrictEqual(o.choices, ['Fractional in profile', 'From an older watchdog', 'Old style, no webhook step']);
  // the flag survives the machine list's clean-up, and only when the machine sent one
  assert.deepStrictEqual(lhCampaignList.cleanList([{ id: 45, name: 'Remove approved connections', paused: true, sends: false }, { id: 9, name: 'Older' }]),
    [{ id: 45, name: 'Remove approved connections', paused: true, sends: false }, { id: 9, name: 'Older', paused: false }]);
});

(async () => {
  for (const run of pending) await run();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll lead-campaign tests passed');
  process.exit(0);
})();
