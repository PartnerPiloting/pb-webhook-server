/**
 * Match Recall participant.email to Airtable leads (same pattern as Krisp).
 */

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { createSafeLogger } = require('../utils/loggerHelper');

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || process.env.KRISP_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/** @param {object} participant Recall participant object */
function participantEmail(participant) {
  if (!participant || typeof participant !== 'object') return null;
  const e = participant.email;
  if (typeof e !== 'string' || !e.trim()) return null;
  return e.trim().toLowerCase();
}

/**
 * Link one participant email to a lead and return lead id.
 * @returns {Promise<{ leadId: string|null, email: string, matchMethod?: string }>}
 */
async function linkRecallParticipantEmail(email, opts = {}) {
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();
  const log = createSafeLogger('SYSTEM', null, 'recall_lead_link');
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return { leadId: null, email: e };

  let client;
  try {
    client = await clientService.getClientById(coachClientId);
  } catch (err) {
    log.warn(`RECALL-LINK skip: client load ${err.message}`);
    return { leadId: null, email: e, matchMethod: 'client_load_failed' };
  }
  if (!client?.airtableBaseId) {
    return { leadId: null, email: e, matchMethod: 'no_airtable_base' };
  }

  try {
    const lead = await findLeadByEmail(client, e);
    if (lead?.id) return { leadId: lead.id, email: e, matchMethod: 'email' };
  } catch (err) {
    log.warn(`RECALL-LINK findLeadByEmail ${err.message}`);
  }
  return { leadId: null, email: e, matchMethod: 'unmatched' };
}

module.exports = {
  DEFAULT_COACH_CLIENT_ID,
  participantEmail,
  linkRecallParticipantEmail,
};
