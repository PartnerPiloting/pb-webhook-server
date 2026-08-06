/**
 * Tests for OPTIONAL placeholders — `{{?key}}` — in rule bodies.
 *
 * Why this exists: a normal `{{key}}` with no value is left in the text on purpose (a rule about
 * the coach's sign-off IS broken without one, and the literal braces are the loud signal). That
 * behaviour is wrong for a setting most people leave blank — the braces would then be sent to the
 * model in every message. `{{?key}}` drops its whole line instead.
 *
 * The blast radius is every rule that renders, so the required-variable behaviour is pinned here
 * too: if a change to the optional path ever starts swallowing REQUIRED placeholders, that is a
 * silent prompt regression and these catch it.
 *
 * Run: node tests/wingguy-optional-placeholders.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { resolveRuleBody } = store;

console.log('\noptional placeholders');

check('a set optional resolves like any other variable', () => {
  const r = resolveRuleBody('Never use: {{?never_say_words}}', { never_say_words: 'reach out, folks' });
  assert.strictEqual(r.text, 'Never use: reach out, folks');
  assert.deepStrictEqual(r.unresolved, []);
});

check('an unset optional drops its whole line', () => {
  const body = 'Write plainly.\nNever use: {{?never_say_words}}\nKeep it short.';
  const r = resolveRuleBody(body, {});
  assert.strictEqual(r.text, 'Write plainly.\nKeep it short.');
});

check('an EMPTY optional drops its line too (cleared, not just unset)', () => {
  const r = resolveRuleBody('Never use: {{?never_say_words}}', { never_say_words: '   ' });
  assert.strictEqual(r.text, '');
});

check('an unset optional is NOT reported as unresolved', () => {
  // The hygiene sweep reads `unresolved`. An unanswered optional is not a housekeeping problem,
  // and reporting it would nag every client about a box they deliberately left blank.
  const r = resolveRuleBody('Never use: {{?never_say_words}}', {});
  assert.deepStrictEqual(r.unresolved, []);
});

check('a rule that is ONLY an optional line resolves to empty, so it falls out of the block', () => {
  const r = resolveRuleBody('Never use: {{?never_say_words}}', {});
  assert.strictEqual(r.text.trim(), '');
});

check('REQUIRED placeholders are untouched: still literal, still reported', () => {
  const r = resolveRuleBody('Sign off as {{signoff}}.', {});
  assert.strictEqual(r.text, 'Sign off as {{signoff}}.');
  assert.deepStrictEqual(r.unresolved, ['signoff']);
});

check('a line mixing required and optional keeps required behaviour when the optional is set', () => {
  const r = resolveRuleBody('{{owner_first_name}} never says {{?never_say_words}}', {
    owner_first_name: 'Guy', never_say_words: 'folks',
  });
  assert.strictEqual(r.text, 'Guy never says folks');
  assert.deepStrictEqual(r.unresolved, []);
});

check('a line is dropped on an empty optional even if it also carries a set required var', () => {
  // The line was written to carry the optional; without it the sentence is nonsense.
  const r = resolveRuleBody('{{owner_first_name}} never says {{?never_say_words}}', { owner_first_name: 'Guy' });
  assert.strictEqual(r.text, '');
  assert.deepStrictEqual(r.unresolved, []);
});

check('two optionals on one line: both must be set for the line to survive', () => {
  const both = resolveRuleBody('{{?a}} and {{?b}}', { a: 'x', b: 'y' });
  assert.strictEqual(both.text, 'x and y');
  const one = resolveRuleBody('{{?a}} and {{?b}}', { a: 'x' });
  assert.strictEqual(one.text, '');
});

check('bodies with no optional syntax are byte-identical to before', () => {
  // The fast path must not touch ordinary rules — this is the whole rulebook's rendering.
  const body = 'Always end with a question.\n\nUse {{asset:zoom_room}} for every invite.\n- {{signoff}}';
  const vars = { signoff: 'Cheers, Guy' };
  const assets = { zoom_room: { url: 'https://zoom.example/1', status: 'active' } };
  const r = resolveRuleBody(body, vars, assets);
  assert.strictEqual(
    r.text,
    'Always end with a question.\n\nUse https://zoom.example/1 for every invite.\n- Cheers, Guy',
  );
  assert.deepStrictEqual(r.unresolved, []);
});

check('assets are unaffected by the optional pass', () => {
  const r = resolveRuleBody('Room: {{asset:zoom_room}}\nNever: {{?never_say_words}}', {}, {});
  assert.strictEqual(r.text, 'Room: {{asset:zoom_room}}');
  assert.deepStrictEqual(r.unresolved, ['asset:zoom_room']);
});

check('an optional ASSET drops its line when the link is not set', () => {
  // Links are as legitimately optional as variables - a client with no explainer link should get
  // no instruction about one, not a literal {{?asset:...}} in their prompt.
  const r = resolveRuleBody('Use it:\nFallback: {{?asset:default_explainer}}', {}, {});
  assert.strictEqual(r.text, 'Use it:');
  assert.deepStrictEqual(r.unresolved, []);
});

check('an optional ASSET resolves to the URL when set', () => {
  const r = resolveRuleBody('Fallback: {{?asset:default_explainer}}', {}, {
    default_explainer: { url: 'https://example.com/x', status: 'active' },
  });
  assert.strictEqual(r.text, 'Fallback: https://example.com/x');
  assert.deepStrictEqual(r.unresolved, []);
});

check('a RETIRED optional asset counts as unset', () => {
  const r = resolveRuleBody('Fallback: {{?asset:default_explainer}}', {}, {
    default_explainer: { url: 'https://example.com/x', status: 'retired' },
  });
  assert.strictEqual(r.text, '');
});

check('whitespace inside the braces is tolerated', () => {
  const r = resolveRuleBody('Never use: {{? never_say_words }}', { never_say_words: 'folks' });
  assert.strictEqual(r.text, 'Never use: folks');
});

console.log(failures ? `\n${failures} failure(s)\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
