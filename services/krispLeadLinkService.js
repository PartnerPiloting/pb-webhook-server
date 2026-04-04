/**
 * Match Krisp webhook payloads to Airtable Leads (Guy-Wilson base) by participant email.
 * Uses existing inboundEmailService.findLeadByEmail + clientService.getClientById.
 */

const clientService = require('./clientService');
const { findLeadByEmail, findLeadByName } = require('./inboundEmailService');
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

/** @param {object} payload */
function participantsByEmailLower(payload) {
  const map = new Map();
  const d = payload?.data;
  if (!d || typeof d !== 'object' || !Array.isArray(d.participants)) return map;
  for (const p of d.participants) {
    if (!p || typeof p.email !== 'string') continue;
    const e = p.email.toLowerCase().trim();
    if (e && !map.has(e)) map.set(e, p);
  }
  return map;
}

/**
 * @param {string|number} postgresEventId - krisp_webhook_events.id
 * @param {object} payload - stored JSON body
 * @param {{ coachClientId?: string }} [opts]
 * @returns {Promise<{ linked: number, checked: number, leadIds: string[], errors?: string, unmatchedParticipants: { email: string, first_name?: string, last_name?: string }[] }>}
 */
async function linkKrispEventToLeadsByEmail(postgresEventId, payload, opts = {}) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_lead_link');
  const coachClientId = (opts.coachClientId || DEFAULT_COACH_CLIENT_ID).trim();
  const emails = extractParticipantEmails(payload);

  if (emails.length === 0) {
    return { linked: 0, checked: 0, leadIds: [], unmatchedParticipants: [] };
  }

  let client;
  try {
    client = await clientService.getClientById(coachClientId);
  } catch (e) {
    log.warn(`KRISP-LINK skip: could not load client ${coachClientId}: ${e.message}`);
    return {
      linked: 0,
      checked: emails.length,
      leadIds: [],
      errors: 'client_load_failed',
      unmatchedParticipants: emails.map((email) => {
        const p = participantsByEmailLower(payload).get(email) || {};
        return { email, first_name: p.first_name, last_name: p.last_name };
      }),
    };
  }

  if (!client?.airtableBaseId) {
    log.warn(`KRISP-LINK skip: client ${coachClientId} has no airtableBaseId`);
    return {
      linked: 0,
      checked: emails.length,
      leadIds: [],
      errors: 'no_airtable_base',
      unmatchedParticipants: emails.map((email) => {
        const p = participantsByEmailLower(payload).get(email) || {};
        return { email, first_name: p.first_name, last_name: p.last_name };
      }),
    };
  }

  const participantMap = participantsByEmailLower(payload);
  const leadIds = [];
  let linked = 0;
  const unmatchedParticipants = [];

  for (const email of emails) {
    const p = participantMap.get(email) || {};
    try {
      let lead = await findLeadByEmail(client, email);
      let matchMethod = 'email';

      if (!lead?.id) {
        const first = typeof p.first_name === 'string' ? p.first_name.trim() : '';
        const last = typeof p.last_name === 'string' ? p.last_name.trim() : '';
        const fullName = [first, last].filter(Boolean).join(' ');
        if (fullName.length >= 3) {
          const nameRes = await findLeadByName(client, fullName, null);
          if (
            nameRes.lead?.id &&
            (nameRes.matchType === 'unique' || nameRes.matchType === 'narrowed')
          ) {
            lead = nameRes.lead;
            matchMethod = 'name';
            log.info(`KRISP-LINK event=${postgresEventId} lead=${lead.id} name="${fullName}"`);
          }
        }
      }

      if (!lead?.id) {
        unmatchedParticipants.push({
          email,
          first_name: p.first_name,
          last_name: p.last_name,
        });
        continue;
      }

      const r = await insertKrispEventLead({
        eventId: postgresEventId,
        airtableLeadId: lead.id,
        coachClientId,
        participantEmail: email,
        matchMethod,
      });
      if (r.inserted) {
        linked++;
        leadIds.push(lead.id);
        log.info(`KRISP-LINK event=${postgresEventId} lead=${lead.id} email=${email} method=${matchMethod}`);
      }
    } catch (e) {
      log.warn(`KRISP-LINK error email=${email}: ${e.message}`);
      unmatchedParticipants.push({
        email,
        first_name: p.first_name,
        last_name: p.last_name,
      });
    }
  }

  return { linked, checked: emails.length, leadIds, unmatchedParticipants };
}

module.exports = {
  extractParticipantEmails,
  linkKrispEventToLeadsByEmail,
  DEFAULT_COACH_CLIENT_ID,
};
