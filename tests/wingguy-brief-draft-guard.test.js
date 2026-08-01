/**
 * Tests for the brief's offline-draft guards (services/wingguyFollowupBrief.js), from the
 * 2026-08-01 Farhad Malegam draft: (1) a draft offering clock times must be retried once and then
 * WITHHELD, never served (the model invented "Tue, 16 June, 10:00 am" in August); (2) draftText
 * must keep its paragraph breaks (htmlToText, not whitespace-collapse) so the draft page and a
 * LinkedIn paste read like the /wg panel's output.
 *
 * writeDraft is exercised with a scripted fake Anthropic client — no network. ⚠ Synthetic only.
 *
 * Run: node tests/wingguy-brief-draft-guard.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { writeDraft, draftPlainText } = require('../services/wingguyFollowupBrief');

// Fake Anthropic client that serves a scripted sequence of text responses and records calls.
function fakeClient(texts) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(req);
        const text = texts[Math.min(calls.length - 1, texts.length - 1)];
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

const item = { lead: { first: 'Farhad', last: 'Malegam' } };
const ctx = { transcript: ['LINKEDIN: 31-05-26 10:15 PM - Farhad Malegam - Sure mate. I could make the 2nd week of june work'] };

const TIMES_DRAFT = '<p>Hi Farhad, would any of these work: Tue, 16 June, 10:00 am / Wed, 17 June, 2:00 pm?</p>';
const CLEAN_DRAFT = '<p>Hi Farhad, following up on this - looks like we never landed on a time back in June.</p><p>Keen to still make it happen - what does your week look like? I\'ll fire over a calendar invite with the Zoom link.</p><p>Talk Soon, (I know a) Guy</p>';

(async () => {
  console.log('writeDraft() clock-time guard');
  await check('clean draft passes first time (one call), "back in June" is not a clock time', async () => {
    const c = fakeClient([CLEAN_DRAFT]);
    const out = await writeDraft(c, 'RULES', item, ctx, 'Reply appropriately.', 'Australia/Brisbane');
    assert.strictEqual(c.calls.length, 1);
    assert.ok(out.includes('back in June'));
  });
  await check('a times-offering draft triggers ONE strict retry, clean retry is served', async () => {
    const c = fakeClient([TIMES_DRAFT, CLEAN_DRAFT]);
    const out = await writeDraft(c, 'RULES', item, ctx, 'Reply appropriately.', 'Australia/Brisbane');
    assert.strictEqual(c.calls.length, 2);
    assert.ok(/STRICT: your previous draft offered specific meeting times/.test(JSON.stringify(c.calls[1].messages)));
    assert.ok(!/10:00 am/.test(out));
  });
  await check('retry note rides the user message — system blocks identical across attempts (cache-safe)', async () => {
    const c = fakeClient([TIMES_DRAFT, CLEAN_DRAFT]);
    await writeDraft(c, 'RULES', item, ctx, 'Reply appropriately.', 'Australia/Brisbane');
    assert.deepStrictEqual(c.calls[0].system, c.calls[1].system);
  });
  await check('still offering times after the retry → draft WITHHELD (throws, becomes draftError)', async () => {
    const c = fakeClient([TIMES_DRAFT, TIMES_DRAFT]);
    await assert.rejects(
      () => writeDraft(c, 'RULES', item, ctx, 'Reply appropriately.', 'Australia/Brisbane'),
      /withheld/i,
    );
    assert.strictEqual(c.calls.length, 2);
  });

  console.log('draftText spacing (draftPlainText, not whitespace-collapse)');
  await check('paragraph breaks survive into the paste-ready text as blank lines', () => {
    const t = draftPlainText(CLEAN_DRAFT);
    assert.ok(t.includes('\n\n'), 'expected blank lines between paragraphs');
    assert.ok(t.startsWith('Hi Farhad'));
    assert.ok(t.endsWith('(I know a) Guy'));
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
