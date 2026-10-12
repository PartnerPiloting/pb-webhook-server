// One home for a client's own contact facts (Guy 13 Oct 2026).
//
// Four facts used to live twice with nothing keeping them in step:
//
//   setup page (wingguyStore)               Master Clients record
//   asset    zoom_room                  <-> Meeting Link   (booking puts it on every invite)
//   variable owner_phone                <-> Phone
//   asset    owner_linkedin_profile     <-> LinkedIn URL
//   variable timezone                   <-> Timezone       (record holds an IANA zone)
//
// They drifted for Joshua Tunstall on 12 Oct: Claude saved his Meet link to the record while he typed
// a different one into his setup page, so invites carried one link and drafted messages the other.
//
// The rule now: the setup page is where these are TYPED - by the client, Guy, or Claude through
// wingguy_variables / wingguy_assets - and every save there also writes the matching record field,
// so every existing reader (booking, the board, preflight) keeps working untouched. Anything that
// writes the record directly (the admin client-update endpoint) pushes the same value back into the
// store. A record edit made by hand in Airtable is the one door this cannot see; the onboarding docs
// send those edits to the setup page instead, and scripts/client-facts-mismatch.js finds any drift.
//
// Timezone is the odd one: the page takes plain words ("Brisbane (AEST, no daylight saving)") but
// the record must hold a zone the calendar code can compute with. Words are only written to the
// record when they resolve to exactly one zone with no guessing; otherwise the record is left alone
// and the caller is told, so a typo can never move someone's calendar.

const PAIRS = [
  { scope: 'asset', key: 'zoom_room', field: 'Meeting Link', kind: 'link' },
  { scope: 'variable', key: 'owner_phone', field: 'Phone', kind: 'phone' },
  { scope: 'asset', key: 'owner_linkedin_profile', field: 'LinkedIn URL', kind: 'link' },
  { scope: 'variable', key: 'timezone', field: 'Timezone', kind: 'timezone' },
];

function pairFor(scope, key) {
  return PAIRS.find((p) => p.scope === scope && p.key === key) || null;
}

function isIanaZone(s) {
  const v = String(s || '').trim();
  if (!/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(v) && v !== 'UTC') return false;
  try { new Intl.DateTimeFormat('en-AU', { timeZone: v }); return true; } catch (_) { return false; }
}

/**
 * The IANA zone some timezone words mean, or null when they do not pin one down without a guess.
 * An IANA zone passes straight through; words go through the same resolver leads use, and a
 * world-database "biggest place by that name" pick is refused - a guess is fine for a lead's
 * clock, not for the coach's own calendar.
 */
function zoneFromWords(words, deps = {}) {
  const raw = String(words || '').trim();
  if (!raw) return null;
  if (isIanaZone(raw)) return raw;
  const { resolveLeadTimezone } = deps.resolver || require('./leadLocationResolver');
  const r = resolveLeadTimezone(raw);
  if (!r || !r.detected || !r.timezone || r.assumedNote) return null;
  return r.timezone;
}

/** Same-fact comparison: ignores the cosmetic differences two people typing one link would make. */
function normalise(kind, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (kind === 'phone') {
    // +61 412..., +61 0412... (a common slip) and 0412... are all one Australian number.
    const d = v.replace(/\D/g, '');
    return v.replace(/\s/g, '').startsWith('+61') ? `0${d.slice(2).replace(/^0+/, '')}` : d;
  }
  if (kind === 'link') {
    return v.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');
  }
  if (kind === 'timezone') return isIanaZone(v) ? v : (zoneFromWords(v) || `?${v.toLowerCase()}`);
  return v;
}

function sameFact(kind, a, b) {
  return normalise(kind, a) === normalise(kind, b);
}

/**
 * A setup-store save just happened for (scope, key) - write the matching record field.
 * Never throws: the store save has already succeeded and must not be reported as failed because
 * the record copy could not be written. Returns what happened, for the log and the caller.
 */
async function syncStoreToRecord({ tenantId, scope, key, value }, deps = {}) {
  const pair = pairFor(scope, key);
  if (!pair) return { synced: false, reason: 'not a shared fact' };
  const clean = value == null ? '' : String(value).trim();
  let recordValue = clean;
  if (pair.kind === 'timezone') {
    if (!clean) return { synced: false, field: pair.field, reason: 'blank timezone never clears the record' };
    recordValue = zoneFromWords(clean, deps);
    if (!recordValue) {
      return {
        synced: false, field: pair.field,
        reason: `"${clean}" does not pin down one time zone, so the record's Timezone was left as it was`,
      };
    }
  }
  const clientService = deps.clientService || require('./clientService');
  try {
    await clientService.updateClientRecordFields(tenantId, { [pair.field]: recordValue || null });
    return { synced: true, field: pair.field, value: recordValue };
  } catch (e) {
    return { synced: false, field: pair.field, reason: `record write failed: ${e.message}` };
  }
}

/**
 * The record was written directly (admin endpoint) - push the same values into the store, so the
 * setup page and the drafting placeholders read what booking reads. `fields` is keyed by record
 * field name. Timezone goes into the store as the zone itself; the page shows it as typed text.
 */
async function syncRecordToStore({ tenantId, fields, actor }, deps = {}) {
  const store = deps.store || require('./wingguyRulesStore');
  const done = [];
  for (const pair of PAIRS) {
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, pair.field)) continue;
    const clean = fields[pair.field] == null ? '' : String(fields[pair.field]).trim();
    try {
      if (pair.scope === 'variable') {
        await store.setVariable({ tenantId, varKey: pair.key, value: clean, actor });
      } else {
        await store.setAsset({
          tenantId, assetKey: pair.key, url: clean, kind: 'url',
          status: clean ? 'active' : 'retired', actor,
        });
      }
      done.push(pair.key);
    } catch (e) {
      done.push(`${pair.key} FAILED (${e.message})`);
    }
  }
  return done;
}

/**
 * Compare one client's two copies. `storeVars` / `storeAssets` are the store rows; `client` is the
 * clientService shape (bookingZoom, coachPhone, coachLinkedInUrl, timezone). Returns one entry per
 * fact that disagrees or is blank on one side only - both blank is not a mismatch.
 */
function compareClient({ client, storeVars, storeAssets }) {
  const vars = new Map((storeVars || []).map((r) => [r.var_key, r.value]));
  const assets = new Map((storeAssets || []).filter((r) => r.status !== 'retired').map((r) => [r.asset_key, r.url]));
  const recordValue = {
    'Meeting Link': client.bookingZoom,
    Phone: client.coachPhone,
    'LinkedIn URL': client.coachLinkedInUrl,
    Timezone: client.timezone,
  };
  const out = [];
  for (const pair of PAIRS) {
    const page = String((pair.scope === 'variable' ? vars.get(pair.key) : assets.get(pair.key)) || '').trim();
    const record = String(recordValue[pair.field] || '').trim();
    if (!page && !record) continue;
    if (page && record && sameFact(pair.kind, page, record)) continue;
    out.push({
      fact: pair.field,
      page, record,
      problem: !page ? 'blank on the setup page' : !record ? 'blank on the record' : 'different',
    });
  }
  return out;
}

module.exports = { PAIRS, pairFor, zoneFromWords, normalise, sameFact, syncStoreToRecord, syncRecordToStore, compareClient };
