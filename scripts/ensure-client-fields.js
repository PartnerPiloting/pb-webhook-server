/**
 * Ensure a defined set of Airtable fields exists across ALL client bases,
 * the CLIENT TEMPLATE, and the master Clients base.
 *
 * This is the standard, reusable field-rollout tool. To roll out a new field
 * in future, just add it to LEADS_FIELDS (per-client Leads tables) or
 * MASTER_FIELDS (the master Clients table) below and re-run. It is IDEMPOTENT
 * — every base is checked and any field that already exists is skipped, so it
 * is safe to run repeatedly.
 *
 * ⚠ THE TEMPLATE IS A DEFAULT TARGET. New clients are duplicated from
 * "My Leads - Client Template" (app6W6k9GiDlJktvt), which lives OUTSIDE the
 * master Clients base, so a field missed there is silently absent for every
 * future client (validated writes drop unknown fields). This script always
 * includes the template unless you pass --skip-template. Do not remove that
 * default — it is the whole point (see memory: feedback_airtable_field_rollout_includes_template).
 *
 * Usage:
 *   node scripts/ensure-client-fields.js --audit       # compare template vs all clients, list drift (read-only)
 *   node scripts/ensure-client-fields.js --dry-run     # report what's missing, change nothing
 *   node scripts/ensure-client-fields.js               # apply to all clients + template + master
 *   node scripts/ensure-client-fields.js --client=Guy-Wilson   # one client only (still + template/master unless skipped)
 *   node scripts/ensure-client-fields.js --skip-template       # clients + master only
 *   node scripts/ensure-client-fields.js --skip-master         # leads tables only (clients + template)
 *
 * Prerequisites (server environment — run via Render one-off job, not locally):
 *   - AIRTABLE_API_KEY (with schema/metadata write permission)
 *   - MASTER_CLIENTS_BASE_ID
 *   - CLIENT_TEMPLATE_BASE_ID (base id of "My Leads - Client Template" — Guy owns this value;
 *       the token must also have access to that base, or template steps 403)
 */

require('dotenv').config();
const Airtable = require('airtable');

// ============================================
// CONFIGURATION
// ============================================

// Template base ID comes from the env var (Guy owns the source of truth). Falls back to the
// previously-hardcoded id only if the env var is unset (which would likely 403 — that's the signal to set it).
// Fallback corrected 2026-07-23: the old fallback ('app6W6k9GiDUlktvt') was a TYPO'd id — Airtable
// reports a nonexistent base as 403 "not authorized", so template runs failed looking like a
// permissions problem. Prod sets CLIENT_TEMPLATE_BASE_ID (correct value) so prod runs were fine;
// the fallback only bit env-less runs. Two STALE bases share the template's name — never use
// appl1yvqhaWHKEtlN or appIvp0Ieuuc6bLJq.
const TEMPLATE_BASE_ID = process.env.CLIENT_TEMPLATE_BASE_ID || 'app6W6k9GiDlJktvt';
const MASTER_TABLE = 'Clients';               // matches constants/airtableUnifiedConstants MASTER_TABLES.CLIENTS
const LEADS_TABLE = 'Leads';                  // CLIENT_TABLES.LEADS
const BASE_ID_FIELD = 'Airtable Base ID';
const CLIENT_ID_FIELD = 'Client ID';

// Fields to ensure on every client Leads table AND the template's Leads table.
const LEADS_FIELDS = [
  {
    name: 'Thanks Status',
    type: 'singleSelect',
    description: 'Connection-follow-up worklist ("Thanks for Connecting") state. Blank = Outstanding (connected, in window, not yet decided). Messaged = personally reached out. Skipped = left to the LinkedIn Helper automated sequence (incl. auto-resolved by the LH message-sent webhook). Added 2026-06-20. NOTE: bases provisioned 2026-06-20 got a "Let go" choice instead of "Skipped"; the app now writes "Skipped" (auto-created via typecast) and treats legacy "Let go" as "Skipped" — the stale choice can be removed by hand. New bases get "Skipped" from the start.',
    options: {
      choices: [
        { name: 'Messaged', color: 'greenLight2' },
        { name: 'Skipped', color: 'grayLight2' }
      ]
    }
  },
  {
    name: 'Alt Emails',
    type: 'multilineText',
    description: "Secondary / 'also known as' emails for this person (e.g. business email used to book vs the personal email on LinkedIn). Newline-separated, lowercase. Read as a fallback by findLeadByEmail; auto-populated by the email self-healing write-back (services/inboundEmailService.js learnEmailForLead). Added 2026-06-17 for email-identity hardening; template backfilled 2026-06-20."
  },
  {
    name: 'Reconnect On',
    type: 'date',
    description: "Engine-written follow-up reconnect date (the 'ping them ~this date' promise). The follow-up sweep (wingguy_followup_sweep) surfaces the lead at DEFERRAL DUE tier once this arrives, and parks them from cadence nudges until then. Written by wingguy_set_reconnect on propose-then-confirm — not hand-typed. NOT the legacy Follow-Up Date. Added 2026-07-23; all client bases + template backfilled same day.",
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }
  },
  {
    name: 'Cease FUP At',
    type: 'dateTime',
    description: "Engine-written timestamp of the moment Cease FUP was set (wingguy_cease_followups). The waiver line: a reply the lead was owed BEFORE this moment is considered deliberately let go and stops surfacing in follow-ups; an inbound NEWER than this still surfaces (a reply is a reply). Cleared when the lead is re-opened. Blank on leads ceased before the rollout = legacy always-surface behavior. Added 2026-07-28.",
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' }, timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone: 'utc' }
  }
];

// Fields to ensure on the master Clients base's Clients table (per-client config).
const MASTER_FIELDS = [
  {
    name: 'Anthropic Key Added At',
    type: 'dateTime',
    description: 'When the client\'s BYO Anthropic key was last saved (portal "Your Claude key" section or a re-check that passed). Written by clientService.updateClientAnthropicKey; shown masked on the setup page. Blank on keys pasted into Airtable by hand before this rollout. Added 2026-08-28 (Julian\'s key-ran-out session).',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' }, timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone: 'utc' }
  },
  {
    name: 'Anthropic Key Failing Since',
    type: 'dateTime',
    description: 'First moment the client\'s stored Anthropic key was rejected mid-flight (revoked, or account out of credit / over its spend limit). Stamped fire-and-forget by clientService.noteClientKeyFailure from the drafting error path; drives the red "your key stopped working" banner on the setup page. Cleared whenever a key is saved or re-checked good. Blank = no standing failure. Added 2026-08-28.',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' }, timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone: 'utc' }
  },
  {
    name: 'Anthropic Key Fail Reason',
    type: 'singleLineText',
    description: 'Why the stored Anthropic key is failing: "revoked" (invalid/revoked key) or "billing" (credit/spend limit). Written beside Anthropic Key Failing Since; cleared with it. Added 2026-08-28.'
  },
  {
    name: 'Stripe Customer ID',
    type: 'singleLineText',
    description: 'The client\'s Stripe customer id (cus_...). When set, billing lookups (portal Billing page, entitlement) address Stripe by this id instead of guessing by email - the join key between the Clients table and Stripe. Written by the Stripe checkout webhook for new signups; backfilled by hand for existing members during the PMPro cutover (stage 6). Added 2026-08-25 (Stripe cutover stage 2).'
  },
  {
    name: 'Email Series Start Date',
    type: 'date',
    description: 'When the client email series (the 14-piece drip, content/one-pagers/SERIES-ARC.md) starts for this client. Per-client choice, set during onboarding; the convention is the END of onboarding (the Linked Helper launch session), so the drip takes over the drumbeat when the weekly sessions stop and fills the collection quiet zone. Blank = series not started. The drip engine (not yet built) sends nothing before this date. Added 2026-08-23.',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }
  },
  {
    name: 'Connection Lookback Days',
    type: 'number',
    description: 'Thanks-for-Connecting worklist: only connections from the last N days appear in the Outstanding queue. Set to roughly match this client\'s Linked Helper follow-up window. Empty is treated as 14 by the app. Added 2026-06-20.',
    options: { precision: 0 }
  },
  {
    name: 'Thanks for Connecting',
    type: 'singleSelect',
    description: 'Per-client feature switch: show the "Thanks for Connecting" worklist tab in the portal for this client when set to Yes. Blank/No = hidden (default). Roll out client-by-client by flipping to Yes. Added 2026-06-20.',
    options: {
      choices: [
        { name: 'Yes', color: 'greenBright' },
        { name: 'No', color: 'grayBright' }
      ]
    }
  },
  {
    name: 'Followup Brief',
    type: 'singleSelect',
    description: 'Per-client switch for the overnight PREPARED follow-up brief (services/wingguyFollowupBrief.js): Yes = the nightly cron prepares this client\'s brief (sweep + read their threads + triage + pre-write reply drafts, stored for instant serving in their Wingguy chat). Blank/No = not prepared automatically (they can still trigger it on demand in chat). Opt-in by design. Added 2026-07-23.',
    options: {
      choices: [
        { name: 'Yes', color: 'greenBright' },
        { name: 'No', color: 'grayBright' }
      ]
    }
  },
  {
    name: 'Transcript Provider',
    type: 'singleSelect',
    description: 'Which capture tool feeds this client\'s meeting transcripts into the store (services/transcriptProvider.js seam). Blank = Fathom (every existing client, unchanged). Granola = the client\'s Granola note-taker pushes via webhook (needs Granola API Key + Granola Webhook Secret below, Granola Business plan). Fireflies = the client\'s Fireflies account pushes via webhook (needs Fireflies API Key + Fireflies Webhook Secret below, paid Fireflies plan; added 2026-08-13 — on the LIVE master base add this choice by hand, the script skips existing fields). Zoom = reserved for Zoom My Notes once its public API ships (until then it means transcripts arrive via the manual import door). Added 2026-07-29.',
    options: {
      choices: [
        { name: 'Fathom', color: 'blueBright' },
        { name: 'Granola', color: 'greenBright' },
        { name: 'Fireflies', color: 'orangeBright' },
        { name: 'Zoom', color: 'cyanBright' }
      ]
    }
  },
  {
    name: 'Granola API Key',
    type: 'singleLineText',
    description: 'The client\'s own Granola API key (grn_...), created by them in Granola (Business plan). Used to fetch their notes + transcripts when their Granola webhook fires, and to register that webhook (scripts/register-granola-webhook.js). Plaintext-at-rest like the other credential fields in this base. Added 2026-07-29.'
  },
  {
    name: 'Granola Webhook Secret',
    type: 'singleLineText',
    description: 'Signing secret for this client\'s Granola webhook registration — returned ONCE by scripts/register-granola-webhook.js; paste it here immediately. The webhook route (/webhooks/granola/<Client ID>) verifies every delivery against THIS value and rejects all traffic while it\'s blank, so the Granola pipe is not live until this is set. Added 2026-07-29.'
  },
  {
    name: 'Fireflies API Key',
    type: 'singleLineText',
    description: 'The client\'s own Fireflies API key, copied by them from Fireflies Settings -> Developer settings (paid plan recommended: free-tier API sentence access is not guaranteed). Used to fetch their transcripts over GraphQL when their Fireflies webhook fires. Plaintext-at-rest like the other credential fields in this base. Added 2026-08-13.'
  },
  {
    name: 'Fireflies Webhook Secret',
    type: 'singleLineText',
    description: 'Signing secret for this client\'s Fireflies webhook — the client sets it themselves in Fireflies Settings -> Developer settings (16-32 chars) in the same screen where they paste our webhook URL (/webhooks/fireflies/<Client ID>); copy the same value here. The route verifies every delivery\'s x-hub-signature against THIS value and rejects all traffic while it\'s blank, so the Fireflies pipe is not live until both sides hold it. Added 2026-08-13.'
  },
  {
    name: 'Capture Mode',
    type: 'singleSelect',
    description: 'Capture security gate (services/capturePolicyStore.js). Blank or Open = every recording the client\'s transcript provider produces is fetched and filed (behaviour before this field existed). Leads Only = a transcript is fetched ONLY when someone on the call is already one of the client\'s leads; anything else is declined statelessly - never fetched, never stored, not even the title. Kills new-prospect impromptu capture for that client by design (miss beats leak), so leave blank for normal networking clients. Added 2026-08-07.',
    options: {
      choices: [
        { name: 'Open', color: 'grayBright' },
        { name: 'Leads Only', color: 'redBright' }
      ]
    }
  },
  {
    name: 'Capture Hold Minutes',
    type: 'number',
    description: 'Capture holding window in minutes (services/capturePolicyStore.js). Blank or 0 = transcripts are fetched and filed as soon as the provider announces them (behaviour before this field existed). N > 0 = the capture sits in a visible queue for N minutes with only its metadata held - the words are not fetched until release. The client can veto or release-now through chat. E.g. Ashley 240. Added 2026-08-07.',
    options: { precision: 0 }
  },
  {
    name: 'Anthropic API Key',
    type: 'singleLineText',
    description: 'Client\'s own (BYO) Anthropic API key. When present, Wingguy runs THIS client\'s server-side work (nightly follow-up brief, and the Chrome extension\'s drafting) on their key + their spend cap, not the platform key. Resolution order: request header -> this stored key -> platform key. Falls back to platform ONLY when absent; a FAILING key here (revoked/capped) must surface, not silently fall through. Client sets a spend cap + can revoke instantly (Anthropic Console), so worst-case cost is a number they chose. Plaintext-at-rest like the portal tokens in this base. Added 2026-07-24.'
  },
  {
    name: 'Extension Folder Provider',
    type: 'singleSelect',
    description: 'Which cloud holds this client\'s Wingguy extension update folder (scripts/ship-extension.js pushes every ship into it). gdrive = a Google Drive folder shared to Guy as Editor. onedrive = a OneDrive folder - the client\'s own (work or personal, shared to Guy with edit rights) or a Guy-owned folder shared out where that works. Blank = no update folder yet; the client is on hand-delivered updates. A personal-OneDrive share can NEVER sync into a client\'s Microsoft 365 work account, which is why M365 clients own their folder and share it inward. Added 2026-08-20.',
    options: {
      choices: [
        { name: 'gdrive', color: 'greenBright' },
        { name: 'onedrive', color: 'blueBright' }
      ]
    }
  },
  {
    name: 'Extension Folder Ref',
    type: 'singleLineText',
    description: 'The update folder itself, captured once at the extension onboarding step: for gdrive the folder ID out of the folder\'s drive.google.com URL; for onedrive the folder\'s share link. scripts/ship-extension.js resolves it, uploads the build, and verifies the folder\'s manifest version after every push. Added 2026-08-20.'
  }
];

// ============================================
// HELPERS (Airtable Metadata API)
// ============================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTables(baseId) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`get tables ${baseId}: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).tables;
}

async function addField(baseId, tableId, fieldDefinition) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(fieldDefinition)
  });
  if (!response.ok) {
    throw new Error(`add field "${fieldDefinition.name}": ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

const stats = { added: 0, skipped: 0, errors: 0 };

async function ensureFields(label, baseId, tableName, fieldDefs, dryRun) {
  process.stdout.write(`\n• ${label} (${baseId})\n`);
  let tables;
  try {
    tables = await getTables(baseId);
  } catch (err) {
    console.log(`    ❌ could not read schema: ${err.message}`);
    stats.errors++;
    return;
  }
  const table = tables.find((t) => t.name === tableName);
  if (!table) {
    console.log(`    ❌ table "${tableName}" not found`);
    stats.errors++;
    return;
  }
  const existingNames = new Set(table.fields.map((f) => f.name));
  for (const def of fieldDefs) {
    if (existingNames.has(def.name)) {
      console.log(`    ⏭️  "${def.name}" already exists`);
      stats.skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`    ➕ would add "${def.name}" (${def.type})`);
      stats.added++;
      continue;
    }
    try {
      await addField(baseId, table.id, def);
      console.log(`    ✅ added "${def.name}"`);
      stats.added++;
      await sleep(250); // be gentle with the metadata API rate limit
    } catch (err) {
      console.log(`    ❌ "${def.name}": ${err.message}`);
      stats.errors++;
    }
  }
}

async function getClients(filterClientId) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);
  const clients = [];
  await base(MASTER_TABLE).select({ fields: [CLIENT_ID_FIELD, BASE_ID_FIELD] })
    .eachPage((records, next) => {
      for (const r of records) {
        const baseId = r.get(BASE_ID_FIELD);
        const clientId = r.get(CLIENT_ID_FIELD);
        if (!baseId) continue;
        if (filterClientId && clientId !== filterClientId) continue;
        clients.push({ clientId: clientId || '(unnamed)', baseId });
      }
      next();
    });
  return clients;
}

// ============================================
// AUDIT — compare template vs all clients (read-only)
// ============================================

async function runAudit() {
  console.log('🔎 Schema audit — template vs clients (Leads table), read-only\n');
  const clients = await getClients(null);
  const total = clients.length;
  console.log(`Scanning ${total} client base(s) + template...\n`);

  const fieldInfo = new Map(); // name -> { count, type }
  for (const c of clients) {
    let tables;
    try { tables = await getTables(c.baseId); }
    catch (err) { console.log(`  ⚠ ${c.clientId}: ${err.message}`); continue; }
    const leads = tables.find((t) => t.name === LEADS_TABLE);
    if (!leads) { console.log(`  ⚠ ${c.clientId}: no Leads table`); continue; }
    for (const f of leads.fields) {
      const e = fieldInfo.get(f.name) || { count: 0, type: f.type };
      e.count++; fieldInfo.set(f.name, e);
    }
  }

  let templateFields = new Set();
  try {
    const tTables = await getTables(TEMPLATE_BASE_ID);
    const tLeads = tTables.find((t) => t.name === LEADS_TABLE);
    templateFields = new Set((tLeads ? tLeads.fields : []).map((f) => f.name));
  } catch (err) {
    console.log(`❌ could not read template (${TEMPLATE_BASE_ID}): ${err.message}`);
    return;
  }

  const missing = [...fieldInfo.entries()]
    .filter(([name]) => !templateFields.has(name))
    .sort((a, b) => b[1].count - a[1].count);

  console.log('\n=== Fields on clients but MISSING from the template ===');
  if (missing.length === 0) {
    console.log('  ✅ none — the template already has every field the clients have.');
  } else {
    for (const [name, info] of missing) {
      const flag = info.count === total ? '‼ ALL ' : (info.count * 2 >= total ? '· many ' : '  few  ');
      console.log(`  ${flag} ${info.count}/${total}  "${name}" (${info.type})`);
    }
    console.log('\n  ‼ = on every client → almost certainly belongs on the template too.');
  }

  const clientFieldNames = new Set(fieldInfo.keys());
  const templateOnly = [...templateFields].filter((n) => !clientFieldNames.has(n));
  if (templateOnly.length) {
    console.log('\n=== On the template but on NO client (template-only / possible cruft) ===');
    templateOnly.forEach((n) => console.log(`  • "${n}"`));
  }
  console.log('\n(audit only — no changes made)');
}

// ============================================
// MAIN
// ============================================

async function run() {
  const args = process.argv.slice(2);
  const audit = args.includes('--audit');
  const dryRun = args.includes('--dry-run');
  const skipTemplate = args.includes('--skip-template');
  const skipMaster = args.includes('--skip-master');
  const clientArg = args.find((a) => a.startsWith('--client='));
  const filterClientId = clientArg ? clientArg.split('=')[1] : null;

  console.log(`🔧 Ensure client fields${audit ? ' — AUDIT' : (dryRun ? ' — DRY RUN (no changes)' : '')}\n`);

  if (!process.env.AIRTABLE_API_KEY) { console.error('❌ AIRTABLE_API_KEY not set'); process.exit(1); }
  if (!process.env.MASTER_CLIENTS_BASE_ID) { console.error('❌ MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }

  if (audit) { await runAudit(); return; }

  // 1) Leads-table fields on every client base
  const clients = await getClients(filterClientId);
  console.log(`Found ${clients.length} client base(s)${filterClientId ? ` matching "${filterClientId}"` : ''}.`);
  for (const c of clients) {
    await ensureFields(`client: ${c.clientId}`, c.baseId, LEADS_TABLE, LEADS_FIELDS, dryRun);
  }

  // 2) Leads-table fields on the template (default target — see header note)
  if (!skipTemplate) {
    await ensureFields('CLIENT TEMPLATE', TEMPLATE_BASE_ID, LEADS_TABLE, LEADS_FIELDS, dryRun);
  } else {
    console.log('\n(skipping template — --skip-template)');
  }

  // 3) Per-client config fields on the master Clients table
  if (!skipMaster) {
    await ensureFields('MASTER Clients table', process.env.MASTER_CLIENTS_BASE_ID, MASTER_TABLE, MASTER_FIELDS, dryRun);
  } else {
    console.log('\n(skipping master — --skip-master)');
  }

  console.log('\n' + '='.repeat(48));
  console.log(`📊 ${dryRun ? 'Would add' : 'Added'}: ${stats.added} | Skipped (exist): ${stats.skipped} | Errors: ${stats.errors}`);
  if (dryRun) console.log('🔍 Dry run — re-run without --dry-run to apply.');
  if (stats.errors > 0) process.exitCode = 1;
}

run().catch((err) => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
