/**
 * Tests for the Follow-Ups Ask box (services/wingguyFollowupsAsk.js, Guy 2026-09-11).
 * Contracts:
 *   1. The stored story rides into the system prompt as ground truth; a question the story
 *      answers makes NO tool call and reports source "story" only.
 *   2. A live question runs the model's tool calls through the SHARED tool defs (wingguy_list_events,
 *      wingguy_lead_replied_since) scoped to the tenant, and the sources say so.
 *   3. No acting tools exist - the tool list never contains book/draft/park/cease anything.
 *   4. A person with no email gets no mailbox tools; a blocked key lane returns blocked, not a call.
 *   5. Reader-facing dashes are normalised (em/en -> " - ").
 *
 * Pure - no network, no Postgres, no Anthropic (the client is stubbed). Synthetic content only.
 *
 * Run: node tests/wingguy-followups-ask.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { answerAboutPerson, normaliseDashes, todayLine, buildTools } = require('../services/wingguyFollowupsAsk');

const coach = { clientId: 'Test-Coach', clientName: 'Test Coach', timezone: 'Australia/Brisbane', anthropicApiKey: 'sk-test' };
const person = { name: 'Sam Example', email: 'sam@example.com' };
const STORY = 'DOSSIER: Sam Example. WHERE IT STANDS: one call 26 Aug, you offered Mon 7 / Wed 9 / Thu 10 Sep, no reply since 3 Sep.';

// A scripted Anthropic client: each create() pops the next scripted response; records requests.
function fakeLlm(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        // Snapshot: the service keeps appending to the same messages array after the call.
        calls.push(JSON.parse(JSON.stringify(params)));
        const next = script.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
    },
  };
}
const textTurn = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const toolTurn = (name, input, id = 'tu1') => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', id, name, input }] });

// Shared tool defs, stubbed: record what was called and with which tenant.
function fakeTools() {
  const log = [];
  const mk = (name, text) => ({ name, run: async (args, tenant) => { log.push({ name, args, tenant }); return { text }; } });
  return {
    log,
    mailTools: [
      mk('wingguy_dossier', STORY),
      mk('wingguy_lead_replied_since', 'NO — no inbound email from sam@example.com since 2026-09-03.'),
      mk('wingguy_read_message', 'From: sam ... body'),
    ],
    bookingTools: [
      mk('wingguy_list_events', 'TODAY IS Friday 11 September 2026. Thursday 3 Sep: 3:00 pm Sam Example & Test Coach'),
    ],
  };
}

(async () => {
  console.log('wingguyFollowupsAsk');

  await check('story-only question: dossier loaded via the shared tool, no other tool call, source = story', async () => {
    const t = fakeTools();
    const llm = fakeLlm([textTurn('**One call on 26 Aug**, then silence since 3 Sep — the ball is with you.')]);
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'Where are we up to?' }], deps: { llm, mailTools: t.mailTools, bookingTools: t.bookingTools } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(t.log.map((l) => l.name), ['wingguy_dossier']);
    assert.strictEqual(t.log[0].tenant, 'Test-Coach');
    assert.deepStrictEqual(t.log[0].args, { name: 'Sam Example', email: 'sam@example.com' });
    assert.deepStrictEqual(r.sources, ['story']);
    assert.strictEqual(llm.calls.length, 1);
    const sys = llm.calls[0].system.map((b) => b.text).join('\n');
    assert.ok(sys.includes(STORY), 'story rides in the system prompt');
    assert.ok(/TODAY IS/.test(sys), 'today anchor present');
    assert.ok(!/—/.test(r.reply) && r.reply.includes(' - '), `dashes normalised: ${r.reply}`);
  });

  await check('live question: calendar + mailbox reads go through the shared defs, scoped to the tenant', async () => {
    const t = fakeTools();
    const llm = fakeLlm([
      toolTurn('calendar', { date: '2026-08-20', end_date: '2026-09-18' }, 'a'),
      toolTurn('replied_since', { since_iso: '2026-09-03' }, 'b'),
      textTurn('One missed slot: Thu 3 Sep 3pm. No email from him since.'),
    ]);
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'Have I missed anything?' }], deps: { llm, mailTools: t.mailTools, bookingTools: t.bookingTools } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(t.log.map((l) => l.name), ['wingguy_dossier', 'wingguy_list_events', 'wingguy_lead_replied_since']);
    assert.deepStrictEqual(t.log[1].args, { date: '2026-08-20', end_date: '2026-09-18' });
    assert.deepStrictEqual(t.log[2].args, { lead_email: 'sam@example.com', since_iso: '2026-09-03' });
    assert.ok(t.log.every((l) => l.tenant === 'Test-Coach'));
    assert.deepStrictEqual(r.sources.sort(), ['calendar (live)', 'mailbox (live)', 'story'].sort());
    // tool results were fed back as tool_result blocks on the next request
    const second = llm.calls[1].messages;
    const last = second[second.length - 1];
    assert.strictEqual(last.role, 'user');
    assert.strictEqual(last.content[0].type, 'tool_result');
    assert.strictEqual(last.content[0].tool_use_id, 'a');
  });

  await check('no acting tools exist, ever', async () => {
    const names = buildTools(person).map((tl) => tl.name);
    assert.deepStrictEqual(names, ['calendar', 'replied_since', 'read_email']);
    for (const n of names) assert.ok(!/book|draft|park|cease|reconnect|send|create/i.test(n));
  });

  await check('person without an email gets no mailbox tools', async () => {
    const names = buildTools({ name: 'LinkedIn Only' }).map((tl) => tl.name);
    assert.deepStrictEqual(names, ['calendar']);
  });

  await check('blocked key lane returns blocked without calling anything', async () => {
    const t = fakeTools();
    const r = await answerAboutPerson({ coach: { clientId: 'Keyless-Client', clientName: 'Keyless' }, person, messages: [{ role: 'user', content: 'Where are we up to?' }], deps: { mailTools: t.mailTools, bookingTools: t.bookingTools } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.blocked, true);
    assert.ok(/key/i.test(r.error));
    assert.deepStrictEqual(t.log, []);
  });

  await check('running conversation is relayed as text turns and must end with the question', async () => {
    const t = fakeTools();
    const llm = fakeLlm([textTurn('Yes, twice.')]);
    const msgs = [
      { role: 'user', content: 'Where are we up to?' },
      { role: 'assistant', content: 'One call, then silence.' },
      { role: 'user', content: 'Did he mention Teams?' },
    ];
    const r = await answerAboutPerson({ coach, person, messages: msgs, deps: { llm, mailTools: t.mailTools, bookingTools: t.bookingTools } });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(llm.calls[0].messages, msgs);
    const bad = await answerAboutPerson({ coach, person, messages: [{ role: 'assistant', content: 'x' }], deps: { llm, mailTools: t.mailTools, bookingTools: t.bookingTools } });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.error, 'question_required');
  });

  await check('helpers: normaliseDashes and todayLine', async () => {
    assert.strictEqual(normaliseDashes('a — b – c &mdash; d'), 'a - b - c - d');
    assert.ok(/^TODAY IS \w+ \d+ \w+ \d{4} \(\d{4}-\d{2}-\d{2}, Australia\/Brisbane\)\.$/.test(todayLine('Australia/Brisbane')), todayLine('Australia/Brisbane'));
  });

  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})();
