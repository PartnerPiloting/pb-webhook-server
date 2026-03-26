/**
 * Optional: update lead Email in client's Leads base when guest submits a different address.
 */
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;

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

module.exports = { maybeUpdateLeadEmailIfChanged };
