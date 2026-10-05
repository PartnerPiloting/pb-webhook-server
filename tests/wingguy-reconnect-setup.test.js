/**
 * Tests for the Reconnect setup conversation tool (services/wingguyReconnectMcp.js).
 *
 * What must hold: nothing spends the client's money or writes to their leads without confirm
 * true; the figures come first; it will not run before their LinkedIn history has arrived and
 * never offers a way to connect LinkedIn; the leads step refuses while the read is unfinished;
 * the second yes saves the cut-off, brings people in and only then switches the list on.
 * Every dependency is faked through the module cache - no Claude, Airtable, Postgres or Unipile.
 * ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-reconnect-setup.test.js
 */
const assert = require('assert');
const path = require('path');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const fake = (rel, exports) => { const p = require.resolve(path.join('..', 'services', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const state = { client: { clientId: 'T', recordId: 'recT', reconnect: null }, status: { T: { messages: 9000, conversations: 2900, connections: 27000, oldest_msg_at: '2024-09-18T00:00:00.000Z', state: 'ready' } }, who: '', toRead: 120, calls: [], master: [] };
fake('clientService.js', { getClientById: async () => state.client, clearCache: () => {} });
fake('linkedinCollect.js', { statusByTenant: async () => state.status });
fake('conversationScore.js', {
  loadProfile: async () => ({ who: state.who }),
  saveWho: async (t, who) => { state.who = who; state.calls.push('save'); return { ok: true }; },
  scoreConversations: async (t, o) => {
    if (o.dryRun) return state.who ? { ok: true, candidates: 400, upToDate: 400 - state.toRead, toRead: state.toRead, estimateUsd: 0.71 } : { ok: false, error: 'T has no "who I\'m looking for" paragraph yet' };
    if (o.sample) { state.calls.push(`sample ${o.sample}`); return { ok: true, read: 2, costUsd: 0.01, results: [{ name: 'Pat Person', warmth: 4, ending: 'not_now', quietDays: 200, why: 'Said later.', pick_up_on: 'the trip' }, { name: 'Sam Sample', warmth: 1, ending: 'declined', quietDays: 300, why: 'Said no.', pick_up_on: '' }] }; }
    state.calls.push('read'); state.toRead = 0; return { ok: true, read: 120, costUsd: 0.7 };
  },
});
fake('reconnectLeads.js', { syncReconnectLeads: async (t, o) => { state.calls.push(`leads dry=${o.dryRun} cut=${o.cutOff}`); return { ok: true, scoredPeople: 400, alreadyLeads: 100, toCreate: o.cutOff === 4 ? 60 : 150, unsure: 3, created: 60, updated: 100 }; } });
// The master write goes straight to Airtable - fake the library.
const airtablePath = require.resolve('airtable');
require.cache[airtablePath] = { id: airtablePath, filename: airtablePath, loaded: true, exports: function Airtable() { return { base: () => () => ({ update: async (id, fields) => { state.master.push(fields); Object.assign(state.client, 'Reconnect' in fields ? { reconnect: fields.Reconnect } : {}); } }) }; } };

const { runSetup, TOOL_DEFS } = require('../services/wingguyReconnectMcp');
const DESC = 'I advise mid-size builders on procurement and I am looking for people who run purchasing and have supply contracts coming up for renewal.';

(async () => {
  console.log('before the history arrives');
  await check('every step says it is not ready, and none offers a way to connect LinkedIn', async () => {
    const saved = state.status; state.status = {};
    for (const step of ['status', 'sample', 'read', 'leads']) {
      const r = await runSetup({ step, description: DESC, confirm: true, cut_off: 4 }, 'T');
      assert.ok(/has not arrived yet/.test(r.text), `${step}: ${r.text.slice(0, 60)}`);
      assert.ok(!/unipile|https?:\/\//i.test(r.text));
    }
    assert.deepStrictEqual(state.calls, []);
    state.status = saved;
  });

  console.log('the description');
  await check('a sample needs a real description, and saves nothing', async () => {
    assert.strictEqual((await runSetup({ step: 'sample', description: 'too short' }, 'T')).isError, true);
    const r = await runSetup({ step: 'sample', description: DESC }, 'T');
    assert.ok(/4\/5 - Pat Person \(not now, quiet 200 days\): Said later\. Pick up on: the trip\./.test(r.text));
    assert.ok(/Nothing was saved/.test(r.text));
    assert.strictEqual(state.who, '');
    assert.deepStrictEqual(state.calls, ['sample 30']);
  });
  await check('saving it reports the cost of the read and asks for the first yes', async () => {
    const r = await runSetup({ step: 'save_description', description: DESC }, 'T');
    assert.strictEqual(state.who, DESC);
    assert.ok(/120 conversations to read now, about US\$0\.71/.test(r.text) && /yes/i.test(r.text));
  });

  console.log('yes number one - the read');
  await check('without confirm it only shows the figures', async () => {
    state.calls.length = 0;
    const r = await runSetup({ step: 'read' }, 'T');
    assert.ok(/120 conversations are waiting/.test(r.text) && /YES NUMBER ONE/.test(r.text));
    assert.deepStrictEqual(state.calls, []);
  });
  await check('the leads step refuses while the read is unfinished', async () => {
    const r = await runSetup({ step: 'leads', confirm: true, cut_off: 4 }, 'T');
    assert.ok(/has not finished/.test(r.text));
    assert.ok(!state.calls.some((c) => c.startsWith('leads')));
    assert.deepStrictEqual(state.master, []);
  });
  await check('with confirm it starts, and asking again reports it done', async () => {
    const r = await runSetup({ step: 'read', confirm: true }, 'T');
    assert.ok(/Started: reading 120/.test(r.text));
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(state.calls.includes('read'));
    assert.ok(/The read is complete/.test((await runSetup({ step: 'read' }, 'T')).text));
  });

  console.log('yes number two - the leads');
  await check('without confirm it shows both cut-offs and writes nothing', async () => {
    state.calls.length = 0;
    const r = await runSetup({ step: 'leads' }, 'T');
    assert.ok(/cut-off 3 .*: 150 new leads/.test(r.text) && /cut-off 4 .*: 60 new leads/.test(r.text) && /YES NUMBER TWO/.test(r.text));
    assert.deepStrictEqual(state.calls, ['leads dry=true cut=3', 'leads dry=true cut=4']);
    assert.deepStrictEqual(state.master, []);
  });
  await check('confirm needs the chosen cut-off', async () => {
    assert.strictEqual((await runSetup({ step: 'leads', confirm: true }, 'T')).isError, true);
    assert.deepStrictEqual(state.master, []);
  });
  await check('the yes saves the cut-off, brings people in, THEN switches the list on', async () => {
    state.calls.length = 0;
    const r = await runSetup({ step: 'leads', confirm: true, cut_off: 4 }, 'T');
    assert.deepStrictEqual(state.calls, ['leads dry=false cut=4']);
    assert.deepStrictEqual(state.master, [{ 'Reconnect Lead Cut-Off': 4 }, { Reconnect: 'Yes' }]);
    assert.ok(/60 people added/.test(r.text) && /Follow-Ups/.test(r.text));
  });
  await check('status then says there is nothing more to set up', async () => {
    state.status.T.oldest_msg_at = new Date('2019-07-31T23:16:29.320Z'); // the store returns a Date, not a string
    const text = (await runSetup({}, 'T')).text;
    assert.ok(/Reconnect list is ON/.test(text));
    assert.ok(/back to 2019-07-31\./.test(text), text.slice(0, 160));
  });

  console.log('the tool');
  await check('one tool, and its description carries the phrase and the two-yes rule', () => {
    assert.strictEqual(TOOL_DEFS.length, 1);
    assert.ok(TOOL_DEFS[0].description.includes('set up my reconnect list'));
    assert.ok(/Two yeses, never assumed/.test(TOOL_DEFS[0].description));
    assert.ok(!/[—–]/.test(TOOL_DEFS[0].description));
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
