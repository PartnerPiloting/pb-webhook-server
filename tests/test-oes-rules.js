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
      summary:
        'I believe in collaboration and partnerships across the ecosystem. Focused on AI and digital transformation.',
    })
  );
  assert.strictEqual(r.ok, true);
  assert.ok(r.score >= 5);
  assert.ok(r.breakdown.inflection >= 3);
  assert.ok(r.breakdown.future_awareness >= 1);
});

test('no future tech applies raw penalty when future_awareness is 0', () => {
  const r = scoreRawProfileForOesRules(
    JSON.stringify({
      headline: 'Director of Operations',
      summary: 'Leading teams and stakeholder engagement. Operational excellence.',
    })
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.breakdown.future_awareness, 0);
  assert.strictEqual(r.breakdown.no_future_tech_penalty_raw, -4);
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
