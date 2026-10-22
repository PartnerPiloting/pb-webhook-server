/**
 * Client unsubscribe link - services/clientUnsubscribe.js (2026-10-22). Pure parts only.
 *
 * Covers: token shape · the footer link · exact token matching (no partial, no blank, no
 * trimmed-into-a-match). No Airtable, no network.
 *
 * Run: node tests/client-unsubscribe.test.js
 */
const assert = require('assert');
const unsub = require('../services/clientUnsubscribe');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const clients = [
  { clientId: 'Rick-Wong', clientName: 'Rick Wong', emailUnsubToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', emailUnsubscribed: false },
  { clientId: 'Steve-Nelson', clientName: 'Steve Nelson', emailUnsubToken: null, emailUnsubscribed: false },
  { clientId: 'Dean-Hobin', clientName: 'Dean Hobin', emailUnsubToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', emailUnsubscribed: true },
];

console.log('newToken():');
check('is 32 URL-safe characters and never repeats', () => {
  const a = unsub.newToken(); const b = unsub.newToken();
  assert.strictEqual(a.length, 32);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a));
  assert.notStrictEqual(a, b);
});

console.log('unsubscribeUrlFor():');
check('builds the same link shape the prospect drip uses', () => {
  delete process.env.SERIES_PUBLIC_BASE_URL;
  assert.strictEqual(unsub.unsubscribeUrlFor(clients[0]), 'https://knowaguy.com.au/series/unsubscribe?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
});
check('is null for a client with no token - the planner must not send to them', () => {
  assert.strictEqual(unsub.unsubscribeUrlFor(clients[1]), null);
  assert.strictEqual(unsub.unsubscribeUrlFor(null), null);
});

console.log('findClientByToken():');
check('finds the client whose token it is', () => {
  assert.strictEqual(unsub.findClientByToken('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', clients).clientId, 'Dean-Hobin');
});
check('tolerates surrounding whitespace an email client added', () => {
  assert.strictEqual(unsub.findClientByToken('  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n', clients).clientId, 'Rick-Wong');
});
check('never matches a blank, short or partial token', () => {
  assert.strictEqual(unsub.findClientByToken('', clients), null);
  assert.strictEqual(unsub.findClientByToken(null, clients), null);
  assert.strictEqual(unsub.findClientByToken('AAAAAAAA', clients), null);
  assert.strictEqual(unsub.findClientByToken('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', clients), null);
});
check('a client with no token can never be matched by an empty one', () => {
  assert.strictEqual(unsub.findClientByToken(undefined, [{ clientId: 'X', emailUnsubToken: undefined }]), null);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
