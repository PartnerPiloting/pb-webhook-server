/**
 * "How do I set up my Claude key?" asked of Wingguy Learning (services/wingguyGetStartedMcp.js).
 *
 * 13 Oct 2026: the playbook had no topic on the client's own Anthropic key - the steps lived only in
 * Guy's past emails, so a client asking Wingguy got "not covered". The topic YOUR CLAUDE KEY now
 * covers it; clients ask in their own words ("Anthropic", "API key"), so those must land too, and
 * the neighbouring "Claude" topic must not be stolen.
 *
 * Run: node tests/learn-claude-key.test.js
 */
const assert = require('assert');
const { loadPlaybook, findPlaybookTopic } = require('../services/wingguyGetStartedMcp');

const pb = loadPlaybook();
const topics = pb.topics || pb;
const titleFor = (q) => (findPlaybookTopic(topics, q) || {}).title || '(none)';
const KEY = /^YOUR CLAUDE KEY/;

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

for (const q of [
  'how do I set up my Claude key?',
  'Claude key',
  'Anthropic key',
  'how do I set up my Anthropic account?',
  'what is the anthropic console',
  'where do I get an API key',
]) {
  check(`"${q}" -> YOUR CLAUDE KEY`, () => assert.match(titleFor(q), KEY, titleFor(q)));
}

check('"finding my audience with Claude" still -> FINDING YOUR AUDIENCE', () =>
  assert.match(titleFor('finding my audience with Claude'), /^FINDING YOUR AUDIENCE/));

check('the topic links its one-page version', () => {
  const t = topics.find((x) => KEY.test(x.title));
  assert.ok(t, 'topic missing');
  assert.match(t.body, /https:\/\/knowaguy\.com\.au\/your-claude-key/);
});

check('no em or en dashes in the topic', () => {
  const t = topics.find((x) => KEY.test(x.title));
  assert.ok(!/[–—]/.test(t.title + t.body));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
