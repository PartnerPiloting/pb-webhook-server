// services/wingguyLeads.js
// Wingguy — the CRM WRITE seam for the chat agent. The agent already READS each lead's Airtable
// record every turn (routes/wingguyRoutes.js → enrichProfileFromPortal); this adds the one write it
// needs: updating a lead's email addresses when the lead gives a better address in the thread (e.g.
// the work email the calendar invite should go to). Deliberately NARROW — emails only — so the agent
// can't scribble over other CRM fields. Matches the existing {Email} (primary) + {Alt Emails}
// (newline-separated) conventions used by the Portal and the inbound-email self-healer.

const clientService = require('./clientService');

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pull the linkedin.com/in/<slug> handle out of a profile URL (lowercased). Same shape the Portal
// enrich (routes/wingguyRoutes.js → enrichProfileFromPortal) matches on — the slug is the strongest
// dedup key we have for a person.
function linkedinSlug(url) {
  const m = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
}

// Find an EXISTING lead record for this person, mirroring enrichProfileFromPortal's match order:
// LinkedIn slug first (strongest), then first+last name. Returns the Airtable record or null. This is
// the dedup guard for createLead — never make a second record for someone already in the base.
async function findLeadRecord(base, { linkedinUrl = '', firstName = '', lastName = '' } = {}) {
  const slug = linkedinSlug(linkedinUrl);
  if (slug) {
    const bySlug = await base('Leads').select({
      filterByFormula: `SEARCH("${slug}", LOWER({LinkedIn Profile URL}))`,
      maxRecords: 1,
    }).firstPage();
    if (bySlug.length) return bySlug[0];
  }
  const first = String(firstName || '').trim().toLowerCase();
  const last = String(lastName || '').trim().toLowerCase();
  if (first && last) {
    const byName = await base('Leads').select({
      filterByFormula: `AND(SEARCH("${first}", LOWER({First Name})), SEARCH("${last}", LOWER({Last Name})))`,
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

module.exports = { updateLeadEmails, buildAltEmails, findLeadRecord, createLead, updateLeadContact };
