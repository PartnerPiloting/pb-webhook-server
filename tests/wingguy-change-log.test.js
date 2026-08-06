/**
 * Tests for the review page's store half — getClientChangeLog / addChangeNote / resolveChangeNote.
 *
 * Covers: client-layer-only filtering with before/after bodies resolved from retired versions ·
 * notes attach to their change and count open · cross-tenant note refusal · resolve is idempotent
 * and tenant-scoped. In-memory fake pool — no real database. ⚠ Synthetic content ONLY (public repo).
 *
 * Run: node tests/wingguy-change-log.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

class FakeDb {
  constructor() {
    this.history = [];
    this.rules = [];
    this.notes = [];
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
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || /^CREATE /i.test(s) || /^(DROP|ALTER|DO) /i.test(s)) return { rows: [] };

    if (s.startsWith('SELECT 1 FROM wingguy_rule_history')) {
      const [id, tenant] = params;
      // Tenant match only — blank rows carry no layer, and they take notes too.
      const hit = this.history.find((h) => h.id === Number(id) && h.tenant_id === tenant);
      return { rows: hit ? [{ '?column?': 1 }] : [] };
    }
    if (s.includes('FROM wingguy_rule_history') && s.includes('ORDER BY')) {
      const [tenant, cap] = params;
      const rows = this.history
        .filter((h) => h.tenant_id === tenant && (
          (h.layer === 'client' && ['commit', 'retire', 'revert'].includes(h.action))
          || ['variable-set', 'asset-set'].includes(h.action)
        ))
        .slice().reverse().slice(0, cap);
      return { rows };
    }
    if (s.includes('FROM wingguy_rules') && s.includes('rule_key = ANY')) {
      const [tenant, keys] = params;
      return { rows: this.rules.filter((r) => r.tenant_id === tenant && r.layer === 'client' && keys.includes(r.rule_key)) };
    }
    if (s.includes('FROM wingguy_change_summaries')) {
      const rows = this.summaries || [];
      if (s.includes('history_id = ANY')) {
        const [tenant, ids] = params;
        return { rows: rows.filter((x) => x.tenant_id === tenant && ids.includes(x.history_id)) };
      }
      const [historyId, tenant] = params;
      return { rows: rows.filter((x) => x.tenant_id === tenant && x.history_id === Number(historyId)) };
    }
    if (s.startsWith('SELECT id, created_at, actor, action, rule_key') && s.includes('WHERE id = $1')) {
      const [id, tenant] = params;
      return { rows: this.history.filter((h) => h.id === Number(id) && h.tenant_id === tenant && h.layer === 'client') };
    }
    if (s.includes('SELECT version, body, context, rule_type FROM wingguy_rules')) {
      const [tenant, key] = params;
      let rows = this.rules.filter((r) => r.tenant_id === tenant && r.layer === 'client' && r.rule_key === key);
      // The live-version query adds status = 'active'; the fake marks only the newest active.
      if (s.includes("status = 'active'")) {
        const top = rows.reduce((m, r) => (!m || r.version > m.version ? r : m), null);
        rows = top ? [top] : [];
      }
      return { rows: rows.map((r) => ({ version: r.version, body: r.body, context: r.context || 'global', rule_type: r.rule_type || 'voice' })) };
    }
    if (s.includes('INSERT INTO wingguy_change_summaries')) {
      const [history_id, tenant_id, summary] = params;
      this.summaries = this.summaries || [];
      if (!this.summaries.some((x) => x.history_id === Number(history_id))) {
        this.summaries.push({ history_id: Number(history_id), tenant_id, summary });
      }
      return { rows: [] };
    }
    if (s.includes('FROM wingguy_change_notes')) {
      const [tenant, ids] = params;
      return { rows: this.notes.filter((n) => n.tenant_id === tenant && ids.includes(n.history_id)) };
    }
    if (s.includes('INSERT INTO wingguy_change_notes')) {
      const [tenant_id, history_id, author, note] = params;
      const row = {
        id: this.nextId++, created_at: `t${this.nextId}`, tenant_id, history_id: Number(history_id),
        author, note, resolved_at: null, resolved_by: null,
      };
      this.notes.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }
    if (s.includes('UPDATE wingguy_change_notes')) {
      const [resolvedBy, id, tenant] = params;
      const row = this.notes.find((n) => n.id === Number(id) && n.tenant_id === tenant && !n.resolved_at);
      if (row) { row.resolved_at = 'now'; row.resolved_by = resolvedBy; return { rowCount: 1, rows: [] }; }
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

(async () => {
  const db = new FakeDb();
  store.__setTestPool(db);

  // A tenant with one edited rule (v1 retired → v2 active), one added rule, and one foreign row.
  db.history.push(
    { id: 1, created_at: 't1', tenant_id: 'Test-Tenant', layer: 'client', actor: 'portal:Test-Tenant:as:April', action: 'commit', rule_key: 'greeting-style', from_version: 1, to_version: 2, detail: { change_note: 'Softened the opener' } },
    { id: 2, created_at: 't2', tenant_id: 'Test-Tenant', layer: 'client', actor: 'mcp:Test-Tenant', action: 'commit', rule_key: 'no-fridays', from_version: null, to_version: 1, detail: { change_note: 'Added from chat' } },
    { id: 3, created_at: 't3', tenant_id: 'Other-Tenant', layer: 'client', actor: 'portal:Other-Tenant', action: 'commit', rule_key: 'greeting-style', from_version: null, to_version: 1, detail: {} },
    { id: 4, created_at: 't4', tenant_id: 'Test-Tenant', layer: 'client', actor: 'system:seed', action: 'seed', rule_key: 'seeded-rule', from_version: null, to_version: 1, detail: {} },
  );
  db.rules.push(
    { tenant_id: 'Test-Tenant', layer: 'client', rule_key: 'greeting-style', version: 1, body: 'Open with their first name.' },
    { tenant_id: 'Test-Tenant', layer: 'client', rule_key: 'greeting-style', version: 2, body: 'Open with their first name, never "Dear".' },
    { tenant_id: 'Test-Tenant', layer: 'client', rule_key: 'no-fridays', version: 1, body: 'Never message anyone on a Friday.' },
  );

  console.log('getClientChangeLog() — the review list:');
  await check('returns client commits newest first, seeds excluded, other tenants invisible', async () => {
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    assert.strictEqual(changes.length, 2);
    assert.strictEqual(changes[0].ruleKey, 'no-fridays');
    assert.ok(!changes.some((c) => c.ruleKey === 'seeded-rule'));
  });
  await check('before/after bodies resolve from kept versions', async () => {
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    const edit = changes.find((c) => c.ruleKey === 'greeting-style');
    assert.strictEqual(edit.beforeBody, 'Open with their first name.');
    assert.strictEqual(edit.afterBody, 'Open with their first name, never "Dear".');
    const add = changes.find((c) => c.ruleKey === 'no-fridays');
    assert.strictEqual(add.beforeBody, null, 'an add has no before');
    assert.strictEqual(add.changeNote, 'Added from chat');
  });

  console.log('addChangeNote() — the margin:');
  await check('a note lands on its change and counts open', async () => {
    const r = await store.addChangeNote({ tenantId: 'Test-Tenant', historyId: 1, author: 'Paul', note: 'Prefer we never promise timeframes.' });
    assert.ok(r.id);
    const { changes, openNotes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    assert.strictEqual(openNotes, 1);
    const edit = changes.find((c) => c.ruleKey === 'greeting-style');
    assert.strictEqual(edit.notes.length, 1);
    assert.strictEqual(edit.notes[0].author, 'Paul');
  });
  await check('a note on another tenant\'s change is refused', async () => {
    await assert.rejects(
      store.addChangeNote({ tenantId: 'Test-Tenant', historyId: 3, author: 'Paul', note: 'sneaky' }),
      /not on this account/,
    );
  });
  await check('empty note or missing id is refused', async () => {
    await assert.rejects(store.addChangeNote({ tenantId: 'T', historyId: 1, note: '  ' }), /note text/);
    await assert.rejects(store.addChangeNote({ tenantId: 'T', note: 'x' }), /historyId/);
  });

  console.log('fill-in-the-blanks changes — variable/asset sets join the list:');
  await check('a variable-set row appears as a blank with from/to', async () => {
    db.history.push({ id: 5, created_at: 't5', tenant_id: 'Test-Tenant', layer: null, actor: 'portal:Test-Tenant:as:April', action: 'variable-set', rule_key: 'signoff', from_version: null, to_version: null, detail: { from: 'Cheers', to: 'Talk soon' } });
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    const blank = changes.find((c) => c.kind === 'blank');
    assert.ok(blank, 'blank entry present');
    assert.strictEqual(blank.ruleKey, 'signoff');
    assert.strictEqual(blank.fromValue, 'Cheers');
    assert.strictEqual(blank.toValue, 'Talk soon');
    assert.ok(changes.every((c) => c.kind !== 'blank' || c.beforeBody === null), 'blanks carry no rule bodies');
  });
  await check('an asset-set row carries its url as the new value', async () => {
    db.history.push({ id: 6, created_at: 't6', tenant_id: 'Test-Tenant', layer: null, actor: 'portal:Test-Tenant', action: 'asset-set', rule_key: 'default_explainer', from_version: null, to_version: null, detail: { kind: 'url', url: 'https://example.com/x', status: 'active' } });
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    const a = changes.find((c) => c.ruleKey === 'default_explainer');
    assert.strictEqual(a.kind, 'blank');
    assert.strictEqual(a.toValue, 'https://example.com/x');
    assert.strictEqual(a.blankStatus, 'active');
  });
  await check('a note lands on a blank change too (no layer on its history row)', async () => {
    const r = await store.addChangeNote({ tenantId: 'Test-Tenant', historyId: 5, author: 'Paul', note: 'Like it.' });
    assert.ok(r.id);
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    assert.strictEqual(changes.find((c) => c.id === 5).notes.length, 1);
    // Tidy up so later open-note counts start from zero again.
    await store.resolveChangeNote({ tenantId: 'Test-Tenant', noteId: r.id, resolvedBy: 'April' });
  });

  console.log('change summaries — written once, kept forever:');
  await check('a summary is stored and comes back on the change', async () => {
    await store.setChangeSummary({ tenantId: 'Test-Tenant', historyId: 1, summary: 'Wingguy now opens with their first name and never says "Dear".' });
    const { changes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    const edit = changes.find((c) => c.ruleKey === 'greeting-style');
    assert.ok(edit.summary.includes('first name'));
    assert.strictEqual(changes.find((c) => c.ruleKey === 'no-fridays').summary, null, 'unsummarised changes stay null');
  });
  await check('a second write never overwrites the first', async () => {
    await store.setChangeSummary({ tenantId: 'Test-Tenant', historyId: 1, summary: 'DIFFERENT TEXT' });
    assert.ok((await store.getChangeSummary({ tenantId: 'Test-Tenant', historyId: 1 })).includes('first name'));
  });
  await check('an empty summary or bogus id is a no-op', async () => {
    assert.strictEqual((await store.setChangeSummary({ tenantId: 'T', historyId: 9, summary: '  ' })).stored, false);
    assert.strictEqual((await store.setChangeSummary({ tenantId: 'T', historyId: 0, summary: 'x' })).stored, false);
  });

  console.log('getChangeEntry() — what the explain and undo doors read:');
  await check('returns before/after plus the CURRENT live version', async () => {
    const e = await store.getChangeEntry({ tenantId: 'Test-Tenant', historyId: 1 });
    assert.strictEqual(e.ruleKey, 'greeting-style');
    assert.strictEqual(e.beforeBody, 'Open with their first name.');
    assert.strictEqual(e.liveVersion, 2, 'undo must commit against the live version, not the entry');
  });
  await check('another tenant cannot read the entry', async () => {
    assert.strictEqual(await store.getChangeEntry({ tenantId: 'Other-Tenant', historyId: 1 }), null);
  });

  console.log('resolveChangeNote() — sorted:');
  await check('resolve ticks the note and open count drops', async () => {
    const noteId = db.notes[0].id;
    const r = await store.resolveChangeNote({ tenantId: 'Test-Tenant', noteId, resolvedBy: 'April' });
    assert.strictEqual(r.resolved, 1);
    const { openNotes } = await store.getClientChangeLog({ tenantId: 'Test-Tenant' });
    assert.strictEqual(openNotes, 0);
    assert.strictEqual(db.notes[0].resolved_by, 'April');
  });
  await check('resolving again (or cross-tenant) is a no-op', async () => {
    const noteId = db.notes[0].id;
    assert.strictEqual((await store.resolveChangeNote({ tenantId: 'Test-Tenant', noteId })).resolved, 0);
    assert.strictEqual((await store.resolveChangeNote({ tenantId: 'Other-Tenant', noteId })).resolved, 0);
  });

  store.__setTestPool(null);
  console.log(failures ? `\n${failures} FAILED` : '\nAll change-log tests passed.');
  process.exit(failures ? 1 : 0);
})();
