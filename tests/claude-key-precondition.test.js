/**
 * Tests for "no Claude key, no extension" (Guy, 13 Oct 2026). Guy McPhee hit the extension's
 * "refresh this page" card on a live call with no Anthropic key behind him - after the refresh, /wg
 * would have read the whole profile and then failed at the draft. The key is now checked up front.
 * Contracts:
 *   1. ONE lane rule: anthropicLane says exactly what resolveClientAnthropic does - stored key ->
 *      theirs; owner / managed -> platform; any other client with a blank key -> none-blocked.
 *   2. The preflight prints step 9 as BLOCKED for a keyless BYO client, whatever the install looks
 *      like, and even where the check-in ledger cannot be read. Owner and managed are never blocked.
 *   3. The portal install page is told claudeKeyNeeded, and the download itself is refused (409)
 *      for a keyless BYO client - not just a hidden button. Owner and managed download as before.
 *   4. POST /identity carries claudeKey { ready, lane } - additive, the old fields unchanged.
 *   5. The extension that ships: the background verdict carries the key status and never serves a
 *      "no key" verdict from memory; /wg shows the key card AFTER the refresh / connect /
 *      wrong-person checks and BEFORE the page is read; an older server (no field) changes nothing.
 *
 * Synthetic clients and tokens only, no network beyond localhost. Run:
 *   node tests/claude-key-precondition.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const Module = require('module');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-platform-test';
process.env.RECALL_COACH_CLIENT_ID = 'Olive-Owner';
delete process.env.WINGGUY_PLATFORM_KEY_CLIENTS;
delete process.env.DATABASE_URL;

let failures = 0;
// One at a time: the checks share the stand-in ledger below.
let chain = Promise.resolve();
const check = (name, fn) => { chain = chain.then(fn).then(
  () => console.log(`  ✓ ${name}`),
  (e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
); };

const CLIENTS = {
  'Olive-Owner': { clientId: 'Olive-Owner', clientName: 'Olive Owner', status: 'Active', portalToken: 'tok-owner', anthropicApiKey: '', wingguyEnabled: true },
  'Mona-Managed': { clientId: 'Mona-Managed', clientName: 'Mona Managed', status: 'Active', portalToken: 'tok-managed', anthropicApiKey: '', managedClaudeKey: true, wingguyEnabled: true },
  'Kim-Keyed': { clientId: 'Kim-Keyed', clientName: 'Kim Keyed', status: 'Active', portalToken: 'tok-keyed', anthropicApiKey: 'sk-ant-kim-0000', wingguyEnabled: true },
  'Nell-Nokey': { clientId: 'Nell-Nokey', clientName: 'Nell Nokey', status: 'Active', portalToken: 'tok-nokey', anthropicApiKey: '   ', wingguyEnabled: true },
};
const byToken = (t) => Object.values(CLIENTS).find((c) => c.portalToken === t) || null;
let CHECKINS = {}; // clientId -> latest check-in row

// Stand-ins for the record and the check-in ledger. Patched on the real module objects BEFORE the
// routes load, because extensionDistRoutes destructures latestForClient at require time.
const clientService = require('../services/clientService');
Object.assign(clientService, {
  getClientById: async (id) => CLIENTS[id] || null,
  getClientByPortalToken: async (t) => byToken(t),
  getAssistantByPortalToken: async () => null,
});
const extensionDistStore = require('../services/extensionDistStore');
Object.assign(extensionDistStore, {
  latestForClient: async (id) => CHECKINS[id] || null,
  recordCheckin: async () => {},
});
// adm-zip builds the download; the gate under test answers before it is touched.
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'adm-zip') return 'adm-zip-stub';
  return realResolve.call(this, request, ...rest);
};
require.cache['adm-zip-stub'] = { id: 'adm-zip-stub', filename: 'adm-zip-stub', loaded: true,
  exports: class { addLocalFolder() {} toBuffer() { return Buffer.from('PK-zip'); } } };

const { anthropicLane, resolveClientAnthropic } = require('../config/anthropicClient');

console.log('claude key precondition');

// ---- 1. one lane rule --------------------------------------------------------
check('lanes: stored key / owner / managed / keyless BYO', () => {
  assert.strictEqual(anthropicLane(CLIENTS['Kim-Keyed']), 'client-stored-key');
  assert.strictEqual(anthropicLane(CLIENTS['Olive-Owner']), 'platform-fallback');
  assert.strictEqual(anthropicLane(CLIENTS['Mona-Managed']), 'platform-fallback');
  assert.strictEqual(anthropicLane(CLIENTS['Nell-Nokey']), 'none-blocked', 'a whitespace key is no key');
  assert.strictEqual(anthropicLane(null), 'none-blocked');
});
check('resolveClientAnthropic agrees with anthropicLane, and only none-blocked has no client', () => {
  for (const c of Object.values(CLIENTS)) {
    const r = resolveClientAnthropic(c);
    assert.strictEqual(r.lane, anthropicLane(c), c.clientId);
    assert.strictEqual(r.llm === null, r.lane === 'none-blocked', c.clientId);
  }
});

// ---- 2. the preflight's step 9 ----------------------------------------------------
const { runPreflight } = require('../services/onboardingPreflight');
const step9 = async (id) => (await runPreflight(id)).steps.find((s) => s.n === 9);

check('preflight: keyless BYO, nothing installed -> BLOCKED, and readable without a database', async () => {
  CHECKINS = {};
  const s = await step9('Nell-Nokey');
  assert.strictEqual(s.verdict, 'owed');
  assert.match(s.evidence, /^BLOCKED - no Claude key yet, do the key first \(step 11\)/);
});
check('preflight: keyless BYO with a working install is STILL blocked (the McPhee case)', async () => {
  CHECKINS = { 'Nell-Nokey': { version: '0.3.33', action: 'downloaded', checked_in_at: new Date().toISOString(), machine: 'portal-download' } };
  const s = await step9('Nell-Nokey');
  assert.strictEqual(s.verdict, 'owed');
  assert.match(s.evidence, /^BLOCKED - no Claude key yet/);
  assert.match(s.evidence, /0\.3\.33/, 'still says what is installed');
});
check('preflight: step 11 says the extension waits on the key', async () => {
  const r = await runPreflight('Nell-Nokey');
  assert.match(r.steps.find((s) => s.n === 11).evidence, /step 9/);
});
check('preflight: owner, managed and keyed clients are never key-blocked', async () => {
  CHECKINS = {};
  for (const id of ['Olive-Owner', 'Mona-Managed', 'Kim-Keyed']) {
    const s = await step9(id);
    assert.doesNotMatch(s.evidence, /BLOCKED - no Claude key/, id);
  }
});

// ---- 3 + 4. the routes, on a real Express app ----------------------------------------
const express = require('express');
const app = express();
app.use(express.json());
app.use('/extension/dist', require('../routes/extensionDistRoutes'));
const wingguyApp = express();
wingguyApp.use(express.json());
require('../routes/wingguyRoutes')(wingguyApp);
// mountWingguy mounts its router itself; find where, so the test follows the real path.
app.use(wingguyApp);

let server;
const listening = new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
const call = async (method, url, token, body) => {
  await listening;
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: url,
      headers: { 'x-portal-token': token, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null; try { json = JSON.parse(text); } catch (_) { /* zip */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

check('portal-status: claudeKeyNeeded only for the keyless BYO client', async () => {
  CHECKINS = {};
  const want = { 'tok-nokey': true, 'tok-keyed': false, 'tok-owner': false, 'tok-managed': false };
  for (const [tok, needed] of Object.entries(want)) {
    const r = await call('GET', '/extension/dist/portal-status', tok);
    assert.strictEqual(r.status, 200, tok);
    assert.strictEqual(r.json.claudeKeyNeeded, needed, tok);
    assert.ok(r.json.current, 'still reports the current version');
  }
});
check('download: refused (409) for the keyless BYO client, served to the others', async () => {
  const no = await call('GET', '/extension/dist/download', 'tok-nokey');
  assert.strictEqual(no.status, 409);
  assert.strictEqual(no.json.claudeKeyNeeded, true);
  for (const tok of ['tok-keyed', 'tok-owner', 'tok-managed']) {
    const ok = await call('GET', '/extension/dist/download', tok);
    assert.strictEqual(ok.status, 200, tok);
  }
});

const findIdentityPath = () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'wingguyRoutes.js'), 'utf8');
  const m = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*router\s*\)/.exec(src);
  assert.ok(m, 'could not find where wingguyRoutes mounts its router');
  return `${m[1]}/identity`;
};
check('/identity: keyless client gets claudeKey.ready=false, old fields unchanged', async () => {
  const r = await call('POST', findIdentityPath(), 'tok-nokey', { viewerName: 'Nell Nokey' });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.clientId, 'Nell-Nokey');
  assert.strictEqual(r.json.matches, true);
  assert.deepStrictEqual({ ready: r.json.claudeKey.ready, lane: r.json.claudeKey.lane }, { ready: false, lane: 'none-blocked' });
  assert.match(r.json.claudeKey.message, /Claude key isn't set up/);
});
check('/identity: keyed, owner and managed clients are ready', async () => {
  for (const [tok, lane] of [['tok-keyed', 'client-stored-key'], ['tok-owner', 'platform-fallback'], ['tok-managed', 'platform-fallback']]) {
    const r = await call('POST', findIdentityPath(), tok, { viewerName: '' });
    assert.strictEqual(r.json.claudeKey.ready, true, tok);
    assert.strictEqual(r.json.claudeKey.lane, lane, tok);
  }
});

// ---- 5. the extension that ships ---------------------------------------------------
function backgroundWorld(serverSays) {
  const store = { clientId: 'Nell-Nokey', portalToken: 'tok-nokey', environment: 'production' };
  let listener = null;
  let identityCalls = 0;
  const opened = [];
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }, getManifest: () => ({ version: 'test' }) },
    tabs: { query: (_q, cb) => cb([]), sendMessage: () => Promise.resolve(), create: (o, cb) => { opened.push(o.url); if (cb) cb(); } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    scripting: { insertCSS: () => Promise.resolve(), executeScript: () => Promise.resolve() },
    storage: { onChanged: { addListener() {} }, local: {
      get(keys, cb) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; cb(out); },
      set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
      remove(keys, cb) { for (const k of [].concat(keys)) delete store[k]; if (cb) cb(); } } },
  };
  const fetch = async (url) => {
    if (url.endsWith('/identity')) {
      identityCalls++;
      return { ok: true, status: 200, json: async () => ({ ok: true, clientId: 'Nell-Nokey', clientName: 'Nell Nokey', matches: true, message: '', ...serverSays() }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const sandbox = { chrome, fetch, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, Date, Promise, JSON, encodeURIComponent };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'background.js'), 'utf8'), sandbox);
  const send = (message) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer to ${message.type}`)), 2000);
    listener(message, {}, (resp) => { clearTimeout(t); resolve(resp); });
  });
  return { send, opened, calls: () => identityCalls };
}

check('extension: the verdict carries the key status, and a "no key" verdict is re-asked every time', async () => {
  let ready = false;
  const w = backgroundWorld(() => ({ claudeKey: { ready, lane: ready ? 'client-stored-key' : 'none-blocked', message: '' } }));
  const a = await w.send({ type: 'WG_IDENTITY', _viewer: 'Nell Nokey' });
  assert.strictEqual(a.data.claudeKey.ready, false);
  ready = true; // they paste their key in the Portal
  const b = await w.send({ type: 'WG_IDENTITY', _viewer: 'Nell Nokey' });
  assert.strictEqual(b.data.claudeKey.ready, true, 'saw the new key straight away');
  assert.strictEqual(w.calls(), 2);
  await w.send({ type: 'WG_IDENTITY', _viewer: 'Nell Nokey' });
  assert.strictEqual(w.calls(), 2, 'a ready verdict is remembered as before');
});
check('extension: an older server (no claudeKey field) gives claudeKey null - nothing changes', async () => {
  const w = backgroundWorld(() => ({}));
  const r = await w.send({ type: 'WG_IDENTITY', _viewer: 'Nell Nokey' });
  assert.strictEqual(r.data.claudeKey, null);
  assert.strictEqual(r.data.matches, true);
});
check('extension: OPEN_CLAUDE_KEY opens their own key box with the sign-in it holds', async () => {
  const w = backgroundWorld(() => ({}));
  const r = await w.send({ type: 'OPEN_CLAUDE_KEY' });
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(w.opened, ['https://pb-webhook-server.vercel.app/my-wingguy/setup?token=tok-nokey#claude-key']);
});

check('extension: /wg checks the key after refresh/connect/wrong-person and before the page is read', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js'), 'utf8');
  const start = src.indexOf('async function openPanel()');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  const at = (needle) => { const i = body.indexOf(needle); assert.ok(i > 0, `openPanel lost: ${needle}`); return i; };
  const refresh = at('renderRefreshCard()');
  const connect = at('renderConnectCard()');
  const wrong = at('renderWrongPersonCard(who)');
  const key = at('renderClaudeKeyCard()');
  const read = at('scrapeProfile()');
  assert.ok(refresh < key && connect < key && wrong < key, 'key card must come after the refresh/connect/wrong-person checks');
  assert.ok(key < read, 'key card must come before the page is read');
  assert.match(body, /who\.claudeKey\.ready === false/, 'only a definite "no key" stops the panel');
  assert.match(src, /function renderClaudeKeyCard\(\)/);
  assert.match(src, /Your Claude key isn't set up yet/);
  assert.match(src, /https:\/\/knowaguy\.com\.au\/your-claude-key/);
});
check('extension: manifest version moved past 0.3.33 (the updater does nothing on a match)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'manifest.json'), 'utf8')).version;
  const n = v.split('.').map(Number);
  assert.ok(n[0] > 0 || n[1] > 3 || n[2] > 33, `version ${v}`);
});

chain.then(() => {
  if (server) server.close();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
  process.exit(0);
});
