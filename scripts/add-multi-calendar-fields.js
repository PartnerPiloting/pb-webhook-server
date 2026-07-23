/**
 * Add the multi-calendar scope fields to the client roster (2026-07-17).
 *
 *   Calendar Read IDs  - which calendars busy/list reads see:
 *                          blank            -> the provider default calendar (old behaviour)
 *                          all              -> every calendar in the connected account
 *                                              (nylas skips read-only subscribed feeds)
 *                          id1, id2, ...    -> exactly those provider-native ids
 *                                              (nylas calendar ids / zoho uids / google emails
 *                                              shared with the service account)
 *   Calendar Write ID  - the ONE calendar bookings + holds are written to
 *                          blank            -> the provider default (old behaviour)
 *
 * Rationale: the no-double-book guarantee is only true if availability reads see EVERY calendar
 * the coach keeps (read MANY); writes stay on one nominated calendar so "where did that meeting
 * go?" has a boring answer (write ONE). Find a client's calendar ids with
 * scripts/wingguy-list-calendars.js <clientId> (run as a Render one-off job for prod).
 *
 * Usage:
 *   node scripts/add-multi-calendar-fields.js            # DRY RUN (default)
 *   node scripts/add-multi-calendar-fields.js --commit   # create the fields
 *
 * Idempotent: a field that already exists is skipped. Finds the roster table by the presence of a
 * `Calendar Provider` field (robust to the table's actual name). The roster is a SINGLE global
 * table in the Master Clients base, so there is NO template copy to update (the Client Template
 * is a leads base with no roster — correctly a no-op there).
 *
 * Prereqs: AIRTABLE_API_KEY (schema write), MASTER_CLIENTS_BASE_ID.
 */

require('dotenv').config();

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const MASTER = process.env.MASTER_CLIENTS_BASE_ID;
const TEMPLATE_BASE_ID = 'app6W6k9GiDlJktvt'; // "My Leads - Client Template"
const ROSTER_MARKER_FIELD = 'Calendar Provider';
const NEW_FIELDS = [
  { name: 'Calendar Read IDs', type: 'singleLineText' },
  { name: 'Calendar Write ID', type: 'singleLineText' },
];
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

async function processBase(label, baseId) {
  const tables = await getTables(baseId);
  const roster = tables.find((t) => t.fields.some((f) => f.name === ROSTER_MARKER_FIELD));
  console.log(`\n[${label}] ${baseId}`);
  console.log(`  tables: ${tables.map((t) => t.name).join(', ')}`);
  if (!roster) {
    console.log(`  no roster table (no "${ROSTER_MARKER_FIELD}" field) -> nothing to add here`);
    return;
  }
  console.log(`  roster table = "${roster.name}" (${roster.id})`);
  for (const def of NEW_FIELDS) {
    if (roster.fields.some((f) => f.name === def.name)) {
      console.log(`  skip: "${def.name}" already exists`);
      continue;
    }
    if (!commit) {
      console.log(`  would add: "${def.name}" (${def.type})`);
      continue;
    }
    await addField(baseId, roster.id, def);
    console.log(`  ADDED: "${def.name}"`);
  }
}

(async () => {
  if (!AIRTABLE_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }
  if (!MASTER) { console.error('MASTER_CLIENTS_BASE_ID not set'); process.exit(1); }
  console.log(commit ? 'MODE: COMMIT (writing schema)' : 'MODE: DRY RUN (pass --commit to write)');
  await processBase('MASTER CLIENTS', MASTER);
  // The roster lives only in the Master Clients base; the template is a leads base with no roster.
  // Best-effort + non-fatal so an inaccessible/irrelevant template never blocks the real work.
  try {
    await processBase('CLIENT TEMPLATE', TEMPLATE_BASE_ID);
  } catch (e) {
    console.log(`\n[CLIENT TEMPLATE] ${TEMPLATE_BASE_ID}\n  skipped (${e.message.slice(0, 80)}) - no roster here, nothing to add`);
  }
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
