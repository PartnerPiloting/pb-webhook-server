/**
 * Tests for variable DEFAULTS - the fallbacks that make "leave it blank" genuinely safe.
 *
 * The line this pins: a setting with an obvious answer (30 minutes, a 9am floor) must never reach
 * the model as a literal {{placeholder}}, and a setting only the client can supply (their name,
 * their timezone) must STILL render loudly when unset. Getting that backwards either ships broken
 * prompts or silently invents facts about a person.
 *
 * Run: node tests/wingguy-variable-defaults.test.js
 */
const assert = require('assert');
const store = require('../services/wingguyRulesStore');
const { defaultFor, DEFAULTED_KEYS } = require('../config/wingguyVariableDefaults');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

console.log('\nvariable defaults');

check('a defaulted variable resolves instead of leaking braces', () => {
  const r = store.resolveRuleBody('Meetings run {{default_meeting_length}}.', {});
  assert.strictEqual(r.text, 'Meetings run 30 minutes.');
  assert.deepStrictEqual(r.unresolved, []);
});

check('the tenant\'s own value always wins over the default', () => {
  const r = store.resolveRuleBody('Meetings run {{default_meeting_length}}.', { default_meeting_length: '45 minutes' });
  assert.strictEqual(r.text, 'Meetings run 45 minutes.');
});

check('a variable with NO safe default still renders loudly', () => {
  // Nobody can guess someone's name or timezone - braces are the correct, visible signal.
  ['owner_first_name', 'timezone'].forEach((k) => {
    const r = store.resolveRuleBody(`x {{${k}}} y`, {});
    assert.ok(r.text.includes(`{{${k}}}`), `${k} should stay literal`);
    assert.deepStrictEqual(r.unresolved, [k]);
  });
});

check('sign-off borrows their first name when unset', () => {
  const r = store.resolveRuleBody('Sign off as {{signoff}}.', { owner_first_name: 'Sam' });
  assert.strictEqual(r.text, 'Sign off as Sam.');
  assert.deepStrictEqual(r.unresolved, []);
});

check('sign-off with nothing to borrow from stays loud', () => {
  // An alias is only as good as its source: no first name either means we genuinely do not know.
  const r = store.resolveRuleBody('Sign off as {{signoff}}.', {});
  assert.strictEqual(r.text, 'Sign off as {{signoff}}.');
  assert.deepStrictEqual(r.unresolved, ['signoff']);
});

check('an alias never chains', () => {
  // owner_first_name has no default of its own, so signoff must not resolve through two hops.
  assert.strictEqual(defaultFor('signoff', {}), undefined);
  assert.strictEqual(defaultFor('signoff', { owner_first_name: 'Sam' }), 'Sam');
});

check('assets are unaffected - a missing link is still a missing link', () => {
  const r = store.resolveRuleBody('Room: {{asset:zoom_room}}', {}, {});
  assert.ok(r.text.includes('{{asset:zoom_room}}'));
  assert.deepStrictEqual(r.unresolved, ['asset:zoom_room']);
});

check('optional placeholders are untouched by defaults', () => {
  // {{?key}} still drops its line when unset, even for a key that HAS a default.
  const r = store.resolveRuleBody('a\nNever: {{?never_say_words}}\nb', {});
  assert.strictEqual(r.text, 'a\nb');
});

check('every defaulted key produces a non-empty string', () => {
  DEFAULTED_KEYS.forEach((k) => {
    const v = defaultFor(k, { owner_first_name: 'Sam' });
    assert.ok(v && String(v).trim().length, `${k}: default resolved to nothing`);
  });
});

check('the booking sentence reads naturally with every fallback in place', () => {
  // The defaults exist to be substituted into real wording - a default that reads as gibberish in
  // the sentence it lands in is worse than the braces it replaced.
  const body = 'Length: {{default_meeting_length}} unless specified. Offer from {{preferred_start_time}} or later; '
    + '{{earliest_meeting_time}} is the floor. {{max_meetings_per_day}} a day is the preferred load. '
    + 'Close: worth a quick {{call_platform}}?';
  const r = store.resolveRuleBody(body, {});
  assert.deepStrictEqual(r.unresolved, []);
  assert.strictEqual(
    r.text,
    'Length: 30 minutes unless specified. Offer from 9:00am or later; 9:00am is the floor. '
    + '4 a day is the preferred load. Close: worth a quick call?',
  );
});

console.log(failures ? `\n${failures} failure(s)\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
