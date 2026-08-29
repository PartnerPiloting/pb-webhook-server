// services/wingguyLeads.js
// Wingguy — the CRM WRITE seam for the chat agent. The agent already READS each lead's Airtable
// record every turn (routes/wingguyRoutes.js → enrichProfileFromPortal); this adds the one write it
// needs: updating a lead's email addresses when the lead gives a better address in the thread (e.g.
// the work email the calendar invite should go to). Deliberately NARROW — emails only — so the agent
// can't scribble over other CRM fields. Matches the existing {Email} (primary) + {Alt Emails}
// (newline-separated) conventions used by the Portal and the inbound-email self-healer.

const clientService = require('./clientService');
const { canonicalLinkedinSlug, slugPrefilterFormula, findExactSlugMatch, escapeFormulaText } = require('../utils/linkedinCanonical');

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Find an EXISTING lead record for this person, mirroring enrichProfileFromPortal's match order:
// LinkedIn slug first (strongest), then first+last name. Returns the Airtable record or null. This is
// the dedup guard for createLead — never make a second record for someone already in the base.
//
// DEDUP IS STRICT EQUALITY on the canonical slug (Bognar/Byrne, 2026-07-28): SEARCH() is containment,
// so "andrewdb" used to match "andrewdbyrne" and refuse a legitimate new lead. The SEARCH formula
// survives only as a prefilter; the real decision is canonicalLinkedinSlug equality. Same rule for the
// name fallback — exact first+last, never substring ("Ali" must not dedupe against "Alison").
async function findLeadRecord(base, { linkedinUrl = '', firstName = '', lastName = '' } = {}) {
  const slug = canonicalLinkedinSlug(linkedinUrl);
  if (slug) {
    const candidates = await base('Leads').select({
      filterByFormula: slugPrefilterFormula(slug),
      maxRecords: 50,
    }).firstPage();
    const exact = findExactSlugMatch(candidates, slug);
    if (exact.length) return exact[0];
  }
  const first = String(firstName || '').trim().toLowerCase();
  const last = String(lastName || '').trim().toLowerCase();
  if (first && last) {
    const byName = await base('Leads').select({
      filterByFormula: `AND(LOWER(TRIM({First Name})) = "${escapeFormulaText(first)}", LOWER(TRIM({Last Name})) = "${escapeFormulaText(last)}")`,
      maxRecords: 1,
    }).firstPage();
    if (byName.length) return byName[0];
  }
  return null;
}

// Merge + clean a set of alternate-email sources into the stored form: split tolerant (newline / ; / ,),
// trim + lowercase, keep only plausible emails, DROP the primary, de-dupe, newline-join. This is the
// exact shape the inbound-email matcher and the Portal read/write ({Alt Emails}).
function buildAltEmails(sources, primaryEmail) {
  const primary = String(primaryEmail || '').toLowerCase().trim();
  const seen = new Set();
  const out = [];
  for (const raw of sources) {
    for (const piece of String(raw || '').split(/[;,\n]+/)) {
      const e = piece.trim().toLowerCase();
      if (!e || !EMAIL_SHAPE.test(e) || e === primary || seen.has(e)) continue;
      seen.add(e);
      out.push(e);
    }
  }
  return out.join('\n');
}

// Update a lead's email fields in the client's Leads base.
//   setPrimary  — becomes the new {Email}; the OLD primary is preserved into {Alt Emails} (never lost).
//   addOthers[] — extra addresses filed under {Alt Emails} too.
// Returns { ok, changed, primaryEmail, altEmails } (or { ok:false, error }). Throws only on a genuine
// Airtable failure — a no-op still returns ok. Narrow by design: touches ONLY Email + Alt Emails.
async function updateLeadEmails(airtableBaseId, leadRecordId, { setPrimary = '', addOthers = [] } = {}) {
  if (!airtableBaseId) return { ok: false, error: 'no CRM base for this client' };
  if (!leadRecordId) return { ok: false, error: "couldn't find this lead's CRM record — ask Guy to update it in the Portal" };

  const newPrimaryRaw = String(setPrimary || '').trim().toLowerCase();
  const newPrimary = newPrimaryRaw && EMAIL_SHAPE.test(newPrimaryRaw) ? newPrimaryRaw : '';
  if (setPrimary && !newPrimary) return { ok: false, error: `"${setPrimary}" doesn't look like a valid email address` };
  const others = Array.isArray(addOthers) ? addOthers : [addOthers];

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, error: 'CRM base unavailable' };

  const rec = await base('Leads').find(leadRecordId);
  const currentPrimary = String(rec.fields['Email'] || '').trim();
  const currentAlts = String(rec.fields['Alt Emails'] || '');

  const changingPrimary = !!newPrimary && newPrimary !== currentPrimary.toLowerCase();
  const finalPrimary = changingPrimary ? newPrimary : currentPrimary;

  // When the primary is swapped, the old primary moves into the alternates so nothing is lost.
  const altSources = [currentAlts, ...others];
  if (changingPrimary && currentPrimary) altSources.push(currentPrimary);
  const finalAlts = buildAltEmails(altSources, finalPrimary);

  const fields = {};
  if (changingPrimary) fields['Email'] = finalPrimary;
  // Touch Alt Emails only when it could actually change (primary moved in, or others added).
  if ((changingPrimary && currentPrimary) || others.length) fields['Alt Emails'] = finalAlts;

  if (!Object.keys(fields).length) {
    return { ok: true, changed: false, primaryEmail: finalPrimary, altEmails: buildAltEmails([currentAlts], finalPrimary) };
  }
  await base('Leads').update([{ id: leadRecordId, fields }]);
  return { ok: true, changed: true, primaryEmail: finalPrimary, altEmails: finalAlts };
}

// Create a NEW lead in the client's Leads base — the ONE creation the chat agent can do, added for the
// "I just accepted a connection who isn't in my CRM yet" moment (Guy, 2026-07-07). Deliberately SHAPED,
// not free-form: it writes ONLY the intake fields and only after a dedup check, so it mirrors how live
// inflow lands (a Connected Candidate with Date Connected set) and slots into the pipeline instead of
// becoming an orphan the scoring/FUP logic never sees. The narrow companion to updateLeadEmails.
//   Returns { ok, created, leadRecordId, fields }             on a fresh create
//           { ok:true, exists:true, leadRecordId, ... }        when the person is ALREADY in the base
//           { ok:false, error }                                on a bad call / Airtable failure.
async function createLead(airtableBaseId, {
  firstName = '', lastName = '', linkedinUrl = '', email = '', phone = '', notes = '',
  source = 'They Reached Out To Me', connectionStatus = 'Connected', status = 'In Process',
  dateConnectedISO = '',
} = {}) {
  if (!airtableBaseId) return { ok: false, error: 'no CRM base for this client' };

  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const url = String(linkedinUrl || '').trim();
  // Need a real handle on the person — a name OR a LinkedIn URL — before we'll create anything.
  if (!first && !last && !url) return { ok: false, error: 'need at least a name or LinkedIn URL to create a lead' };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, error: 'CRM base unavailable' };

  // Dedup FIRST: if this person is already in the base, hand back their record id (so the caller can
  // still update their email / book them) rather than creating a duplicate.
  const existing = await findLeadRecord(base, { linkedinUrl: url, firstName: first, lastName: last });
  if (existing) {
    const name = `${existing.fields['First Name'] || ''} ${existing.fields['Last Name'] || ''}`.trim();
    return { ok: true, exists: true, leadRecordId: existing.id, name, error: `already in the CRM${name ? ` (${name})` : ''}` };
  }

  const mail = String(email || '').trim().toLowerCase();
  const tel = String(phone || '').trim();
  const fields = {};
  if (first) fields['First Name'] = first;
  if (last) fields['Last Name'] = last;
  if (url) fields['LinkedIn Profile URL'] = url;
  if (mail && EMAIL_SHAPE.test(mail)) fields['Email'] = mail;
  if (tel) fields['Phone'] = tel;
  if (source) fields['Source'] = source;
  if (connectionStatus) fields['LinkedIn Connection Status'] = connectionStatus;
  if (status) fields['Status'] = status;
  if (notes) fields['Notes'] = String(notes).trim();
  // A lead is "connected" iff {Date Connected} is set — so when we file them as Connected, stamp it.
  // Caller may pass an explicit ISO; otherwise use now (this is the moment Guy accepted them).
  if (connectionStatus === 'Connected') fields['Date Connected'] = dateConnectedISO || new Date().toISOString();

  const created = await base('Leads').create([{ fields }]);
  const rec = created && created[0];
  return { ok: true, created: true, leadRecordId: rec ? rec.id : '', fields };
}

// Patch a lead's LinkedIn-sourced contact details onto an existing record — the SECOND half of the
// "create → enrich" handshake (Guy, 2026-07-08). The chat agent creates the bare record server-side;
// the browser extension then reads the lead's LinkedIn Contact Info (email + phone — only the logged-in
// tab can see them, the server can't reach linkedin.com) and calls this to fill them in. Deliberately
// DEFERENTIAL to anything already on the record so it never clobbers a human/thread value:
//   PHONE — written only when we have one AND the field is empty (LinkedIn is the only phone source).
//   EMAIL — written ONLY when the record has no primary email yet, so an address the lead gave in the
//           thread (set as primary at create time) always wins over the LinkedIn contact-info email
//           (Guy's precedence rule). Idempotent: re-running the enrich changes nothing once filled.
// Returns { ok, changed, email, phone } (or { ok:false, error }).
async function updateLeadContact(airtableBaseId, leadRecordId, { email = '', phone = '' } = {}) {
  if (!airtableBaseId) return { ok: false, error: 'no CRM base for this client' };
  if (!leadRecordId) return { ok: false, error: 'no lead record to update' };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, error: 'CRM base unavailable' };

  const rec = await base('Leads').find(leadRecordId);
  const currentEmail = String(rec.fields['Email'] || '').trim();
  const currentPhone = String(rec.fields['Phone'] || '').trim();

  const mail = String(email || '').trim().toLowerCase();
  const tel = String(phone || '').trim();

  const fields = {};
  if (mail && EMAIL_SHAPE.test(mail) && !currentEmail) fields['Email'] = mail;
  if (tel && !currentPhone) fields['Phone'] = tel;

  // `added` = ONLY what this call actually wrote (so the caller's UI can say "added from LinkedIn: …"
  // without claiming a pre-existing thread email). `email`/`phone` = the record's resulting values.
  const added = {};
  if (fields['Email']) added.email = fields['Email'];
  if (fields['Phone']) added.phone = fields['Phone'];

  if (!Object.keys(fields).length) {
    return { ok: true, changed: false, added, email: currentEmail, phone: currentPhone };
  }
  await base('Leads').update([{ id: leadRecordId, fields }]);
  return { ok: true, changed: true, added, email: fields['Email'] || currentEmail, phone: fields['Phone'] || currentPhone };
}

// Correct a lead's CONTACT FACTS on an existing record — the "the lead just told us something
// truer" write (Guy, 2026-08-20, after Dean Hobin's missing location). Deliberately a short
// WHITELIST — Location, Email, Phone — never a general edit pen:
//   LOCATION — plain overwrite; it's what feeds the lead-timezone maths when offering times.
//   EMAIL    — same preservation rule as updateLeadEmails: the OLD primary moves into {Alt Emails}
//              (never lost), so the invite matcher and inbound self-healer keep finding them.
//   PHONE    — plain overwrite (a human-stated correction beats the scraped value).
// Unlike updateLeadContact (fill-if-empty enrichment), this OVERWRITES — it exists for the moment
// a value the lead or coach actually stated beats what's on the record. Empty/omitted params leave
// fields untouched; there is deliberately NO way to blank a field from here.
// Returns { ok, changed, changes: [{field, from, to}], notes: [] } or { ok:false, error }.
async function updateLeadFacts(airtableBaseId, leadRecordId, { location = '', email = '', phone = '' } = {}) {
  if (!airtableBaseId) return { ok: false, error: 'no CRM base for this client' };
  if (!leadRecordId) return { ok: false, error: 'no lead record to update' };

  const loc = String(location || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const tel = String(phone || '').trim();
  if (!loc && !mail && !tel) return { ok: false, error: 'nothing to update — pass a location, email and/or phone' };
  if (mail && !EMAIL_SHAPE.test(mail)) return { ok: false, error: `"${email}" doesn't look like a valid email address` };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, error: 'CRM base unavailable' };

  const rec = await base('Leads').find(leadRecordId);
  const f = rec.fields || {};
  const fields = {};
  const changes = [];
  const notes = [];

  const currentLoc = String(f['Location'] || '').trim();
  if (loc && loc !== currentLoc) {
    fields['Location'] = loc;
    changes.push({ field: 'Location', from: currentLoc, to: loc });
  }
  const currentPhone = String(f['Phone'] || '').trim();
  if (tel && tel !== currentPhone) {
    fields['Phone'] = tel;
    changes.push({ field: 'Phone', from: currentPhone, to: tel });
  }
  const currentPrimary = String(f['Email'] || '').trim();
  if (mail && mail !== currentPrimary.toLowerCase()) {
    fields['Email'] = mail;
    // The old primary moves into the alternates so nothing is lost — updateLeadEmails' rule.
    if (currentPrimary) {
      fields['Alt Emails'] = buildAltEmails([String(f['Alt Emails'] || ''), currentPrimary], mail);
      notes.push(`old email ${currentPrimary} kept under Alt Emails, so replies and invites from it still match`);
    }
    changes.push({ field: 'Email', from: currentPrimary, to: mail });
  }

  if (!changes.length) return { ok: true, changed: false, changes: [], notes: [] };
  await base('Leads').update([{ id: leadRecordId, fields }]);
  return { ok: true, changed: true, changes, notes };
}

// Persist what the extension just scraped onto the lead's record — the write-back half of the
// profile read (Guy, 2026-08-29). Leads added by referral or via the extension never went through
// Linked Helper, so their records carry no About/headline/profile JSON: no score, thin dossiers,
// generic drafts. The extension already reads all of it on every /wg (full About behind "see more",
// headline, location) and then throws it away after drafting — this keeps it instead, so the FIRST
// time anyone opens a referred lead's profile they are permanently enriched.
//
// FILL BLANKS ONLY, like updateLeadContact: a value already on the record — Linked Helper's scrape,
// a human edit — always wins, and a blinded scrape (LinkedIn markup change) can never erase stored
// material because empties are never written. Idempotent: the second /wg turn writes nothing.
//
// TRUST RULES (which payload fields are really the lead's own profile):
//   about    — trusted whenever non-empty: every extension path that leaves it non-empty read it
//              off the person's OWN profile (profile page, same-person bubble, or the hidden-tab
//              read of their profileUrl); the wrong-person messaging case blanks it client-side.
//   location — same property: the messaging scrape blanks it (Wayne Merry, 2026-08-27), so
//              non-empty means profile page or hidden-tab — trusted.
//   headline — trusted ONLY from the profile surface (trustPage): on the messaging surface the
//              header text lands in `headline` and that is a thread snippet, not their headline.
//
// SCORING HANDOFF: when the record had no Profile Full JSON, synthesize one in the exact shape the
// scorers already read (about / headline / organization_1 fallbacks — utils/appHelpers
// isMissingCritical) and stamp Scoring Status = 'To Be Scored' so the nightly batch picks the lead
// up. The batch gate demands a job entry, which a page scrape doesn't have — a "Title at Company"
// headline is parsed into organization_title_1/organization_1 to satisfy it honestly; leads whose
// headline doesn't parse are covered by the instant score below, whose gate is About-only.
//
// `recordFields` is the fields object enrichProfileFromPortal ALREADY read this turn — passed in so
// this costs zero extra Airtable reads and can no-op for free on every later turn of the session.
// Returns { ok, changed, wrote:[...], scoreNow } — scoreNow = the caller should trigger an instant
// score (JSON now present + a real About + not already scored).
async function enrichLeadFromScrape(airtableBaseId, leadRecordId, profile = {}, recordFields = {}) {
  if (!airtableBaseId || !leadRecordId) return { ok: false, error: 'no base/record to enrich' };
  const f = recordFields || {};
  const has = (v) => v != null && String(v).trim() !== '';
  const pick = (v, cap) => String(v == null ? '' : v).trim().slice(0, cap || 10000);

  const trustPage = profile._wgSurface === 'profile' || !!profile._wgPageKept;
  const about = pick(profile.about, 4000);
  const location = pick(profile.location, 300);
  const headline = trustPage ? pick(profile.headline, 500) : '';
  const url = pick(profile.profileUrl, 500);

  const fields = {};
  const wrote = [];
  const put = (name, val) => {
    if (val && !has(f[name])) { fields[name] = val; wrote.push(name); }
  };
  put('About', about);
  put('Headline', headline);
  put('Location', location);
  put('LinkedIn Profile URL', url);

  // Synthesize the scoring JSON only when the record has none — an LH scrape is always richer and
  // is never touched. Keys match what the scorers read (about/headline/organization_X).
  const hadJson = has(f['Profile Full JSON']);
  let jsonWritten = false;
  if (!hadJson && (about || headline)) {
    const synth = {
      about: about || pick(f['About'], 4000),
      headline: headline || pick(f['Headline'], 500),
      location: location || pick(f['Location'], 300),
      linkedinProfileUrl: url || pick(f['LinkedIn Profile URL'], 500),
      source: 'wingguy-extension-scrape',
      scrapedAt: new Date().toISOString(),
    };
    // "Title at Company" → the org fallback the batch gate needs. Conservative: plain " at "
    // (or @) once, both halves non-empty; anything fancier risks inventing a job.
    const m = /^(.{2,120}?)\s+(?:at|@)\s+(.{2,160})$/i.exec(synth.headline || '');
    if (m) { synth.organization_title_1 = m[1].trim(); synth.organization_1 = m[2].trim(); }
    fields['Profile Full JSON'] = JSON.stringify(synth);
    wrote.push('Profile Full JSON');
    jsonWritten = true;
    // Fresh material → into the scoring queue. Only ever from blank or the too-thin skip (which
    // this write may have just cured); a 'Scored' / 'Manually Excluded' status is never touched.
    const status = String(f['Scoring Status'] || '').trim();
    if (!status || status === 'Skipped – Profile Too Thin') {
      fields['Scoring Status'] = 'To Be Scored';
      wrote.push('Scoring Status');
    }
  }

  // Instant-score signal (lazy scoring, Guy 2026-08-29): score at the moment somebody cared about
  // the lead instead of waiting for tonight's batch. Fires for fresh material (jsonWritten) AND for
  // a lead who already had JSON but is still sitting unscored (the "they connected this morning"
  // gap). About-gated to ≥40 chars because that is /score-lead's own too-thin bar — firing under it
  // would just stamp them Skipped and steal tonight's retry.
  const statusNow = String(fields['Scoring Status'] || f['Scoring Status'] || '').trim();
  // The About that /score-lead will actually gate on lives INSIDE the JSON it reads — for a
  // pre-existing (LH) JSON check that, not the About field, or a divergence could get a lead
  // stamped Skipped that tonight's batch (whose gate is headline+job, not About) would have scored.
  let aboutForGate = about || pick(f['About'], 4000);
  if (!jsonWritten && hadJson) {
    try {
      const j = JSON.parse(String(f['Profile Full JSON']));
      aboutForGate = pick(j.about || j.summary || j.linkedinDescription, 4000);
    } catch (_) { aboutForGate = ''; }
  }
  const scoreNow = (jsonWritten || hadJson)
    && aboutForGate.length >= 40
    && (!statusNow || statusNow === 'To Be Scored');

  if (!wrote.length) return { ok: true, changed: false, wrote: [], scoreNow };

  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { ok: false, error: 'CRM base unavailable' };
  try {
    await base('Leads').update([{ id: leadRecordId, fields }]);
  } catch (e) {
    // A failing write here means every /wg has stopped enriching (an Airtable field rename, a
    // permissions change) — worth one email a day, not a silent log line. Same lesson as the
    // batchScorer skipped-leads write that failed silently Dec 2025 → Aug 2026.
    alertOnceDaily('scrape-writeback',
      'Wingguy scrape write-back failing',
      `Writing the extension's profile scrape onto lead ${leadRecordId} (base ${airtableBaseId}) failed: ${e.message}\n` +
      `Fields attempted: ${Object.keys(fields).join(', ')}\n` +
      `Leads added by referral/extension are NOT being enriched until this is fixed. ` +
      `Check services/wingguyLeads.js enrichLeadFromScrape and the Leads field names.`);
    return { ok: false, error: e.message, scoreNow: false };
  }
  return { ok: true, changed: true, wrote, scoreNow };
}

// One admin email per failure KIND per day — enough to know it's broken, no alert fatigue.
// Uses the same Mailgun alertAdmin pipe as batchScorer (proven delivering in prod logs).
const alertLastSent = new Map(); // kind → ms
function alertOnceDaily(kind, subject, text) {
  try {
    const last = alertLastSent.get(kind) || 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    alertLastSent.set(kind, Date.now());
    const { alertAdmin } = require('../utils/appHelpers');
    alertAdmin(subject, text).catch(() => {});
  } catch (_) { /* alerting must never break the write path */ }
}

// Fire-and-forget instant score via the existing single-lead door (GET /score-lead in
// routes/apiAndJobRoutes.js) — a self-call, the same pattern the Apify pipeline uses, so the
// scoring logic stays in exactly one place. Never throws, never awaited by a draft turn.
const instantScoreFiredAt = new Map(); // recordId → ms; suppresses double-fires from racing chat turns
async function scoreLeadInstant(clientId, leadRecordId, log) {
  try {
    // The write-back is fire-and-forget, so turn 2 of a chat session can re-read the record before
    // turn 1's score has landed and try to score again. One instant score per record per 10 minutes;
    // after that the record's own Scoring Status = 'Scored' is the real guard.
    const last = instantScoreFiredAt.get(leadRecordId) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return { ok: true, deduped: true };
    instantScoreFiredAt.set(leadRecordId, Date.now());
    if (instantScoreFiredAt.size > 2000) instantScoreFiredAt.clear(); // bound the map; a re-fire is harmless
    const port = process.env.PORT || 3001;
    const resp = await fetch(`http://localhost:${port}/score-lead?recordId=${encodeURIComponent(leadRecordId)}`, {
      headers: { 'x-client-id': clientId },
      signal: AbortSignal.timeout(120000),
    });
    const body = await resp.json().catch(() => ({}));
    if (log) log(`instant score for ${leadRecordId}: http ${resp.status}${body && body.finalPct != null ? ` score=${body.finalPct}` : ''}${body && body.skipped ? ` skipped (${body.reason})` : ''}`);
    if (!resp.ok) {
      // A skipped-too-thin lead is a 200 (legit outcome); a non-2xx means the scoring door itself is
      // failing. Leads still get scored by tonight's batch, so this is a degradation, not an outage —
      // but a persistent one should reach Guy, once a day.
      alertOnceDaily('instant-score',
        'Wingguy instant scoring failing',
        `The on-the-spot score call (GET /score-lead) returned http ${resp.status} for lead ${leadRecordId} (client ${clientId}): ${(body && body.error) || 'no error body'}\n` +
        `Same-day scores (Thanks-for-Connecting screen, new-lead creates) are not appearing; the nightly batch is still the backstop. ` +
        `Check /score-lead in routes/apiAndJobRoutes.js and the Gemini config.`);
    }
    return { ok: resp.ok, ...body };
  } catch (e) {
    if (log) log(`instant score for ${leadRecordId} failed (non-fatal): ${e.message}`);
    alertOnceDaily('instant-score',
      'Wingguy instant scoring failing',
      `The on-the-spot score call (GET /score-lead) for lead ${leadRecordId} (client ${clientId}) did not complete: ${e.message}\n` +
      `Same-day scores (Thanks-for-Connecting screen, new-lead creates) are not appearing; the nightly batch is still the backstop.`);
    return { ok: false, error: e.message };
  }
}

module.exports = { updateLeadEmails, buildAltEmails, findLeadRecord, createLead, updateLeadContact, updateLeadFacts, enrichLeadFromScrape, scoreLeadInstant };
