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
 * "My Leads - Client Template" (app6W6k9GiDUlktvt), which lives OUTSIDE the
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
  }
];

// Fields to ensure on the master Clients base's Clients table (per-client config).
const MASTER_FIELDS = [
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
