// An old connection is not a new one (Guy, 27 Nov 2026 - Steve Nelson's existing connections).
// /wg on someone the coach connected with long ago and never wrote to must not say "thanks for
// connecting". The connected date decides it; an unknown date keeps the old behaviour.
// Run: node tests/wingguy-established-connection.test.js

const assert = require('assert');
const {
  connectedDateOf, establishedConnection, establishedConnectionLine, thanksForConnectingPhrase,
  ESTABLISHED_CONNECTION_DAYS, runWingguyChatTurn,
} = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

const COACH = 'Steve Nelson';
const LEAD = 'Priya Patel';
const NOW = Date.parse('2026-11-27T06:00:00Z');
const OLD = '2021-03-15T00:00:00.000Z';
const RECENT = '2026-11-20T00:00:00.000Z';
const myNote = { sender: 'Steve Nelson', text: 'Hi Priya, came across your profile...' };
const theirReply = { sender: 'Priya Patel', text: 'Hi Steve, good to hear from you.' };

console.log('connectedDateOf');
check('the CRM date wins', () => assert.strictEqual(connectedDateOf({ _dateConnected: OLD, rawProfileData: '{"connected_at":1600000000000}' }), OLD));
check('falls back to Linked Helper connected_at (ms)', () => assert.strictEqual(connectedDateOf({ rawProfileData: JSON.stringify({ connected_at: Date.parse(OLD) }) }), OLD));
check('falls back to connected_at_iso', () => assert.strictEqual(connectedDateOf({ rawProfileData: JSON.stringify({ connected_at_iso: OLD }) }), OLD));
check('nothing usable = empty, never a throw', () => {
  assert.strictEqual(connectedDateOf({}), '');
  assert.strictEqual(connectedDateOf({ rawProfileData: 'not json' }), '');
  assert.strictEqual(connectedDateOf({ _dateConnected: 'rubbish' }), '');
});

console.log('establishedConnection');
const est = (o) => establishedConnection({ coachName: COACH, leadName: LEAD, now: NOW, ...o });
check('old connection, empty thread = established', () => {
  const r = est({ conversation: [], connectedAt: OLD });
  assert.ok(r && r.date === '2021-03-15' && r.days > 2000, JSON.stringify(r));
});
check('old connection, only my own note = still established', () => assert.ok(est({ conversation: [myNote], connectedAt: OLD })));
check('they have written = not this case (the reply flow handles it)', () => assert.strictEqual(est({ conversation: [myNote, theirReply], connectedAt: OLD }), null));
check('connected last week = a new connection, thanks as before', () => assert.strictEqual(est({ conversation: [], connectedAt: RECENT }), null));
check(`exactly ${ESTABLISHED_CONNECTION_DAYS} days = established`, () => assert.ok(est({ conversation: [], connectedAt: new Date(NOW - ESTABLISHED_CONNECTION_DAYS * 86400000).toISOString() })));
check('no date = unknown, old behaviour', () => assert.strictEqual(est({ conversation: [], connectedAt: '' }), null));
check('a group thread = never', () => assert.strictEqual(est({ conversation: [], connectedAt: OLD, group: true }), null));

console.log('establishedConnectionLine');
check('names the date, overrides the thanks, points to the reconnect instruction', () => {
  const line = establishedConnectionLine({ days: 2083, date: '2021-03-15' }, LEAD);
  assert.ok(/NOT A NEW CONNECTION/.test(line) && /2021-03-15/.test(line) && /about 5 years ago/.test(line), line);
  assert.ok(/does NOT apply/.test(line) && /Reconnecting after a gap/.test(line) && /Never thank Priya/.test(line), line);
});
check('months for under a year', () => assert.ok(/about 3 months ago/.test(establishedConnectionLine({ days: 92, date: '2026-08-27' }, LEAD))));
check('no established connection = no line', () => assert.strictEqual(establishedConnectionLine(null, LEAD), ''));

console.log('thanksForConnectingPhrase');
for (const t of ['Thanks for connecting.', 'Thank you for connecting, Priya', 'thanks so much for accepting', 'Great to connect!', 'Glad we connected', 'Now that we\'re connected, ...', 'Lovely to be connected']) {
  check(`catches "${t}"`, () => assert.ok(thanksForConnectingPhrase(`Hi Priya,\n\n${t}`), t));
}
for (const t of ['Saw your post on pricing the other day', 'It has been a while since we connected - saw your post on pricing', 'Happy to connect you with someone in mining']) {
  check(`leaves "${t}" alone`, () => assert.strictEqual(thanksForConnectingPhrase(t), null));
}

// Wired through a whole turn: a fake Claude first writes "Thanks for connecting", is refused, then
// writes the reconnect. The context it saw must carry the override.
console.log('wired through runWingguyChatTurn');
(async () => {
  const thanks = 'Hi Priya,\n\nThanks for connecting. Your work on supply chains caught my eye.\n\nWorth a quick chat?\n\nCheers,\nSteve';
  const good = 'Hi Priya,\n\nIt has been a while since we connected - your post on the new supply chain rules caught my eye.\n\nWorth a quick chat?\n\nCheers,\nSteve';
  const make = (first) => {
    const seen = { system: '', results: [] };
    let call = 0;
    const client = { messages: { create: async (req) => {
      call++;
      if (call === 1) seen.system = (req.system || []).map((b) => b.text).join('\n');
      const last = req.messages[req.messages.length - 1];
      if (last && Array.isArray(last.content)) last.content.filter((b) => b.type === 'tool_result').forEach((b) => seen.results.push(String(b.content)));
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_message', input: { message: first } }] };
      if (call === 2 && seen.results.some((t) => /REJECTED/.test(t))) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_message', input: { message: good } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    return { client, seen };
  };
  const coach = { clientId: 'Steve-Nelson', clientName: COACH, timezone: 'Australia/Melbourne' };
  try {
    const a = make(thanks);
    const r = await runWingguyChatTurn({
      coach, profile: { name: LEAD, _dateConnected: OLD }, conversation: [], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: a.client, getVariables: async () => [] },
    });
    check('the context told the model it is not a new connection', () => assert.ok(/NOT A NEW CONNECTION/.test(a.seen.system), 'override missing from the context'));
    check('"Thanks for connecting" was refused, with the reason', () => assert.ok(a.seen.results.some((t) => /REJECTED/.test(t) && /EXISTING connection/.test(t)), a.seen.results.join(' | ')));
    check('the reconnect became the draft', () => assert.strictEqual(r.draft, good));

    const b = make(thanks);
    const r2 = await runWingguyChatTurn({
      coach, profile: { name: LEAD, _dateConnected: RECENT }, conversation: [], leadEmail: '',
      messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: b.client, getVariables: async () => [] },
    });
    check('a connection from last week still gets its thanks', () => assert.strictEqual(r2.draft, thanks));
    check('...and no override in its context', () => assert.ok(!/NOT A NEW CONNECTION/.test(b.seen.system)));
  } catch (e) {
    failed++;
    console.log(`  ✗ wired test threw: ${e.message}`);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
