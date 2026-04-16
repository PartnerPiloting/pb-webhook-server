/**
 * Optional: update lead Email in client's Leads base when guest submits a different address.
 * CC outreach funnel: first-click intro, booking page visit, completed guest booking (timestamps once).
 */
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;

/** Must match Airtable column names exactly. */
const AIRTABLE_LEAD_FIELDS = {
  ccIntroClickedAt: "CC Intro Clicked At",
  ccBookingPageVisitedAt: "CC Booking Page Visited At",
  guestBookingCompletedAt: "Guest Booking Completed At",
};

function normalizeEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function escapeFormulaString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * @returns {Promise<{ updated: boolean, reason?: string }>}
 */
async function maybeUpdateLeadEmailIfChanged(opts) {
  const { airtableBaseId, linkedInUrl, oldEmail, newEmail } = opts;
  if (!AIRTABLE_KEY || !airtableBaseId) {
    return { updated: false, reason: "no base or api key" };
  }
  if (normalizeEmail(oldEmail) === normalizeEmail(newEmail)) {
    return { updated: false, reason: "unchanged" };
  }

  const li = escapeFormulaString(String(linkedInUrl).trim());
  const formula = `OR({LinkedIn Profile URL} = '${li}', {LinkedIn URL} = '${li}')`;

  const url = `https://api.airtable.com/v0/${airtableBaseId}/Leads?filterByFormula=${encodeURIComponent(
    formula
  )}&maxRecords=3&fields[]=Email&fields[]=LinkedIn Profile URL&fields[]=LinkedIn URL`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) {
    return { updated: false, reason: `airtable list ${res.status}` };
  }
  const data = await res.json();
  const recs = data.records || [];
  if (recs.length !== 1) {
    return { updated: false, reason: recs.length === 0 ? "not found" : "ambiguous" };
  }

  const patchUrl = `https://api.airtable.com/v0/${airtableBaseId}/Leads/${recs[0].id}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { Email: String(newEmail).trim() } }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text();
    return { updated: false, reason: `patch ${patchRes.status} ${t.slice(0, 200)}` };
  }
  return { updated: true };
}

/**
 * Skip lead updates from anonymous /identify flow (token uses placeholder LinkedIn).
 */
function shouldSkipLeadTrackingByLinkedIn(li) {
  const s = String(li || "").trim().toLowerCase();
  return !s || s === "direct-booking";
}

/**
 * Find single lead by LinkedIn URL; returns { id, fields } or null.
 * @param {string[]} [extraFieldNames] — e.g. timestamp field to check before set
 */
async function findLeadByLinkedIn(airtableBaseId, linkedInUrl, extraFieldNames = []) {
  if (!AIRTABLE_KEY || !airtableBaseId || shouldSkipLeadTrackingByLinkedIn(linkedInUrl)) {
    return null;
  }
  const li = escapeFormulaString(String(linkedInUrl).trim());
  const formula = `OR({LinkedIn Profile URL} = '${li}', {LinkedIn URL} = '${li}')`;
  const fieldParams = ["LinkedIn Profile URL", "LinkedIn URL", ...extraFieldNames]
    .map((f) => `fields[]=${encodeURIComponent(f)}`)
    .join("&");
  const url = `https://api.airtable.com/v0/${airtableBaseId}/Leads?filterByFormula=${encodeURIComponent(
    formula
  )}&maxRecords=3&${fieldParams}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const recs = data.records || [];
  if (recs.length !== 1) return null;
  return { id: recs[0].id, fields: recs[0].fields || {} };
}

/**
 * Set a datetime field on the lead only if it is currently empty (first touch wins).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function maybeSetLeadTimestampOnce(opts) {
  const { airtableBaseId, linkedInUrl, fieldName } = opts;
  if (!AIRTABLE_KEY || !airtableBaseId || !fieldName) {
    return { ok: false, reason: "missing config" };
  }
  if (shouldSkipLeadTrackingByLinkedIn(linkedInUrl)) {
    return { ok: false, reason: "skip placeholder linkedin" };
  }

  const lead = await findLeadByLinkedIn(airtableBaseId, linkedInUrl, [fieldName]);
  if (!lead) return { ok: false, reason: "not found" };

  const existing = lead.fields[fieldName];
  if (existing != null && String(existing).trim() !== "") {
    return { ok: false, reason: "already set" };
  }

  const iso = new Date().toISOString();
  const patchUrl = `https://api.airtable.com/v0/${airtableBaseId}/Leads/${lead.id}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { [fieldName]: iso } }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text();
    return { ok: false, reason: `patch ${patchRes.status} ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

async function maybeSetCcIntroClickedAt(opts) {
  return maybeSetLeadTimestampOnce({
    ...opts,
    fieldName: AIRTABLE_LEAD_FIELDS.ccIntroClickedAt,
  });
}

async function maybeSetCcBookingPageVisitedAt(opts) {
  return maybeSetLeadTimestampOnce({
    ...opts,
    fieldName: AIRTABLE_LEAD_FIELDS.ccBookingPageVisitedAt,
  });
}

async function maybeSetGuestBookingCompletedAt(opts) {
  return maybeSetLeadTimestampOnce({
    ...opts,
    fieldName: AIRTABLE_LEAD_FIELDS.guestBookingCompletedAt,
  });
}

module.exports = {
  maybeUpdateLeadEmailIfChanged,
  maybeSetCcIntroClickedAt,
  maybeSetCcBookingPageVisitedAt,
  maybeSetGuestBookingCompletedAt,
  AIRTABLE_LEAD_FIELDS,
};
