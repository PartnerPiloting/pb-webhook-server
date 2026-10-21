// tests/scoring-provider.test.js
// The scoring-model seam (config/scoringProvider.js): provider switch, Claude call shape, the
// Gemini-shaped response bundle, transient-error classification and the attribute-level rescale.
// No network: the Claude client is a fake. Run: node tests/scoring-provider.test.js
'use strict';
const assert = require('assert');

process.env.SCORING_PROVIDER = '';
delete process.env.SCORING_CLAUDE_SCALE;
delete process.env.SCORING_CLAUDE_OFFSET;
delete process.env.SCORING_CLAUDE_MODEL_ID;
delete process.env.SCORING_CLAUDE_MAX_TOKENS;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-never-used';

const sp = require('../config/scoringProvider');

let passed = 0;
function test(name, fn) {
    return Promise.resolve().then(fn).then(() => { passed++; console.log(`ok - ${name}`); }, (e) => { console.error(`FAIL - ${name}\n  ${e.stack || e}`); process.exitCode = 1; });
}

(async () => {
    await test('default provider is gemini; only the exact word claude switches', () => {
        delete process.env.SCORING_PROVIDER;
        assert.strictEqual(sp.scoringProvider(), 'gemini');
        assert.strictEqual(sp.isClaudeScoring(), false);
        assert.strictEqual(sp.scoringProviderLabel(), 'Gemini');
        process.env.SCORING_PROVIDER = 'anthropic';
        assert.strictEqual(sp.scoringProvider(), 'gemini');
        process.env.SCORING_PROVIDER = ' Claude ';
        assert.strictEqual(sp.scoringProvider(), 'claude');
        assert.strictEqual(sp.scoringProviderLabel(), 'Claude');
        process.env.SCORING_PROVIDER = 'gemini';
    });

    await test('defaults: model claude-haiku-5-5, scale 1.5, offset 0, 32000 tokens, effort low', () => {
        assert.strictEqual(sp.claudeScoringModelId(), 'claude-haiku-5-5');
        assert.strictEqual(sp.claudeScale(), 1.5);
        assert.strictEqual(sp.claudeOffset(), 0);
        assert.strictEqual(sp.claudeMaxTokens(), 32000);
        assert.strictEqual(sp.claudeEffort(), 'low');
        process.env.SCORING_CLAUDE_SCALE = 'abc';
        assert.strictEqual(sp.claudeScale(), 1.5, 'garbage scale falls back');
        process.env.SCORING_CLAUDE_SCALE = '-2';
        assert.strictEqual(sp.claudeScale(), 1.5, 'non-positive scale falls back');
        process.env.SCORING_CLAUDE_SCALE = '1.6';
        assert.strictEqual(sp.claudeScale(), 1.6);
        delete process.env.SCORING_CLAUDE_SCALE;
    });

    await test('describeScoringProvider reports what is in force', () => {
        process.env.SCORING_PROVIDER = 'gemini';
        assert.deepStrictEqual(sp.describeScoringProvider('gemini-3.5-flash'), { provider: 'gemini', modelId: 'gemini-3.5-flash' });
        process.env.SCORING_PROVIDER = 'claude';
        const d = sp.describeScoringProvider('gemini-3.5-flash');
        assert.strictEqual(d.provider, 'claude');
        assert.strictEqual(d.modelId, 'claude-haiku-5-5');
        assert.strictEqual(d.scale, 1.5);
        process.env.SCORING_PROVIDER = 'gemini';
    });

    await test('scaleClaudePositiveScores: x1.5, rounded, capped at maxPoints, floored at 0, non-numeric untouched', () => {
        const positives = { A: { maxPoints: 20 }, B: { maxPoints: 8 }, C: { max_points: 15 }, D: { max: '10' }, E: {} };
        const out = sp.scaleClaudePositiveScores({ A: 10, B: 6, C: 9, D: 7, E: 4, F: 3, G: null, H: 'n/a' }, positives);
        assert.deepStrictEqual(out, { A: 15, B: 8, C: 14, D: 10, E: 6, F: 5, G: null, H: 'n/a' });
        // 6 * 1.5 = 9 > 8 -> capped. 9 * 1.5 = 13.5 -> 14 (round). 7 * 1.5 = 10.5 -> 11 -> capped 10.
        // E has no max -> uncapped 6. F unknown attribute -> 4.5 -> 5 (rounded, not capped).
    });

    await test('scaleClaudePositiveScores honours explicit scale/offset and never goes negative', () => {
        const out = sp.scaleClaudePositiveScores({ A: 2, B: 0 }, { A: { maxPoints: 20 }, B: { maxPoints: 5 } }, { scale: 2, offset: -5 });
        assert.deepStrictEqual(out, { A: 0, B: 0 });
        const out2 = sp.scaleClaudePositiveScores({ A: 2 }, { A: { maxPoints: 20 } }, { scale: 1, offset: 3 });
        assert.deepStrictEqual(out2, { A: 5 });
        const src = { A: 4 };
        sp.scaleClaudePositiveScores(src, { A: { maxPoints: 20 } });
        assert.deepStrictEqual(src, { A: 4 }, 'pure: input not mutated');
    });

    await test('scale 1 and offset 0 is the identity on numbers', () => {
        const out = sp.scaleClaudePositiveScores({ A: 7, B: 0, C: 15 }, { A: { maxPoints: 20 }, C: { maxPoints: 15 } }, { scale: 1, offset: 0 });
        assert.deepStrictEqual(out, { A: 7, B: 0, C: 15 });
    });

    await test('finishReason mapping onto the Gemini vocabulary', () => {
        assert.strictEqual(sp.finishReasonFromStop('end_turn'), 'STOP');
        assert.strictEqual(sp.finishReasonFromStop('stop_sequence'), 'STOP');
        assert.strictEqual(sp.finishReasonFromStop('max_tokens'), 'MAX_TOKENS');
        assert.strictEqual(sp.finishReasonFromStop('refusal'), 'REFUSAL');
        assert.strictEqual(sp.finishReasonFromStop(null), null);
    });

    await test('callClaudeForScoring: same prompts + JSON-only suffix, no temperature, Gemini-shaped bundle', async () => {
        process.env.SCORING_PROVIDER = 'claude';
        let seen = null;
        const fake = { messages: { stream(params) { seen = params; return { finalMessage: async () => ({ content: [{ type: 'text', text: '[{"a":' }, { type: 'text', text: '1}]' }], stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 340 } }), abort() {} }; } } };
        const r = await sp.callClaudeForScoring({ systemPrompt: 'SYS', userPrompt: 'USER', timeoutMs: 5000, client: fake });
        assert.strictEqual(seen.model, 'claude-haiku-5-5');
        assert.strictEqual(seen.max_tokens, 32000);
        assert.strictEqual(seen.system, 'SYS');
        assert.deepStrictEqual(seen.output_config, { effort: 'low' });
        assert.strictEqual(seen.temperature, undefined, 'Haiku 5.5 rejects temperature');
        assert.strictEqual(seen.messages.length, 1);
        assert.strictEqual(seen.messages[0].role, 'user');
        assert.strictEqual(seen.messages[0].content, 'USER' + sp.JSON_ONLY_SUFFIX);
        assert.strictEqual(r.rawResponseText, '[{"a":1}]', 'text blocks joined');
        assert.deepStrictEqual(r.usageMetadata, { promptTokenCount: 1200, candidatesTokenCount: 340, totalTokenCount: 1540, provider: 'claude', modelId: 'claude-haiku-5-5' });
        assert.strictEqual(r.finishReason, 'STOP');
        process.env.SCORING_PROVIDER = 'gemini';
    });

    await test('callClaudeForScoring: the timeout aborts the stream and rejects', async () => {
        let aborted = false;
        const fake = { messages: { stream() { return { finalMessage: () => new Promise(() => {}), abort() { aborted = true; } }; } } };
        await assert.rejects(() => sp.callClaudeForScoring({ systemPrompt: 'S', userPrompt: 'U', timeoutMs: 30, client: fake }), /timeout/);
        assert.strictEqual(aborted, true);
    });

    await test('isRetryableClaudeError: 429/529/5xx/overloaded/network yes; 400/401/404 no', () => {
        assert.strictEqual(sp.isRetryableClaudeError({ status: 429, message: 'rate_limit' }), true);
        assert.strictEqual(sp.isRetryableClaudeError({ status: 529, message: 'overloaded' }), true);
        assert.strictEqual(sp.isRetryableClaudeError({ status: 503, message: 'x' }), true);
        assert.strictEqual(sp.isRetryableClaudeError({ type: 'overloaded_error', message: 'x' }), true);
        assert.strictEqual(sp.isRetryableClaudeError(new Error('Connection error: ECONNRESET')), true);
        assert.strictEqual(sp.isRetryableClaudeError(new Error('Claude API call timeout after 1ms (scoring)')), true);
        assert.strictEqual(sp.isRetryableClaudeError({ status: 400, message: 'invalid_request_error: temperature' }), false);
        assert.strictEqual(sp.isRetryableClaudeError({ status: 401, message: 'authentication_error' }), false);
        assert.strictEqual(sp.isRetryableClaudeError({ status: 404, message: 'not_found' }), false);
        assert.strictEqual(sp.isRetryableClaudeError(null), false);
    });

    console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
})();
