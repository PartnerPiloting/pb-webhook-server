/**
 * "Wingguy first" - the texts that make a client's Claude ask Wingguy before answering from memory.
 *
 * 19 Sep 2026, proven with server logs: Claude.ai consults its own memory BEFORE loading connector
 * tools. A confident memory answer means "Recalled memory" as the first line, no tool loaded, and
 * Wingguy never asked - which is how the exact sentence an email told a client to type came back
 * with the August Windows-laptop doctrine. The fix has to live in the client's Claude: preferences
 * text, a memory pointer, an opener habit, and a canary that proves it took. All of it is words,
 * and words in three docs drift. This pins:
 *
 *   1. content/wingguy-first.json is well-formed, sized for the boxes it goes into, house style;
 *   2. the canary and the opener are REGISTERED client phrases (content/client-phrases.json), so
 *      the tool that must answer them has been told about them;
 *   3. every doc the JSON names still carries each text verbatim - a reworded checklist or
 *      connector message fails here, not in a client's chat;
 *   4. the concierge run sheet has the step, right after the connector, and MINTS the texts onto
 *      the page rather than carrying its own copy - and the rendered page has all four with a Copy
 *      button each.
 *
 * What it cannot check: whether a client's Claude honours any of it. Only the canary can - new
 * chat, the phrase, read the first line. Do that at the end of every onboarding.
 *
 * Run: node tests/wingguy-first.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wf = require('../utils/wingguyFirst');
const { load: loadPhrases, normalise } = require('../utils/clientPhrases');
const rs = require('../services/runSheet');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// Docs wrap at ~100 columns and quote client-facing text inside "> " blocks, so compare with
// blockquote markers stripped, whitespace collapsed and quotes straightened - never byte for byte.
const flat = (s) => normalise(String(s || '').replace(/^\s*>\s?/gm, ' '));

const T = wf.load();
const texts = { preferences: T.preferences, preferences_short: T.preferences_short, memory_pointer: T.memory_pointer };

console.log('\nWingguy first - the texts that go into a client\'s Claude on onboarding day\n');

console.log('1. the canonical file');
check('preferences is about 500 characters - the size of the box it goes into', () => {
  assert.ok(T.preferences.length >= 300 && T.preferences.length <= 700, `${T.preferences.length} chars`);
});
check('the short form fits a nearly-full box (under 150 characters)', () => {
  assert.ok(T.preferences_short.length < 150, `${T.preferences_short.length} chars`);
});
check('every text names Wingguy, and the two preference texts name the Linked Helper machine', () => {
  for (const [k, v] of Object.entries(texts)) assert.ok(/wingguy/i.test(v), `${k} does not say Wingguy`);
  for (const k of ['preferences', 'preferences_short']) assert.ok(/linked helper machine/i.test(texts[k]), `${k} does not name the machine`);
  assert.ok(/tools first/i.test(T.memory_pointer), 'the memory pointer must say "tools first"');
});
check('house style: no em or en dashes anywhere a client will read', () => {
  for (const [k, v] of Object.entries({ ...texts, opener: T.opener, canary: T.canary.phrase })) {
    assert.ok(!/[–—]/.test(v), `${k} contains an em/en dash`);
  }
});
check('the canary marker is the first line Claude.ai prints when tools were loaded', () => {
  assert.strictEqual(T.canary.first_line, 'Loaded tools');
  assert.strictEqual(T.canary.bad_first_line, 'Recalled memory');
});

console.log('\n2. the canary and the opener are registered client phrases');
const { phrases } = loadPhrases();
check(`canary "${T.canary.phrase}" is registered and routes to wingguy_learn`, () => {
  const hit = phrases.find((p) => normalise(p.phrase) === normalise(T.canary.phrase));
  assert.ok(hit, 'not in content/client-phrases.json - add it there first');
  assert.strictEqual(hit.tool, 'wingguy_learn');
  assert.ok(hit.topic, 'the canary must serve a playbook topic, not the tour');
});
check(`opener "${T.opener}" is registered as the tour status phrase`, () => {
  const hit = phrases.find((p) => normalise(p.phrase) === normalise(T.opener));
  assert.ok(hit, 'not in content/client-phrases.json');
  assert.strictEqual(hit.tour, 'status', 'the opener has to be a phrase only the server can answer');
});

console.log('\n3. every doc the file names still carries the text verbatim');
for (const [key, docs] of Object.entries(T.where || {})) {
  for (const rel of docs) {
    check(`${key} in ${rel}`, () => {
      const abs = path.join(ROOT, rel);
      assert.ok(fs.existsSync(abs), `${rel} does not exist`);
      assert.ok(flat(fs.readFileSync(abs, 'utf8')).includes(flat(texts[key])), `${rel} no longer carries ${key} word for word - edit content/wingguy-first.json first, then bring the doc into line`);
    });
  }
}
check('the connector install message and the checklist both carry the canary phrase and the opener', () => {
  for (const rel of ['docs/wingguy-connector-install.md', 'docs/wingguy-onboarding-checklist.md']) {
    const doc = flat(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.ok(doc.includes(flat(T.canary.phrase)), `${rel} lacks the canary phrase`);
    assert.ok(doc.includes(flat(T.canary.first_line)), `${rel} lacks the "${T.canary.first_line}" marker`);
    assert.ok(doc.includes(flat(T.opener)), `${rel} lacks the opener habit`);
  }
});

console.log('\n4. the concierge run sheet mints the texts, it does not copy them');
const conciergeMd = fs.readFileSync(path.join(ROOT, 'docs', 'concierge-run-sheet.md'), 'utf8');
const steps = rs.parseConciergeDoc(conciergeMd);
const step = steps.find((s) => s.link === 'wingguy-first');
check('there is exactly one Wingguy-first step and it follows the connector step', () => {
  assert.strictEqual(steps.filter((s) => s.link === 'wingguy-first').length, 1);
  const connector = steps.find((s) => s.link === 'connector');
  assert.strictEqual(step.n, connector.n + 1, `connector is step ${connector.n}, Wingguy first is step ${step.n}`);
});
check('the step\'s worked-when names the first line, and its do-list names the opener habit', () => {
  assert.ok(step.check.includes(T.canary.first_line), 'worked-when must say what the first line reads');
  assert.ok(step.check.includes(T.canary.bad_first_line), 'worked-when must say what the failure looks like');
  assert.ok(step.dos.some((d) => flat(d).includes(flat(T.opener))), 'no do-line teaches the opener habit');
});
check('the doc carries none of the texts itself - they come from the JSON at mint time', () => {
  const doc = flat(conciergeMd);
  for (const [k, v] of Object.entries(texts)) assert.ok(!doc.includes(flat(v)), `${k} is copied into the run sheet doc - remove it, the page mints it`);
});
check('the rendered page carries all four texts, each with its own Copy button', () => {
  const detail = { clientId: 'T', clientName: 'Test Client', links: { connectorUrl: 'https://x/mcp2/TOK' }, setup: {}, preflight: { steps: [] } };
  const html = rs.renderRunSheet(rs.buildData({ mode: 'concierge', detail, steps, docText: conciergeMd }));
  const rows = wf.runSheetRows();
  assert.deepStrictEqual(rows.map((r) => r.key), ['preferences', 'preferences_short', 'memory_pointer', 'canary'], 'rows in the order they are done');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  for (const r of rows) {
    assert.ok(html.includes(esc(r.text)), `${r.key} text missing from the page`);
    assert.ok(html.includes(`data-copy="wingguy-first-${r.key}"`), `${r.key} has no Copy button`);
  }
  assert.ok(html.includes(esc(T.canary.first_line)), 'the page tells Guy what the first line must read');
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
