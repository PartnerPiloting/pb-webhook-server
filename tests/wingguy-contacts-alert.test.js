/**
 * Tests for the contacts feed staleness alert (2026-09-15).
 *
 * The sweep deliberately reports success when one tenant's feed errors, so this is the only
 * thing that notices a feed that STAYS broken. Its judgement is pure, so it is tested without
 * a database.
 *
 * The rule that matters most is the one that keeps it quiet: a feed with NO ROW was never
 * attempted (a new client, or a feed that shipped today) and must never alert. The first draft
 * flagged "no success stamp while other feeds have one", which would have emailed a fault for
 * every tenant the night the mail feed shipped. A fault now needs a recorded ATTEMPT.
 *
 * Run: node tests/wingguy-contacts-alert.test.js
 */
const assert = require('assert');
const { findStale, expectedFeeds, describeStale } = require('../services/contactsAlert');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const NOW = new Date('2026-09-15T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const ok = (d) => ({ lastRunAt: daysAgo(d), lastErrorAt: null, lastError: null });
const failed = (d, msg, lastOk = null) => ({ lastRunAt: lastOk === null ? null : daysAgo(lastOk), lastErrorAt: daysAgo(d), lastError: msg });
const TEN = [{ clientId: 'Dean', feeds: ['lead', 'mail', 'comms-log'] }];

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

  console.log('\nSILENCE - the cases that must never email:');
  check('a brand new client with no rows at all', () => {
    assert.deepStrictEqual(findStale(TEN, new Map(), { now: NOW }), []);
  });
  check('THE ROLLOUT CASE: a feed that shipped today has no row, while others are healthy', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::comms-log', ok(0)]]);
    assert.deepStrictEqual(findStale(TEN, rows, { now: NOW }), []);
  });
  check('everything succeeded recently', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', ok(1)], ['Dean::comms-log', ok(0)]]);
    assert.deepStrictEqual(findStale(TEN, rows, { now: NOW }), []);
  });
  check('one bad night is noise - an error with a fresh success behind it', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', failed(0, '504', 0)], ['Dean::comms-log', ok(0)]]);
    assert.deepStrictEqual(findStale(TEN, rows, { now: NOW }), []);
  });
  check('just under the threshold is not stale', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', ok(2)], ['Dean::comms-log', ok(0)]]);
    assert.deepStrictEqual(findStale(TEN, rows, { now: NOW }), []);
  });

  console.log('\nFAULTS - the cases that must email:');
  check('tried and failed, never once worked', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', failed(0, 'mailbox read timed out after 120s')], ['Dean::comms-log', ok(0)]]);
    const s = findStale(TEN, rows, { now: NOW });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].feed, 'mail');
    assert.strictEqual(s[0].lastRunAt, null);
    assert.ok(/never worked/.test(describeStale(s[0])), describeStale(s[0]));
    assert.ok(/timed out/.test(describeStale(s[0])), 'the reason should travel with the alert');
  });
  check('worked once, then failed for days', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', failed(0, '504 Gateway Timeout', 9)], ['Dean::comms-log', ok(0)]]);
    const s = findStale(TEN, rows, { now: NOW });
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].daysStale, 9);
    assert.ok(/504/.test(describeStale(s[0])));
  });
  check('gone quiet with no error captured is still a fault', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', ok(11)], ['Dean::comms-log', ok(0)]]);
    const s = findStale(TEN, rows, { now: NOW });
    assert.deepStrictEqual(s.map((x) => x.feed), ['mail']);
    assert.strictEqual(s[0].daysStale, 11);
  });

  console.log('\nTenants are judged independently:');
  check('one broken tenant does not implicate the others', () => {
    const many = [
      { clientId: 'Dean', feeds: ['lead', 'mail'] },
      { clientId: 'Julian', feeds: ['lead', 'mail'] },
    ];
    const rows = new Map([
      ['Dean::lead', ok(0)], ['Dean::mail', ok(0)],
      ['Julian::lead', ok(0)], ['Julian::mail', failed(0, 'timed out', 11)],
    ]);
    assert.deepStrictEqual(findStale(many, rows, { now: NOW }).map((x) => `${x.clientId}/${x.feed}`), ['Julian/mail']);
  });
  check('a custom threshold is honoured', () => {
    const rows = new Map([['Dean::lead', ok(0)], ['Dean::mail', ok(4)], ['Dean::comms-log', ok(0)]]);
    assert.strictEqual(findStale(TEN, rows, { now: NOW, staleDays: 7 }).length, 0);
    assert.strictEqual(findStale(TEN, rows, { now: NOW, staleDays: 3 }).length, 1);
  });

  console.log('\ndescribeStale() - a line Guy can act on:');
  check('names the client, the feed, how long and why', () => {
    const line = describeStale({ clientId: 'Julian-Davis', feed: 'mail', lastRunAt: daysAgo(9), daysStale: 9, lastError: 'read timed out' });
    assert.ok(/Julian-Davis/.test(line) && /mail/.test(line) && /9 days ago/.test(line) && /timed out/.test(line), line);
  });
  check('singular day reads correctly', () => {
    assert.ok(/1 day ago/.test(describeStale({ clientId: 'X', feed: 'lead', lastRunAt: daysAgo(1), daysStale: 1 })));
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
