/**
 * Unit tests for rule-based OES (no Vertex).
 */
const assert = require('assert');
const { scoreRawProfileForOesRules } = require('../services/oesRuleScorer');

function test(name, fn) {
  try {
    fn();
    console.log('OK', name);
  } catch (e) {
    console.error('FAIL', name, e.message);
    process.exitCode = 1;
  }
}

test('empty fails', () => {
  assert.strictEqual(scoreRawProfileForOesRules('').ok, false);
});

test('advisor headline scores', () => {
  const r = scoreRawProfileForOesRules(
    JSON.stringify({
      headline: 'Independent advisor | helping organisations navigate change',
      summary: 'I believe in collaboration and partnerships across the ecosystem.',
    })
  );
  assert.strictEqual(r.ok, true);
  assert.ok(r.score >= 5);
  assert.ok(r.breakdown.inflection >= 3);
});

test('plain IC engineer penalty', () => {
  const r = scoreRawProfileForOesRules(
    JSON.stringify({
      headline: 'Software Engineer',
      summary: 'Building APIs and microservices.',
    })
  );
  assert.strictEqual(r.ok, true);
  assert.ok(r.score <= 6);
});
