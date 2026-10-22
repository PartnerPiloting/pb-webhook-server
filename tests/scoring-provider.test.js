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

    await test('defaults: model claude-haiku-5-5, scale 1.45, offset 0, 32000 tokens, effort low', () => {
        assert.strictEqual(sp.claudeScoringModelId(), 'claude-haiku-5-5');
        assert.strictEqual(sp.claudeScale(), 1.45);
        assert.strictEqual(sp.claudeOffset(), 0);
        assert.strictEqual(sp.claudeMaxTokens(), 32000);
        assert.strictEqual(sp.claudeEffort(), 'low');
        process.env.SCORING_CLAUDE_SCALE = 'abc';
        assert.strictEqual(sp.claudeScale(), 1.45, 'garbage scale falls back');
        process.env.SCORING_CLAUDE_SCALE = '-2';
        assert.strictEqual(sp.claudeScale(), 1.45, 'non-positive scale falls back');
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
        assert.strictEqual(d.scale, 1.45);
        process.env.SCORING_PROVIDER = 'gemini';
    });

    await test('scaleClaudePositiveScores: x1.45, rounded, capped at maxPoints, floored at 0, non-numeric untouched', () => {
        const positives = { A: { maxPoints: 20 }, B: { maxPoints: 8 }, C: { max_points: 15 }, D: { max: '10' }, E: {} };
        const out = sp.scaleClaudePositiveScores({ A: 10, B: 6, C: 9, D: 7, E: 4, F: 3, G: null, H: 'n/a' }, positives);
        assert.deepStrictEqual(out, { A: 15, B: 8, C: 13, D: 10, E: 6, F: 4, G: null, H: 'n/a' });
        // 10 * 1.45 = 14.5 -> 15. 6 * 1.45 = 8.7 -> 9 > 8 -> capped. 9 * 1.45 = 13.05 -> 13. 7 * 1.45 = 10.15 -> 10.
        // E has no max -> 5.8 -> 6. F unknown attribute -> 4.35 -> 4 (rounded, not capped).
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

    const POS = { A: { maxPoints: 20 }, B: { maxPoints: 10 }, I: { maxPoints: 5 } };
    const NEG = { N1: { penalty: -5 }, N2: { penalty: -10 } };

    await test('claudeScoringOutputFormat: every attribute a required key, nothing optional or nullable', () => {
        const f = sp.claudeScoringOutputFormat(POS, NEG);
        assert.strictEqual(f.type, 'json_schema');
        assert.strictEqual(f.schema.type, 'object');
        const lead = f.schema.properties.leads.items;
        assert.deepStrictEqual(lead.required, Object.keys(lead.properties));
        assert.deepStrictEqual(lead.properties.positive_scores.required, ['A', 'B', 'I']);
        assert.deepStrictEqual(lead.properties.negative_scores.required, ['N1', 'N2']);
        assert.deepStrictEqual(lead.properties.attribute_reasoning.required, ['A', 'B', 'I', 'N1', 'N2']);
        assert.deepStrictEqual(lead.properties.unscored_attributes.items.enum, ['A', 'B', 'I', 'N1', 'N2']);
        assert.deepStrictEqual(lead.properties.ai_excluded.enum, ['Yes', 'No']);
        // The API's limits: 24 optional and 16 nullable properties per request. Count both.
        let optional = 0, nullable = 0;
        (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node.type) || node.anyOf) nullable++;
            if (node.properties) {
                assert.strictEqual(node.additionalProperties, false);
                optional += Object.keys(node.properties).filter(k => !(node.required || []).includes(k)).length;
                Object.values(node.properties).forEach(walk);
            }
            if (node.items) walk(node.items);
        })(f.schema);
        assert.strictEqual(optional, 0);
        assert.strictEqual(nullable, 0);
    });

    await test('normaliseClaudeScoringText: unwraps leads, drops unscored keys and empty reasons, fixes Yes/No case', () => {
        const raw = JSON.stringify({ leads: [{
            positive_scores: { A: 12, B: 0, I: 0 }, negative_scores: { N1: 0, N2: -10 },
            attribute_reasoning: { A: 'Strong fit', B: '', I: '', N1: 'None seen', N2: 'Competitor' },
            contact_readiness: false, unscored_attributes: ['B', 'I'],
            aiProfileAssessment: 'ok', ai_excluded: 'yes', exclude_details: 'x',
        }] });
        const out = JSON.parse(sp.normaliseClaudeScoringText(raw));
        assert.ok(Array.isArray(out) && out.length === 1);
        assert.deepStrictEqual(out[0].positive_scores, { A: 12 });
        assert.deepStrictEqual(out[0].negative_scores, { N1: 0, N2: -10 });
        assert.deepStrictEqual(out[0].attribute_reasoning, { A: 'Strong fit', N1: 'None seen', N2: 'Competitor' });
        assert.strictEqual(out[0].ai_excluded, 'Yes');
    });

    await test('normaliseClaudeScoringText: text that does not parse comes back unchanged', () => {
        assert.strictEqual(sp.normaliseClaudeScoringText('{"leads": [{"a": 1'), '{"leads": [{"a": 1');
    });

    await test('callClaudeForScoring with attributes: schema enforced, structured suffix, bare array back', async () => {
        process.env.SCORING_PROVIDER = 'claude';
        let seen = null;
        const answer = JSON.stringify({ leads: [{ positive_scores: { A: 5, B: 0, I: 0 }, negative_scores: { N1: 0, N2: 0 }, attribute_reasoning: { A: 'r', B: '', I: '', N1: '', N2: '' }, contact_readiness: false, unscored_attributes: ['B'], aiProfileAssessment: 'a', ai_excluded: 'No', exclude_details: '' }] });
        const fake = { messages: { stream(params) { seen = params; return { finalMessage: async () => ({ content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), abort() {} }; } } };
        const r = await sp.callClaudeForScoring({ systemPrompt: 'S', userPrompt: 'U', timeoutMs: 5000, client: fake, positives: POS, negatives: NEG });
        assert.strictEqual(seen.output_config.effort, 'low');
        assert.deepStrictEqual(seen.output_config.format, sp.claudeScoringOutputFormat(POS, NEG));
        assert.ok(seen.messages[0].content.startsWith('U') && seen.messages[0].content.includes('unscored_attributes'));
        const out = JSON.parse(r.rawResponseText);
        assert.ok(Array.isArray(out));
        assert.deepStrictEqual(out[0].positive_scores, { A: 5, I: 0 });

        process.env.SCORING_CLAUDE_STRUCTURED = 'off';
        await sp.callClaudeForScoring({ systemPrompt: 'S', userPrompt: 'U', timeoutMs: 5000, client: fake, positives: POS, negatives: NEG });
        assert.deepStrictEqual(seen.output_config, { effort: 'low' }, 'off = rollback to prompt-only JSON');
        assert.strictEqual(seen.messages[0].content, 'U' + sp.JSON_ONLY_SUFFIX);
        delete process.env.SCORING_CLAUDE_STRUCTURED;
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
