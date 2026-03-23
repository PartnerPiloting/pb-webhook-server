/**
 * Unit tests for OES JSON extraction and score normalization (no Vertex calls).
 */
const assert = require('assert');
const { extractJsonObject, normalizeScorePayload } = require('../services/outboundEmailScoreService');

function test(name, fn) {
  try {
    fn();
    console.log('OK', name);
  } catch (e) {
    console.error('FAIL', name, e.message);
    process.exitCode = 1;
  }
}

test('normalize uses score when string (bugfix)', () => {
  const n = normalizeScorePayload({ score: '7', classification: 'Medium' });
  assert.strictEqual(n.zoom_readiness_score, 7);
});

test('normalize zoom_readiness_score string', () => {
  const n = normalizeScorePayload({ zoom_readiness_score: '9', score_breakdown: {}, classification: 'x' });
  assert.strictEqual(n.zoom_readiness_score, 9);
});

test('normalize rejects array', () => {
  assert.strictEqual(normalizeScorePayload([{ score: 1 }]), null);
});

test('normalize clamps', () => {
  assert.strictEqual(normalizeScorePayload({ zoom_readiness_score: 99 }).zoom_readiness_score, 10);
  assert.strictEqual(normalizeScorePayload({ zoom_readiness_score: -3 }).zoom_readiness_score, 0);
});

test('extract strips fences and finds object', () => {
  const raw = 'Here you go:\n```json\n{"zoom_readiness_score":5,"score_breakdown":{},"classification":"Medium"}\n```';
  const o = extractJsonObject(raw);
  assert.strictEqual(o.zoom_readiness_score, 5);
});

test('extract anchors on zoom_readiness_score key', () => {
  const raw = 'Note: use {not json} for x.\n{"zoom_readiness_score":3,"score_breakdown":{},"classification":"Low Priority"}';
  const o = extractJsonObject(raw);
  assert.strictEqual(o.zoom_readiness_score, 3);
});

test('extract unwraps single-element array', () => {
  const raw = '[{"zoom_readiness_score":4,"score_breakdown":{},"classification":"Medium"}]';
  const o = extractJsonObject(raw);
  assert.strictEqual(o.zoom_readiness_score, 4);
});
