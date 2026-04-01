/**
 * Coaching / ChatGPT convenience: look up contact fields on Master Clients rows by name.
 * Reads optional Phone, LinkedIn, Location if those columns exist on the Clients table.
 */

const clientService = require('./clientService');
const { CLIENT_FIELDS, CLIENT_CONTACT_LOOKUP_FIELDS } = require('../constants/airtableUnifiedConstants');

function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True if client name matches query (substring or all query words appear in name).
 */
function nameMatches(clientName, query) {
  const cn = normalizeName(clientName);
  const q = normalizeName(query);
  if (!q || !cn) return false;
  if (cn.includes(q)) return true;
  const words = q.split(' ').filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => cn.includes(w));
}

function buildContactFromClient(client) {
  const r = client.rawRecord;
  const email =
    client.clientEmailAddress ||
    (r && r.get(CLIENT_FIELDS.CLIENT_EMAIL_ADDRESS)) ||
    null;

  let phone = null;
  let linkedinProfileUrl = null;
  let location = null;
  if (r) {
    phone = r.get(CLIENT_CONTACT_LOOKUP_FIELDS.PHONE) || null;
    linkedinProfileUrl =
      r.get(CLIENT_CONTACT_LOOKUP_FIELDS.LINKEDIN_PROFILE_URL) ||
      r.get(CLIENT_CONTACT_LOOKUP_FIELDS.LINKEDIN_URL) ||
      null;
    location = r.get(CLIENT_CONTACT_LOOKUP_FIELDS.LOCATION) || null;
  }

  return {
    airtableRecordId: client.id,
    clientId: client.clientId,
    clientName: client.clientName,
    status: client.status,
    email: email || null,
    phone: phone || null,
    linkedinProfileUrl: linkedinProfileUrl || null,
    location: location || null
  };
}

/**
 * @param {string} nameQuery - e.g. "Matthew Bulat", "Guy_Wilson" (underscores OK)
 * @returns {Promise<Array<ReturnType<typeof buildContactFromClient>>>}
 */
async function lookupClientContactsByName(nameQuery) {
  const all = await clientService.getAllClients();
  return all.filter((c) => nameMatches(c.clientName, nameQuery)).map(buildContactFromClient);
}

module.exports = {
  lookupClientContactsByName,
  normalizeName,
  nameMatches
};
