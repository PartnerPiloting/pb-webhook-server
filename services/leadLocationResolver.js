// Lead location → timezone, world-wide.
//
// Two layers, in order:
//   1. The hand-written AU/NZ-first list (lib/timezoneFromLocation.js) — it wins outright, on
//      purpose: Guy's book is Australian/NZ, so "Perth" is Western Australia and "Newcastle" is
//      NSW, never the UK ones (policy comment lives in that file, Guy 2026-07-20).
//   2. The city-timezones world database (~7300 cities with population + IANA zone) for everything
//      the list doesn't know — Berlin, Warsaw, whole countries ("Germany"), etc. (Guy 2026-08-28,
//      after a Berlin lead crept into an AU-centric book.)
//
// The world layer never guesses silently when a name is genuinely ambiguous:
//   - One timezone across all matching cities → detected.
//   - Several timezones but one place utterly dominates by population (Sydney AU 5.2M vs Sydney
//     Nova Scotia 37k) → detected, with an `assumedNote` the surfaces must relay so a wrong pick
//     is caught ("took Sydney as Sydney, New South Wales, Australia").
//   - Several timezones and no dominant place (Springfield, San Jose, Birmingham) → NOT detected;
//     `candidates` lists one top city per timezone so the agent can ask "which one?".
//
// resolveLeadTimezone(location) → {
//   timezone: string|null,   // IANA zone — only set when detected
//   detected: boolean,       // safe to use without asking
//   source: 'aunz-list'|'world'|null,
//   assumedNote: string|null,// dominant-pick explanation to relay to the coach
//   ambiguous: boolean,
//   candidates: [{ place, timezone }],  // filled when ambiguous
// }
// detectTimezone(location) → string|null — drop-in for the old getTimezoneFromLocation shape.

const cityTimezones = require('city-timezones');
const { getTimezoneFromLocation } = require('../linkedin-messaging-followup-next/lib/timezoneFromLocation.js');

// A dominant place must out-populate the biggest same-name place in any OTHER timezone by this
// factor to be picked without asking (Sydney 139×: pick; Birmingham UK vs AL 2.4×: ask).
const DOMINANCE_RATIO = 10;

// LinkedIn dressing that isn't part of the place name ("Greater Berlin Area", "Sydney Metropolitan
// Region").
const NOISE_WORDS = new Set(['greater', 'area', 'metro', 'metropolitan', 'region', 'city', 'the']);

// Common location words → the country name the database actually uses.
const COUNTRY_ALIASES = {
  england: 'united kingdom', scotland: 'united kingdom', wales: 'united kingdom',
  'northern ireland': 'united kingdom', uk: 'united kingdom', 'great britain': 'united kingdom',
  usa: 'united states of america', us: 'united states of america',
  'united states': 'united states of america', america: 'united states of america',
  uae: 'united arab emirates', holland: 'netherlands',
  'hong kong sar': 'hong kong s.a.r.', 'hong kong': 'hong kong s.a.r.',
};

function cleanPart(part) {
  return String(part)
    .toLowerCase()
    .replace(/[^a-zÀ-ɏ' -]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(' ')
    .trim();
}

function aliased(token) {
  return COUNTRY_ALIASES[token] || token;
}

function placeLabel(row) {
  return [row.city, row.province, row.country].filter(Boolean).join(', ');
}

function rowMatchesToken(row, token) {
  const t = aliased(token);
  return [row.province, row.country, row.iso2, row.iso3]
    .some((f) => f && String(f).toLowerCase().includes(t));
}

// One representative (top-population) city per distinct timezone, biggest zones first.
function zoneLeaders(rows) {
  const byZone = new Map();
  for (const row of rows) {
    const cur = byZone.get(row.timezone);
    if (!cur || (row.pop || 0) > (cur.pop || 0)) byZone.set(row.timezone, row);
  }
  return [...byZone.values()].sort((a, b) => (b.pop || 0) - (a.pop || 0));
}

function resolveLeadTimezone(location) {
  const none = { timezone: null, detected: false, source: null, assumedNote: null, ambiguous: false, candidates: [] };
  const raw = String(location || '').trim();
  if (!raw) return none;

  // Layer 1: the AU/NZ-first hand list. A hit here is final — see policy note above.
  const listed = getTimezoneFromLocation(raw);
  if (listed) {
    return { ...none, timezone: listed, detected: true, source: 'aunz-list' };
  }

  // Layer 2: world database. Take comma parts most-specific-first ("Kowloon, Hong Kong" — the
  // city may miss, the territory hits); a part matches as an exact city name or, failing that, as
  // a token across city/province/country (which is how bare countries like "Germany" resolve).
  const parts = raw.split(',').map(cleanPart).filter(Boolean);
  if (!parts.length) return none;

  let rows = [];
  let usedIdx = -1;
  for (let i = 0; i < parts.length && !rows.length; i++) {
    rows = cityTimezones.lookupViaCity(parts[i]) || [];
    if (!rows.length) rows = cityTimezones.findFromCityStateProvince(aliased(parts[i])) || [];
    usedIdx = i;
  }
  if (!rows.length) return none;

  // The parts we didn't match on qualify the one we did ("Birmingham, England" → keep UK rows) —
  // but only when the narrowing actually leaves something.
  const qualifiers = parts.filter((_, i) => i !== usedIdx);
  for (const q of qualifiers) {
    const narrowed = rows.filter((row) => rowMatchesToken(row, q));
    if (narrowed.length) rows = narrowed;
  }

  const leaders = zoneLeaders(rows);
  if (leaders.length === 1) {
    return { ...none, timezone: leaders[0].timezone, detected: true, source: 'world' };
  }

  const [top, second] = leaders;
  // AU/NZ tie-break, same spirit as the hand list's policy: a foreign city never silently beats an
  // AU/NZ place of the same name on population alone (Richmond VA 551k vs Richmond NSW) — for this
  // book that's a question, not a pick. An AU/NZ top still wins normally.
  const isAunz = (row) => row.iso2 === 'AU' || row.iso2 === 'NZ';
  const aunzOverruled = !isAunz(top) && leaders.some(isAunz);
  if (!aunzOverruled && (top.pop || 0) >= DOMINANCE_RATIO * (second.pop || 1)) {
    return {
      ...none,
      timezone: top.timezone,
      detected: true,
      source: 'world',
      assumedNote: `location "${raw}" taken as ${placeLabel(top)} (${top.timezone}) — by far the biggest place by that name; say so when presenting so a wrong pick is caught (also exists as ${placeLabel(second)})`,
    };
  }

  return {
    ...none,
    ambiguous: true,
    candidates: leaders.slice(0, 4).map((row) => ({ place: placeLabel(row), timezone: row.timezone })),
  };
}

// Drop-in replacement for getTimezoneFromLocation: an IANA zone only when it's safe to use
// without asking, else null.
function detectTimezone(location) {
  const r = resolveLeadTimezone(location);
  return r.detected ? r.timezone : null;
}

module.exports = { resolveLeadTimezone, detectTimezone };
