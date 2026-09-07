/**
 * Regression tests for the half-emoji guard (Roland Illyes' group thread, 2026-09-07).
 *
 * The bug: an emoji is TWO code units that only mean anything as a pair. The extension shortened
 * scraped text by counting characters — a recent post capped at 400, the page text at 6,000 — and
 * when the cut landed between the two halves it sent an orphan. Anthropic rejects the WHOLE request
 * with `400 ... "no low surrogate in string"` before Claude reads a word, so the panel could only
 * say "couldn't reach Wingguy", and the same thread failed identically on every retry (three
 * attempts, same character position each time).
 *
 * Two halves to the fix, both tested here:
 *   capText (content-wingguy.js)             — never cut a pair in the first place
 *   stripLoneSurrogates (config/anthropicClient.js) — drop any orphan that still gets through
 *
 * Run: node tests/lone-surrogate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// The thing Anthropic actually rejects: a surrogate with no partner. Scan for one directly rather
// than trusting either implementation to say so.
function hasLoneSurrogate(s) {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

const BULB = '\u{1F4A1}';        // 💡 — one emoji, two code units
const HIGH = '\uD83D';           // its first half, orphaned
const LOW = '\uDCA1';            // its second half, orphaned

// --- capText: the extension must not create an orphan ------------------------------------------
// Pulled straight out of the content script (an IIFE, so it cannot be required) — the same trick
// tests/wingguy-selector-store.test.js uses to check the extension against the server.
const extSrc = fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js'), 'utf8');
const capMatch = extSrc.match(/function capText\(t, max\) \{[\s\S]*?\n  \}/);
assert.ok(capMatch, 'capText not found in content-wingguy.js — did it get renamed?');
// eslint-disable-next-line no-eval
const capText = eval(`(${capMatch[0]})`);

console.log('capText — cut long text without splitting an emoji:');
check('short text is returned untouched', () => assert.strictEqual(capText('hello', 400), 'hello'));
check('a cut in plain text still cuts at the cap', () => assert.strictEqual(capText('abcdef', 3), 'abc'));
check('a cut THROUGH an emoji backs off instead of splitting it', () => {
  const out = capText(`ab${BULB}cd`, 3);        // index 2 = the emoji's first half
  assert.strictEqual(out, 'ab');
  assert.ok(!hasLoneSurrogate(out), 'left an orphaned half behind');
});
check('a cut just AFTER an emoji keeps the whole emoji', () => {
  const out = capText(`ab${BULB}cd`, 4);
  assert.strictEqual(out, `ab${BULB}`);
});
check('the live shape: a 400-cap landing mid-emoji (the Roland case)', () => {
  const post = 'x'.repeat(399) + BULB + ' and some more text after it';
  const out = capText(post, 400);
  assert.strictEqual(out.length, 399);
  assert.ok(!hasLoneSurrogate(out), 'a 400-char cap still produced half an emoji');
});
check('emoji-only text at the cap is kept whole', () => assert.strictEqual(capText(BULB, 2), BULB));
check('null/undefined are tolerated', () => {
  assert.strictEqual(capText(null, 10), '');
  assert.strictEqual(capText(undefined, 10), '');
});

// --- stripLoneSurrogates: the server drops any orphan that still arrives ------------------------
const { stripLoneSurrogates, withoutLoneSurrogates, getAnthropicClientForKey } = require('../config/anthropicClient');

console.log('\nstripLoneSurrogates — drop orphans, keep real emoji:');
check('a complete emoji survives untouched', () => assert.strictEqual(stripLoneSurrogates(`hi ${BULB} there`), `hi ${BULB} there`));
check('an orphaned first half is dropped', () => assert.strictEqual(stripLoneSurrogates(`hi ${HIGH} there`), 'hi  there'));
check('an orphaned second half is dropped', () => assert.strictEqual(stripLoneSurrogates(`hi ${LOW} there`), 'hi  there'));
check('an orphan at the very end is dropped (the truncation case)', () => {
  const out = stripLoneSurrogates(`a post that got cut ${HIGH}`);
  assert.ok(!hasLoneSurrogate(out), 'orphan survived');
});
check('two orphans in a row are BOTH dropped', () => assert.strictEqual(stripLoneSurrogates(`x${HIGH}${HIGH}y`), 'xy'));
check('a low then a high (reversed pair) — both dropped, neither is a pair', () => assert.strictEqual(stripLoneSurrogates(`x${LOW}${HIGH}y`), 'xy'));
check('an orphan next to a real emoji leaves the emoji alone', () => assert.strictEqual(stripLoneSurrogates(`${HIGH}${BULB}`), BULB));
check('plain text is returned unchanged', () => assert.strictEqual(stripLoneSurrogates('nothing to do here'), 'nothing to do here'));

console.log('\nwithoutLoneSurrogates — sweep a whole request payload:');
check('cleans strings nested in messages/content blocks', () => {
  const params = { system: 'ok', messages: [{ role: 'user', content: [{ type: 'text', text: `cut here ${HIGH}` }] }] };
  const out = withoutLoneSurrogates(params);
  assert.ok(!hasLoneSurrogate(JSON.stringify(out)), 'an orphan survived the sweep');
  assert.strictEqual(out.messages[0].content[0].text, 'cut here ');
});
check('a clean payload comes back as the SAME object (no needless copying)', () => {
  const params = { system: 'ok', messages: [{ role: 'user', content: `all fine ${BULB}` }] };
  assert.strictEqual(withoutLoneSurrogates(params), params);
});
check('numbers, booleans and nulls pass through', () => {
  const params = { max_tokens: 4096, stream: false, metadata: null };
  assert.deepStrictEqual(withoutLoneSurrogates(params), params);
});

console.log('\nthe guard is actually wired onto the SDK client:');
check('messages.create and messages.stream are wrapped at construction', () => {
  const client = getAnthropicClientForKey('sk-ant-test-not-a-real-key');
  assert.ok(Object.prototype.hasOwnProperty.call(client.messages, 'create'),
    'messages.create is not wrapped — the SDK shape may have changed');
  assert.ok(Object.prototype.hasOwnProperty.call(client.messages, 'stream'),
    'messages.stream is not wrapped — the SDK shape may have changed');
});
check('a wrapped create sweeps its params before the SDK sees them', () => {
  // The wrapper binds the real method at construction, so the stand-in has to be in place BEFORE the
  // client under test is built — hence a key nothing else has used (clients are cached by key).
  const proto = Object.getPrototypeOf(getAnthropicClientForKey('sk-ant-test-probe-a').messages);
  const realCreate = proto.create;
  let seen = null;
  proto.create = function (p) { seen = p; return Promise.resolve({}); };   // stand in for the network call
  try {
    getAnthropicClientForKey('sk-ant-test-probe-b')
      .messages.create({ model: 'x', messages: [{ role: 'user', content: `oops ${HIGH}` }] });
  } finally {
    proto.create = realCreate;
  }
  assert.ok(seen, 'the wrapper did not call through');
  assert.ok(!hasLoneSurrogate(JSON.stringify(seen)), 'an orphan reached the SDK');
});

console.log(failures ? `\n${failures} test(s) FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
