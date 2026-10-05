/**
 * Tests for the LinkedIn network read (services/linkedinNetworkSync.js) - Reconnect, brick 1.
 *
 * Covers: buildNetwork() (who spoke last, counts, the connections list as the spine, organisation
 * inbox and event rows ignored) · resolveSalesNav() (a Sales Navigator copy of a person merges onto
 * the connection only when that is safe) · writeNetwork() (a partial read never deletes people).
 * Pure functions and a fake pool - no Unipile, no Postgres. ⚠ Synthetic content only.
 *
 * Run: node tests/linkedin-network-sync.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { buildNetwork, resolveSalesNav, writeNetwork } = require('../services/linkedinNetworkSync');

const nowMs = Date.UTC(2026, 9, 5);
const CLASSIC = ['INBOX', 'INBOX_LINKEDIN_CLASSIC'];
const SALES = ['INBOX', 'INBOX_LINKEDIN_SALES_NAVIGATOR'];
const chat = (id, pid, folder = CLASSIC) => ({ id, attendee_provider_id: pid, folder });
const msg = (id, chatId, when, mine, text = 'hello', extra = {}) =>
  ({ id, chat_id: chatId, timestamp: when, is_sender: mine ? 1 : 0, text, message_type: 'MESSAGE', ...extra });
const att = (pid, name, occupation = '', distance = 'DISTANCE_1') =>
  ({ provider_id: pid, name, is_self: 0, profile_url: `https://www.linkedin.com/in/${pid}`, specifics: { occupation, network_distance: distance } });
const rel = (memberId, first, last, headline = '', slug = '') =>
  ({ member_id: memberId, first_name: first, last_name: last, headline, public_identifier: slug, public_profile_url: slug ? `https://www.linkedin.com/in/${slug}` : '', created_at: Date.UTC(2023, 0, 15) });

const person = (net, key) => net.people.find((p) => p.person_key === key);

(async () => {
  console.log('buildNetwork');

  await check('sorts people by who spoke last', () => {
    const net = buildNetwork({
      nowMs,
      chats: [chat('c1', 'ACoA-never'), chat('c2', 'ACoA-theirs'), chat('c3', 'ACoA-mine')],
      attendees: [att('ACoA-never', 'Nora Never'), att('ACoA-theirs', 'Tom Theirs'), att('ACoA-mine', 'Mia Mine')],
      messages: [
        msg('m1', 'c1', '2025-01-01T00:00:00.000Z', true),
        msg('m2', 'c2', '2025-01-01T00:00:00.000Z', true),
        msg('m3', 'c2', '2025-01-02T00:00:00.000Z', false),
        msg('m4', 'c3', '2025-01-01T00:00:00.000Z', false),
        msg('m5', 'c3', '2025-01-03T00:00:00.000Z', true),
      ],
    });
    assert.strictEqual(net.summary.neverSpoke, 1);
    assert.strictEqual(net.summary.theySpokeLast, 1);
    assert.strictEqual(net.summary.repliedThenQuiet, 1);
    assert.strictEqual(net.summary.quiet90Connected, 2);
    const mia = person(net, 'ACoA-mine');
    assert.strictEqual(mia.last_dir, 'out');
    assert.strictEqual(mia.msgs_in, 1);
    assert.strictEqual(mia.last_in_at, '2025-01-01T00:00:00.000Z');
    assert.strictEqual(net.messages.length, 5);
  });

  await check('the last word is right whatever order messages arrive in', () => {
    const net = buildNetwork({
      nowMs, chats: [chat('c1', 'ACoA-a')], attendees: [att('ACoA-a', 'Ann A')],
      messages: [msg('m2', 'c1', '2025-03-02T00:00:00.000Z', false), msg('m1', 'c1', '2025-03-01T00:00:00.000Z', true)],
    });
    assert.strictEqual(person(net, 'ACoA-a').last_dir, 'in');
    assert.strictEqual(person(net, 'ACoA-a').first_msg_at, '2025-03-01T00:00:00.000Z');
  });

  await check('ignores events, deleted and hidden rows, and the organisation inbox', () => {
    const net = buildNetwork({
      nowMs,
      chats: [chat('c1', 'ACoA-a'), chat('c2', 'ACoA-org', ['INBOX', 'INBOX_LINKEDIN_ORGANIZATION'])],
      attendees: [att('ACoA-a', 'Ann A')],
      messages: [
        msg('m1', 'c1', '2025-03-01T00:00:00.000Z', true),
        msg('m2', 'c1', '2025-03-02T00:00:00.000Z', false, 'x', { is_event: 1 }),
        msg('m3', 'c1', '2025-03-03T00:00:00.000Z', false, 'x', { deleted: 1 }),
        msg('m4', 'c1', '2025-03-04T00:00:00.000Z', false, 'x', { hidden: 1 }),
        msg('m5', 'c2', '2025-03-05T00:00:00.000Z', false),
        msg('m6', 'nochat', '2025-03-05T00:00:00.000Z', false),
      ],
    });
    assert.strictEqual(net.messages.length, 1);
    assert.strictEqual(net.people.length, 1);
    assert.strictEqual(person(net, 'ACoA-a').msgs_in, 0);
  });

  await check('a connection with no messages is still a person, with the date connected and slug', () => {
    const net = buildNetwork({ nowMs, relations: [rel('ACoA-q', 'Quiet', 'Quinn', 'Director at Somewhere', 'quiet-quinn')] });
    const q = person(net, 'ACoA-q');
    assert.strictEqual(q.is_connection, true);
    assert.strictEqual(q.public_identifier, 'quiet-quinn');
    assert.strictEqual(q.connected_at, '2023-01-15T00:00:00.000Z');
    assert.strictEqual(q.last_msg_at, null);
    assert.strictEqual(net.summary.connections, 1);
    assert.strictEqual(net.summary.withMessages, 0);
  });

  await check('a Sales Navigator thread merges onto the connection and keeps its raw id on the messages', () => {
    const net = buildNetwork({
      nowMs, salesNav: true,
      relations: [rel('ACoA-sam', 'Sam', 'Sample', 'Founder at Widgets', 'sam-sample')],
      chats: [chat('c1', 'ACoA-sam'), chat('c2', 'ACwA-sam', SALES)],
      attendees: [att('ACoA-sam', 'Sam Sample'), att('ACwA-sam', 'Sam Sample', 'Founder at Widgets')],
      messages: [
        msg('m1', 'c1', '2024-01-01T00:00:00.000Z', true),
        msg('m2', 'c2', '2024-06-01T00:00:00.000Z', false),
      ],
    });
    assert.strictEqual(net.people.length, 1);
    const sam = person(net, 'ACoA-sam');
    assert.strictEqual(sam.sales_nav_id, 'ACwA-sam');
    assert.strictEqual(sam.folders, 'CLASSIC+SALES_NAVIGATOR');
    assert.strictEqual(sam.last_dir, 'in');
    assert.strictEqual(net.summary.mergedSalesNav, 1);
    assert.strictEqual(net.messages.find((m) => m.message_id === 'm2').attendee_id, 'ACwA-sam');
  });

  await check('an unmatched Sales Navigator person stands alone, with no member id', () => {
    const net = buildNetwork({
      nowMs, salesNav: true, relations: [rel('ACoA-x', 'Someone', 'Else')],
      chats: [chat('c1', 'ACwA-stranger', SALES)], attendees: [att('ACwA-stranger', 'Stan Stranger', '', 'DISTANCE_2')],
      messages: [msg('m1', 'c1', '2024-06-01T00:00:00.000Z', false)],
    });
    const s = person(net, 'ACwA-stranger');
    assert.strictEqual(s.member_id, null);
    assert.strictEqual(s.sales_nav_id, 'ACwA-stranger');
    assert.strictEqual(s.is_connection, false);
    assert.strictEqual(net.summary.unmergedSalesNav, 1);
  });

  await check('the Sales Navigator inbox is left out unless asked for', () => {
    const net = buildNetwork({
      nowMs, chats: [chat('c1', 'ACoA-a'), chat('c2', 'ACwA-b', SALES)],
      attendees: [att('ACoA-a', 'Ann A'), att('ACwA-b', 'Bob B')],
      messages: [msg('m1', 'c1', '2025-03-01T00:00:00.000Z', false), msg('m2', 'c2', '2025-03-01T00:00:00.000Z', false)],
    });
    assert.strictEqual(net.people.length, 1);
    assert.strictEqual(net.messages.length, 1);
    assert.strictEqual(net.people[0].person_key, 'ACoA-a');
  });

  console.log('resolveSalesNav');
  const byName = (rels) => { const m = new Map(); for (const r of rels) { const k = `${r.first_name} ${r.last_name}`.toLowerCase(); m.set(k, [...(m.get(k) || []), r]); } return m; };

  await check('one connection with the name, 1st-degree -> merged', () => {
    const r = rel('ACoA-1', 'Jo', 'Bloggs');
    assert.strictEqual(resolveSalesNav(att('ACwA-1', 'Jo Bloggs'), byName([r])), r);
  });
  await check('one connection with the name but NOT 1st-degree and no headline match -> not merged', () => {
    assert.strictEqual(resolveSalesNav(att('ACwA-1', 'Jo Bloggs', 'Plumber', 'DISTANCE_2'), byName([rel('ACoA-1', 'Jo', 'Bloggs', 'Barrister')])), null);
  });
  await check('two connections share the name -> the headline decides', () => {
    const a = rel('ACoA-1', 'Jo', 'Bloggs', 'Managing Director at Northern Freight');
    const b = rel('ACoA-2', 'Jo', 'Bloggs', 'Physiotherapist');
    assert.strictEqual(resolveSalesNav(att('ACwA-1', 'Jo Bloggs', 'Managing Director, Northern Freight'), byName([a, b])), a);
  });
  await check('two connections share the name and the headline cannot tell them apart -> not merged', () => {
    const a = rel('ACoA-1', 'Jo', 'Bloggs', 'Consultant');
    const b = rel('ACoA-2', 'Jo', 'Bloggs', 'Consultant');
    assert.strictEqual(resolveSalesNav(att('ACwA-1', 'Jo Bloggs', 'Consultant'), byName([a, b])), null);
  });

  console.log('writeNetwork');
  const fakeDb = () => { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } }; };
  const net = buildNetwork({
    nowMs, chats: [chat('c1', 'ACoA-a')], attendees: [att('ACoA-a', 'Ann A')],
    messages: [msg('m1', 'c1', '2025-03-01T00:00:00.000Z', true, 'nul\u0000byte')],
  });

  await check('a full read replaces the people; messages are never overwritten', async () => {
    const db = fakeDb();
    await writeNetwork(db, 'T', net, { fullPeople: true });
    assert.ok(db.calls.some((c) => /INSERT INTO linkedin_messages[\s\S]*DO NOTHING/.test(c.sql)));
    assert.ok(db.calls.some((c) => /DELETE FROM linkedin_people/.test(c.sql)));
    assert.ok(!db.calls.some((c) => /lead_rec_id/.test(c.sql)), 'a sync must never touch lead_rec_id');
    assert.ok(db.calls.every((c) => c.params[0] === 'T'));
  });
  await check('a partial read deletes nobody', async () => {
    const db = fakeDb();
    await writeNetwork(db, 'T', net, { fullPeople: false });
    assert.ok(!db.calls.some((c) => /DELETE/.test(c.sql)));
  });
  await check('NUL bytes are stripped before they reach Postgres', () => {
    assert.strictEqual(net.messages[0].body, 'nulbyte');
  });

  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
