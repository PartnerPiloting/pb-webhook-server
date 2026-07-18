/**
 * Tests for learn-from-my-edit — the wingguy_edit_pairs store functions.
 *
 * Covers: unchanged-send suppression (whitespace-only diffs never land a row) · a real edit is
 * stored pending · list filters by status · resolve moves pending → reviewed/dismissed and never
 * touches already-resolved rows · input validation. Uses an injected in-memory fake pool — no
 * real database. ⚠ Synthetic message content ONLY (public repo).
 *
 * Run: node tests/wingguy-edit-pairs.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// In-memory fake pool — emulates just the SQL shapes the edit-pair functions issue.
class FakeDb {
  constructor() {
    this.pairs = [];
    this.drafts = [];
    this.nextId = 1;
  }
  connect() {
    return Promise.resolve({
      query: (sql, params) => this.query(sql, params || []),
      release() {},
    });
  }
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^CREATE /i.test(s) || /^(DROP|ALTER) /i.test(s)) return { rows: [] };

    if (s.includes('INSERT INTO wingguy_edit_pairs')) {
      const [tenant_id, lead_name, lead_url, surface, generated, sent] = params;
      const row = {
        id: this.nextId++, created_at: `t${this.nextId}`, tenant_id, lead_name, lead_url, surface,
        generated, sent, status: 'pending', reviewed_at: null, review_note: null,
      };
      this.pairs.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (s.includes('UPDATE wingguy_edit_pairs')) {
      const [status, note, tenant, ids] = params;
      let n = 0;
      for (const p of this.pairs) {
        if (p.tenant_id === tenant && ids.includes(p.id) && p.status === 'pending') {
          p.status = status; p.review_note = note; p.reviewed_at = 'now'; n++;
        }
      }
      return { rowCount: n, rows: [] };
    }
    if (s.includes('FROM wingguy_edit_pairs')) {
      const tenant = params[0];
      const cap = params[1];
      const status = params[2]; // undefined for status='all'
      let rows = this.pairs.filter((p) => p.tenant_id === tenant);
      if (status !== undefined) rows = rows.filter((p) => p.status === status);
      return { rows: rows.slice().reverse().slice(0, cap) };
    }
    if (s.includes('INSERT INTO wingguy_draft_ledger')) {
      const [tenant_id, draft_id, thread_id, to_email, subject, generated] = params;
      const row = {
        id: this.nextId++, created_at: new Date().toISOString(), tenant_id, draft_id, thread_id,
        to_email, subject, generated, status: 'awaiting-send', settled_at: null,
      };
      this.drafts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (s.includes('UPDATE wingguy_draft_ledger')) {
      const [status, tenant, id] = params;
      let n = 0;
      const row = this.drafts.find((d) => d.tenant_id === tenant && d.id === id && d.status === 'awaiting-send');
      if (row) { row.status = status; row.settled_at = 'now'; n = 1; }
      return { rowCount: n, rows: [] };
    }
    if (s.includes('FROM wingguy_draft_ledger')) {
      const tenant = params[0];
      const cap = params[1];
      return { rows: this.drafts.filter((d) => d.tenant_id === tenant && d.status === 'awaiting-send').slice(0, cap) };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

(async () => {
  console.log('normalizeForEditCompare() — the "did anything change?" view:');
  await check('whitespace runs and edges collapse', () => {
    assert.strictEqual(store.normalizeForEditCompare('  Hi   Sam,\n\ngreat to  connect. '), 'Hi Sam, great to connect.');
  });
  await check('case and punctuation changes still COUNT as edits', () => {
    assert.notStrictEqual(store.normalizeForEditCompare('Great to connect!'), store.normalizeForEditCompare('great to connect'));
  });

  const db = new FakeDb();
  store.__setTestPool(db);

  console.log('recordEditPair() — unchanged suppression + storage:');
  await check('an unchanged send (whitespace aside) is NOT stored', async () => {
    const r = await store.recordEditPair({
      tenantId: 'Test-Tenant', leadName: 'Sam Test',
      generated: 'Hi Sam, great to connect.\n\nTalk soon.',
      sent: '  Hi Sam,   great to connect. Talk soon. ',
    });
    assert.strictEqual(r.stored, false);
    assert.strictEqual(r.reason, 'unchanged');
    assert.strictEqual(db.pairs.length, 0);
  });
  await check('a real edit lands one pending row', async () => {
    const r = await store.recordEditPair({
      tenantId: 'Test-Tenant', leadName: 'Sam Test', leadUrl: 'https://www.linkedin.com/in/sam-test/',
      generated: 'Hi Sam, great to connect! I would love to hear about your work.',
      sent: 'Hi Sam, great to connect. Keen to hear about your work.',
    });
    assert.strictEqual(r.stored, true);
    assert.ok(r.id);
    assert.strictEqual(db.pairs.length, 1);
    assert.strictEqual(db.pairs[0].status, 'pending');
    assert.strictEqual(db.pairs[0].surface, 'linkedin');
  });
  await check('empty generated or sent is rejected', async () => {
    await assert.rejects(store.recordEditPair({ tenantId: 'T', generated: '', sent: 'x' }), /required/);
    await assert.rejects(store.recordEditPair({ tenantId: 'T', generated: 'x', sent: '  ' }), /required/);
  });

  console.log('getEditPairs() — status filter:');
  await store.recordEditPair({
    tenantId: 'Test-Tenant', leadName: 'Pat Test',
    generated: 'Would Tuesday 10am work?', sent: 'Would Tuesday or Wednesday morning work?',
  });
  await check('pending (default) returns both, newest first', async () => {
    const rows = await store.getEditPairs({ tenantId: 'Test-Tenant' });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].lead_name, 'Pat Test');
  });
  await check('another tenant sees nothing', async () => {
    const rows = await store.getEditPairs({ tenantId: 'Other-Tenant' });
    assert.strictEqual(rows.length, 0);
  });

  console.log('resolveEditPairs() — close-out semantics:');
  await check('resolve marks pending rows reviewed with the note', async () => {
    const ids = db.pairs.map((p) => p.id);
    const r = await store.resolveEditPairs({ tenantId: 'Test-Tenant', ids: [ids[0]], note: 'folded into greeting-style' });
    assert.strictEqual(r.resolved, 1);
    assert.strictEqual(db.pairs[0].status, 'reviewed');
    assert.strictEqual(db.pairs[0].review_note, 'folded into greeting-style');
  });
  await check('an already-resolved row is not re-resolved', async () => {
    const r = await store.resolveEditPairs({ tenantId: 'Test-Tenant', ids: [db.pairs[0].id], status: 'dismissed' });
    assert.strictEqual(r.resolved, 0);
    assert.strictEqual(db.pairs[0].status, 'reviewed', 'stays reviewed');
  });
  await check('dismiss works on a pending row', async () => {
    const pending = db.pairs.find((p) => p.status === 'pending');
    const r = await store.resolveEditPairs({ tenantId: 'Test-Tenant', ids: [pending.id], status: 'dismissed', note: 'mispaired' });
    assert.strictEqual(r.resolved, 1);
    assert.strictEqual(pending.status, 'dismissed');
  });
  await check('an invalid resolution status throws', async () => {
    await assert.rejects(store.resolveEditPairs({ tenantId: 'T', ids: [1], status: 'deleted' }), /invalid status/);
  });
  await check('no ids is a harmless no-op', async () => {
    const r = await store.resolveEditPairs({ tenantId: 'Test-Tenant', ids: [] });
    assert.strictEqual(r.resolved, 0);
  });

  console.log('draft ledger (email half) — record / awaiting / settle:');
  await check('recordDraftBody stores an awaiting row', async () => {
    const r = await store.recordDraftBody({
      tenantId: 'Test-Tenant', draftId: 'd1', threadId: 't1', toEmail: 'Lead@Example.com',
      subject: 'Quick follow-up', generated: 'Hi there, following up on our chat.',
    });
    assert.ok(r.id);
    assert.strictEqual(db.drafts[0].to_email, 'lead@example.com', 'email lowercased');
    assert.strictEqual(db.drafts[0].status, 'awaiting-send');
  });
  await check('getAwaitingDrafts returns only awaiting rows for the tenant', async () => {
    const rows = await store.getAwaitingDrafts({ tenantId: 'Test-Tenant' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual((await store.getAwaitingDrafts({ tenantId: 'Other-Tenant' })).length, 0);
  });
  await check('settleDraftRecord closes the row; invalid status throws', async () => {
    const r = await store.settleDraftRecord({ tenantId: 'Test-Tenant', id: db.drafts[0].id, status: 'no-diff' });
    assert.strictEqual(r.settled, 1);
    assert.strictEqual(db.drafts[0].status, 'no-diff');
    assert.strictEqual((await store.getAwaitingDrafts({ tenantId: 'Test-Tenant' })).length, 0);
    await assert.rejects(store.settleDraftRecord({ tenantId: 'T', id: 1, status: 'sent' }), /invalid status/);
  });
  await check('recordDraftBody without body or recipient is rejected', async () => {
    await assert.rejects(store.recordDraftBody({ tenantId: 'T', toEmail: 'a@b.co', generated: '' }), /required/);
    await assert.rejects(store.recordDraftBody({ tenantId: 'T', toEmail: '', generated: 'x' }), /required/);
  });

  console.log('stripQuotedTail() — reply compares as the human\'s words only:');
  const { stripQuotedTail } = require('../services/wingguyMailMcp');
  await check('cuts at the Gmail "On ... wrote:" marker', () => {
    const t = stripQuotedTail('Thanks Sam - Tuesday works.\n\nOn Fri, 17 Jul 2026 at 09:12, Sam Test <sam@example.com> wrote:\n> earlier message');
    assert.strictEqual(t, 'Thanks Sam - Tuesday works.');
  });
  await check('cuts at an Outlook Original Message divider', () => {
    const t = stripQuotedTail('Sounds good.\n-----Original Message-----\nFrom: Sam');
    assert.strictEqual(t, 'Sounds good.');
  });
  await check('cuts at a ">"-quoted line', () => {
    const t = stripQuotedTail('See you then.\n> when suits?\n> cheers');
    assert.strictEqual(t, 'See you then.');
  });
  await check('leaves unquoted text alone', () => {
    const body = 'Hi Sam,\n\nGreat to connect - talk soon.';
    assert.strictEqual(stripQuotedTail(body), body);
  });

  console.log('computeRulebookHygiene() — code-detected structural findings:');
  await check('flags a cross-layer twin (same key+campaign active in two layers)', () => {
    const findings = store.computeRulebookHygiene([
      { rule_key: 'greeting-style', campaign: null, layer: 'foundation', body: 'A' },
      { rule_key: 'greeting-style', campaign: null, layer: 'client', body: 'B' },
    ], [], []);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'cross-layer-twin');
    assert.ok(findings[0].detail.includes('foundation AND client'));
  });
  await check('campaign-vs-generic same key is BY DESIGN — not flagged', () => {
    const findings = store.computeRulebookHygiene([
      { rule_key: 'opener', campaign: null, layer: 'client', body: 'generic' },
      { rule_key: 'opener', campaign: 'frac', layer: 'client', body: 'frac version' },
    ], [], []);
    assert.strictEqual(findings.length, 0);
  });
  await check('flags unresolved variable and retired-asset placeholders', () => {
    const findings = store.computeRulebookHygiene([
      { rule_key: 'signoff-rule', campaign: null, layer: 'client', body: 'Sign as {{signoff}} and link {{asset:old-deck}}' },
    ], [{ var_key: 'signoff', value: null }], [{ asset_key: 'old-deck', url: 'x', status: 'retired' }]);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'unresolved-placeholders');
    assert.ok(findings[0].detail.includes('{{signoff}}'));
    assert.ok(findings[0].detail.includes('{{asset:old-deck}}'));
  });
  await check('a clean rulebook returns no findings', () => {
    const findings = store.computeRulebookHygiene([
      { rule_key: 'greeting-style', campaign: null, layer: 'client', body: 'Open with {{coach_first_name}}.' },
    ], [{ var_key: 'coach_first_name', value: 'Alex' }], []);
    assert.strictEqual(findings.length, 0);
  });

  store.__setTestPool(null);
  console.log(failures ? `\n${failures} FAILED` : '\nAll edit-pair tests passed.');
  process.exit(failures ? 1 : 0);
})();
