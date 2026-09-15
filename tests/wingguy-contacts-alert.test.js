/**
 * Tests for the contacts feed staleness alert (2026-09-15).
 *
 * The sweep deliberately reports success when one tenant's feed errors, so this is the only
 * thing that notices a feed that STAYS broken. The judgement it makes - which feeds a tenant
 * should even have, and when "no stamp" is a fault rather than a new client - is pure, so it
 * is tested without a database.
 *
 * Run: node tests/wingguy-contacts-alert.test.js
 */
const assert = require('assert');
const { findStale, expectedFeeds, describeStale } = require('../services/contactsAlert');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const NOW = new Date('2026-09-15T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);

(() => {
  console.log('expectedFeeds() - only what the tenant actually has:');
  const mpYes = { hasMailbox: () => true };
  const mpNo = { hasMailbox: () => false };
  check('leads base + mailbox = all three', () => {
    assert.deepStrictEqual(expectedFeeds({ airtableBaseId: 'app1' }, mpYes), ['lead', 'mail', 'comms-log']);
  });
  check('no mailbox = no mail feed expected (not a fault)', () => {
    assert.deepStrictEqual(expectedFeeds({ airtableBaseId: 'app1' }, mpNo), ['lead', 'comms-log']);
  });
  check('mailbox but no CRM still sweeps mail', () => {
    assert.deepStrictEqual(expectedFeeds({}, mpYes), ['mail', 'comms-log']);
  });
  check('nothing connected = nothing expected', () => {
    assert.deepStrictEqual(expectedFeeds({}, mpNo), []);
  });

  console.log('\nfindStale() - staleness, not one-off errors:');
  const tenants = [{ clientId: 'Dean', feeds: ['lead', 'mail', 'comms-log'] }];
  check('fresh stamps = nothing stale', () => {
    const stamps = new Map([['Dean::lead', daysAgo(0)], ['Dean::mail', daysAgo(1)], ['Dean::comms-log', daysAgo(0)]]);
    assert.deepStrictEqual(findStale(tenants, stamps, { now: NOW }), []);
  });
  check('a feed older than the threshold is stale, and says how old', () => {
    const stamps = new Map([['Dean::lead', daysAgo(0)], ['Dean::mail', daysAgo(9)], ['Dean::comms-log', daysAgo(0)]]);
    const s = findStale(tenants, stamps, { now: NOW });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].feed, 'mail');
    assert.strictEqual(s[0].daysStale, 9);
  });
  check('just under the threshold is NOT stale (a single bad night is noise)', () => {
    const stamps = new Map([['Dean::lead', daysAgo(0)], ['Dean::mail', daysAgo(2)], ['Dean::comms-log', daysAgo(0)]]);
    assert.deepStrictEqual(findStale(tenants, stamps, { now: NOW }), []);
  });

  console.log('\nfindStale() - a brand new client is not a fault:');
  check('no stamps at all = never swept = silent', () => {
    assert.deepStrictEqual(findStale(tenants, new Map(), { now: NOW }), []);
  });
  check('but a missing feed IS a fault once other feeds have run', () => {
    const stamps = new Map([['Dean::lead', daysAgo(0)], ['Dean::comms-log', daysAgo(0)]]);
    const s = findStale(tenants, stamps, { now: NOW });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].feed, 'mail');
    assert.strictEqual(s[0].lastRunAt, null);
    assert.ok(/never worked/.test(describeStale(s[0])), describeStale(s[0]));
  });

  console.log('\nfindStale() - tenants are judged independently:');
  check('one broken tenant does not implicate the others', () => {
    const many = [
      { clientId: 'Dean', feeds: ['lead', 'mail'] },
      { clientId: 'Julian', feeds: ['lead', 'mail'] },
    ];
    const stamps = new Map([
      ['Dean::lead', daysAgo(0)], ['Dean::mail', daysAgo(0)],
      ['Julian::lead', daysAgo(0)], ['Julian::mail', daysAgo(11)],
    ]);
    const s = findStale(many, stamps, { now: NOW });
    assert.deepStrictEqual(s.map((x) => `${x.clientId}/${x.feed}`), ['Julian/mail']);
  });
  check('a custom threshold is honoured', () => {
    const stamps = new Map([['Dean::lead', daysAgo(0)], ['Dean::mail', daysAgo(4)], ['Dean::comms-log', daysAgo(0)]]);
    assert.strictEqual(findStale(tenants, stamps, { now: NOW, staleDays: 7 }).length, 0);
    assert.strictEqual(findStale(tenants, stamps, { now: NOW, staleDays: 3 }).length, 1);
  });

  console.log('\ndescribeStale() - a line Guy can act on:');
  check('names the client, the feed and how long', () => {
    const line = describeStale({ clientId: 'Julian-Davis', feed: 'mail', lastRunAt: daysAgo(9), daysStale: 9 });
    assert.ok(/Julian-Davis/.test(line) && /mail/.test(line) && /9 days ago/.test(line), line);
  });
  check('singular day reads correctly', () => {
    assert.ok(/1 day ago/.test(describeStale({ clientId: 'X', feed: 'lead', lastRunAt: daysAgo(1), daysStale: 1 })));
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
