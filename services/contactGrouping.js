/**
 * One row per PERSON (Guy, 25 Nov 2026).
 *
 * WHY: the contacts store keeps one row per email address - that is what lets an incoming email find
 * its person. So someone with three addresses is three rows, and a name search showed Avon Collis
 * three times. A person is not their addresses: the page must show them once, with every address on
 * the card.
 *
 * THE RULE (do not loosen without Guy):
 *   same full name PLUS one shared detail = one person. A shared detail is
 *     - the same company, or
 *     - the same phone number, or
 *     - the same LinkedIn address.
 *   Same name with nothing else in common stays SEPARATE - two different John Smiths are never
 *   merged on the name alone.
 *   One more way in, which is a fact rather than a guess: a file the client uploaded listed the
 *   addresses under ONE entry. That is remembered on the rows (person_ref) and groups them whatever
 *   their other details say.
 *
 * WHERE: at READ time, not as a stored merge. The rows stay as they are (every feed keeps matching
 * on the address), nothing can go stale, and a wrong grouping repairs itself the moment a detail is
 * corrected. The only thing stored is person_ref - what a file told us.
 *
 * PURE: rows in, people out. No database.
 */

const squash = (v) => String(v === undefined || v === null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

/** A full name to match on - two words or more. A first name alone is never a match key. */
function nameKey(name) {
  const n = squash(name).replace(/[.,]/g, '');
  return n.split(' ').filter(Boolean).length >= 2 ? n : '';
}

/** "Relevate Pty Ltd" and "relevate" are the same company; "" is no company. */
function companyKey(company) {
  const words = squash(company).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
  while (words.length > 1 && ['pty', 'ltd', 'limited', 'inc', 'llc', 'plc', 'co', 'corp', 'corporation', 'company'].includes(words[words.length - 1])) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

/** The last nine digits - so 0412 345 678 and +61 412 345 678 are one number. '' under eight digits. */
function phoneKey(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-9) : '';
}

/** Every key a row can be joined on. Two rows sharing ANY key are the same person. */
function joinKeys(r) {
  const keys = [];
  if (r.person_ref) keys.push(`ref|${squash(r.person_ref)}`);
  const n = nameKey(r.name || [r.first_name, r.last_name].filter(Boolean).join(' '));
  if (n) {
    const c = companyKey(r.company);
    const p = phoneKey(r.phone);
    const l = squash(r.linkedin_slug);
    if (c) keys.push(`${n}|company|${c}`);
    if (p) keys.push(`${n}|phone|${p}`);
    if (l) keys.push(`${n}|linkedin|${l}`);
  }
  return keys;
}

const uniq = (a) => [...new Set(a.filter(Boolean))];

/**
 * Fold rows into people. Order of first appearance is kept (the caller already ranked the rows), and
 * inside a person the first row is the primary one: its name and id are the person's.
 * Each person is the primary row plus:
 *   ids     every row id that is this person
 *   emails  every address, the primary row's first
 *   phone / company / linkedin_slug / headline / location  the first one any row has
 *   sources, lists  everything any row carries
 *   manual  true when any row was typed or uploaded by the client
 */
function groupPeople(rows) {
  const list = (rows || []).filter(Boolean);
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const firstWith = new Map();
  list.forEach((r, i) => {
    for (const k of joinKeys(r)) {
      if (firstWith.has(k)) { const a = find(firstWith.get(k)); const b = find(i); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } else firstWith.set(k, i);
    }
  });
  const groups = new Map();
  list.forEach((r, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(r); });
  return [...groups.values()].map((members) => {
    const head = members[0];
    const pick = (f) => { for (const m of members) if (m[f] !== null && m[f] !== undefined && m[f] !== '') return m[f]; return head[f] === undefined ? null : head[f]; };
    return {
      ...head,
      ids: members.map((m) => String(m.id)),
      emails: uniq(members.map((m) => (m.email ? String(m.email).toLowerCase() : ''))),
      phone: pick('phone'), company: pick('company'), linkedin_slug: pick('linkedin_slug'), headline: pick('headline'), location: pick('location'),
      linkedin_connected_at: pick('linkedin_connected_at'),
      sources: uniq(members.flatMap((m) => m.sources || [])),
      lists: uniq(members.flatMap((m) => m.lists || [])),
      manual: members.some((m) => m.manual),
      members,
    };
  });
}

module.exports = { groupPeople, joinKeys, nameKey, companyKey, phoneKey };
