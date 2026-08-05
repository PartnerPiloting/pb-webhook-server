/**
 * Tests for the client-facing setup field list (config/wingguySetupFields.js) — the curated
 * subset of variables/assets the "Your Wingguy" page may read and write.
 *
 * The point of these is blast radius. That file is the ONLY allow-list between a client's browser
 * and the variable store, so the things worth pinning are: nothing dangerous has crept onto it,
 * every field is renderable, and the page's own group order stays derivable.
 *
 * Run: node tests/wingguy-setup-fields.test.js
 */
const assert = require('assert');
const fields = require('../config/wingguySetupFields');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const ALL = [...fields.VARIABLE_FIELDS, ...fields.ASSET_FIELDS, ...fields.VOICE_FIELDS];

console.log('\nwingguySetupFields');

check('every field is renderable (key, group, label, type)', () => {
  ALL.forEach((f) => {
    assert.ok(f.key, `missing key on ${JSON.stringify(f)}`);
    assert.ok(f.group, `${f.key}: missing group`);
    assert.ok(f.label, `${f.key}: missing label`);
    assert.ok(['text', 'long', 'choice'].includes(f.type), `${f.key}: bad type "${f.type}"`);
  });
});

check('choice fields carry non-empty options', () => {
  ALL.filter((f) => f.type === 'choice').forEach((f) => {
    assert.ok(Array.isArray(f.options) && f.options.length, `${f.key}: choice with no options`);
  });
});

check('keys are unique within each scope', () => {
  // Voice fields ARE variables underneath, so uniqueness runs across both lists.
  const vars = [...fields.VARIABLE_FIELDS, ...fields.VOICE_FIELDS].map((f) => f.key);
  const assets = fields.ASSET_FIELDS.map((f) => f.key);
  assert.strictEqual(new Set(vars).size, vars.length, 'duplicate variable key');
  assert.strictEqual(new Set(assets).size, assets.length, 'duplicate asset key');
});

check('the key sets match the field lists (the write-door allow-list)', () => {
  assert.strictEqual(fields.VARIABLE_KEYS.size, fields.VARIABLE_FIELDS.length + fields.VOICE_FIELDS.length);
  assert.strictEqual(fields.ASSET_KEYS.size, fields.ASSET_FIELDS.length);
  [...fields.VARIABLE_FIELDS, ...fields.VOICE_FIELDS].forEach((f) => assert.ok(fields.VARIABLE_KEYS.has(f.key), `${f.key} missing from VARIABLE_KEYS`));
  fields.ASSET_FIELDS.forEach((f) => assert.ok(fields.ASSET_KEYS.has(f.key), `${f.key} missing from ASSET_KEYS`));
});

check('voice fields carry a save cap and the default stays 600', () => {
  fields.VOICE_FIELDS.filter((f) => f.cap).forEach((f) => {
    assert.strictEqual(fields.capFor('variable', f.key), f.cap, `${f.key}: capFor should honour its cap`);
  });
  assert.strictEqual(fields.capFor('variable', 'signoff'), 600);
  assert.strictEqual(fields.capFor('asset', 'zoom_room'), 600);
});

check('the harvested-over-time slot is NOT a day-one box', () => {
  // own_anchor_lines fills via the edit loop and chat - a box would collect guesses (Guy's call).
  assert.ok(!fields.VARIABLE_KEYS.has('own_anchor_lines'), 'own_anchor_lines must not be page-editable yet');
});

check('plumbing variables are NOT exposed to clients', () => {
  // tracking_bcc is a guardrail (the CRM copy every outbound email must carry) and smoke_floor is
  // a test row. Neither is a client's business, and handing over tracking_bcc would let someone
  // quietly break their own follow-up queue.
  ['tracking_bcc', 'smoke_floor'].forEach((k) => {
    assert.ok(!fields.VARIABLE_KEYS.has(k), `${k} must never be client-editable`);
  });
});

check('group order covers every field, in first-appearance order', () => {
  const order = fields.groupOrder();
  assert.strictEqual(new Set(order).size, order.length, 'duplicate group in order');
  ALL.forEach((f) => assert.ok(order.includes(f.group), `group "${f.group}" missing from order`));
  // First appearance wins, so the page renders groups in the order the file declares them.
  assert.strictEqual(order[0], ALL[0].group);
});

check('hints and examples are plain sentences, not variable keys', () => {
  // The whole reason this file exists is that `owner_first_name` is not a question. If a label
  // ever reads like a key again, the page has regressed to showing store internals.
  ALL.forEach((f) => {
    assert.ok(!/^[a-z0-9_]+$/.test(f.label), `${f.key}: label looks like a key ("${f.label}")`);
    assert.ok(f.label.length > 8, `${f.key}: label too terse to be a question`);
  });
});

console.log(failures ? `\n${failures} failure(s)\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
