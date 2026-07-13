/**
 * Add the "Wingguy Enabled" gate field to the client roster + migrate the old env allow-list onto it.
 *
 *   Wingguy Enabled  - single-select Yes/No; blank = off. This is the PER-CLIENT switch for the
 *                      Wingguy Chrome extension (the drafting routes), replacing the
 *                      WINGGUY_ENABLED_CLIENTS env allow-list (2026-07-14). Enablement now lives on
 *                      the record beside Status / Managed Claude Key - flip it in Airtable, no
 *                      redeploy. The OWNER is always enabled in code, so this field never gates Guy.
 *
 * It's a ROSTER field (a property of the client), so - like Calendar Provider / Managed Claude Key -
 * it lives ONLY in the Master Clients base. The Client Template is a leads base with no roster, so
 * there is correctly NO template copy (best-effort no-op there).
 *
 * Migration: on --commit, every clientId in WINGGUY_ENABLED_CLIENTS is stamped "Wingguy Enabled=Yes"
 * so nobody who was enabled by the env var drops offline. (The owner is enabled by code, not by the
 * env list, so this typically just stamps the real client(s), e.g. Julian-Davis.)
 *
 * Usage:
 *   node scripts/add-wingguy-enabled-field.js            # DRY RUN (default)
 *   node scripts/add-wingguy-enabled-field.js --commit   # create the field + stamp the allow-list
 *
 * Idempotent: an existing field is skipped; a record already Yes is re-set to Yes (no-op).
 * Prereqs: AIRTABLE_API_KEY (schema write), MASTER_CLIENTS_BASE_ID, WINGGUY_ENABLED_CLIENTS (to migrate).
 */

require('dotenv').config();

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const MASTER = process.env.MASTER_CLIENTS_BASE_ID;
const TEMPLATE_BASE_ID = 'app6W6k9GiDUlktvt'; // "My Leads - Client Template" (leads base, no roster)
const ROSTER_MARKER_FIELD = 'Calendar Provider'; // identifies the roster table regardless of its name
const NEW_FIELD = {
  name: 'Wingguy Enabled',
  type: 'singleSelect',
  options: { choices: [{ name: 'Yes' }, { name: 'No' }] },
};
const commit = process.argv.includes('--commit');

async function getTables(baseId) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`list tables (${baseId}): ${r.status} ${await r.text()}`);
  return (await r.json()).tables;
}

async function addField(baseId, tableId, def) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!r.ok) throw new Error(`add "${def.name}": ${r.status} ${await r.text()}`);
  return r.json();
}

async function findRecordByClientId(baseId, tableId, clientId) {
  const formula = encodeURIComponent(`{Client ID} = '${clientId}'`);
  const r = await fetch(
    `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } },
  );
  if (!r.ok) throw new Error(`find "${clientId}": ${r.status} ${await r.text()}`);
  return (await r.json()).records[0] || null;
}

async function setEnabled(baseId, tableId, recordId) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'Wingguy Enabled': 'Yes' } }),
  });
  if (!r.ok) throw new Error(`stamp ${recordId}: ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  if (!AIRTABLE_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }
  if (!MASTER) { console.error('MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }
  console.log(commit ? 'MODE: COMMIT (writing schema + records)' : 'MODE: DRY RUN (pass --commit to write)');

  const tables = await getTables(MASTER);
  const roster = tables.find((t) => t.fields.some((f) => f.name === ROSTER_MARKER_FIELD));
  console.log(`\n[MASTER CLIENTS] ${MASTER}`);
  if (!roster) { console.error(`  no roster table (no "${ROSTER_MARKER_FIELD}" field) -> abort`); process.exit(1); }
  console.log(`  roster table = "${roster.name}" (${roster.id})`);

  // 1. Field
  const exists = roster.fields.some((f) => f.name === NEW_FIELD.name);
  if (exists) {
    console.log(`  skip field: "${NEW_FIELD.name}" already exists`);
  } else if (!commit) {
    console.log(`  would add field: "${NEW_FIELD.name}" (singleSelect Yes/No)`);
  } else {
    await addField(MASTER, roster.id, NEW_FIELD);
    console.log(`  ADDED field: "${NEW_FIELD.name}"`);
  }

  // 2. Migrate the old env allow-list onto the field
  const allowList = String(process.env.WINGGUY_ENABLED_CLIENTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`\n  migrating WINGGUY_ENABLED_CLIENTS = [${allowList.join(', ') || '(empty)'}]`);
  for (const cid of allowList) {
    const rec = await findRecordByClientId(MASTER, roster.id, cid);
    if (!rec) { console.log(`  WARN: no record for Client ID "${cid}" -> skipped`); continue; }
    const cur = rec.fields['Wingguy Enabled'];
    if (!commit) { console.log(`  would set "${cid}" -> Yes (currently ${JSON.stringify(cur)})`); continue; }
    await setEnabled(MASTER, roster.id, rec.id);
    console.log(`  STAMPED "${cid}" -> Wingguy Enabled = Yes`);
  }

  console.log(`\n  (template base ${TEMPLATE_BASE_ID} is a leads base with no roster -> correctly no-op)`);
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
