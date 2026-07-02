// services/wingguyLeads.js
// Wingguy — the CRM WRITE seam for the chat agent. The agent already READS each lead's Airtable
// record every turn (routes/wingguyRoutes.js → enrichProfileFromPortal); this adds the one write it
// needs: updating a lead's email addresses when the lead gives a better address in the thread (e.g.
// the work email the calendar invite should go to). Deliberately NARROW — emails only — so the agent
// can't scribble over other CRM fields. Matches the existing {Email} (primary) + {Alt Emails}
// (newline-separated) conventions used by the Portal and the inbound-email self-healer.

const clientService = require('./clientService');

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

module.exports = { updateLeadEmails, buildAltEmails };
