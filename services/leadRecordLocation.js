// The lead's city, read from the job history ALREADY ON THEIR RECORD - no page, no scrape.
//
// Why this exists (Guy, 2026-09-17, after Helia Singh). When a lead's {Location} is a country
// ("Australia"), the clock can't be pinned and Wingguy had to read the current role off the
// LinkedIn page. That read failed four different ways in one day - truncation, wrong surface,
// section not reachable, LinkedIn's doubled labels - because a page scrape is the least reliable
// link in the chain. Meanwhile Linked Helper's import had been writing per-role locations into
// {Raw Profile Data} the whole time, and nothing read them.
//
// Measured on Guy's base the same day: 786 leads sit on "Australia". In a 60-lead sample, 58 (97%)
// had a usable city here - 39 on their CURRENT role, 19 on a past one. So this is the primary
// fallback and the page is the last resort, not the other way round.
//
// Shape of {Raw Profile Data} (Linked Helper's SendPersonToWebhook payload, flattened):
//   organization_1 .. organization_10           company name
//   organization_location_N                     "Perth, Western Australia, Australia" | null
//   organization_start_N / organization_end_N   "2023.01" | null   (end null = current)
//
// THE SAME-COUNTRY RULE. A past role's city is where they worked THEN. The sample turned up
// Tokyo, Zurich, Singapore and Bangkok as past-role cities on people whose top card now says
// "Australia" - they have moved, and the top card is the newer fact. So when the record's own
// Location resolves to a COUNTRY (ambiguous, several candidate zones), any role we take must sit in
// one of that country's zones. Applied to the current role too: a current role in Tokyo under an
// "Australia" top card is a conflict, and a conflict falls through to the next step rather than
// picking a side.
//
// Pure, no I/O. Returns null, or:
//   { location, timezone, source: 'current'|'past', org, title, endYear }
// A 'past' result is an INFERENCE and the caller must say so ("worked there until 2023").

const { resolveLeadTimezone } = require('./leadLocationResolver');

const MAX_ORGS = 10;

// "Australia/Perth" -> "Australia". The tz database's region prefix is a good-enough country key
// for the AU/NZ-heavy case this serves; it is only ever used to compare like with like.
function regionOf(tz) {
  const s = String(tz || '');
  const i = s.indexOf('/');
  return i === -1 ? s : s.slice(0, i);
}

// The set of regions the record's own Location could mean. A resolved city gives one; an
// ambiguous country gives several (all "Australia"); nothing gives an empty set = no constraint.
function allowedRegions(recordLocation) {
  const r = resolveLeadTimezone(recordLocation);
  const out = new Set();
  if (r.detected && r.timezone) out.add(regionOf(r.timezone));
  for (const c of r.candidates || []) if (c && c.timezone) out.add(regionOf(c.timezone));
  return out;
}

function parseRaw(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (_) { return null; }
}

/**
 * @param {string|object} rawProfileData  the {Raw Profile Data} cell (JSON string or parsed)
 * @param {string} recordLocation          the {Location} cell, for the same-country rule
 */
function recordRoleLocation(rawProfileData, recordLocation = '') {
  const p = parseRaw(rawProfileData);
  if (!p) return null;
  const allowed = allowedRegions(recordLocation);

  let current = null;
  let best = null; // latest-ending past role with a usable city
  for (let i = 1; i <= MAX_ORGS; i++) {
    const org = p[`organization_${i}`];
    if (!org) break;
    const loc = String(p[`organization_location_${i}`] || '').trim();
    if (!loc) continue;
    const rz = resolveLeadTimezone(loc);
    if (!rz.detected || !rz.timezone) continue;
    if (allowed.size && !allowed.has(regionOf(rz.timezone))) continue; // moved country since
    const end = String(p[`organization_end_${i}`] || '').trim();
    const hit = { location: loc, timezone: rz.timezone, org: String(org), title: String(p[`organization_title_${i}`] || '').trim() };
    if (!end) {
      if (!current) current = { ...hit, source: 'current', endYear: null };
    } else if (!best || end > best.end) {
      // "YYYY.MM" compares correctly as a string.
      best = { ...hit, end, source: 'past', endYear: end.slice(0, 4) };
    }
  }
  if (current) return current;
  if (best) { const { end, ...rest } = best; return rest; }
  return null;
}

module.exports = { recordRoleLocation, regionOf, allowedRegions };
