// The setup-page helper's reply reader (utils/setupAssistJson). Matthew Bulat, 2026-09-28: his
// "never go around the person I'm talking to" instruction came back from the model with more than one
// JSON object in the reply, the old first-{-to-last-} reader choked ("Unexpected non-whitespace
// character after JSON"), and the page said "That did not work". Run: node tests/wingguy-setup-assist-json.test.js

const assert = require('assert');
const { extractFirstJsonObject } = require('../utils/setupAssistJson');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const add = { ruleKey: 'never-go-around-the-contact', context: 'global', ruleType: 'stage-logic', explanation: 'x', body: 'If you are talking with a Director, never suggest contacting their staff.' };

console.log('extractFirstJsonObject');
check('a clean object', () => assert.deepStrictEqual(extractFirstJsonObject(JSON.stringify(add)), add));
check('prose around it', () => assert.deepStrictEqual(extractFirstJsonObject(`Here you go:\n${JSON.stringify(add)}\nHope that helps.`), add));
check('a code fence', () => assert.deepStrictEqual(extractFirstJsonObject('```json\n' + JSON.stringify(add) + '\n```'), add));
check('TWO objects - the first wins (the 28 Sep crash)', () => {
  const two = `${JSON.stringify(add)}\n${JSON.stringify({ overlapKey: 'x', why: 'y' })}`;
  assert.throws(() => JSON.parse(two.slice(two.indexOf('{'), two.lastIndexOf('}') + 1)), /after JSON/);
  assert.deepStrictEqual(extractFirstJsonObject(two), add);
});
check('a trailing note with a brace in it', () => assert.deepStrictEqual(extractFirstJsonObject(`${JSON.stringify(add)}\n(I kept {{signoff}} out of it.)`), add));
check('braces and quotes INSIDE strings do not confuse it', () => {
  const o = { explanation: 'Uses {{owner_first_name}} and "quotes" and a } brace', body: 'b' };
  assert.deepStrictEqual(extractFirstJsonObject(JSON.stringify(o)), o);
});
check('a stray brace in prose BEFORE the object is skipped', () => assert.deepStrictEqual(extractFirstJsonObject(`Note {not json} first. ${JSON.stringify(add)}`), add));
check('nested objects come back whole', () => {
  const o = { a: { b: { c: 1 } }, d: [1, { e: 2 }] };
  assert.deepStrictEqual(extractFirstJsonObject(`x ${JSON.stringify(o)} y`), o);
});
check('no JSON at all -> the usual error', () => assert.throws(() => extractFirstJsonObject('sorry, I cannot'), /did not return usable JSON/));
check('truncated JSON -> the usual error', () => assert.throws(() => extractFirstJsonObject('{"ruleKey": "a", "body": "cut off'), /did not return usable JSON/));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
