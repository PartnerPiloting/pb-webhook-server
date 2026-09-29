/**
 * Tests for "the extension keeps its owner" (wingguy-extension/background.js 0.3.29, Guy 2026-09-30).
 * Runs the REAL background.js in a sandbox with a fake browser and a fake server, so what is tested
 * is the file that ships, not a copy of its logic.
 * Contracts:
 *   1. First link (nothing held) is taken, and the owner's name is recorded.
 *   2. A DIFFERENT person's Portal cannot replace the owner. The held sign-in is untouched.
 *   3. The same person with a re-issued link IS accepted.
 *   4. A held link the server now rejects gives way to a good one (no owner on record to protect).
 *   5. Server unreachable while a different sign-in arrives -> keep what is held.
 *   6. After Disconnect, anyone's Portal links - switching owner is possible, but deliberate.
 *   7. A call that acts as the client is refused when the LinkedIn name is someone else, and the
 *      server is never asked to do the work. With no LinkedIn name it goes through as before.
 *   8. The chat call carries the LinkedIn name to the server.
 *
 * Synthetic names and tokens only. Run: node tests/wingguy-extension-owner-lock.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { viewerMatchesClient, mismatchMessage } = require('../services/wingguyIdentity');

let failures = 0;
const results = [];
const check = (name, fn) => results.push(
  Promise.resolve().then(fn).then(
    () => console.log(`  ✓ ${name}`),
    (e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  )
);

// token -> who the server says it is
const PEOPLE = {
  'tok-owner': { clientId: 'Olive-Owner', clientName: 'Olive Owner' },
  'tok-owner-new': { clientId: 'Olive-Owner', clientName: 'Olive Owner' },
  'tok-client': { clientId: 'Carl-Client', clientName: 'Carl Client' },
};

function makeWorld({ serverDown = false, dead = [] } = {}) {
  const store = {};
  const calls = [];
  let listener = null;
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } },
      getManifest: () => ({ version: 'test' }),
    },
    tabs: { query: (_q, cb) => cb([]), sendMessage: () => Promise.resolve() },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    scripting: { insertCSS: () => Promise.resolve(), executeScript: () => Promise.resolve() },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; cb(out); },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete store[k]; if (cb) cb(); },
      },
    },
  };
  const fetch = async (url, opts = {}) => {
    const token = opts.headers && opts.headers['x-portal-token'];
    const body = opts.body ? JSON.parse(opts.body) : {};
    calls.push({ url, token, body });
    if (serverDown) throw new Error('network down');
    const json = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
    const who = PEOPLE[token];
    if (!who || dead.includes(token)) return json(401, { error: 'invalid link' });
    if (url.endsWith('/identity')) {
      const v = viewerMatchesClient({ viewerName: body.viewerName, clientName: who.clientName });
      return json(200, { ok: true, ...who, viewerName: body.viewerName, matches: v.matches,
        message: v.matches === false ? mismatchMessage({ viewerName: body.viewerName, clientName: who.clientName }) : '' });
    }
    return json(200, { ok: true, reply: 'drafted', leads: [] });
  };
  const sandbox = { chrome, fetch, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, Date, Promise, JSON };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'background.js'), 'utf8'), sandbox);
  const send = (message) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer to ${message.type}`)), 2000);
    listener(message, {}, (resp) => { clearTimeout(t); resolve(resp); });
  });
  const portal = (clientId, portalToken) => send({ type: 'AUTH_BROADCAST', clientId, portalToken, environment: 'production' });
  return { store, calls, send, portal };
}

console.log('wingguy extension owner lock');

check('first link is taken and the owner is named', async () => {
  const w = makeWorld();
  const r = await w.portal('Olive-Owner', 'tok-owner');
  assert.strictEqual(r.success, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner');
  assert.strictEqual(w.store.ownerName, 'Olive Owner');
});

check('a different person\'s Portal cannot replace the owner', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  const r = await w.portal('Carl-Client', 'tok-client');
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.locked, true);
  assert.strictEqual(r.heldName, 'Olive Owner');
  assert.strictEqual(w.store.portalToken, 'tok-owner');
  assert.strictEqual(w.store.clientId, 'Olive-Owner');
});

check('...even when the page sends the owner\'s client id with the other person\'s token', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  const r = await w.portal('Olive-Owner', 'tok-client');
  assert.strictEqual(r.locked, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner');
});

check('...and on a copy linked before 0.3.29, which never recorded its owner', async () => {
  const w = makeWorld();
  Object.assign(w.store, { clientId: 'Olive-Owner', portalToken: 'tok-owner', environment: 'production' });
  const r = await w.portal('Carl-Client', 'tok-client');
  assert.strictEqual(r.locked, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner');
});

check('the same sign-in again is a quiet yes', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  const r = await w.portal('Olive-Owner', 'tok-owner');
  assert.strictEqual(r.success, true);
});

check('the same person with a re-issued link is accepted', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  const r = await w.portal('Olive-Owner', 'tok-owner-new');
  assert.strictEqual(r.success, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner-new');
});

check('a held link the server rejects gives way to a good one', async () => {
  const w = makeWorld({ dead: ['tok-owner'] });
  Object.assign(w.store, { clientId: 'Olive-Owner', portalToken: 'tok-owner', environment: 'production' });
  const r = await w.portal('Olive-Owner', 'tok-owner-new');
  assert.strictEqual(r.success, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner-new');
});

check('server unreachable + a different sign-in -> keep what is held', async () => {
  const w = makeWorld({ serverDown: true });
  Object.assign(w.store, { clientId: 'Olive-Owner', portalToken: 'tok-owner', environment: 'production' });
  const r = await w.portal('Carl-Client', 'tok-client');
  assert.strictEqual(r.locked, true);
  assert.strictEqual(w.store.portalToken, 'tok-owner');
});

check('server unreachable on a FIRST link still links (a new client must not be stranded)', async () => {
  const w = makeWorld({ serverDown: true });
  const r = await w.portal('Carl-Client', 'tok-client');
  assert.strictEqual(r.success, true);
  assert.strictEqual(w.store.portalToken, 'tok-client');
});

check('after Disconnect, another Portal links - switching is possible but deliberate', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  await w.send({ type: 'CLEAR_AUTH' });
  assert.strictEqual(w.store.portalToken, undefined);
  assert.strictEqual(w.store.ownerName, undefined);
  const r = await w.portal('Carl-Client', 'tok-client');
  assert.strictEqual(r.success, true);
  assert.strictEqual(w.store.ownerName, 'Carl Client');
});

check('acting as the client is refused when LinkedIn is someone else; no work reaches the server', async () => {
  const w = makeWorld();
  await w.portal('Carl-Client', 'tok-client');
  w.calls.length = 0;
  for (const type of ['WG_CHAT', 'LOOKUP_LEAD', 'CREATE_LEAD', 'QUICK_UPDATE']) {
    const r = await w.send({ type, _viewer: 'Olive Owner', payload: { messages: [{}] }, linkedinUrl: 'https://www.linkedin.com/in/x', fields: {}, leadId: 'rec1', content: 'x' });
    assert.strictEqual(r.success, false, `${type} should be refused`);
    assert.strictEqual(r.identityMismatch, true, `${type} should say why`);
    assert.ok(/Olive Owner/.test(r.error) && /Carl Client/.test(r.error), `${type} names both people`);
  }
  assert.ok(w.calls.every((c) => c.url.endsWith('/identity')), 'only identity checks were made');
});

check('the panel is told who it is drafting as, and that the names disagree', async () => {
  const w = makeWorld();
  await w.portal('Carl-Client', 'tok-client');
  const bad = await w.send({ type: 'WG_IDENTITY', _viewer: 'Olive Owner' });
  assert.strictEqual(bad.data.matches, false);
  assert.strictEqual(bad.data.clientName, 'Carl Client');
  const good = await w.send({ type: 'WG_IDENTITY', _viewer: 'Carl Client' });
  assert.strictEqual(good.data.matches, true);
});

check('the owner on their own LinkedIn goes through, and chat carries the LinkedIn name', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  w.calls.length = 0;
  const r = await w.send({ type: 'WG_CHAT', _viewer: 'Olive Owner', payload: { messages: [{ role: 'user' }] } });
  assert.strictEqual(r.success, true);
  const chat = w.calls.find((c) => c.url.endsWith('/chat'));
  assert.ok(chat, 'chat reached the server');
  assert.strictEqual(chat.body.viewerName, 'Olive Owner');
});

check('an agreed verdict is remembered: the second turn makes no extra identity call', async () => {
  const w = makeWorld();
  await w.portal('Olive-Owner', 'tok-owner');
  await w.send({ type: 'WG_CHAT', _viewer: 'Olive Owner', payload: { messages: [{}] } });
  w.calls.length = 0;
  await w.send({ type: 'WG_CHAT', _viewer: 'Olive Owner', payload: { messages: [{}] } });
  assert.strictEqual(w.calls.filter((c) => c.url.endsWith('/identity')).length, 0);
});

check('no LinkedIn name readable -> goes through as before', async () => {
  const w = makeWorld();
  await w.portal('Carl-Client', 'tok-client');
  const r = await w.send({ type: 'WG_CHAT', _viewer: '', payload: { messages: [{}] } });
  assert.strictEqual(r.success, true);
});

check('identity check unreachable -> goes through as before (never blocks on a guess)', async () => {
  const w = makeWorld();
  await w.portal('Carl-Client', 'tok-client');
  const down = makeWorld({ serverDown: true });
  Object.assign(down.store, w.store, { identityVerdict: null });
  const r = await down.send({ type: 'WG_IDENTITY', _viewer: 'Olive Owner' });
  assert.strictEqual(r.data.matches, null);
});

Promise.all(results).then(() => {
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
});
