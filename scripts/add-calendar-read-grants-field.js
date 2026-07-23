/**
 * Add the `Calendar Read Grants` field to the client roster (2026-07-23, multi-grant calendars).
 *
 *   Calendar Read Grants  - a JSON ARRAY of EXTRA read-only calendar sources that live in OTHER
 *                           accounts/providers than the client's primary calendar. Availability
 *                           unions free/busy across the primary + all of these; bookings still go to
 *                           the ONE primary/nominated calendar. Blank -> no extra grants -> the
 *                           client behaves exactly as a single-provider client (fully additive).
 *
 * Element shape (each object supplies just the creds its provider needs):
 *   iCloud : { "provider":"icloud", "label":"Personal", "appleId":"you@icloud.com",
 *              "appPassword":"abcd-efgh-ijkl-mnop", "calendarUrls":["https://p52-caldav.icloud.com/123/calendars/home/"] }
 *   Zoho   : { "provider":"zoho", "label":"...", "token":"<refresh>", "domain":"com.au", "readIds":"all" }
 *   Unipile: { "provider":"unipile", "label":"...", "accountId":"<id>", "readIds":"all" }
 *   Google : { "provider":"google", "label":"...", "selfEmail":"shared@x.com", "readIds":"shared@x.com" }
 *   Nylas  : { "provider":"nylas", "label":"...", "grantId":"<grant>", "readIds":"all" }
 *
 * For iCloud, resolve calendarUrls once with scripts/wingguy-icloud-discover.js (Apple has no OAuth,
 * so the client generates an app-specific password at appleid.apple.com).
 *
 * Usage:
 *   node scripts/add-calendar-read-grants-field.js            # DRY RUN (default)
 *   node scripts/add-calendar-read-grants-field.js --commit   # create the field
 *
 * Idempotent: an existing field is skipped. Finds the roster table by the presence of a `Calendar
 * Provider` field (robust to the table's actual name). Mirrors scripts/add-multi-calendar-fields.js.
 *
 * Prereqs: AIRTABLE_API_KEY (schema write), MASTER_CLIENTS_BASE_ID.
 */

require('dotenv').config();

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const MASTER = process.env.MASTER_CLIENTS_BASE_ID;
const TEMPLATE_BASE_ID = 'app6W6k9GiDUlktvt'; // "My Leads - Client Template"
const ROSTER_MARKER_FIELD = 'Calendar Provider';
const NEW_FIELDS = [
  // multilineText = a long-text field; holds the JSON array.
  { name: 'Calendar Read Grants', type: 'multilineText' },
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
