// services/clientJourney.js
// The client journey - the eight stops in content/client-journey.json - with where THIS client is
// up to on it. Drawn at the top of the portal's Start Here page.
//
// One written journey (Guy, 5 Oct 2026). The words and the order live in the JSON file and nowhere
// else. This file only answers "which stops has this client done?", and it answers from the LIVE
// system every time - the record and the stores - never from a stored checklist, because a stored
// ledger drifts (the same rule as services/onboardingPreflight.js).
//
// What a client is shown is deliberately gentler than the coach's preflight:
//   done    - we can SEE it is in place
//   started - part of it is in place
//   todo    - not yet
// "done" is only ever claimed from a real signal. A stop we cannot see (for instance whether they
// have had their Linked Helper session) is 'todo' until its signal appears - it never guesses.
// The first stop that is not done is marked `current`: that is "you are here".

const path = require('path');
const fs = require('fs');

const FILE = path.join(__dirname, '..', 'content', 'client-journey.json');
let cached = null;
function loadJourney() {
  if (!cached) cached = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return cached;
}

const present = (v) => Boolean(v && String(v).trim());
const yes = (v) => String(v || '').trim() === 'Yes';

/**
 * Pure: the status of each stop from plain facts about the client.
 * @param {object} f  facts - every one a boolean (see gatherFacts)
 * @returns {{ [key]: 'done'|'started'|'todo' }}
 */
function statusFromFacts(f = {}) {
  const pick = (done, started) => (done ? 'done' : started ? 'started' : 'todo');
  return {
    claude: pick(f.usedClaude, false),
    reconnect: pick(f.reconnectOn, f.linkedinConnected),
    voice: pick(f.hasKey && f.voiceDone, f.hasKey || f.voiceStarted),
    linkedin: pick(f.extensionSeen, false),
    calendar: pick(f.calendarConnected, false),
    calls: pick(f.recorderConnected, false),
    rhythm: pick(f.followUpsOn && (f.extensionSeen || f.reconnectOn), f.followUpsOn),
    newpeople: pick(f.machineSeen && f.leadsArriving, f.machineSeen),
  };
}

/** Pure: the journey with a status on every stop and exactly one `current` (none when all done). */
function buildJourney(journey, statuses) {
  let currentSet = false;
  const stops = journey.stops.map((s, i) => {
    const status = statuses[s.key] || 'todo';
    const current = !currentSet && status !== 'done';
    if (current) currentSet = true;
    return { ...s, n: i + 1, status, current };
  });
  const done = stops.filter((s) => s.status === 'done').length;
  return { title: journey.title, lede: journey.lede, whyFirst: journey.whyFirst, stops, done, total: stops.length, complete: done === stops.length };
}

async function one(db, sql, params) {
  try { const r = await db.query(sql, params); return r.rows[0] || null; } catch (_) { return null; } // a missing table = no signal
}

/** The facts, read live. Every probe is best-effort: a failed one counts as "not seen". */
async function gatherFacts(client, deps = {}) {
  const tenant = client.clientId;
  const f = {
    hasKey: present(client.anthropicApiKey) || !!client.managedClaudeKey,
    linkedinConnected: present(client.unipileLinkedinAccountId),
    reconnectOn: yes(client.reconnect),
    calendarConnected: present(client.unipileAccountId) || present(client.nylasGrantId) || present(client.calendarProvider),
    recorderConnected: present(client.fathomApiKey) || present(client.granolaApiKey) || present(client.firefliesApiKey),
    followUpsOn: yes(client.followupBrief),
    machineSeen: present(client.machineLastSeen),
  };
  const db = deps.db || (() => {
    const url = (process.env.DATABASE_URL || '').trim();
    if (!url) return null;
    const { Pool } = require('pg');
    gatherFacts.pool = gatherFacts.pool || new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    return gatherFacts.pool;
  })();
  if (db) {
    const [chat, learn, ext, collect] = await Promise.all([
      one(db, 'SELECT 1 FROM wingguy_chat_metrics WHERE tenant_id = $1 LIMIT 1', [tenant]),
      one(db, 'SELECT 1 FROM wingguy_learning_events WHERE tenant_id = $1 LIMIT 1', [tenant]),
      one(db, 'SELECT 1 FROM wingguy_extension_checkins WHERE client_id = $1 LIMIT 1', [tenant]),
      one(db, 'SELECT 1 FROM linkedin_collect_status WHERE tenant_id = $1 LIMIT 1', [tenant]),
    ]);
    f.usedClaude = !!(chat || learn);
    f.extensionSeen = !!ext;
    if (collect) f.linkedinConnected = true; // still counts after the month-end switch-off
  }
  try {
    const store = deps.store || require('./wingguyRulesStore');
    const fields = deps.fields || require('../config/wingguySetupFields');
    const [rules, varRows, assetRows] = [
      await store.getActiveRules({ tenantId: tenant, layer: 'client' }),
      await store.getVariables({ tenantId: tenant }),
      await store.getAssets({ tenantId: tenant }),
    ];
    const vars = new Map(varRows.map((r) => [r.var_key, String(r.value || '').trim()]));
    const assets = new Map(assetRows.filter((r) => r.status !== 'retired').map((r) => [r.asset_key, String(r.url || '').trim()]));
    const essentials = [
      ...fields.VARIABLE_FIELDS.filter((x) => x.tier === 'essential').map((x) => present(vars.get(x.key))),
      ...fields.ASSET_FIELDS.filter((x) => x.tier === 'essential').map((x) => present(assets.get(x.key))),
      ...fields.VOICE_FIELDS.filter((x) => x.tier === 'essential').map((x) => present(vars.get(x.key))),
    ];
    const filled = essentials.filter(Boolean).length;
    f.voiceDone = rules.length > 0 && filled === essentials.length;
    f.voiceStarted = filled > 0;
  } catch (_) { /* the instructions store is down - voice stays 'todo' rather than guessing */ }
  // "Really going" = the machine reports its Linked Helper as RUNNING or IDLE, which it only does
  // once someone has signed in on it (before that it says WAITING FOR SIGN-IN). Two signals that
  // look right and are NOT used: the account number on the record (typed in from an export before
  // anyone signs in - Roland Illyes read "done" on 5 Oct 2026 with nobody signed in), and the
  // "LinkedIn ok / LOGGED OUT" part of the status (it reads LOGGED OUT whenever the runner is
  // mid-task on a profile page - Guy's own working machine read LOGGED OUT the same night).
  f.leadsArriving = f.machineSeen && /^\s*(RUNNING|IDLE)\b/.test(String(client.machineStatus || ''));
  return f;
}

/**
 * Who is shown the journey. It describes the NEW way of onboarding, with Reconnect second - so a
 * client who was set up before Reconnect existed is not shown it: for them it would announce a
 * feature Guy has not offered them, with "you are here" on it. They see it from the moment they are
 * on the new road: their LinkedIn is connected, or their Reconnect list is on. The owner always
 * sees it. (Widening this to every client is Guy's call, client by client or all at once.)
 */
function onNewJourney(client, ownerId) {
  if (!client) return false;
  return client.clientId === ownerId || present(client.unipileLinkedinAccountId) || yes(client.reconnect);
}

/** The journey for one client, ready for the page. */
async function journeyFor(clientId, deps = {}) {
  const clientService = deps.clientService || require('./clientService');
  const client = await clientService.getClientById(clientId);
  if (!client) return null;
  const facts = await gatherFacts(client, deps);
  return buildJourney(loadJourney(), statusFromFacts(facts));
}

module.exports = { loadJourney, statusFromFacts, buildJourney, gatherFacts, journeyFor, onNewJourney };
