/**
 * Tests for the Follow-Ups Ask box (services/wingguyFollowupsAsk.js, Guy 2026-09-11).
 * Contracts:
 *   1. The stored story rides into the system prompt as ground truth; a question the story
 *      answers makes NO tool call and reports source "story" only.
 *   2. A live question runs the model's tool calls through the SHARED tool defs (wingguy_list_events,
 *      wingguy_lead_replied_since) scoped to the tenant, and the sources say so.
 *   3. Two hands and only two: check_availability -> wingguy_check_availability (the only source of
 *      offered times) and push_draft -> wingguy_create_draft with the recipient PINNED to the person.
 *      Never book / park / drop / cease / send.
 *   4. A person with no email gets no mailbox tools and no push; a blocked key lane returns
 *      blocked, not a call.
 *   5. The rulebook rides in the system prompt (voice for drafts); reader-facing dashes are
 *      normalised (em/en -> " - ").
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
const STORY = 'DOSSIER: Sam Example. WHERE IT STANDS: one call 26 Aug, you offered Mon 7 / Wed 9 / Thu 10 Sep, no reply since 3 Sep. push with: reply_to_message_id=abc123';
const RULES = 'RULE voice-1: sign off "(I know a) Coach".';

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
      mk('wingguy_create_draft', 'Draft created: draftId=d1 (threaded).'),
    ],
    bookingTools: [
      mk('wingguy_list_events', 'TODAY IS Friday 11 September 2026. Thursday 3 Sep: 3:00 pm Sam Example & Test Coach'),
      mk('wingguy_check_availability', 'TODAY IS Friday 11 September 2026. Slots: Tue 22 Sep, 11:00 am (lead) ...'),
    ],
  };
}
const depsFor = (t, llm) => ({ llm, mailTools: t.mailTools, bookingTools: t.bookingTools, rulesText: RULES });

(async () => {
  console.log('wingguyFollowupsAsk');

  await check('story-only question: dossier loaded via the shared tool, no other tool call, source = story', async () => {
    const t = fakeTools();
    const llm = fakeLlm([textTurn('**One call on 26 Aug**, then silence since 3 Sep — the ball is with you.')]);
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'Where are we up to?' }], deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(t.log.map((l) => l.name), ['wingguy_dossier']);
    assert.strictEqual(t.log[0].tenant, 'Test-Coach');
    assert.deepStrictEqual(t.log[0].args, { name: 'Sam Example', email: 'sam@example.com' });
    assert.deepStrictEqual(r.sources, ['story']);
    assert.strictEqual(llm.calls.length, 1);
    const sys = llm.calls[0].system.map((b) => b.text).join('\n');
    assert.ok(sys.includes(STORY), 'story rides in the system prompt');
    assert.ok(sys.includes(RULES), 'rulebook rides in the system prompt');
    assert.ok(/```draft/.test(sys), 'draft-fence instruction present for the card');
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
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'Have I missed anything?' }], deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(t.log.map((l) => l.name), ['wingguy_dossier', 'wingguy_list_events', 'wingguy_lead_replied_since']);
    assert.deepStrictEqual(t.log[1].args, { date: '2026-08-20', end_date: '2026-09-18' });
    assert.deepStrictEqual(t.log[2].args, { lead_email: 'sam@example.com', since_iso: '2026-09-03' });
    assert.ok(t.log.every((l) => l.tenant === 'Test-Coach'));
    assert.deepStrictEqual(r.sources.sort(), ['calendar (live)', 'mailbox (live)', 'story'].sort());
    const second = llm.calls[1].messages;
    const last = second[second.length - 1];
    assert.strictEqual(last.role, 'user');
    assert.strictEqual(last.content[0].type, 'tool_result');
    assert.strictEqual(last.content[0].tool_use_id, 'a');
  });

  await check('times come from check_availability through the shared def, flags passed only when true', async () => {
    const t = fakeTools();
    const llm = fakeLlm([
      toolTurn('check_availability', { lead_location: 'Greater Sydney Area', include_far_weeks: true, include_soon: false }, 'a'),
      textTurn('Tue 22 Sep, 11:00 am or Thu 24 Sep, 2:00 pm (all times are Sydney time).'),
    ]);
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'What times could I offer the week after next?' }], deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(t.log.map((l) => l.name), ['wingguy_dossier', 'wingguy_check_availability']);
    assert.deepStrictEqual(t.log[1].args, { lead_location: 'Greater Sydney Area', include_far_weeks: true });
    assert.ok(r.sources.includes('calendar (live)'));
  });

  await check('push_draft -> wingguy_create_draft with the recipient PINNED to the person, threaded', async () => {
    const t = fakeTools();
    const llm = fakeLlm([
      toolTurn('push_draft', { subject: 'Re: Sam & Coach', html_body: '<p>Hi Sam,</p><p>Circling back.</p>', reply_to_message_id: 'abc123' }, 'a'),
      textTurn('Pushed - it is in your Drafts, threaded and unsent.'),
    ]);
    const r = await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'Push it to my drafts.' }], deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const push = t.log.find((l) => l.name === 'wingguy_create_draft');
    assert.ok(push, 'create_draft called');
    assert.strictEqual(push.tenant, 'Test-Coach');
    assert.deepStrictEqual(push.args, {
      to: [{ email: 'sam@example.com', name: 'Sam Example' }],
      subject: 'Re: Sam & Coach',
      html_body: '<p>Hi Sam,</p><p>Circling back.</p>',
      reply_to_message_id: 'abc123',
    });
    assert.ok(r.sources.includes('draft pushed to your mailbox'));
  });

  await check('the model cannot pick another recipient - a "to" in its input is ignored', async () => {
    const t = fakeTools();
    const llm = fakeLlm([
      toolTurn('push_draft', { to: [{ email: 'someone@else.com' }], subject: 'x', html_body: '<p>x</p>' }, 'a'),
      textTurn('Done.'),
    ]);
    await answerAboutPerson({ coach, person, messages: [{ role: 'user', content: 'push' }], deps: depsFor(t, llm) });
    const push = t.log.find((l) => l.name === 'wingguy_create_draft');
    assert.deepStrictEqual(push.args.to, [{ email: 'sam@example.com', name: 'Sam Example' }]);
  });

  await check('exactly these tools, never book / park / drop / cease / send', async () => {
    const names = buildTools(person).map((tl) => tl.name);
    assert.deepStrictEqual(names, ['calendar', 'check_availability', 'replied_since', 'read_email', 'push_draft']);
    for (const n of names) assert.ok(!/book|park|cease|reconnect|send|create_lead|done/i.test(n), n);
  });

  await check('LinkedIn profile URL rides in the person line (only a real linkedin.com URL)', async () => {
    const t = fakeTools();
    const llm = fakeLlm([textTurn('ok')]);
    await answerAboutPerson({ coach, person: { ...person, linkedin: 'https://www.linkedin.com/in/sam-example' }, messages: [{ role: 'user', content: 'hi' }], deps: depsFor(t, llm) });
    assert.ok(llm.calls[0].system.map((b) => b.text).join('\n').includes('LINKEDIN PROFILE: https://www.linkedin.com/in/sam-example'));
    const llm2 = fakeLlm([textTurn('ok')]);
    await answerAboutPerson({ coach, person: { ...person, linkedin: 'javascript:alert(1)' }, messages: [{ role: 'user', content: 'hi' }], deps: depsFor(fakeTools(), llm2) });
    assert.ok(!llm2.calls[0].system.map((b) => b.text).join('\n').includes('LINKEDIN PROFILE'));
    const llm3 = fakeLlm([textTurn('ok')]);
    await answerAboutPerson({ coach, person: { name: 'LinkedIn Only' }, messages: [{ role: 'user', content: 'hi' }], deps: depsFor(fakeTools(), llm3) });
    assert.ok(llm3.calls[0].system.map((b) => b.text).join('\n').includes('LinkedIn only'));
  });

  await check('person without an email: no mailbox tools, no push; a push attempt is refused', async () => {
    const names = buildTools({ name: 'LinkedIn Only' }).map((tl) => tl.name);
    assert.deepStrictEqual(names, ['calendar', 'check_availability']);
    const t = fakeTools();
    const llm = fakeLlm([toolTurn('push_draft', { subject: 'x', html_body: '<p>x</p>' }, 'a'), textTurn('Cannot push - no email on file; here is the wording to paste.')]);
    const r = await answerAboutPerson({ coach, person: { name: 'LinkedIn Only' }, messages: [{ role: 'user', content: 'push it' }], deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true);
    assert.ok(!t.log.some((l) => l.name === 'wingguy_create_draft'), 'no draft created');
    assert.ok(!r.sources.includes('draft pushed to your mailbox'));
    const toolResult = llm.calls[1].messages[llm.calls[1].messages.length - 1].content[0];
    assert.strictEqual(toolResult.is_error, true);
  });

  await check('blocked key lane returns blocked without calling anything', async () => {
    const t = fakeTools();
    const r = await answerAboutPerson({ coach: { clientId: 'Keyless-Client', clientName: 'Keyless' }, person, messages: [{ role: 'user', content: 'Where are we up to?' }], deps: { mailTools: t.mailTools, bookingTools: t.bookingTools, rulesText: RULES } });
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
    const r = await answerAboutPerson({ coach, person, messages: msgs, deps: depsFor(t, llm) });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(llm.calls[0].messages, msgs);
    const bad = await answerAboutPerson({ coach, person, messages: [{ role: 'assistant', content: 'x' }], deps: depsFor(t, llm) });
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
