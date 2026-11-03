/**
 * Tests for the drafting-window cost cut (2026-11-03, David Gould's bill):
 * - trimHistoryForModel: earlier turns go to Claude trimmed (last 12 exchanges, big tool results
 *   shrunk), tool_use/tool_result pairs never split, the draft and booking exchanges always kept.
 * - runWingguyChatTurn: the current turn's tool loop goes whole; the full history still comes back.
 * - AGENT_TOOLS: only drafting tools + the rule tools.
 *
 * Run: node tests/wingguy-history-trim.test.js
 */
const assert = require('assert');
const { trimHistoryForModel, runWingguyChatTurn, AGENT_TOOLS } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// A realistic check_availability result: 8 days x 8 slots, every field the real one carries.
function availabilityResult() {
  const days = [];
  for (let d = 10; d < 18; d++) {
    const freeSlots = [];
    for (let h = 9; h < 17; h++) {
      const time = `2026-11-${d}T${String(h).padStart(2, '0')}:00:00+10:00`;
      freeSlots.push({ time, display: `${h}:00 am`, leadDisplay: `${h + 1}:00 am`, label: `Tue ${d} November, ${h}:00 am`, both: `Tue ${d} November, ${h + 1}:00 am Sydney (${h}:00 am your time, Brisbane)` });
    }
    days.push({ date: `2026-11-${d}`, meetingCount: 2, freeSlots });
  }
  return { window: { today: '2026-11-03' }, yourTimezone: 'Australia/Brisbane', days };
}

// One exchange = coach text, then (optionally) an agent tool step, then the agent's text answer.
let idSeq = 0;
function exchange(i, { tool = null, input = {}, result = { ok: true } } = {}) {
  const out = [{ role: 'user', content: `coach message ${i}` }];
  if (tool) {
    const id = `tu_${++idSeq}`;
    out.push({ role: 'assistant', content: [{ type: 'text', text: `working ${i}` }, { type: 'tool_use', id, name: tool, input }] });
    out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) }] });
  }
  out.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] });
  return out;
}

// Every tool_result answers a tool_use in the assistant message right before it, and every
// tool_use is answered in the message right after it. First message is the coach's.
function assertPairing(msgs) {
  assert.strictEqual(msgs[0].role, 'user', 'first message must be a user message');
  msgs.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content.filter((x) => x.type === 'tool_result')) {
        const prev = msgs[i - 1];
        assert.ok(prev && prev.role === 'assistant' && prev.content.some((x) => x.type === 'tool_use' && x.id === b.tool_use_id), `orphaned tool_result ${b.tool_use_id} at ${i}`);
      }
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content.filter((x) => x.type === 'tool_use')) {
        const next = msgs[i + 1];
        assert.ok(next && Array.isArray(next.content) && next.content.some((x) => x.type === 'tool_result' && x.tool_use_id === b.id), `unanswered tool_use ${b.id} at ${i}`);
      }
    }
  });
}

const texts = (msgs) => msgs.flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((b) => b.type === 'text').map((b) => b.text)));

(async () => {
  console.log('short chats pass through, big earlier tool results shrink:');
  {
    const hist = [...exchange(1, { tool: 'check_availability', result: availabilityResult() }), ...exchange(2, { tool: 'propose_message', input: { message: 'Hi Tony - draft one' } })];
    const out = trimHistoryForModel(hist);
    check('same number of messages (nothing dropped under 12 exchanges)', () => assert.strictEqual(out.length, hist.length));
    check('no "left out" note', () => assert.ok(!texts(out).some((t) => /left out/.test(t))));
    const before = hist[2].content[0].content;
    const after = out[2].content[0].content;
    check('calendar read is much smaller', () => assert.ok(after.length < before.length / 2, `${after.length} vs ${before.length}`));
    check('calendar read keeps every slot as "label = ISO"', () => {
      const r = JSON.parse(after);
      assert.strictEqual(r.days.length, 8);
      assert.strictEqual(r.days[0].slots.length, 8);
      assert.strictEqual(r.days[0].slots[0], 'Tue 10 November, 9:00 am = 2026-11-10T09:00:00+10:00');
    });
    check('the input history is not mutated', () => assert.strictEqual(hist[2].content[0].content, before));
    check('draft tool_use input kept word for word', () => assert.strictEqual(out[5].content[1].input.message, 'Hi Tony - draft one'));
    check('pairing valid', () => assertPairing(out));
  }

  console.log('\nlong chats keep the last exchanges, whole:');
  {
    const hist = [];
    for (let i = 1; i <= 20; i++) hist.push(...exchange(i, i % 3 === 0 ? { tool: 'check_availability', result: availabilityResult() } : {}));
    const out = trimHistoryForModel(hist);
    const coachTexts = texts(out).filter((t) => /^coach message/.test(t));
    check('20 exchanges -> 8 kept (window steps by 6 above 12)', () => assert.strictEqual(coachTexts.length, 8));
    check('the kept ones are the newest', () => assert.deepStrictEqual(coachTexts, [13, 14, 15, 16, 17, 18, 19, 20].map((n) => `coach message ${n}`)));
    check('a note says how many were left out', () => assert.ok(texts(out).some((t) => /12 earlier exchanges in this chat left out/.test(t))));
    check('pairing valid', () => assertPairing(out));
    check('never more than 12 exchanges', () => {
      for (let n = 1; n <= 40; n++) {
        const h = [];
        for (let i = 1; i <= n; i++) h.push(...exchange(i));
        const kept = texts(trimHistoryForModel(h)).filter((t) => /^coach message/.test(t)).length;
        assert.ok(kept <= 12 && kept >= Math.min(n, 6), `n=${n} kept=${kept}`);
      }
    });
    check('window holds still for several turns (cache-friendly)', () => {
      const build = (n) => { const h = []; idSeq = 0; for (let i = 1; i <= n; i++) h.push(...exchange(i)); return trimHistoryForModel(h); };
      const a = build(13); const b = build(17);
      assert.deepStrictEqual(b.slice(0, a.length), a);
    });
  }

  console.log('\nthe current draft and the booking always survive:');
  {
    const hist = [
      ...exchange(1),
      ...exchange(2, { tool: 'propose_message', input: { message: 'Hi Tony - the draft he is still editing' } }),
      ...exchange(3, { tool: 'book_meeting', input: { startISO: '2026-11-12T10:00:00+10:00' }, result: { ok: true, start: '2026-11-12T10:00:00+10:00', when: 'Thu 12 November, 10:00 am Brisbane' } }),
      ...exchange(4, { tool: 'propose_message', input: { message: 'refused draft' }, result: { ok: false, error: 'REJECTED - draft NOT set' } }),
    ];
    for (let i = 5; i <= 25; i++) hist.push(...exchange(i));
    const out = trimHistoryForModel(hist);
    const json = JSON.stringify(out);
    check('the exchange that set the draft is kept', () => assert.ok(json.includes('the draft he is still editing')));
    check('the exchange that booked is kept', () => assert.ok(json.includes('Thu 12 November, 10:00 am Brisbane')));
    check('a refused draft is not what pins', () => assert.ok(!json.includes('refused draft')));
    check('pairing valid', () => assertPairing(out));
  }

  console.log('\nrule-tool results are never shrunk:');
  {
    const big = { ok: true, key: 'voice', expected_version: 7, body: 'x'.repeat(5000) };
    const hist = [...exchange(1, { tool: 'wingguy_rule_get', result: big }), ...exchange(2)];
    const out = trimHistoryForModel(hist);
    check('rule body comes through whole', () => assert.strictEqual(out[2].content[0].content, JSON.stringify(big)));
  }

  console.log('\nwired through runWingguyChatTurn:');
  {
    const hist = [];
    for (let i = 1; i <= 20; i++) hist.push(...exchange(i, i === 19 ? { tool: 'check_availability', result: availabilityResult() } : {}));
    const messages = [...hist, { role: 'user', content: 'suggest some times next week' }];
    const calls = [];
    let n = 0;
    const client = { messages: { create: async (req) => {
      calls.push(JSON.parse(JSON.stringify(req.messages)));
      n++;
      if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'now_1', name: 'check_availability', input: {} }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here are some times.' }] };
    } } };
    const res = await runWingguyChatTurn({
      coach: { clientId: 'Guy-Wilson', clientName: 'Guy Wilson', timezone: 'Australia/Brisbane' },
      profile: { name: 'Tony Lead', location: 'Brisbane' },
      conversation: [{ sender: 'Tony Lead', text: 'Happy to have a chat' }],
      messages,
      leadEmail: 'tony@example.com',
      deps: { client, getAvailabilityForCoach: async () => ({ yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', leadTzDetected: true, ...availabilityResult() }) },
    });
    check('turn ok', () => assert.ok(res.ok, res.error));
    check('Claude saw a trimmed history', () => assert.ok(calls[0].length < messages.length, `${calls[0].length} vs ${messages.length}`));
    check('the coach\'s new message is last on the first call', () => assert.strictEqual(texts([calls[0][calls[0].length - 1]])[0], 'suggest some times next week'));
    check('this turn\'s tool result goes whole (not shrunk)', () => {
      const last = calls[1][calls[1].length - 1];
      assert.strictEqual(last.content[0].tool_use_id, 'now_1');
      assert.ok(!/trimmed/.test(last.content[0].content));
    });
    check('both calls share the same history prefix (cache holds)', () => {
      const strip = (ms) => JSON.parse(JSON.stringify(ms), (k, v) => (k === 'cache_control' ? undefined : v));
      const k = calls[0].length - 1;
      assert.deepStrictEqual(strip(calls[1].slice(0, k)), strip(calls[0].slice(0, k)));
    });
    check('one cache marker per call, on the last message', () => {
      for (const c of calls) {
        const marks = JSON.stringify(c).split('cache_control').length - 1;
        assert.strictEqual(marks, 1);
        assert.ok(JSON.stringify(c[c.length - 1]).includes('cache_control'));
      }
    });
    check('pairing valid on every call', () => calls.forEach(assertPairing));
    check('the panel gets the FULL history back (old turns + this turn\'s loop)', () => assert.strictEqual(res.messages.length, messages.length + 3));
  }

  console.log('\npanel tool list:');
  {
    const names = AGENT_TOOLS.map((t) => t.name);
    for (const gone of ['weekly_emails', 'referrals', 'campaign_numbers', 'client_emails', 'get_client', 'client_settings', 'campaigns', 'assets', 'list_edition', 'edit_review', 'variables']) {
      check(`no wingguy_${gone}`, () => assert.ok(!names.includes(`wingguy_${gone}`)));
    }
    for (const kept of ['rules_list', 'rule_get', 'rule_propose', 'rule_commit', 'rule_revert', 'rule_reset_to_standard']) {
      check(`keeps wingguy_${kept}`, () => assert.ok(names.includes(`wingguy_${kept}`)));
    }
  }

  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nAll history-trim tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
