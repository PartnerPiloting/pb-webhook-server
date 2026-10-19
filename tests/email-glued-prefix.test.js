/**
 * Tests for utils/emailGluedPrefix.js and utils/mailboxVerify.js (Craig Carolan, 2026-10-19).
 *
 * Contracts - gluedPrefix:
 *   1. "iscraig.carolan@infocus.com.au" vs Craig Carolan -> suspect, prefix "is", suggested clean address.
 *   2. The clean address is NOT suspect; neither is the Gmail-with-middle-initial shape
 *      ("craigpcarolan@") - a real address must never be flagged as glued.
 *   3. Common glued words all trip it: "emailcraig...", "atcraig...", "iscraig...".
 *   4. A prefix with digits/dots is left alone ("22craig.carolan@" is not glued text).
 *   5. No name, no address, or a name that matches nothing -> not suspect (never a false alarm
 *      on someone whose address is unrelated to their name, e.g. "info@").
 *   6. Case is preserved in the suggestion ("isCraig.carolan@" -> "Craig.carolan@").
 * Contracts - verifyMailbox:
 *   7. No provider configured -> 'unknown' (the check is simply off).
 *   8. zerobounce "invalid" -> 'invalid'; "valid" -> 'valid'; "catch-all" -> 'unknown'.
 *   9. emailable "undeliverable" -> 'invalid'; "deliverable" -> 'valid'; "risky" -> 'unknown'.
 *  10. A network error or non-200 -> 'unknown', never a throw.
 *  11. Settled answers are cached; 'unknown' is not.
 *
 * Run: node tests/email-glued-prefix.test.js
 */
const assert = require('assert');
const { gluedPrefix } = require('../utils/emailGluedPrefix');
const mv = require('../utils/mailboxVerify');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

console.log('gluedPrefix:');
check('1. Craig\'s bounce address is flagged with the right fix', () => {
  const g = gluedPrefix('iscraig.carolan@infocus.com.au', 'Craig Carolan');
  assert.deepStrictEqual(g, { suspect: true, prefix: 'is', suggested: 'craig.carolan@infocus.com.au' });
});
check('2. real addresses are never flagged', () => {
  assert.strictEqual(gluedPrefix('craig.carolan@infocus.com.au', 'Craig Carolan').suspect, false);
  assert.strictEqual(gluedPrefix('craigpcarolan@gmail.com', 'Craig Carolan').suspect, false, 'middle initial is not glue');
  assert.strictEqual(gluedPrefix('ccarolan@infocus.com.au', 'Craig Carolan').suspect, false, 'initial + surname');
  assert.strictEqual(gluedPrefix('sam.trattles@acme.com', 'Sam Trattles').suspect, false);
});
check('3. the usual glued words all trip it', () => {
  for (const pre of ['is', 'at', 'email', 'emailis', 'on']) {
    const g = gluedPrefix(`${pre}sam.trattles@acme.com`, 'Sam Trattles');
    assert.ok(g.suspect, `${pre} should be flagged`);
    assert.strictEqual(g.prefix, pre);
    assert.strictEqual(g.suggested, 'sam.trattles@acme.com');
  }
});
check('4. digits or dots in front are not glued text', () => {
  assert.strictEqual(gluedPrefix('22craig.carolan@infocus.com.au', 'Craig Carolan').suspect, false);
  assert.strictEqual(gluedPrefix('.craig.carolan@infocus.com.au', 'Craig Carolan').suspect, false);
});
check('5. nothing to compare against -> not suspect', () => {
  assert.strictEqual(gluedPrefix('', 'Craig Carolan').suspect, false);
  assert.strictEqual(gluedPrefix('iscraig.carolan@infocus.com.au', '').suspect, false);
  assert.strictEqual(gluedPrefix('info@infocus.com.au', 'Craig Carolan').suspect, false);
  assert.strictEqual(gluedPrefix('hello@gmail.com', 'Craig Carolan').suspect, false);
});
check('6. the suggestion keeps the lead\'s own capitalisation', () => {
  const g = gluedPrefix('isCraig.carolan@infocus.com.au', 'Craig Carolan');
  assert.strictEqual(g.suggested, 'Craig.carolan@infocus.com.au');
});

(async () => {
  console.log('verifyMailbox:');
  const fakeFetch = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  const env = (provider, key) => { process.env.MAILBOX_VERIFY_PROVIDER = provider; process.env.MAILBOX_VERIFY_API_KEY = key; mv._cache.clear(); };

  await acheck('7. no provider configured -> unknown', async () => {
    env('', '');
    const r = await mv.verifyMailbox('x@y.com', { fetchImpl: fakeFetch(200, { status: 'invalid' }) });
    assert.strictEqual(r.state, 'unknown');
  });
  await acheck('8. zerobounce mapping', async () => {
    env('zerobounce', 'k');
    assert.strictEqual((await mv.verifyMailbox('a@y.com', { fetchImpl: fakeFetch(200, { status: 'invalid', sub_status: 'mailbox_not_found' }) })).state, 'invalid');
    assert.strictEqual((await mv.verifyMailbox('b@y.com', { fetchImpl: fakeFetch(200, { status: 'valid' }) })).state, 'valid');
    assert.strictEqual((await mv.verifyMailbox('c@y.com', { fetchImpl: fakeFetch(200, { status: 'catch-all' }) })).state, 'unknown');
  });
  await acheck('9. emailable mapping', async () => {
    env('emailable', 'k');
    assert.strictEqual((await mv.verifyMailbox('a@y.com', { fetchImpl: fakeFetch(200, { state: 'undeliverable', reason: 'rejected_email' }) })).state, 'invalid');
    assert.strictEqual((await mv.verifyMailbox('b@y.com', { fetchImpl: fakeFetch(200, { state: 'deliverable' }) })).state, 'valid');
    assert.strictEqual((await mv.verifyMailbox('c@y.com', { fetchImpl: fakeFetch(200, { state: 'risky' }) })).state, 'unknown');
  });
  await acheck('10. errors are unknown, never thrown', async () => {
    env('zerobounce', 'k');
    assert.strictEqual((await mv.verifyMailbox('d@y.com', { fetchImpl: fakeFetch(500, {}) })).state, 'unknown');
    assert.strictEqual((await mv.verifyMailbox('e@y.com', { fetchImpl: async () => { throw new Error('boom'); } })).state, 'unknown');
  });
  await acheck('11. settled answers cache, unknown does not', async () => {
    env('zerobounce', 'k');
    let calls = 0;
    const counting = (body) => async () => { calls++; return { ok: true, status: 200, json: async () => body }; };
    await mv.verifyMailbox('f@y.com', { fetchImpl: counting({ status: 'invalid' }) });
    await mv.verifyMailbox('f@y.com', { fetchImpl: counting({ status: 'invalid' }) });
    assert.strictEqual(calls, 1, 'second invalid lookup should hit the cache');
    await mv.verifyMailbox('g@y.com', { fetchImpl: counting({ status: 'unknown' }) });
    await mv.verifyMailbox('g@y.com', { fetchImpl: counting({ status: 'unknown' }) });
    assert.strictEqual(calls, 3, 'unknown is asked again');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
