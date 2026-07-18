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

  store.__setTestPool(null);
  console.log(failures ? `\n${failures} FAILED` : '\nAll edit-pair tests passed.');
  process.exit(failures ? 1 : 0);
})();
