/**
 * Tests for the dark-machine judgement (services/extensionDistStore.js darkMachineAlerts,
 * 2026-09-13). The extension updater on a client's machine checks in every run; a coached
 * client whose machine has checked in before and then gone quiet for three days (or whose last
 * run errored) gets a line on the coach's queue - chat and the Follow-Ups screen alike.
 *
 * Pure function - no Postgres, no Airtable. ⚠ Synthetic clients and machines only.
 *
 * Run: node tests/wingguy-dark-machines.test.js
 */
const assert = require('assert');
const { darkMachineAlerts, DARK_AFTER_MS } = require('../services/extensionDistStore');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const NOW = Date.parse('2026-09-13T22:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const COACH = 'Coach-One';
const client = (over) => ({
  clientId: 'Client-A', clientName: 'Client A', coach: COACH, status: 'Active', coachingStatus: 'Graduated', wingguyEnabled: true, ...over,
});
const checkin = (over) => ({ client_id: 'Client-A', version: '0.3.19', action: 'current', machine: 'A-LAPTOP', checked_in_at: daysAgo(5), ...over });
const run = (clients, checkins) => darkMachineAlerts({ coachClientId: COACH, clients, checkins, now: NOW });

console.log('darkMachineAlerts():');

check('a coached client silent 5 days is flagged, with machine, days and version in the line', () => {
  const out = run([client()], [checkin()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'dark');
  assert.equal(out[0].days, 5);
  assert.match(out[0].line, /Client A's machine \(A-LAPTOP\) has not checked in for 5 days - last seen on 0\.3\.19/);
});

check('checked in yesterday = nothing', () => {
  assert.deepEqual(run([client()], [checkin({ checked_in_at: daysAgo(1) })]), []);
});

check('exactly three days is the edge: just under is quiet, just over is dark', () => {
  const under = new Date(NOW - DARK_AFTER_MS + 60000).toISOString();
  const over = new Date(NOW - DARK_AFTER_MS - 60000).toISOString();
  assert.equal(run([client()], [checkin({ checked_in_at: under })]).length, 0);
  assert.equal(run([client()], [checkin({ checked_in_at: over })]).length, 1);
});

check('an errored last run is flagged even when recent, with the note', () => {
  const out = run([client()], [checkin({ checked_in_at: daysAgo(0), action: 'error', note: 'download failed: 502' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'error');
  assert.match(out[0].line, /reported an error on its last update run - download failed: 502/);
});

check('never checked in = not on the updater = nothing to watch', () => {
  assert.deepEqual(run([client()], []), []);
});

check("somebody else's client is not mine to worry about", () => {
  assert.deepEqual(run([client({ coach: 'Coach-Two' })], [checkin()]), []);
});

check('the coach\'s own record is never flagged to themselves', () => {
  assert.deepEqual(run([client({ clientId: COACH })], [checkin({ client_id: COACH })]), []);
});

check('a paused or non-Active client is left alone (Status Paused, or Coaching Status Paused)', () => {
  assert.deepEqual(run([client({ status: 'Paused' })], [checkin()]), []);
  assert.deepEqual(run([client({ coachingStatus: 'Paused' })], [checkin()]), []);
  assert.deepEqual(run([client({ status: 'Off' })], [checkin()]), []);
});

check('extension switched off = nothing (the machine is not meant to be pulling)', () => {
  assert.deepEqual(run([client({ wingguyEnabled: false })], [checkin()]), []);
});

check('only the LATEST check-in per client counts (a stale older row must not resurrect a live machine)', () => {
  // latestPerClient() returns one row per client; the pure function must still cope if two arrive.
  const out = run([client()], [checkin({ checked_in_at: daysAgo(9) }), checkin({ checked_in_at: daysAgo(1) })]);
  assert.deepEqual(out, []);
});

check('darkest first when several are flagged', () => {
  const out = run(
    [client(), client({ clientId: 'Client-B', clientName: 'Client B' })],
    [checkin(), checkin({ client_id: 'Client-B', machine: 'B-PC', checked_in_at: daysAgo(12) })],
  );
  assert.deepEqual(out.map((a) => a.clientId), ['Client-B', 'Client-A']);
});

check('garbage in (no coach, unparseable date) = empty, never a throw', () => {
  assert.deepEqual(darkMachineAlerts({}), []);
  assert.deepEqual(run([client()], [checkin({ checked_in_at: 'not a date' })]), []);
  assert.deepEqual(run(null, null), []);
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
