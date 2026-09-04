/**
 * "Is anyone WAITING to be added?" - one shared read over the parked-meeting list, for the chat
 * tools. Born 2026-09-04 from Rick Wong's session: he asked his Claude for the transcript of his
 * call with Cynthia Lau, her record carried a different email from the one Fireflies saw, and the
 * tools said "no meetings" - so he concluded the system was broken. The meeting was sitting in the
 * store the whole time, parked under her other address. A miss must never be silent again: every
 * tool that answers "no transcript" / "no lead" first checks the parked list, and when it finds a
 * likely person it says so AND names the one-step door that attaches the meeting.
 *
 * Read-only. All matching is deliberately conservative (first AND last name, typo-tolerant), and
 * the tools only ever PROPOSE - the human confirms, then wingguy_create_lead / wingguy_update_lead
 * does the write and the meeting attaches through resolvePendingLeadByEmail.
 */

const clientService = require('./clientService');
const { collectWaitingPeople } = require('./pendingLeadNotifier');
const { localPartMatchesName, tokenClose } = require('./pendingLeadFilter');

function nameTokens(s) {
  return String(s || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

/**
 * Does a waiting person plausibly match this full name? Needs BOTH a first and a last name to
 * compare (a first name alone is too loose to claim someone with). Matches on the parked name
 * when we have one (typo-tolerant, first + last), else on the email's local part reading as the
 * name ("cynthia.lau@", "clau@"). Pure - unit tested.
 */
function waitingPersonMatchesName(person, fullName) {
  const want = nameTokens(fullName);
  if (want.length < 2) return false;
  const first = want[0];
  const last = want[want.length - 1];
  const have = nameTokens(person && person.name);
  if (have.length >= 2) {
    // One-letter tolerance only on names long enough for it to be a typo rather than a different
    // name: "Lam" vs "Lau" are two people, "Jonathon" vs "Jonathan" is a slip.
    const close = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && tokenClose(a, b));
    if (close(have[0], first) && close(have[have.length - 1], last)) return true;
  }
  return localPartMatchesName(person && person.email, `${first} ${last}`);
}

async function waitingPeople(coachClientId, coach) {
  const c = coach || (await clientService.getClientById(coachClientId).catch(() => null)) || {};
  return collectWaitingPeople(coachClientId, c);
}

/** Waiting person parked under exactly this address, or null. */
async function findWaitingByEmail(coachClientId, email, coach) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;
  const people = await waitingPeople(coachClientId, coach);
  return people.find((p) => p.email === needle) || null;
}

/** Waiting people who look like this name (first + last). */
async function findWaitingByName(coachClientId, fullName, coach) {
  const people = await waitingPeople(coachClientId, coach);
  return people.filter((p) => waitingPersonMatchesName(p, fullName));
}

function fmtDate(d, tz) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz || 'Australia/Brisbane' });
  } catch {
    return String(d).slice(0, 10);
  }
}

/** One line per waiting person: address (name) - N meeting(s), latest "title" on date. */
function describeWaiting(p, tz) {
  const who = p.name ? `${p.email} (${p.name})` : p.email;
  const count = p.meetings > 1 ? `${p.meetings} meetings` : '1 meeting';
  const latest = p.latestTitle ? `, latest "${p.latestTitle}"` : '';
  const when = p.latest ? ` on ${fmtDate(p.latest, tz)}` : '';
  return `${who} - ${count}${latest}${when}`;
}

// The two doors that attach a parked meeting. Written for the assistant, not the human.
const CREATE_DOOR = (p) =>
  `Add them with wingguy_create_lead (${p.name ? `name "${p.name}", ` : ''}email ${p.email}) and the meeting attaches instantly - then ask again.`;
const LINK_DOOR = (p, leadLabel, leadEmail) =>
  `If the human confirms it is the same person, put that address on the record with wingguy_update_lead (lead_email ${leadEmail || 'as on record'}, email ${p.email})${leadLabel ? ` for ${leadLabel}` : ''} - the meeting attaches instantly, then ask again.`;
const NEVER = 'Never tell the human the meeting was not recorded - it was; it is parked, and the address is the only thing missing.';

/**
 * Text to append when a lookup BY EMAIL found no lead. Says whether a parked meeting exists under
 * that address, and - if a lead with the parked person's name already exists - offers the link
 * door instead of a duplicate create.
 */
async function waitingHintForEmail(coach, email) {
  const coachClientId = coach && coach.clientId;
  if (!coachClientId) return '';
  let p = null;
  try { p = await findWaitingByEmail(coachClientId, email, coach); } catch { return ''; }
  if (!p) return '';
  const lines = [
    '',
    `BUT Wingguy IS holding a parked meeting under that address: ${describeWaiting(p, coach.timezone)}.`,
    'It is parked because nobody in the database carries that email.',
  ];
  const named = await leadWithName(coach, p.name).catch(() => null);
  if (named) {
    lines.push(`There IS a lead called ${named.name}${named.email ? ` (record email ${named.email})` : ''}. ${LINK_DOOR(p, named.name, named.email)}`);
  } else {
    lines.push(CREATE_DOOR(p));
  }
  lines.push(NEVER);
  return lines.join('\n');
}

/**
 * Text to append when a lead EXISTS but has no meetings. Looks for a parked meeting whose person
 * reads as this lead's name and offers the link door.
 */
async function waitingHintForLead(coach, { name, email }) {
  const coachClientId = coach && coach.clientId;
  if (!coachClientId) return '';
  let hits = [];
  try { hits = await findWaitingByName(coachClientId, name, coach); } catch { return ''; }
  if (!hits.length) return '';
  const lines = [
    '',
    `BUT Wingguy IS holding ${hits.length === 1 ? 'a parked meeting' : `${hits.length} parked meetings`} that look like this person:`,
    ...hits.map((p) => `  - ${describeWaiting(p, coach.timezone)}`),
    'Not linked because that address is not on their record.',
    LINK_DOOR(hits[0], name, email),
    NEVER,
  ];
  return lines.join('\n');
}

/**
 * Section for wingguy_recordings: everyone waiting, with the doors. Empty string when nobody is.
 */
async function waitingSection(coach) {
  const coachClientId = coach && coach.clientId;
  if (!coachClientId) return '';
  let people = [];
  try { people = await waitingPeople(coachClientId, coach); } catch { return ''; }
  if (!people.length) return '';
  const lines = [
    `WAITING FOR A PERSON TO BE ADDED (${people.length}) - transcripts are saved, but nobody in the database carries the address:`,
    ...people.map((p) => `  - ${describeWaiting(p, coach.timezone)}`),
    '  Add them (wingguy_create_lead with that email), or if they ARE in the database under another address, wingguy_update_lead with that email - either way the transcript attaches instantly. The New Leads page in the portal has the same Add / Skip buttons.',
  ];
  return lines.join('\n');
}

/** Exactly-one lead whose first + last name equal this full name, or null. */
async function leadWithName(coach, fullName) {
  const t = nameTokens(fullName);
  if (t.length < 2 || !coach || !coach.airtableBaseId) return null;
  const base = clientService.getClientBase(coach.airtableBaseId);
  if (!base) return null;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const rows = await base('Leads').select({
    filterByFormula: `AND(LOWER(TRIM({First Name})) = "${esc(t[0])}", LOWER(TRIM({Last Name})) = "${esc(t[t.length - 1])}")`,
    fields: ['First Name', 'Last Name', 'Email'],
    maxRecords: 2,
  }).firstPage();
  if (rows.length !== 1) return null;
  const f = rows[0].fields || {};
  return { id: rows[0].id, name: `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim(), email: String(f['Email'] || '').trim().toLowerCase() };
}

module.exports = {
  waitingPersonMatchesName,
  findWaitingByEmail,
  findWaitingByName,
  describeWaiting,
  waitingHintForEmail,
  waitingHintForLead,
  waitingSection,
};
