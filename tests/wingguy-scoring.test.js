/**
 * Tests for the Wingguy scoring tools (2026-10-05) - "rebuild my scoring" from chat.
 *
 * The Dean Hobin rebuild: a brief -> a whole new attribute set, shown before it is written, backed
 * up before it is written, never adding or deleting rows, and written in whatever field types the
 * client's base actually uses (older bases store Active as a select, newer as a checkbox).
 *
 * Pure logic + the MCP runners against a stubbed Airtable base, stubbed clientService and a fake
 * Postgres pool. No network.
 *
 * Run: node tests/wingguy-scoring.test.js
 */
const assert = require('assert');
const core = require('../services/scoringAttributes');
const backupStore = require('../services/scoringBackupStore');
const clientService = require('../services/clientService');
const mcp = require('../services/wingguyScoringMcp');

let failures = 0;
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Airtable record stub: { id, fields } with .get(name).
const rec = (id, fields) => ({ id, fields, get: (f) => fields[f] });

// A small table in the OLD style (Active + Disqualifying as selects), like Dean's base.
function oldStyleRecords() {
  return [
    rec('recPRE', { 'Attribute Id': 'PREAMBLE', Category: 'Meta', Heading: 'Global Scoring Narrative', Instructions: 'Partner Piloting purpose', Active: 'checked' }),
    rec('recSTA', { 'Attribute Id': 'STEP-A', Category: 'Step', Heading: 'Disqualifying Check', Instructions: 'step', Active: 'checked' }),
    rec('recA', { 'Attribute Id': 'A', Category: 'Positive', Heading: 'AI Enthusiasm', 'Max Points': 15, 'Min To Qualify': 5, Instructions: 'old A', Active: 'checked' }),
    rec('recB', { 'Attribute Id': 'B', Category: 'Positive', Heading: 'Learner', 'Max Points': 15, Instructions: 'old B', Active: 'checked' }),
    rec('recJ', { 'Attribute Id': 'J', Category: 'Positive', Heading: 'India', 'Max Points': 20, 'Bonus Points': true, Instructions: 'old J' }),
    rec('recN5', { 'Attribute Id': 'N5', Category: 'Negative', Heading: 'Cynicism', Penalty: 5, Disqualifying: 'checked', Instructions: 'old N5', Active: 'checked' }),
    rec('recN4', { 'Attribute Id': 'N4', Category: 'Negative', Heading: 'Anti-Entrepreneurial', Penalty: 10, Disqualifying: 'checked', Instructions: 'old N4', Active: 'checked' }),
  ];
}

function stubBase(records) {
  const updates = [];
  const table = (name) => {
    assert.strictEqual(name, core.TABLE);
    return {
      select: () => ({ all: async () => records }),
      update: async (rows) => {
        updates.push(...rows);
        for (const u of rows) { const r = records.find((x) => x.id === u.id); Object.assign(r.fields, u.fields); }
        return rows;
      },
    };
  };
  return { table, updates };
}

// Fake pg pool for the backup store.
function fakePool({ failInsert = false } = {}) {
  const saved = [];
  const client = {
    query: async (sql, params) => {
      if (/INSERT INTO wingguy_scoring_backups/.test(sql)) {
        if (failInsert) throw new Error('db down');
        const row = { id: saved.length + 1, at: new Date(), tenant_id: params[0], base_id: params[1], reason: params[2], rows: JSON.parse(params[3]) };
        saved.push(row);
        return { rows: [{ id: row.id, at: row.at }] };
      }
      if (/WHERE tenant_id = \$1 AND id = \$2/.test(sql)) return { rows: saved.filter((b) => b.tenant_id === params[0] && b.id === params[1]) };
      if (/ORDER BY at DESC/.test(sql)) return { rows: saved.filter((b) => b.tenant_id === params[0]).reverse().map((b) => ({ id: b.id, at: b.at, reason: b.reason, row_count: b.rows.length })) };
      return { rows: [] };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client }, saved };
}

function withClient(base, fn) {
  const origGet = clientService.getClientById;
  const origBase = clientService.getClientBase;
  clientService.getClientById = async () => ({ clientId: 'Dean-Hobin', airtableBaseId: 'appDEAN' });
  clientService.getClientBase = () => base.table;
  return Promise.resolve(fn()).finally(() => { clientService.getClientById = origGet; clientService.getClientBase = origBase; });
}

const fpFrom = (text) => (text.match(/fingerprint=([0-9a-f]{12})/) || [])[1];

(async () => {
  console.log('fieldKinds - read the types off the data:');
  await acheck('old base: Active is a select, Bonus a checkbox, Disqualifying a select', () => {
    assert.deepStrictEqual(core.fieldKinds(oldStyleRecords()), { Active: 'select', Disqualifying: 'select', 'Bonus Points': 'checkbox' });
  });
  await acheck('new base: Active checkbox', () => {
    const k = core.fieldKinds([rec('r1', { Active: true }), rec('r2', { Disqualifying: 'checked' })]);
    assert.strictEqual(k.Active, 'checkbox');
    assert.strictEqual(k.Disqualifying, 'select');
  });

  console.log('checkProposal:');
  const rows = oldStyleRecords().map(core.normalize);
  await acheck('unknown row is refused (fixed slots)', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'Z', heading: 'New' }] });
    assert.ok(c.errors.some((e) => /no row Z/.test(e)), c.errors.join('|'));
  });
  await acheck('penalty on a positive row is refused', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'A', penalty: 5 }] });
    assert.ok(c.errors.some((e) => /positive attribute/.test(e)));
  });
  await acheck('bonus on a negative row is refused', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'N5', bonus: true }] });
    assert.ok(c.errors.some((e) => /negative attribute/.test(e)));
  });
  await acheck('PREAMBLE as a row is refused; purpose= changes it', () => {
    assert.ok(core.checkProposal(rows, { rows: [{ id: 'PREAMBLE', instructions: 'x' }] }).errors.length);
    const c = core.checkProposal(rows, { purpose: 'Project Helix purpose' });
    assert.strictEqual(c.errors.length, 0);
    assert.strictEqual(c.changes[0].row.id, 'PREAMBLE');
  });
  await acheck('step rows cannot be changed', () => {
    assert.ok(core.checkProposal(rows, { rows: [{ id: 'STEP-A', heading: 'x' }] }).errors.some((e) => /not a scoring row/.test(e)));
  });
  await acheck('a remaining minimum is warned about', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'A', heading: 'Health Alignment', max_points: 30 }] });
    assert.ok(c.warnings.some((w) => /minimum of 5/.test(w)), c.warnings.join('|'));
  });
  await acheck('switching every positive off is refused', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'A', active: false }, { id: 'B', active: false }] });
    assert.ok(c.errors.some((e) => /No positive attribute/.test(e)));
  });
  await acheck('only real differences count as changes', () => {
    const c = core.checkProposal(rows, { rows: [{ id: 'B', heading: 'Learner', max_points: 15 }] });
    assert.strictEqual(c.changes.length, 0);
  });
  await acheck('ids are matched case-insensitively', () => {
    assert.strictEqual(core.checkProposal(rows, { rows: [{ id: 'a', max_points: 30 }] }).errors.length, 0);
  });

  console.log('buildWrites - field types:');
  await acheck('select base writes "checked"/null, checkbox writes booleans', () => {
    const r = { ...rows.find((x) => x.id === 'J'), active: true, bonus: true };
    const [w] = core.buildWrites([r], { Active: 'select', Disqualifying: 'select', 'Bonus Points': 'checkbox' });
    assert.strictEqual(w.fields.Active, 'checked');
    assert.strictEqual(w.fields['Bonus Points'], true);
    assert.strictEqual(w.fields['Min To Qualify'], null);
    assert.ok(!('Penalty' in w.fields));
    const off = core.buildWrites([{ ...rows.find((x) => x.id === 'N4'), active: false }], { Active: 'select', Disqualifying: 'select', 'Bonus Points': 'checkbox' })[0];
    assert.strictEqual(off.fields.Active, null);
    assert.strictEqual(off.fields.Disqualifying, 'checked');
  });

  console.log('propose -> commit -> revert (runners):');
  {
    const records = oldStyleRecords();
    const base = stubBase(records);
    const fp = fakePool();
    backupStore.__setTestPool(fp.pool);
    const proposal = {
      purpose: 'Evaluate profiles for Project Helix.',
      rows: [
        { id: 'A', heading: 'Health & Wellness Alignment', max_points: 30, min_to_qualify: 0, instructions: 'Score bands\n- 0-5 = none\n- 24-30 = exemplar', examples: '28: EP', signals: 'healthy ageing' },
        { id: 'N4', active: false },
      ],
    };
    await withClient(base, async () => {
      const p = await mcp.runPropose(proposal, 'Dean-Hobin');
      await acheck('propose writes nothing and returns a fingerprint', () => {
        assert.ok(!p.isError, p.text);
        assert.strictEqual(base.updates.length, 0);
        assert.ok(fpFrom(p.text));
        assert.ok(/Main attributes \(45 points in total\)/.test(p.text), p.text);
      });
      const bad = await mcp.runCommit({ ...proposal, fingerprint: 'deadbeef0000' }, 'Dean-Hobin');
      await acheck('commit with a wrong fingerprint is refused', () => { assert.ok(bad.isError); assert.strictEqual(base.updates.length, 0); });

      const c = await mcp.runCommit({ ...proposal, fingerprint: fpFrom(p.text) }, 'Dean-Hobin');
      await acheck('commit backs up first, then writes the 3 touched rows', () => {
        assert.ok(!c.isError, c.text);
        assert.strictEqual(fp.saved.length, 1);
        assert.deepStrictEqual(fp.saved[0].rows.map((r) => r.id).sort(), ['A', 'N4', 'PREAMBLE']);
        assert.strictEqual(fp.saved[0].rows.find((r) => r.id === 'A').heading, 'AI Enthusiasm');
        assert.deepStrictEqual(base.updates.map((u) => u.id).sort(), ['recA', 'recN4', 'recPRE']);
      });
      await acheck('table now holds the new values in the base\'s own types', () => {
        const a = records.find((r) => r.id === 'recA').fields;
        assert.strictEqual(a.Heading, 'Health & Wellness Alignment');
        assert.strictEqual(a['Max Points'], 30);
        assert.strictEqual(a['Min To Qualify'], null);
        assert.strictEqual(a.Active, 'checked');
        assert.strictEqual(records.find((r) => r.id === 'recN4').fields.Active, null);
        assert.strictEqual(records.find((r) => r.id === 'recPRE').fields.Instructions, 'Evaluate profiles for Project Helix.');
      });
      const again = await mcp.runCommit({ ...proposal, fingerprint: fpFrom(p.text) }, 'Dean-Hobin');
      await acheck('the same fingerprint cannot be reused once the table moved', () => assert.ok(again.isError));

      const list = await mcp.runRevert({}, 'Dean-Hobin');
      await acheck('revert with no id lists backups', () => assert.ok(/#1 /.test(list.text), list.text));
      const rv = await mcp.runRevert({ backup_id: 1 }, 'Dean-Hobin');
      await acheck('revert restores the old rows and backs up what it replaced', () => {
        assert.ok(!rv.isError, rv.text);
        const a = records.find((r) => r.id === 'recA').fields;
        assert.strictEqual(a.Heading, 'AI Enthusiasm');
        assert.strictEqual(a['Min To Qualify'], 5);
        assert.strictEqual(records.find((r) => r.id === 'recN4').fields.Active, 'checked');
        assert.strictEqual(fp.saved.length, 2);
        assert.ok(/backup #2/.test(rv.text));
      });
      const other = await mcp.runRevert({ backup_id: 1 }, 'Someone-Else');
      await acheck('another client cannot restore this client\'s backup', () => assert.ok(other.isError));
    });
  }

  {
    const records = oldStyleRecords();
    const base = stubBase(records);
    backupStore.__setTestPool(fakePool({ failInsert: true }).pool);
    await withClient(base, async () => {
      const p = await mcp.runPropose({ rows: [{ id: 'B', max_points: 20 }] }, 'Dean-Hobin');
      const c = await mcp.runCommit({ rows: [{ id: 'B', max_points: 20 }], fingerprint: fpFrom(p.text) }, 'Dean-Hobin');
      await acheck('no backup -> nothing written', () => { assert.ok(c.isError); assert.strictEqual(base.updates.length, 0); });
    });
  }

  console.log('get:');
  {
    const base = stubBase(oldStyleRecords());
    await withClient(base, async () => {
      const g = await mcp.runGet({}, 'Dean-Hobin');
      await acheck('summary lists scoring rows, not step rows', () => {
        assert.ok(/A - AI Enthusiasm/.test(g.text));
        assert.ok(!/STEP-A/.test(g.text));
        assert.ok(/detail="full"/.test(g.text));
      });
    });
  }

  backupStore.__setTestPool(null);
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
