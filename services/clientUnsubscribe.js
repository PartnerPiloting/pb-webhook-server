// services/clientUnsubscribe.js
//
// The unsubscribe link behind every weekly email a CLIENT gets from Guy (the client touch planner,
// docs/CLIENT-TOUCH-PLANNER.md). Built 2026-10-22 as the planner's groundwork.
//
// Follows the prospect drip exactly (services/siteEnquiryStore.js): one unguessable token per
// person, so the link needs no login and cannot be used to unsubscribe anyone else by guessing an
// address. The difference is where it lives - prospects are rows in Postgres (site_enquiries);
// clients are rows in the master Clients table, so the token is an Airtable field
// ("Email Unsubscribe Token") and the flag is the existing "Series Unsubscribed" checkbox.
//
// The same route serves both: /series/unsubscribe?t=<token> (routes/marketingRoutes.js) tries the
// prospect store first, then this. GET is the footer link; POST is Gmail's one-click button.
//
// Nothing here sends anything. The planner reads client.emailUnsubscribed (clientService) before it
// picks, and a client without a token gets nothing at all until one is minted
// (scripts/fill-client-unsub-tokens.js for existing clients; joinProvisioningService for new ones).

const crypto = require('crypto');
const clientService = require('./clientService');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'client_unsubscribe' });

const TOKEN_FIELD = 'Email Unsubscribe Token';
const FLAG_FIELD = 'Series Unsubscribed';

/** Same shape as the prospect drip's token: 24 random bytes, URL-safe. */
function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function baseUrl() {
  return (process.env.SERIES_PUBLIC_BASE_URL || 'https://knowaguy.com.au').replace(/\/+$/, '');
}

/** The link to put in a client's email footer. Null when the client has no token yet. */
function unsubscribeUrlFor(client) {
  const token = client && client.emailUnsubToken;
  if (!token) return null;
  return `${baseUrl()}/series/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** Pure: the client whose token this is, or null. Tokens are compared exactly, never trimmed into a match. */
function findClientByToken(token, clients) {
  const t = String(token || '').trim();
  if (!t || t.length < 16) return null;
  return (clients || []).find((c) => c.emailUnsubToken && c.emailUnsubToken === t) || null;
}

/**
 * Unsubscribe the client whose token this is. Returns { ok, clientId, clientName, alreadyUnsubscribed }
 * or { ok: false }. Already-unsubscribed is still ok - they clicked to be off, and they are off.
 * Never throws: the route must always answer.
 */
async function unsubscribeClientByToken(token) {
  try {
    const clients = await clientService.getAllClients();
    const client = findClientByToken(token, clients);
    if (!client) return { ok: false };
    if (client.emailUnsubscribed) {
      return { ok: true, clientId: client.clientId, clientName: client.clientName, alreadyUnsubscribed: true };
    }
    const base = clientService.initializeClientsBase();
    await base('Clients').update([{ id: client.id, fields: { [FLAG_FIELD]: true } }]);
    clientService.clearCache();
    logger.info(`client unsubscribed from the weekly emails: ${client.clientId}`);
    return { ok: true, clientId: client.clientId, clientName: client.clientName, alreadyUnsubscribed: false };
  } catch (err) {
    logger.error(`unsubscribe by token failed: ${err && err.message}`);
    return { ok: false };
  }
}

module.exports = {
  TOKEN_FIELD,
  FLAG_FIELD,
  newToken,
  unsubscribeUrlFor,
  findClientByToken,
  unsubscribeClientByToken,
};
