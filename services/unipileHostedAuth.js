// services/unipileHostedAuth.js
// Mint the "connect your calendar and mailbox" link for a client, and catch Unipile's callback
// when they approve it - so the connection stops being invisible.
//
// Until 2026-09-16 this link was minted by hand from the Unipile dashboard during the call, and
// nothing told us when the client had approved it: the account id had to be read out of the
// dashboard and typed onto the row (docs/wingguy-onboarding-checklist.md, step 2, "the
// connection is invisible to us until Claude goes and looks"). Two things change here:
//
//   1. mintHostedLink()  - one POST to Unipile's hosted-auth endpoint, with `name` = the Client
//      ID and a `notify_url` pointing back at us. Returns the URL to paste.
//   2. handleNotify()    - Unipile POSTs { status, account_id, name } to that notify_url the
//      moment the client approves. We verify the URL's signed token, then set exactly the fields
//      step 2 says to set: Unipile Account ID, Calendar Provider = unipile, Email Provider =
//      unipile, Calendar Read IDs = all (every calendar, so the no-double-booking promise holds),
//      and BLANK Calendar Email (a value there forces the old Google path and Unipile is ignored).
//
// SECURITY: the notify URL carries an HMAC-signed, expiring token bound to the Client ID (same
// shape as routes/zohoAuthRoutes.js `state`), signed with UNIPILE_API_KEY - genuinely secret and
// always present when this flow is usable at all. A forged callback can't attach an account to an
// arbitrary client, and a replayed one past expiry is refused. The payload's `name` must ALSO
// match the token's client id, so a mix-up between two open links can't cross the streams.
//
// Payload shape confirmed against Unipile's docs (developer.unipile.com/docs/hosted-auth):
//   { "status": "CREATION_SUCCESS", "account_id": "e54m8LR22bA7G5qsAc8w", "name": "<our name>" }
// with status "RECONNECTED" for reconnect-type links.

const crypto = require('crypto');
const { CLIENT_FIELDS } = require('../constants/airtableUnifiedConstants');

const LINK_TTL_MS = 24 * 60 * 60 * 1000;        // the link itself (Unipile also expires links on its daily restart)
const NOTIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // the callback token - a client may click days later
const OK_STATUSES = new Set(['CREATION_SUCCESS', 'RECONNECTED']);
// GOOGLE and OUTLOOK each cover mail AND calendar in one approval - the "one click covers both"
// promise in the checklist. MAIL (plain IMAP) is deliberately not offered here: it has no calendar
// behind it, and a client on hosting-only mail needs the conversation, not a chooser.
const DEFAULT_PROVIDERS = ['GOOGLE', 'OUTLOOK'];

function env() {
  const dsn = String(process.env.UNIPILE_DSN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    apiKey: process.env.UNIPILE_API_KEY || '',
    apiUrl: dsn ? `https://${dsn}` : '',
    base: dsn ? `https://${dsn}/api/v1` : '',
  };
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || process.env.EXTENSION_DIST_SERVER || 'https://pb-webhook-server.onrender.com').replace(/\/+$/, '');
}

function secret() {
  return process.env.UNIPILE_NOTIFY_SECRET || process.env.UNIPILE_API_KEY || '';
}

function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 32);
}

/** A signed, expiring token bound to one client id. base64url so it sits cleanly in a URL path. */
function signNotifyToken(clientId, { now = Date.now(), key = secret(), ttlMs = NOTIFY_TTL_MS } = {}) {
  if (!key) throw new Error('UNIPILE_API_KEY is not set - cannot sign a notify token');
  if (!clientId || /\./.test(clientId)) throw new Error('client id missing or contains a dot');
  const payload = `${clientId}.${now + ttlMs}`;
  return Buffer.from(`${payload}.${sign(payload, key)}`).toString('base64url');
}

/** @returns {string|null} the client id the token was minted for, or null if forged/expired. */
function verifyNotifyToken(token, { now = Date.now(), key = secret() } = {}) {
  try {
    if (!key) return null;
    const [clientId, exp, sig] = Buffer.from(String(token || ''), 'base64url').toString('utf8').split('.');
    if (!clientId || !exp || !sig) return null;
    const expected = sign(`${clientId}.${exp}`, key);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (now > Number(exp)) return null;
    return clientId;
  } catch (_) { return null; }
}

/** The body we send Unipile. Pure, so the test can pin it without a network. */
function buildLinkRequest(clientId, { now = Date.now(), providers = DEFAULT_PROVIDERS, apiUrl, notifyUrl } = {}) {
  return {
    type: 'create',
    providers,
    api_url: apiUrl,
    expiresOn: new Date(now + LINK_TTL_MS).toISOString(),
    name: clientId,
    notify_url: notifyUrl,
  };
}

/**
 * Mint the hosted-auth link for one client. Returns { url, expiresAt, providers }.
 * @param {string} clientId
 * @param {object} [deps]  { fetch, now, providers } - injectable for tests
 */
async function mintHostedLink(clientId, deps = {}) {
  const { apiKey, apiUrl, base } = env();
  if (!apiKey || !base) throw new Error('Unipile is not configured on this server (UNIPILE_DSN / UNIPILE_API_KEY)');
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now();
  const notifyUrl = `${publicBase()}/api/unipile/notify/${signNotifyToken(clientId, { now })}`;
  const body = buildLinkRequest(clientId, { now, providers: deps.providers, apiUrl, notifyUrl });

  const res = await doFetch(`${base}/hosted/accounts/link`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* leave null */ }
  if (!res.ok || !json || !json.url) {
    throw new Error(`Unipile refused the hosted link (HTTP ${res.status}): ${(text || '').slice(0, 300)}`);
  }
  return { url: json.url, expiresAt: body.expiresOn, providers: body.providers };
}

/** The exact field writes step 2 of the checklist prescribes - nothing more. */
function connectedFields(accountId) {
  return {
    'Unipile Account ID': accountId,
    'Calendar Provider': 'unipile',
    'Email Provider': 'unipile',
    'Calendar Read IDs': 'all',
    [CLIENT_FIELDS.CALENDAR_EMAIL]: null,
  };
}

/**
 * Handle Unipile's callback. Returns a small result object; never throws on a bad payload (the
 * route answers 200 regardless so Unipile doesn't retry a callback we have decided to ignore).
 * @param {string} token   the path token from the notify URL
 * @param {object} body    Unipile's JSON payload
 * @param {object} deps    { clientService, updateFields(recordId, fields), now, logger }
 */
async function handleNotify(token, body, deps = {}) {
  const now = deps.now || Date.now();
  const log = deps.logger || { info() {}, warn() {} };
  const clientId = verifyNotifyToken(token, { now });
  if (!clientId) return { ok: false, reason: 'bad or expired token' };

  const status = String((body && body.status) || '');
  const accountId = String((body && body.account_id) || '').trim();
  const name = String((body && body.name) || '').trim();
  if (!OK_STATUSES.has(status)) return { ok: false, clientId, reason: `ignored status ${status || '(none)'}` };
  if (!accountId) return { ok: false, clientId, reason: 'no account_id in payload' };
  if (name && name !== clientId) return { ok: false, clientId, reason: `payload name ${name} does not match token client ${clientId}` };

  const cs = deps.clientService || require('./clientService');
  const client = await cs.getClientById(clientId);
  if (!client) return { ok: false, clientId, reason: 'client not found' };
  const recordId = client.recordId || client.id;
  if (!recordId) return { ok: false, clientId, reason: 'client has no record id' };

  const fields = connectedFields(accountId);
  const update = deps.updateFields || defaultUpdateFields;
  await update(recordId, fields);
  log.info(`unipile notify: ${clientId} connected account ${accountId} (${status}) - provider fields set`);
  return { ok: true, clientId, accountId, status, fields };
}

async function defaultUpdateFields(recordId, fields) {
  const Airtable = require('airtable');
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);
  await base('Clients').update(recordId, fields);
}

module.exports = {
  mintHostedLink,
  handleNotify,
  signNotifyToken,
  verifyNotifyToken,
  buildLinkRequest,
  connectedFields,
  DEFAULT_PROVIDERS,
  LINK_TTL_MS,
  NOTIFY_TTL_MS,
};
