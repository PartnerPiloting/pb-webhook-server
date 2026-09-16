/**
 * The em dash guard (2026-09-16, after roughly ten prose attempts).
 *
 * Guy's house style is a spaced hyphen " - ". An em dash is the loudest AI tell in Australian
 * business writing, and the rule had been written in prose everywhere prose can go - the rules
 * store, the writing-style docs, the drafting prompts, CLAUDE.md - and still lost to the model's
 * generation default, in real sends and in the /wg panel.
 *
 * So it stopped being an instruction. These tests pin the three things that now make it true:
 *   utils/houseDashes.js               - one definition of the rule, and only em/en are touched
 *   config/anthropicClient.js          - applied to EVERY model response, text and tool arguments
 *   wingguy-extension/content-wingguy.js - the last gate before text enters LinkedIn
 *
 * The tool-argument case is the one that matters most: a LinkedIn draft never arrives as reply
 * text, it arrives as a propose_message argument, which is exactly what the panel was showing Guy.
 *
 * Run: node tests/house-dashes.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { houseDashes, withHouseDashes, hasLongDash } = require('../utils/houseDashes');

let failures = 0;
const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); };
const check = (name, fn) => {
  try { fn(); pass(name); }
  catch (e) { fail(name, e); }
};
// Same contract, for a test that has to await something. Awaited in place, so the output stays in order.
const checkAsync = async (name, fn) => {
  try { await fn(); pass(name); }
  catch (e) { fail(name, e); }
};

const EM = '—';
const EN = '–';

console.log('houseDashes: the rule');

check('an em dash becomes a spaced hyphen', () => {
  assert.strictEqual(houseDashes(`Nothing formal ${EM} I like to keep these conversational.`),
    'Nothing formal - I like to keep these conversational.');
});

check('an en dash becomes a spaced hyphen', () => {
  assert.strictEqual(houseDashes(`Tue 22nd ${EN} 10am`), 'Tue 22nd - 10am');
});

check('spacing is normalised whichever way it was written', () => {
  for (const variant of [`a${EM}b`, `a ${EM} b`, `a ${EM}b`, `a${EM} b`, `a  ${EM}  b`]) {
    assert.strictEqual(houseDashes(variant), 'a - b', `failed on ${JSON.stringify(variant)}`);
  }
});

check('HTML entity forms are caught too (email bodies are HTML)', () => {
  assert.strictEqual(houseDashes('a &mdash; b &ndash; c &#8212; d &#x2014; e'), 'a - b - c - d - e');
});

check('ordinary hyphens are left alone - compounds, URLs, ISO dates', () => {
  const safe = 'old-style 3-min pb-webhook-server https://example.com/a-b-c 2026-09-16 well-known';
  assert.strictEqual(houseDashes(safe), safe);
});

check('empty and missing input survive', () => {
  assert.strictEqual(houseDashes(''), '');
  assert.strictEqual(houseDashes(null), null);
  assert.strictEqual(houseDashes(undefined), undefined);
});

check('hasLongDash spots what the rule is meant to remove', () => {
  assert.strictEqual(hasLongDash(`a ${EM} b`), true);
  assert.strictEqual(hasLongDash('a &mdash; b'), true);
  assert.strictEqual(hasLongDash('a - b'), false);
  assert.strictEqual(hasLongDash('old-style'), false);
});

console.log('withHouseDashes: nested values');

check('sweeps strings inside objects and arrays', () => {
  const out = withHouseDashes({ intro: `Hi ${EM} quick one`, slots: [`Tue ${EN} 10am`], n: 3, ok: true });
  assert.strictEqual(out.intro, 'Hi - quick one');
  assert.strictEqual(out.slots[0], 'Tue - 10am');
  assert.strictEqual(out.n, 3);
  assert.strictEqual(out.ok, true);
});

check('returns the SAME object when nothing needed changing (no allocation)', () => {
  const input = { message: 'Thanks for connecting.', slots: ['2026-09-22T10:00:00+10:00'] };
  assert.strictEqual(withHouseDashes(input), input);
});

console.log('anthropicClient: every response is swept');

// houseDashesInResponse is pure and exported, so it can be checked without an API key or a client.
const { houseDashesInResponse } = require('../config/anthropicClient');

check('reply text to the coach is cleaned', () => {
  const out = houseDashesInResponse({ content: [{ type: 'text', text: `Here's the draft ${EM} sent as a reply.` }] });
  assert.strictEqual(out.content[0].text, "Here's the draft - sent as a reply.");
});

check('THE REGRESSION: a draft in a propose_message tool argument is cleaned', () => {
  // This is the Evan Kohilas draft from Guy's screenshot, 2026-09-16.
  const msg = {
    content: [{
      type: 'tool_use',
      name: 'propose_message',
      input: { message: `Hey Evan,\n\nNothing formal ${EM} I like to keep these conversational.` },
    }],
  };
  const out = houseDashesInResponse(msg);
  assert.strictEqual(out.content[0].input.message, 'Hey Evan,\n\nNothing formal - I like to keep these conversational.');
  assert.strictEqual(hasLongDash(out.content[0].input.message), false);
});

check('propose_times intro and outro are cleaned', () => {
  const out = houseDashesInResponse({
    content: [{ type: 'tool_use', name: 'propose_times', input: { intro: `A few times ${EM} pick one`, outro: `No rush ${EN} whenever suits`, slotTimes: ['2026-09-22T10:00:00+10:00'] } }],
  });
  assert.strictEqual(out.content[0].input.intro, 'A few times - pick one');
  assert.strictEqual(out.content[0].input.outro, 'No rush - whenever suits');
  assert.strictEqual(out.content[0].input.slotTimes[0], '2026-09-22T10:00:00+10:00', 'ISO times must not be touched');
});

check('a clean response is returned unchanged', () => {
  const msg = { content: [{ type: 'text', text: 'All good - nothing to do.' }] };
  assert.strictEqual(houseDashesInResponse(msg), msg);
});

check('odd shapes do not throw', () => {
  assert.doesNotThrow(() => houseDashesInResponse(null));
  assert.doesNotThrow(() => houseDashesInResponse({}));
  assert.doesNotThrow(() => houseDashesInResponse({ content: [null, 'x', { type: 'tool_use' }] }));
});

console.log('end to end, through a real SDK client');

const { getAnthropicClientForKey } = require('../config/anthropicClient');

(async () => {

await checkAsync('a draft coming back from the network is clean by the time the caller sees it', async () => {
  // Same trick as tests/lone-surrogate.test.js: stand in for the network on the SDK prototype BEFORE
  // building the client under test, because the wrapper binds the real method at construction.
  const proto = Object.getPrototypeOf(getAnthropicClientForKey('sk-ant-dash-probe-a').messages);
  const realCreate = proto.create;
  proto.create = function () {
    return Promise.resolve({
      content: [
        { type: 'text', text: `Here's the draft ${EM} sent as a reply.` },
        { type: 'tool_use', name: 'propose_message', input: { message: `Nothing formal ${EM} I like to keep these conversational.` } },
      ],
    });
  };
  let out;
  try {
    out = await getAnthropicClientForKey('sk-ant-dash-probe-b').messages.create({ model: 'x', messages: [] });
  } finally {
    proto.create = realCreate;
  }
  assert.strictEqual(hasLongDash(JSON.stringify(out)), false, 'an em dash survived the round trip');
  assert.strictEqual(out.content[1].input.message, 'Nothing formal - I like to keep these conversational.');
});

console.log('the seams still call it');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

check('the client wraps messages.create with the sweep', () => {
  const src = read('config', 'anthropicClient.js');
  assert.ok(/client\.messages\.create\s*=/.test(src), 'messages.create is no longer wrapped');
  assert.ok(src.includes('houseDashesInResponse'), 'the sweep is not applied to responses');
});

check('the mail draft path still normalises subject and body', () => {
  const src = read('services', 'wingguyMailMcp.js');
  assert.ok(src.includes('normaliseDashes(subject)'), 'subject no longer normalised');
  assert.ok(src.includes('normaliseDashes(html_body)'), 'body no longer normalised');
});

check('there is only ONE definition of the rule on the server', () => {
  // Two services had grown private copies, which is how the panel ended up with none.
  for (const f of [['services', 'wingguyMailMcp.js'], ['services', 'wingguyFollowupsAsk.js']]) {
    assert.ok(!/function normaliseDashes/.test(read(...f)), `${f.join('/')} has its own copy again`);
  }
});

check('the extension cleans on both exits: Insert and Copy', () => {
  const ext = read('wingguy-extension', 'content-wingguy.js');
  const insert = /async function insertIntoComposer[\s\S]{0,200}/.exec(ext);
  const copy = /async function copyDraft[\s\S]{0,200}/.exec(ext);
  assert.ok(insert && /houseDashes\(/.test(insert[0]), 'Insert into LinkedIn no longer cleans the text');
  assert.ok(copy && /houseDashes\(/.test(copy[0]), 'Copy no longer cleans the text');
});

check('the extension copy of the rule agrees with the server copy', () => {
  const ext = read('wingguy-extension', 'content-wingguy.js');
  const body = /function houseDashes\(s\)\s*\{([\s\S]*?)\n  \}/.exec(ext);
  assert.ok(body, 'the extension helper is gone');
  // Rebuild it from the file and run it, so the two cannot drift silently.
  // eslint-disable-next-line no-new-func
  const extHouseDashes = new Function('s', body[1]);
  for (const sample of [`a ${EM} b`, `Tue${EN}10am`, 'old-style 3-min', 'nothing to change']) {
    assert.strictEqual(extHouseDashes(sample), houseDashes(sample), `drifted on ${JSON.stringify(sample)}`);
  }
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

})();
