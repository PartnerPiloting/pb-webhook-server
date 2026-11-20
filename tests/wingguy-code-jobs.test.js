/**
 * Claude Code jobs (20 Nov 2026): Chat files a job, Code reads it, ticks it off; the nudge line for
 * the Monday review and the inbox; owner-only. In-memory store - no Postgres.
 *
 * Run: node tests/wingguy-code-jobs.test.js
 */
const assert = require('assert');
const mod = require('../services/wingguyCodeJobsMcp');
const { runCodeJobs, nudgeFor, legacyToolList, registerWingguyCodeJobsTools } = mod;
const { missingFor, nudgeLine, OWNER } = mod._test;

let failures = 0;
const pending = [];
const check = (name, fn) => pending.push(async () => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
});

const NOW = Date.parse('2026-11-20T09:00:00Z');
function memStore() {
  const rows = []; let next = 1;
  return {
    rows,
    async list(t, { all } = {}) { return rows.filter((r) => r.tenant_id === t && (all || r.status === 'open')); },
    async get(t, id) { return rows.find((r) => r.tenant_id === t && r.id === id) || null; },
    async add(t, { kind, title, payload }) { const r = { id: next++, tenant_id: t, kind, title, payload, status: 'open', created_at: new Date(NOW).toISOString() }; rows.push(r); return r; },
    async update(t, id, { payload, kind, title }) { const r = await this.get(t, id); Object.assign(r, { payload, kind, title }); return r; },
    async close(t, id, status, note) { const r = await this.get(t, id); Object.assign(r, { status, close_note: note }); return r; },
    async reopen(t, id) { const r = await this.get(t, id); Object.assign(r, { status: 'open', close_note: null }); return r; },
  };
}

check('a full library-email job is queued with nothing missing', async () => {
  const store = memStore();
  const r = await runCodeJobs({
    action: 'add', kind: 'library_email', title: 'Library email: Why a quick Zoom works',
    brief: 'Add to the new-client library.', wording: 'Hi ...', wording_approved: true,
    when_used: 'once their first campaign is getting replies', done_when: 'the planner can pick it',
  }, OWNER, { store, now: NOW });
  assert.ok(!r.isError, r.text);
  assert.ok(r.text.includes('job #1'));
  assert.ok(r.text.includes('everything Claude Code needs'));
});

check('a thin job is queued but Chat is told what to ask Guy', async () => {
  const store = memStore();
  const r = await runCodeJobs({ action: 'add', kind: 'library_email', title: 'Who do you want in your corner next year?' }, OWNER, { store, now: NOW });
  assert.ok(!r.isError);
  assert.ok(r.text.includes('Still missing'));
  assert.ok(r.text.includes('when_used'));
  assert.ok(r.text.includes('action=update id=1'));
});

check('wording given without approval status is flagged', () => {
  assert.ok(missingFor('library_email', { brief: 'x', wording: 'y', when_used: 'z', done_when: 'd' }).some((m) => m.startsWith('wording_approved')));
  assert.strictEqual(missingFor('library_email', { brief: 'x', wording: 'y', wording_approved: false, when_used: 'z', done_when: 'd' }).length, 0);
});

check('the same open title twice is refused and points at update', async () => {
  const store = memStore();
  await runCodeJobs({ action: 'add', title: 'Review my edits line' }, OWNER, { store, now: NOW });
  const r = await runCodeJobs({ action: 'add', title: 'review my edits LINE' }, OWNER, { store, now: NOW });
  assert.ok(r.isError);
  assert.ok(r.text.includes('action=update'));
});

check('update merges fields and keeps later notes; show prints it in full', async () => {
  const store = memStore();
  await runCodeJobs({ action: 'add', kind: 'onboarding_script', title: 'Review my edits line', brief: 'Add a line.' }, OWNER, { store, now: NOW });
  await runCodeJobs({ action: 'update', id: '#1', wording: 'Say "review my edits" each week.', wording_approved: true, note: 'Put it after the edits step' }, OWNER, { store, now: NOW });
  const s = await runCodeJobs({ action: 'show', id: 1 }, OWNER, { store, now: NOW });
  assert.ok(s.text.includes('approved by Guy - use as is'));
  assert.ok(s.text.includes('Put it after the edits step'));
  assert.ok(s.text.includes('WHAT TO DO:\nAdd a line.'));
});

check('done needs a note of what changed, then leaves the open list', async () => {
  const store = memStore();
  await runCodeJobs({ action: 'add', title: 'A job' }, OWNER, { store, now: NOW });
  const bare = await runCodeJobs({ action: 'done', id: 1 }, OWNER, { store, now: NOW });
  assert.ok(bare.isError);
  const ok = await runCodeJobs({ action: 'done', id: 1, note: 'Added piece why-a-quick-zoom, PR 52' }, OWNER, { store, now: NOW });
  assert.ok(!ok.isError);
  assert.strictEqual((await runCodeJobs({ action: 'list' }, OWNER, { store, now: NOW })).text, 'No Claude Code jobs waiting.');
  const all = await runCodeJobs({ action: 'list', all: true }, OWNER, { store, now: NOW });
  assert.ok(all.text.includes('[DONE]'));
  const again = await runCodeJobs({ action: 'done', id: 1, note: 'x' }, OWNER, { store, now: NOW });
  assert.ok(again.isError);
});

check('a client tenant cannot use it, and never sees it', async () => {
  const r = await runCodeJobs({ action: 'list' }, 'Roland-Smith', { store: memStore(), now: NOW });
  assert.ok(r.isError);
  assert.deepStrictEqual(legacyToolList('Roland-Smith'), []);
  assert.strictEqual(legacyToolList(OWNER).length, 1);
  const registered = [];
  const fake = { registerTool: (n) => registered.push(n) };
  registerWingguyCodeJobsTools(fake, 'Roland-Smith');
  assert.deepStrictEqual(registered, []);
  registerWingguyCodeJobsTools(fake, OWNER);
  assert.deepStrictEqual(registered, ['wingguy_code_jobs']);
});

check('nudge line: empty when nothing waits, counts and ages when it does', async () => {
  assert.strictEqual(nudgeLine([], NOW), '');
  const old = { title: 'Old one', created_at: new Date(NOW - 5 * 86400000).toISOString() };
  const fresh = { title: 'New one', created_at: new Date(NOW).toISOString() };
  const line = nudgeLine([old, fresh], NOW);
  assert.ok(line.startsWith('CLAUDE CODE JOBS: 2 waiting - the oldest has been waiting 5 days'));
  assert.ok(line.includes('"Old one", "New one"'));
  assert.ok(!nudgeLine([fresh], NOW).includes('oldest'));
});

check('nudgeFor never throws and is silent for clients', async () => {
  const broken = { list: async () => { throw new Error('db down'); } };
  assert.strictEqual(await nudgeFor(OWNER, { store: broken }), '');
  assert.strictEqual(await nudgeFor('Roland-Smith', { store: memStore() }), '');
});

check('the description routes "send that to Claude Code"', () => {
  assert.ok(mod.TOOL_DEFS[0].description.includes('send that to Claude Code'));
});

(async () => {
  for (const p of pending) await p();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll passed');
})();
