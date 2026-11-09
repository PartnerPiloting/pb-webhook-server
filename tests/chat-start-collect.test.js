/**
 * Panel chat: start the turn, then collect it (9 Nov 2026).
 *
 * A turn takes 20-40+ s and the browser cut a single request at about 30 s: Render logged ~1 turn
 * in 11 as 499 (client closed) between 30 Oct and 9 Nov, each a finished draft thrown away behind
 * "Couldn't reach Wingguy right now" (David Gould, 4 Nov). Contracts:
 *   1. POST /api/wingguy/chat/start answers AT ONCE (202 + jobId) while the turn is still running.
 *   2. GET /chat/result/:id says { done: false } until the turn finishes, then answers with exactly
 *      the status + body the one-shot /chat gives - success and the friendly Claude errors alike.
 *   3. A job belongs to one client: anyone else asking gets 404, same as an unknown id.
 *   4. The old one-shot POST /chat still works (extensions before 0.3.42).
 *   5. The panel that ships: runChatTurn starts, asks until done, rides out a dropped ask, falls
 *      back to the old door on a server without the new ones, and the extension's version is bumped.
 *
 * Synthetic clients, a stand-in agent, no network beyond localhost. Run:
 *   node tests/chat-start-collect.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-platform-test';
process.env.RECALL_COACH_CLIENT_ID = 'Olive-Owner';
delete process.env.DATABASE_URL; // memory copy only

let failures = 0;
let chain = Promise.resolve();
const check = (name, fn) => { chain = chain.then(fn).then(
  () => console.log(`  ✓ ${name}`),
  (e) => { failures++; console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); }
); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLIENTS = {
  'Kim-Keyed': { clientId: 'Kim-Keyed', clientName: 'Kim Keyed', status: 'Active', portalToken: 'tok-kim', anthropicApiKey: 'sk-ant-kim-0000', wingguyEnabled: true },
  'Pat-Other': { clientId: 'Pat-Other', clientName: 'Pat Other', status: 'Active', portalToken: 'tok-pat', anthropicApiKey: 'sk-ant-pat-0000', wingguyEnabled: true },
};
const clientService = require('../services/clientService');
Object.assign(clientService, {
  getClientById: async (id) => CLIENTS[id] || null,
  getClientByPortalToken: async (t) => Object.values(CLIENTS).find((c) => c.portalToken === t) || null,
  getAssistantByPortalToken: async () => null,
  noteClientKeyFailure: async () => {},
});
Object.assign(require('../services/extensionDistStore'), { recordSeen: async () => {}, latestForClient: async () => null });
Object.assign(require('../services/wingguyRulesSource'), {
  detectTemplate: async () => 'reply',
  agentSystem: async () => ({ blocks: [], campaignTemplate: null }),
  shadowCompare: () => {},
});
Object.assign(require('../services/wingguyMonitor'), { recordChatTurn: () => {} });

// The stand-in agent: slow on purpose, so "start answers at once" means something.
let TURN = async () => ({ ok: true, messages: [{ role: 'assistant', content: 'hi' }], reply: 'Here is a draft.', draft: 'Hi Sam - good to connect.' });
const TURN_MS = 400;
const wingguyChat = require('../services/wingguyChat');
wingguyChat.runWingguyChatTurn = async (args) => { await sleep(TURN_MS); return TURN(args); };

const express = require('express');
const app = express();
app.use(express.json());
require('../routes/wingguyRoutes')(app);

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
        let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};
const TURN_BODY = { profile: { name: 'Sam Lead' }, conversation: [], messages: [{ role: 'user', content: 'draft a reply' }] };
async function collect(id, token, maxMs = 5000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const r = await call('GET', `/api/wingguy/chat/result/${id}`, token);
    if (!(r.status === 200 && r.json && r.json.done === false)) return r;
    await sleep(50);
  }
  throw new Error('never finished');
}

console.log('chat start + collect');

check('start answers at once, before the turn is done', async () => {
  const t0 = Date.now();
  const r = await call('POST', '/api/wingguy/chat/start', 'tok-kim', TURN_BODY);
  const took = Date.now() - t0;
  assert.strictEqual(r.status, 202, r.text);
  assert.ok(r.json.jobId, 'a job id');
  assert.ok(took < TURN_MS, `start took ${took} ms, the turn takes ${TURN_MS}`);
  const early = await call('GET', `/api/wingguy/chat/result/${r.json.jobId}`, 'tok-kim');
  assert.strictEqual(early.status, 200);
  assert.deepStrictEqual(early.json, { ok: true, done: false });
});

check('the collected result is the turn, as /chat would send it', async () => {
  const r = await call('POST', '/api/wingguy/chat/start', 'tok-kim', TURN_BODY);
  const done = await collect(r.json.jobId, 'tok-kim');
  assert.strictEqual(done.status, 200);
  assert.strictEqual(done.json.draft, 'Hi Sam - good to connect.');
  assert.strictEqual(done.json.reply, 'Here is a draft.');
  assert.strictEqual(done.json.done, undefined, 'a finished turn never reads as not-done');
  const again = await collect(r.json.jobId, 'tok-kim');
  assert.strictEqual(again.json.draft, 'Hi Sam - good to connect.', 'still there on a second ask');
});

check("another client can't collect it", async () => {
  const r = await call('POST', '/api/wingguy/chat/start', 'tok-kim', TURN_BODY);
  const other = await call('GET', `/api/wingguy/chat/result/${r.json.jobId}`, 'tok-pat');
  assert.strictEqual(other.status, 404);
  const unknown = await call('GET', '/api/wingguy/chat/result/nope', 'tok-kim');
  assert.strictEqual(unknown.status, 404);
  await collect(r.json.jobId, 'tok-kim'); // let it finish before the next check swaps TURN
});

check("a turn's own error comes back with the same status and words", async () => {
  TURN = async () => ({ ok: false, error: 'Claude said no.' });
  let r = await call('POST', '/api/wingguy/chat/start', 'tok-kim', TURN_BODY);
  let done = await collect(r.json.jobId, 'tok-kim');
  assert.strictEqual(done.status, 502);
  assert.strictEqual(done.json.error, 'Claude said no.');
  const one = await call('POST', '/api/wingguy/chat', 'tok-kim', TURN_BODY);
  assert.strictEqual(one.status, 502, 'same as the one-shot door');

  TURN = async () => { const e = new Error('overloaded'); e.status = 529; throw e; };
  r = await call('POST', '/api/wingguy/chat/start', 'tok-kim', TURN_BODY);
  done = await collect(r.json.jobId, 'tok-kim');
  const shot = await call('POST', '/api/wingguy/chat', 'tok-kim', TURN_BODY);
  assert.strictEqual(done.status, shot.status);
  assert.strictEqual(done.json.error, shot.json.error);
  TURN = async () => ({ ok: true, messages: [], reply: 'ok', draft: 'D' });
});

check('the old one-shot /chat still works', async () => {
  const r = await call('POST', '/api/wingguy/chat', 'tok-kim', TURN_BODY);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.draft, 'D');
});

// ---- 5. the extension that ships ----------------------------------------------
const EXT = path.join(__dirname, '..', 'wingguy-extension');
const content = fs.readFileSync(path.join(EXT, 'content-wingguy.js'), 'utf8');
const background = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');

function loadRunChatTurn(bg) {
  const start = content.indexOf('  const CHAT_POLL_MS');
  const end = content.indexOf('  async function sendChatTurn(');
  assert.ok(start > 0 && end > start, 'runChatTurn block found');
  const src = content.slice(start, end).replace('const CHAT_POLL_MS = 2000;', 'const CHAT_POLL_MS = 5;');
  const ctx = { bg, sleep, Date, Error };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.runChatTurn = runChatTurn;`, ctx);
  return ctx.runChatTurn;
}

check('panel: starts, asks until done, rides out a dropped ask', async () => {
  const sent = [];
  let asks = 0;
  const run = loadRunChatTurn(async (m) => {
    sent.push(m.type);
    if (m.type === 'WG_CHAT_START') return { ok: true, jobId: 'j1' };
    asks++;
    if (asks === 2) throw new Error('Failed to fetch');
    if (asks < 4) return { ok: true, done: false };
    return { ok: true, draft: 'D' };
  });
  const out = await run({ messages: [] });
  assert.strictEqual(out.draft, 'D');
  assert.strictEqual(sent[0], 'WG_CHAT_START');
  assert.ok(!sent.includes('WG_CHAT'), 'never the old one-shot message');
});

check("panel: a turn's real error is shown, not retried", async () => {
  let asks = 0;
  const run = loadRunChatTurn(async (m) => {
    if (m.type === 'WG_CHAT_START') return { jobId: 'j2' };
    asks++;
    throw new Error('Claude is busy right now - give it a minute.');
  });
  await assert.rejects(run({}), /Claude is busy/);
  assert.strictEqual(asks, 1);
});

check('panel: an older server (no start door) runs the old way', async () => {
  const run = loadRunChatTurn(async () => ({ legacy: true, data: { draft: 'old-way' } }));
  assert.strictEqual((await run({})).draft, 'old-way');
});

check('extension wiring: new messages act as the client; version bumped past 0.3.41', () => {
  assert.match(background, /'WG_CHAT_START', 'WG_CHAT_RESULT'/);
  assert.match(background, /\/chat\/start/);
  assert.match(background, /\/chat\/result\//);
  assert.doesNotMatch(content, /type: 'WG_CHAT',/, 'panel no longer holds one request open');
  const v = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
  const { compareVersions } = require('../services/extensionPolicy');
  assert.ok(compareVersions(v, '0.3.41') > 0, `version ${v}`);
});

chain.then(() => {
  server && server.close();
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
  process.exit(0);
});
