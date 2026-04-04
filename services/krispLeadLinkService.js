/**
 * Match Krisp webhook payloads to Airtable Leads (Guy-Wilson base) by participant email.
 * Uses existing inboundEmailService.findLeadByEmail + clientService.getClientById.
 */

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { insertKrispEventLead } = require('./krispWebhookDb');
const { createSafeLogger } = require('../utils/loggerHelper');

const DEFAULT_COACH_CLIENT_ID = (process.env.KRISP_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/** Collect emails from payload.data.participants[].email */
function extractParticipantEmails(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const d = payload.data;
  if (!d || typeof d !== 'object' || !Array.isArray(d.participants)) return [];
  const out = [];
  const seen = new Set();
  for (const p of d.participants) {
    if (!p || typeof p.email !== 'string') continue;
    const e = p.email.toLowerCase().trim();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * @param {string|number} postgresEventId - krisp_webhook_events.id
 * @param {object} payload - stored JSON body
 * @param {{ coachClientId?: string }} [opts]
 * @returns {Promise<{ linked: number, checked: number, leadIds: string[], errors?: string }>}
 */
async function linkKrispEventToLeadsByEmail(postgresEventId, payload, opts = {}) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_lead_link');
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();
  const emails = extractParticipantEmails(payload);

  if (emails.length === 0) {
    return { linked: 0, checked: 0, leadIds: [] };
  }

  let client;
  try {
    client = await clientService.getClientById(coachClientId);
  } catch (e) {
    log.warn(`KRISP-LINK skip: could not load client ${coachClientId}: ${e.message}`);
    return { linked: 0, checked: emails.length, leadIds: [], errors: 'client_load_failed' };
  }

  if (!client?.airtableBaseId) {
    log.warn(`KRISP-LINK skip: client ${coachClientId} has no airtableBaseId`);
    return { linked: 0, checked: emails.length, leadIds: [], errors: 'no_airtable_base' };
  }

  const leadIds = [];
  let linked = 0;

  for (const email of emails) {
    try {
      const lead = await findLeadByEmail(client, email);
      if (!lead?.id) continue;
      const r = await insertKrispEventLead({
        eventId: postgresEventId,
        airtableLeadId: lead.id,
        coachClientId,
        participantEmail: email,
        matchMethod: 'email',
      });
      if (r.inserted) {
        linked++;
        leadIds.push(lead.id);
        log.info(`KRISP-LINK event=${postgresEventId} lead=${lead.id} email=${email}`);
      }
    } catch (e) {
      log.warn(`KRISP-LINK error email=${email}: ${e.message}`);
    }
  }

  return { linked, checked: emails.length, leadIds };
}

module.exports = {
  extractParticipantEmails,
  linkKrispEventToLeadsByEmail,
  DEFAULT_COACH_CLIENT_ID,
};
