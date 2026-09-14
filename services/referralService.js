// services/referralService.js
// Referral tracking - who introduced whom, and what came of it (built 2026-09-14).
//
// Two stores, one picture:
//   * The `Referrals` table in the master Clients base = the PIPELINE. One row per introduction in
//     either direction: "To Guy" (a client introduced this person to Guy - the thing that earns the
//     referral rate) and "From Guy" (Guy introduced this person to the client - how Guy pays
//     referrers back, in introductions, never money). Stage tracks where it got to.
//   * `Introduced By` on the Clients table = the DURABLE count. When a To Guy row reaches Signed, the
//     new client's row gets Introduced By = the referrer. The referral count that earns the reduced
//     rate is derived live from there: referred clients that are Active and not complimentary
//     (Billing Source). It is MAINTAINED, not cumulative - a referral who leaves stops counting
//     (docs/wingguy.md "maintain 3 active paying referrals"; a short grace window is Guy's call, by
//     hand, not automated here).
//
// Nothing in THIS file changes billing - it shows the count. The rate itself is applied by the
// nightly sweep in services/referralRateService.js (a -$120 credit on the referrer's next Stripe
// invoice while three referrals are currently paying; Guy's rule, stated 2026-09-14).

const clientService = require('./clientService');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'REFERRALS', clientId: 'SYSTEM', operation: 'referrals' });

const TABLE = 'Referrals';
const DIRECTIONS = ['To Guy', 'From Guy'];
const STAGES = ['Promised', 'Introduced', 'Call held', 'Demo held', 'Signed', 'Went quiet', 'Not a fit', 'Not a prospect'];
const OPEN_STAGES = ['Promised', 'Introduced', 'Call held', 'Demo held'];
const CLOSED_STAGES = ['Signed', 'Went quiet', 'Not a fit', 'Not a prospect'];
// How many maintained, paying referrals earn the reduced rate (Guy's rule, 2026-06-08 + 2026-09-14).
const REFERRAL_RATE_COUNT = 3;

const lower = (v) => String(v || '').trim().toLowerCase();
const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

// ---------------------------------------------------------------------------------------------
// Reads

function rowFromRecord(record) {
  const g = (f) => record.get(f);
  return {
    id: record.id,
    person: g('Person') || '',
    direction: g('Direction') || '',
    clientRecordId: first(g('Client')),
    stage: g('Stage') || '',
    introducedOn: g('Introduced On') || null,
    how: g('How') || '',
    company: g('Company') || '',
    linkedinUrl: g('LinkedIn URL') || '',
    email: g('Email') || '',
    introducedTo: g('Introduced To') || '',
    becameClientRecordId: first(g('Became Client')),
    notes: g('Notes') || '',
    lastModified: g('Last Modified') || null,
  };
}

/** Every row in the Referrals table. Airtable's linked fields carry record ids; names are
 *  resolved by the caller against the client directory so one read serves the whole board. */
async function listAllReferrals() {
  const base = clientService.initializeClientsBase();
  const rows = [];
  await base(TABLE).select({ sort: [{ field: 'Introduced On', direction: 'desc' }] }).eachPage((records, next) => {
    records.forEach((r) => rows.push(rowFromRecord(r)));
    next();
  });
  return rows;
}

/** Attach client names to rows and drop rows that belong to a client the coach does not own.
 *  A row with no client link at all stays visible (it is still Guy's to tidy). */
function scopeToCoach(rows, clients, coachClientId) {
  const byRecordId = new Map(clients.map((c) => [c.id, c]));
  const out = [];
  for (const r of rows) {
    const client = r.clientRecordId ? byRecordId.get(r.clientRecordId) : null;
    if (r.clientRecordId && (!client || client.coach !== coachClientId)) continue;
    const became = r.becameClientRecordId ? byRecordId.get(r.becameClientRecordId) : null;
    out.push({
      ...r,
      clientId: client ? client.clientId : null,
      clientName: client ? client.clientName : null,
      becameClientId: became ? became.clientId : null,
      becameClientName: became ? became.clientName : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The per-client picture (pure - unit tested in tests/referrals.test.js)

/** Does this referred client count toward the referrer's maintained total? Active, and paying
 *  (Billing Source complimentary is Guy's gift, not a referral - the field says so). */
function countsAsPayingReferral(client) {
  if (!client || client.status !== 'Active') return false;
  if (lower(client.billingSource) === 'complimentary') return false;
  return true;
}

/**
 * Summarise one client's referral standing from the directory + the pipeline rows.
 *   clients  - every client object (needs id, clientId, clientName, status, billingSource, rawRecord)
 *   rows     - referral rows already scoped + named (scopeToCoach output)
 * Returns numbers the board and the chat tool both render.
 */
function summariseClient(client, clients, rows) {
  const referred = clients.filter((c) => first(introducedByOf(c)) === client.id);
  const paying = referred.filter(countsAsPayingReferral);
  const mine = rows.filter((r) => r.clientRecordId === client.id);
  const toGuy = mine.filter((r) => r.direction === 'To Guy');
  const fromGuy = mine.filter((r) => r.direction === 'From Guy');
  return {
    introduced: toGuy.length,
    open: toGuy.filter((r) => OPEN_STAGES.includes(r.stage)).length,
    signed: toGuy.filter((r) => r.stage === 'Signed').length,
    payingNow: paying.length,
    payingNames: paying.map((c) => c.clientName),
    referralRate: paying.length >= REFERRAL_RATE_COUNT,
    introsFromGuy: fromGuy.filter((r) => r.stage !== 'Promised').length,
    promisedFromGuy: fromGuy.filter((r) => r.stage === 'Promised').map((r) => r.person),
  };
}

function introducedByOf(client) {
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  return raw['Introduced By'] || null;
}

/** Name of the client who introduced this one, or null. */
function introducedByName(client, clients) {
  const id = first(introducedByOf(client));
  if (!id) return null;
  const ref = clients.find((c) => c.id === id);
  return ref ? ref.clientName : null;
}

// ---------------------------------------------------------------------------------------------
// Writes

function normaliseStage(v) {
  const q = lower(v);
  if (!q) return null;
  return STAGES.find((s) => lower(s) === q) || STAGES.find((s) => lower(s).startsWith(q)) || null;
}

function normaliseDirection(v) {
  const q = lower(v);
  if (!q || q === 'to guy' || q === 'in' || q === 'inbound' || q === 'to') return 'To Guy';
  if (q === 'from guy' || q === 'out' || q === 'outbound' || q === 'from') return 'From Guy';
  return null;
}

/** Create a referral row. Returns the stored row. */
async function logReferral({ person, clientRecordId, direction = 'To Guy', stage = 'Introduced', introducedOn = null, how = '', company = '', linkedinUrl = '', email = '', introducedTo = '', notes = '', becameClientRecordId = null }) {
  const base = clientService.initializeClientsBase();
  const fields = {
    Person: String(person || '').trim(),
    Direction: direction,
    Stage: stage,
  };
  if (clientRecordId) fields.Client = [clientRecordId];
  if (introducedOn) fields['Introduced On'] = introducedOn;
  if (how) fields.How = how;
  if (company) fields.Company = company;
  if (linkedinUrl) fields['LinkedIn URL'] = linkedinUrl;
  if (email) fields.Email = email;
  if (introducedTo) fields['Introduced To'] = introducedTo;
  if (notes) fields.Notes = notes;
  if (becameClientRecordId) fields['Became Client'] = [becameClientRecordId];
  const created = await base(TABLE).create([{ fields }]);
  logger.info(`referral logged: ${fields.Person} (${direction}, ${stage})`);
  return rowFromRecord(created[0]);
}

/**
 * Move a referral along. `stage` and `note` are optional; a note is PREPENDED with today's date
 * so the field reads newest first. When the stage becomes Signed and `becameClientRecordId` is
 * given, the new client's Introduced By is set to the row's Client - that is what makes them
 * count.
 */
async function updateReferral(rowId, { stage = null, note = '', becameClientRecordId = null, introducedOn = null, how = null } = {}) {
  const base = clientService.initializeClientsBase();
  const existing = await base(TABLE).find(rowId);
  const row = rowFromRecord(existing);
  const fields = {};
  if (stage) fields.Stage = stage;
  if (introducedOn) fields['Introduced On'] = introducedOn;
  if (how) fields.How = how;
  if (note) {
    const stamp = new Date().toISOString().slice(0, 10);
    fields.Notes = `${stamp} - ${String(note).trim()}${row.notes ? `\n${row.notes}` : ''}`;
  }
  if (becameClientRecordId) fields['Became Client'] = [becameClientRecordId];
  if (!Object.keys(fields).length) return row;
  const updated = await base(TABLE).update([{ id: rowId, fields }]);
  const out = rowFromRecord(updated[0]);

  if (becameClientRecordId && row.clientRecordId && row.direction === 'To Guy') {
    await base('Clients').update([{ id: becameClientRecordId, fields: { 'Introduced By': [row.clientRecordId] } }]);
    clientService.clearCache();
    logger.info(`Introduced By set on ${becameClientRecordId} -> ${row.clientRecordId}`);
  }
  return out;
}

module.exports = {
  TABLE,
  DIRECTIONS,
  STAGES,
  OPEN_STAGES,
  CLOSED_STAGES,
  REFERRAL_RATE_COUNT,
  listAllReferrals,
  scopeToCoach,
  summariseClient,
  countsAsPayingReferral,
  introducedByName,
  introducedByOf,
  normaliseStage,
  normaliseDirection,
  logReferral,
  updateReferral,
};
