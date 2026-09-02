/**
 * Pending-lead hygiene — keeps the "people you've met" list worth reading.
 *
 * Two jobs, both pure functions over data the ingest already holds:
 *
 *   1. JUNK FILTER (isJunkPendingEmail / filterJunk): role mailboxes (reception@, info@ …),
 *      the operator's own address, the coach's own address, and colleagues on the coach's own
 *      company domain never become pending entries at all. Freemail domains (gmail etc.) are
 *      exempt from the own-domain rule — a coach on gmail.com must not blind us to every
 *      gmail-using lead. Applied to NEW arrivals only; existing entries are deliberately left
 *      for the coach to skip themselves (agreed with Guy 2026-08-26).
 *
 *   2. NAME FROM TRANSCRIPT (nameFromTranscript): Fireflies' invite list often returns emails
 *      with no names, but bot-joined transcripts carry REAL speaker labels ("Christopher
 *      Iacono: …"). Pair a nameless pending email to a speaker by matching the email's local
 *      part tokens against speaker-name tokens (1-char typo tolerance — Fireflies renders
 *      "Iacono" as "lacono"). Conservative by design: no confident match = no name. A wrong
 *      name pre-filled is worse than a blank.
 *
 * refinePendingLeads() bundles both for the three ingest call sites (fathom/fireflies/granola).
 */

const ROLE_PREFIXES = new Set([
  'reception', 'info', 'admin', 'accounts', 'hello', 'contact', 'office', 'enquiries',
  'inquiries', 'sales', 'support', 'help', 'team', 'bookings', 'billing', 'noreply',
  'no-reply', 'donotreply', 'do-not-reply', 'mail', 'mailer-daemon', 'postmaster', 'notifications',
]);

// Freemail / ISP domains where "same domain as the coach" means nothing.
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.au', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'westnet.com.au',
  'iinet.net.au', 'tpg.com.au', 'wp.pl',
]);

// The operator's own addresses must never be offered to a client as "someone you met".
function operatorEmails() {
  const set = new Set(['guyralphwilson@gmail.com']);
  const bcc = String(process.env.PENDING_NOTIFY_BCC || '').trim().toLowerCase();
  if (bcc) set.add(bcc);
  return set;
}

/**
 * Operator/self addresses only — the narrow check for READ paths (digest, portal list).
 * Existing role-address junk deliberately still shows there (the coach skips it themselves,
 * agreed with Guy 2026-08-26); offering the coach their own or Guy's address is never OK.
 */
function isSelfOrOperatorEmail(email, coach) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return true;
  if (operatorEmails().has(e)) return true;
  const coachEmail = String((coach && coach.clientEmailAddress) || '').toLowerCase().trim();
  return !!coachEmail && e === coachEmail;
}

/**
 * Should this address be kept OFF the pending list entirely?
 * @param {string} email
 * @param {object} [coach] client record (clientEmailAddress used for self + own-domain checks)
 */
function isJunkPendingEmail(email, coach) {
  const e = String(email || '').toLowerCase().trim();
  if (!e || !e.includes('@')) return true;
  const [local, domain] = e.split('@');
  if (ROLE_PREFIXES.has(local)) return true;
  if (operatorEmails().has(e)) return true;
  const coachEmail = String((coach && coach.clientEmailAddress) || '').toLowerCase().trim();
  if (coachEmail && e === coachEmail) return true;
  const coachDomain = coachEmail.includes('@') ? coachEmail.split('@')[1] : '';
  if (coachDomain && domain === coachDomain && !FREEMAIL_DOMAINS.has(coachDomain)) return true;
  return false;
}

/** One-substitution-tolerant token equality ("iacono" vs "lacono"). */
function tokenClose(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff <= 1;
  }
  // one insertion/deletion
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0; let j = 0; let skips = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (++skips > 1) return false;
    j++;
  }
  return true;
}

/** Split an email local part / a display name into comparable lowercase tokens. */
function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/** Freemail / ISP address (or blank)? A company-domain address is the person's WORK address. */
function isFreemailEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  const domain = e.includes('@') ? e.split('@')[1] : '';
  return !domain || FREEMAIL_DOMAINS.has(domain);
}

/**
 * Does this email's local part read as this person's name? Accepts the common shapes:
 * "alix.simpson@" / "alixsimpson@" / "alix.n.simpson@" ↔ "Alix Simpson", "asimpson@" (initial +
 * surname), one-char typo tolerated ("simson"). Conservative by design: a surname alone, or a bare
 * first name against a two-word name, is NOT enough — a wrong claim attaches an address to the
 * wrong person, which is worse than asking.
 */
function localPartMatchesName(email, fullName) {
  const local = String(email || '').toLowerCase().split('@')[0];
  const emailTokens = tokens(local);
  const nameTokens = tokens(fullName);
  if (!emailTokens.length || !nameTokens.length) return false;
  let hits = 0;
  for (const nt of nameTokens) {
    if (emailTokens.some((et) => tokenClose(et, nt) || et.startsWith(nt) || nt.startsWith(et))) hits++;
  }
  // Every name token found in the email (>=2 tokens), or a single-token name that IS the whole
  // local part ("manish" ↔ manish@).
  if (nameTokens.length >= 2 && hits === nameTokens.length) return true;
  if (nameTokens.length === 1) return emailTokens.length === 1 && hits === 1;
  // Glued shapes: "alixsimpson" (typo-tolerant) and "asimpson" (initial + surname, exact only —
  // one substitution there would let bsimpson@ pass as Alix).
  const first = nameTokens[0];
  const last = nameTokens[nameTokens.length - 1];
  const glued = local.replace(/[^a-z0-9]+/g, '');
  return tokenClose(glued, `${first}${last}`) || glued === `${first[0]}${last}`;
}

/**
 * Find a real speaker name for `email` in canonical "[HH:MM:SS] Name: text" transcript lines.
 * Returns the speaker's display name, or null when no confident match.
 */
function nameFromTranscript(transcriptText, email) {
  const local = String(email || '').toLowerCase().split('@')[0];
  if (!tokens(local).length || !transcriptText) return null;

  // Collect distinct speaker labels, skipping diarization placeholders ("Speaker 1").
  const speakers = new Set();
  const re = /^\[\d{2}:\d{2}:\d{2}\]\s+([^:]{2,60}):/gm;
  let m;
  while ((m = re.exec(transcriptText)) !== null) {
    const name = m[1].trim();
    if (name && !/^speaker(\s*\d+)?$/i.test(name)) speakers.add(name);
  }

  let best = null;
  for (const speaker of speakers) {
    if (!localPartMatchesName(local, speaker)) continue;
    if (best && best !== speaker) return null; // two speakers both match — refuse to guess
    best = speaker;
  }
  return best;
}

/**
 * SAME PERSON, SECOND ADDRESS (Alix Simpson, 2026-09-02). A call matched exactly ONE lead (by her
 * Gmail off the booking) while Fathom's invitee list also carried her work address with no name on
 * it. The work address matched nobody, so it was parked as "someone you met who isn't in Wingguy
 * yet" — a stranger who was the one person on the call. Here: when exactly one lead matched and a
 * leftover address reads as that lead's name (localPartMatchesName), CLAIM it for the lead (the
 * caller learns it onto the record) instead of parking it. Refuses when >1 lead matched (whose
 * address is it?) or the local part doesn't read as the name, so a genuine third party on the
 * same call is still parked. Pure; returns { claimed: [{email, leadId, leadName}], rest: [...] }.
 *
 * @param {object} p
 * @param {object[]} p.matched    [{leadId, name, email}] — leads already linked to this meeting
 * @param {object[]} p.candidates [{email, name?}]         — addresses that matched no lead
 */
function claimSameLeadEmails({ matched, candidates } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const leads = new Map();
  for (const m of (Array.isArray(matched) ? matched : [])) if (m && m.leadId) leads.set(m.leadId, m);
  if (leads.size !== 1) return { claimed: [], rest: [...list] };
  const lead = [...leads.values()][0];
  const leadName = String(lead.name || '').trim();
  const onLead = new Set(matched.map((m) => String((m && m.email) || '').toLowerCase().trim()).filter(Boolean));
  const claimed = [];
  const rest = [];
  for (const c of list) {
    const e = String((c && c.email) || '').toLowerCase().trim();
    if (!e || onLead.has(e)) continue; // blank, or already the address this lead matched on
    if (leadName && !isJunkPendingEmail(e) && localPartMatchesName(e, leadName)) {
      claimed.push({ email: e, leadId: lead.leadId, leadName });
    } else {
      rest.push(c);
    }
  }
  return { claimed, rest };
}

/**
 * Drop junk and fill missing names off the transcript. Non-destructive: returns a new array.
 * @param {object[]} pendingLeads [{email, name?}, ...]
 * @param {object} opts { transcriptText, coach, log }
 */
function refinePendingLeads(pendingLeads, { transcriptText, coach, log } = {}) {
  const out = [];
  for (const p of (Array.isArray(pendingLeads) ? pendingLeads : [])) {
    if (isJunkPendingEmail(p.email, coach)) {
      if (log) log.info(`pending filter: skipped ${p.email} (role/self/own-domain address)`);
      continue;
    }
    if (p.name) { out.push(p); continue; }
    const name = nameFromTranscript(transcriptText, p.email);
    out.push(name ? { ...p, name } : { ...p });
  }
  return out;
}

module.exports = {
  isJunkPendingEmail, isSelfOrOperatorEmail, isFreemailEmail, nameFromTranscript, localPartMatchesName,
  claimSameLeadEmails, refinePendingLeads, tokenClose,
};
