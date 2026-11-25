/**
 * Offboarding deletes what the contacts lookup holds for a client (Guy, 26 Nov 2026) - the terms page
 * says "I delete them when you ask or when you leave". services/contactsStore.forgetClient.
 *
 *   node tests/contacts-forget-client.test.js
 *
 * No database: recallWebhookDb is swapped for a pool that records every statement.
 */
const assert = require('assert');
const path = require('path');

const seen = [];
let failOn = null;
const fakeClient = {
  async query(sql, params) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    seen.push({ text, params });
    if (failOn && failOn.test(text)) throw new Error('relation "linkedin_people" does not exist');
    if (/^SELECT count/.test(text)) return { rows: [{ n: /linkedin_people/.test(text) ? 40 : 7 }], rowCount: 1 };
    if (/^DELETE FROM wingguy_contacts /.test(text)) return { rows: [], rowCount: 7 };
    if (/^DELETE FROM linkedin_people/.test(text)) return { rows: [], rowCount: 40 };
    return { rows: [], rowCount: 0 };
  },
  release() {},
};
const dbPath = require.resolve(path.join('..', 'services', 'recallWebhookDb'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getPool: () => ({ connect: async () => fakeClient }) } };
const store = require('../services/contactsStore');

const writes = () => seen.filter((q) => /^(DELETE|UPDATE|INSERT)/.test(q.text));

(async () => {
  // 1. Counting changes nothing.
  seen.length = 0;
  const count = await store.forgetClient('Left-Client');
  assert.deepStrictEqual(count, { ok: true, contacts: 7, linkedinPeople: 40, applied: false });
  assert.strictEqual(writes().length, 0, 'a count must not write');

  // 2. Applying deletes the contacts, the sweep stamps and the LinkedIn list - for THAT client only.
  seen.length = 0;
  const gone = await store.forgetClient('Left-Client', { apply: true });
  assert.deepStrictEqual(gone, { ok: true, contacts: 7, linkedinPeople: 40, applied: true });
  const dels = writes();
  assert.deepStrictEqual(dels.map((q) => q.text.split(' WHERE ')[0]).sort(),
    ['DELETE FROM linkedin_people', 'DELETE FROM wingguy_contacts', 'DELETE FROM wingguy_contacts_sweeps']);
  for (const q of dels) {
    assert.ok(/WHERE (coach_client_id|tenant_id) = \$1$/.test(q.text), `scoped to one client: ${q.text}`);
    assert.deepStrictEqual(q.params, ['Left-Client']);
  }

  // 3. A database with no LinkedIn table has no list to delete - the contacts still go.
  seen.length = 0; failOn = /linkedin_people/;
  const noTable = await store.forgetClient('Left-Client', { apply: true });
  assert.deepStrictEqual(noTable, { ok: true, contacts: 7, linkedinPeople: 0, applied: true });
  failOn = null;

  // 4. No client named = nothing touched.
  seen.length = 0;
  assert.strictEqual((await store.forgetClient('', { apply: true })).ok, false);
  assert.strictEqual(seen.length, 0);

  console.log('contacts-forget-client: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
