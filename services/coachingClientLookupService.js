/**
 * Coaching / ChatGPT convenience: look up a **Lead** in a tenant's Airtable base
 * (Leads table) by person name — reuses inboundEmailService.findLeadByName.
 *
 * Master **Clients** is only used to resolve which base (Guy Wilson, etc.).
 */

const clientService = require('./clientService');
const inboundEmailService = require('./inboundEmailService');

/**
 * Resolve Master Clients row → client object with airtableBaseId.
 * @param {{ clientId?: string, clientName?: string }} q
 */
async function resolveTenantClient(q) {
  const id = (q.clientId || process.env.COACHING_LEADS_CLIENT_ID || '').trim();
  const nameQ = (q.clientName || process.env.COACHING_LEADS_CLIENT_NAME || '').trim();

  if (id) {
    const all = await clientService.getAllClients();
    const c = all.find((x) => (x.clientId || '').toLowerCase() === id.toLowerCase());
    if (c) return c;
  }

  if (nameQ) {
    const norm = nameQ.toLowerCase().replace(/_/g, ' ').trim();
    const all = await clientService.getAllClients();
    const c = all.find((x) => {
      const n = (x.clientName || '').toLowerCase().replace(/_/g, ' ').trim();
      if (!n) return false;
      return n.includes(norm) || norm.includes(n);
    });
    if (c) return c;
  }

  return null;
}

function shapeLead(lead) {
  if (!lead) return null;
  return {
    airtableRecordId: lead.id,
    firstName: lead.firstName || null,
    lastName: lead.lastName || null,
    leadName: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || null,
    email: lead.email || null,
    phone: lead.phone || null,
    linkedinProfileUrl: lead.linkedinUrl || null,
    location: lead.location || null,
    company: lead.company || null
  };
}

/**
 * @param {string} leadName - e.g. "Matthew Bulat" (First + Last as in Airtable)
 * @param {{ clientId?: string, clientName?: string, company?: string }} tenant
 */
async function lookupLeadContactByName(leadName, tenant) {
  const client = await resolveTenantClient(tenant);
  if (!client) {
    const err = new Error(
      'No tenant client resolved. Pass clientId or clientName query param, or set COACHING_LEADS_CLIENT_ID / COACHING_LEADS_CLIENT_NAME on the server.'
    );
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }
  if (!client.airtableBaseId) {
    const err = new Error(`Client ${client.clientId} has no Airtable base configured`);
    err.code = 'NO_BASE';
    throw err;
  }

  const result = await inboundEmailService.findLeadByName(
    client,
    leadName.trim(),
    (tenant.company || '').trim() || null
  );

  const shapedMatches = (result.allMatches || []).map(shapeLead);

  return {
    tenantClientId: client.clientId,
    tenantClientName: client.clientName,
    matchType: result.matchType,
    lead: result.lead ? shapeLead(result.lead) : null,
    matches: shapedMatches
  };
}

module.exports = {
  resolveTenantClient,
  lookupLeadContactByName,
  shapeLead
};
