// A client's own contact facts - meeting link, phone, LinkedIn, timezone - kept in one home
// (services/clientFactSync.js, 13 Oct 2026). Runs on prod as a Render one-off job, like the
// onboarding preflight, because it needs the live record AND the setup-page store.
//
//   node scripts/client-facts.js
//       READ-ONLY. Every active client whose setup page and record disagree (or one side blank).
//
//   node scripts/client-facts.js <Client-ID> meeting_link=<url> phone="0400 000 000" \
//        linkedin=<url> timezone=Sydney [--commit]
//       The door for Claude (the onboard skill) to set these during onboarding: writes the setup
//       page AND the record, exactly as a save on the page does. Without --commit it only prints
//       before -> after. Never edit Meeting Link / Phone / LinkedIn URL / Timezone on the record
//       by hand - that is how Joshua Tunstall ended up with two different Meet links on 12 Oct.
require('dotenv').config();

const clientService = require('../services/clientService');
const store = require('../services/wingguyRulesStore');
const sync = require('../services/clientFactSync');

const ALIASES = {
  meeting_link: 'zoom_room', zoom_room: 'zoom_room',
  phone: 'owner_phone', owner_phone: 'owner_phone',
  linkedin: 'owner_linkedin_profile', owner_linkedin_profile: 'owner_linkedin_profile',
  timezone: 'timezone',
};

async function readSide(clientId) {
  const [vars, assets] = [await store.getVariables({ tenantId: clientId }), await store.getAssets({ tenantId: clientId })];
  return { storeVars: vars, storeAssets: assets };
}

async function check() {
  const clients = await clientService.getAllActiveClients();
  console.log(`=== CLIENT FACTS - setup page vs record, ${clients.length} active clients (read-only) ===\n`);
  let bad = 0;
  for (const client of clients) {
    const diffs = sync.compareClient({ client, ...(await readSide(client.clientId)) });
    if (!diffs.length) continue;
    bad++;
    console.log(`${client.clientName} (${client.clientId})`);
    for (const d of diffs) {
      console.log(`  ${d.fact.padEnd(13)} ${d.problem.padEnd(24)} page: ${d.page || '(blank)'}  |  record: ${d.record || '(blank)'}`);
    }
    console.log('');
  }
  console.log(bad ? `${bad} client(s) with a mismatch.` : 'Every active client agrees on both sides.');
}

async function set(clientId, pairs, commit) {
  const client = await clientService.getClientById(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  const before = await readSide(clientId);
  const vars = new Map(before.storeVars.map((r) => [r.var_key, r.value]));
  const assets = new Map(before.storeAssets.filter((r) => r.status !== 'retired').map((r) => [r.asset_key, r.url]));
  console.log(`=== ${client.clientName} (${clientId}) - ${commit ? 'WRITING' : 'DRY RUN (add --commit to write)'} ===`);
  for (const [rawKey, value] of pairs) {
    const key = ALIASES[rawKey];
    if (!key) throw new Error(`"${rawKey}" is not one of: ${Object.keys(ALIASES).join(', ')}`);
    const pair = sync.PAIRS.find((p) => p.key === key);
    const clean = String(value || '').trim();
    if (pair.scope === 'asset' && clean && !/^https?:\/\/\S+$/i.test(clean)) throw new Error(`${rawKey} must be a https:// link`);
    if (pair.kind === 'timezone' && !sync.zoneFromWords(clean)) throw new Error(`"${clean}" does not pin down one time zone - give a city or e.g. Australia/Sydney`);
    const now = pair.scope === 'variable' ? vars.get(key) : assets.get(key);
    console.log(`  ${pair.field.padEnd(13)} page: ${now || '(blank)'} -> ${clean || '(blank)'}`);
    if (!commit) continue;
    const actor = 'script:client-facts';
    if (pair.scope === 'variable') await store.setVariable({ tenantId: clientId, varKey: key, value: clean, actor });
    else await store.setAsset({ tenantId: clientId, assetKey: key, url: clean, kind: 'url', status: clean ? 'active' : 'retired', actor });
    const r = await sync.syncStoreToRecord({ tenantId: clientId, scope: pair.scope, key, value: clean });
    console.log(`  ${''.padEnd(13)} record: ${r.synced ? `written (${r.value || 'blank'})` : `NOT written - ${r.reason}`}`);
  }
}

(async () => {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const rest = args.filter((a) => a !== '--commit');
  if (!rest.length) return check();
  const [clientId, ...kv] = rest;
  const pairs = kv.map((s) => { const i = s.indexOf('='); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; });
  if (!pairs.length) throw new Error('Nothing to set - e.g. meeting_link=https://meet.google.com/abc-defg-hij');
  return set(clientId, pairs, commit);
})().then(() => process.exit(0)).catch((e) => { console.error(`!! ${e.message}`); process.exit(1); });
