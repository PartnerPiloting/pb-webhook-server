// services/wisprAuth.js
// Signing Wingguy in to a client's Wispr Flow, and keeping it signed in (13 Nov 2026).
//
//   - The client opens their Connect Wispr link, clicks Allow on Wispr's own page, and lands back
//     on our callback. That is authorization code + PKCE. (Wispr's short-code flow is broken on
//     their side - "Missing external_auth_id" - so it is not used.)
//   - Wispr hands back a pass that lasts 3 days and a renewal ticket. The ticket renews the pass
//     with nobody present, and Wispr REPLACES THE TICKET EVERY TIME IT IS USED. So a renewal is:
//     take the lock, look again (someone may have just renewed), renew, save pass + new ticket in
//     one write, let go. Two renewals for one client can never run at once (wisprStore lock).
//   - If Wispr refuses the ticket (the client signed out, revoked us, or the ticket was lost), the
//     connection is marked "needs_reconnect" and stays that way until the client clicks the link
//     again. Nothing here ever deletes a recording or writes anything to Wispr - it is read-only.
//
// No token is ever logged, returned to a browser, or put in an error message.

const crypto = require('crypto');
const cfg = require('./wisprConfig');

class WisprNotConnected extends Error {
  constructor(msg = 'Wispr is not connected for this client') { super(msg); this.code = 'WISPR_NOT_CONNECTED'; }
}
class WisprNeedsReconnect extends Error {
  constructor(msg = 'Wingguy\'s connection to Wispr has dropped') { super(msg); this.code = 'WISPR_NEEDS_RECONNECT'; }
}
class WisprTransient extends Error {
  constructor(msg) { super(msg); this.code = 'WISPR_TRANSIENT'; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function newPkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── The Connect Wispr link ──────────────────────────────────────────────────────────────────
// Signed per client and long-lived, so the same link works from the portal, from the "your
// connection dropped" email and from chat. All it can do is START a sign-in for that client.

function linkSignature(clientId) {
  const secret = cfg.linkSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`wispr-connect.${String(clientId)}`).digest('base64url').slice(0, 32);
}

function connectLink(clientId) {
  const sig = linkSignature(clientId);
  if (!sig) return '';
  return `${cfg.publicBase()}/auth/wispr/start?c=${encodeURIComponent(clientId)}&k=${sig}`;
}

function verifyConnectLink(clientId, sig) {
  const expected = linkSignature(clientId);
  const got = String(sig || '');
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// ── Sign-in (authorization code + PKCE) ─────────────────────────────────────────────────────

/** Start a sign-in: remember the PKCE secret against a one-use state, return Wispr's URL to send the browser to. */
async function beginSignIn(clientId, { store }) {
  if (!cfg.oauthClientId()) throw new Error('WISPR_OAUTH_CLIENT_ID is not set - Wingguy is not registered with Wispr on this server');
  const state = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = newPkce();
  await store.putPendingAuth(state, clientId, verifier);
  const u = new URL(cfg.AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.oauthClientId());
  u.searchParams.set('redirect_uri', cfg.redirectUri());
  u.searchParams.set('scope', cfg.SCOPE);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('resource', cfg.MCP_URL);
  return u.toString();
}

async function postToken(params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(cfg.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      // The renewal runs under the connection lock - never let a hung request hold it.
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { ok: false, transient: true, error: `network: ${e.message}` };
  }
  let body = {};
  try { body = await res.json(); } catch (_) { body = {}; }
  if (res.ok && body && body.access_token) return { ok: true, body };
  const code = String((body && body.error) || '').toLowerCase();
  // Never echo the body: an error body can carry token fragments. The error CODE is safe.
  const error = `HTTP ${res.status}${code ? ` ${code}` : ''}`;
  if (res.status === 429 || res.status >= 500) return { ok: false, transient: true, error };
  const refused = ['invalid_grant', 'invalid_token', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(code)
    || res.status === 401 || res.status === 403;
  return { ok: false, refused, transient: !refused && res.status !== 400, error, code };
}

const expiryFrom = (body, nowMs) => new Date(nowMs + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000).toISOString();

/** Finish a sign-in: swap the code for a pass + ticket and save the connection. */
async function completeSignIn({ state, code }, { store, fetchImpl = fetch, now = Date.now } = {}) {
  const pending = await store.takePendingAuth(state);
  if (!pending) return { ok: false, error: 'expired', message: 'This sign-in link has expired or was already used.' };
  const r = await postToken({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: cfg.redirectUri(),
    client_id: cfg.oauthClientId(),
    code_verifier: pending.codeVerifier,
    resource: cfg.MCP_URL,
  }, fetchImpl);
  if (!r.ok) return { ok: false, coachClientId: pending.coachClientId, error: 'exchange', message: `Wispr did not complete the sign-in (${r.error}).` };
  if (!r.body.refresh_token) {
    return { ok: false, coachClientId: pending.coachClientId, error: 'no-ticket', message: 'Wispr signed in but did not hand back a renewal ticket, so the connection would only last 3 days. Nothing was saved.' };
  }
  await store.saveNewConnection(pending.coachClientId, {
    accessToken: r.body.access_token,
    refreshToken: r.body.refresh_token,
    expiresAt: expiryFrom(r.body, now()),
  });
  return { ok: true, coachClientId: pending.coachClientId };
}

// ── The token keeper ────────────────────────────────────────────────────────────────────────

function isFresh(row, nowMs, aheadMs) {
  if (!row || !row.accessToken || !row.expiresAt) return false;
  return Date.parse(row.expiresAt) - nowMs > aheadMs;
}

async function saveWithRetry(save, fields, log) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try { await save(fields); return true; } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  if (log) log.error(`wispr: a renewed ticket could NOT be saved (${lastErr && lastErr.message}) - the connection will need a reconnect when the current pass runs out`);
  return false;
}

/**
 * A pass that works right now for this tenant - renewing it first if it is close to running out.
 * `force` = the caller was just told 401 with the pass `rejected`; renew even though it looked fresh
 * (unless someone else has already replaced it).
 * Throws WisprNotConnected / WisprNeedsReconnect / WisprTransient.
 */
async function ensureAccessToken(tenant, { store, fetchImpl = fetch, now = Date.now, force = false, rejected = null, log = null } = {}) {
  const aheadMs = cfg.TUNING.refreshAheadMs();
  const quick = await store.getConnection(tenant);
  if (!quick) throw new WisprNotConnected();
  if (quick.status === 'needs_reconnect') throw new WisprNeedsReconnect();
  if (!force && isFresh(quick, now(), aheadMs)) return quick.accessToken;

  return store.withConnectionLock(tenant, async (row, save) => {
    if (!row) throw new WisprNotConnected();
    if (row.status === 'needs_reconnect') throw new WisprNeedsReconnect();
    // Someone renewed while we waited for the lock: use theirs, do not spend the new ticket.
    const replaced = force ? (rejected && row.accessToken !== rejected) : true;
    if (replaced && isFresh(row, now(), aheadMs)) return row.accessToken;

    const ask = { grant_type: 'refresh_token', refresh_token: String(row.refreshToken || ''), client_id: cfg.oauthClientId() };
    let r = await postToken({ ...ask, resource: cfg.MCP_URL }, fetchImpl);
    // A 400 that is NOT "your ticket is dead" means Wispr disliked the request itself. A refused
    // request does not use the ticket up, so ask once more in the plainest form.
    if (!r.ok && !r.refused && !r.transient) {
      if (log) log.warn(`wispr: renewal for ${tenant} was rejected as a bad request (${r.error}) - retrying without the resource parameter`);
      r = await postToken(ask, fetchImpl);
    }

    if (r.ok) {
      // ONE write: the new pass, the new ticket, and the old ticket kept beside it.
      await saveWithRetry(save, {
        accessToken: r.body.access_token,
        refreshToken: r.body.refresh_token || row.refreshToken,
        prevRefreshToken: row.refreshToken,
        expiresAt: expiryFrom(r.body, now()),
        lastRefreshAt: new Date(now()).toISOString(),
        lastError: null,
        lastErrorAt: null,
      }, log);
      if (log) log.info(`wispr: pass renewed for ${tenant} (ticket ${r.body.refresh_token ? 'rotated' : 'unchanged'})`);
      return r.body.access_token;
    }

    if (r.refused) {
      await saveWithRetry(save, {
        status: 'needs_reconnect',
        disconnectedAt: new Date(now()).toISOString(),
        disconnectReason: `renewal refused (${r.error})`,
        lastError: `renewal refused (${r.error})`,
        lastErrorAt: new Date(now()).toISOString(),
      }, log);
      if (log) log.warn(`wispr: ${tenant} NEEDS RECONNECT - Wispr refused the renewal (${r.error})`);
      throw new WisprNeedsReconnect();
    }

    // Wispr is busy or unreachable. The pass we hold may still be good for hours - use it.
    await save({ lastError: `renewal failed (${r.error})`, lastErrorAt: new Date(now()).toISOString() }).catch(() => {});
    if (log) log.warn(`wispr: renewal for ${tenant} failed for now (${r.error})`);
    const passStillGood = row.accessToken && row.expiresAt && Date.parse(row.expiresAt) > now();
    if (!force && passStillGood) return row.accessToken;
    // The pass is gone and Wispr keeps rejecting the request outright (not "busy"): waiting will
    // not fix it. Say so, so the client gets the reconnect email instead of silence.
    if (!r.transient && !passStillGood) {
      await saveWithRetry(save, {
        status: 'needs_reconnect',
        disconnectedAt: new Date(now()).toISOString(),
        disconnectReason: `renewal rejected (${r.error})`,
      }, log);
      if (log) log.warn(`wispr: ${tenant} NEEDS RECONNECT - renewal rejected (${r.error}) and the pass has run out`);
      throw new WisprNeedsReconnect();
    }
    throw new WisprTransient(`could not renew the Wispr pass (${r.error})`);
  });
}

/** Wispr said no to a pass we had just renewed: the connection itself is dead. */
async function markNeedsReconnect(tenant, reason, { store, now = Date.now, log = null } = {}) {
  await store.withConnectionLock(tenant, async (row, save) => {
    if (!row || row.status === 'needs_reconnect') return;
    await save({
      status: 'needs_reconnect',
      disconnectedAt: new Date(now()).toISOString(),
      disconnectReason: String(reason || 'unknown').slice(0, 200),
      lastError: String(reason || 'unknown').slice(0, 200),
      lastErrorAt: new Date(now()).toISOString(),
    });
  });
  if (log) log.warn(`wispr: ${tenant} NEEDS RECONNECT - ${reason}`);
}

module.exports = {
  WisprNotConnected, WisprNeedsReconnect, WisprTransient,
  newPkce, connectLink, verifyConnectLink, beginSignIn, completeSignIn,
  ensureAccessToken, markNeedsReconnect, isFresh,
};
