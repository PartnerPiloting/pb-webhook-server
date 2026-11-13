// services/wisprConfig.js
// The Wispr Flow feed - THE SWITCH and the addresses (13 Nov 2026).
//
// What the feed does: a client clicks "Connect Wispr" once, and from then on Wingguy collects their
// Wispr Flow Notetaker calls by itself (Wispr has no webhook and no REST API - only a read-only MCP
// connector that a server can sign in to). See services/wisprFeedService.js for the whole picture.
//
// THE SWITCH: WISPR_FEED_TENANTS - a comma list of client ids. Empty or unset = the feed is OFF for
// everyone: no Connect link is shown, the poll does nothing, the transcript tools behave exactly as
// before. A tenant not on the list is never polled even if a connection row exists for them.
// 13 Nov 2026: on prod it is "Guy-Wilson" only. No client is added until Guy says so.

const SOURCE = 'wispr';

const MCP_URL = String(process.env.WISPR_MCP_URL || 'https://api.wisprflow.ai/connect/mcp').replace(/\/+$/, '');
const AUTH_BASE = String(process.env.WISPR_AUTH_BASE || 'https://mcp-auth.wisprflow.com').replace(/\/+$/, '');
const AUTHORIZE_URL = `${AUTH_BASE}/oauth2/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth2/token`;
const REGISTER_URL = `${AUTH_BASE}/oauth2/register`;
const SCOPE = 'openid offline_access';

function feedTenants() {
  return String(process.env.WISPR_FEED_TENANTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/** Is the feed switched on for this tenant? Read per call, so flipping the env var is the whole change. */
function feedEnabledFor(clientId) {
  const id = String(clientId || '').trim().toLowerCase();
  if (!id) return false;
  return feedTenants().some((t) => t.toLowerCase() === id);
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || 'https://pb-webhook-server.onrender.com').replace(/\/+$/, '');
}

/** Our callback. Must be one of the redirect URIs registered with Wispr (scripts/wispr-register-client.js). */
function redirectUri() {
  return String(process.env.WISPR_REDIRECT_URI || `${publicBase()}/auth/wispr/callback`);
}

/** The public client id Wispr issued when Wingguy was registered. Not a secret. */
function oauthClientId() {
  return String(process.env.WISPR_OAUTH_CLIENT_ID || '').trim();
}

/** Signs connect links and the OAuth state. Any server-only secret will do; never sent to Wispr. */
function linkSecret() {
  return String(process.env.WISPR_LINK_SECRET || process.env.PB_WEBHOOK_SECRET || '').trim();
}

const num = (name, dflt) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const TUNING = {
  pollIntervalMs: () => num('WISPR_POLL_INTERVAL_MS', 15 * 60 * 1000),
  // search_meetings filters on when the meeting STARTED, and a long call is only written up after
  // it ends - so each pass looks back well before the last good check. Idempotent by Wispr's id.
  overlapMs: () => num('WISPR_OVERLAP_HOURS', 48) * 3600 * 1000,
  // First ever check for a tenant: how far back to collect.
  firstLookbackMs: () => num('WISPR_FIRST_LOOKBACK_DAYS', 7) * 24 * 3600 * 1000,
  // Renew the pass this long before it runs out (it lasts 3 days).
  refreshAheadMs: () => num('WISPR_REFRESH_AHEAD_HOURS', 12) * 3600 * 1000,
  // A recording that ended this recently with no transcript yet is "still being written up".
  notReadyWindowMs: () => num('WISPR_NOT_READY_MINUTES', 45) * 60 * 1000,
  // A tenant who ALSO runs another recorder: give that one this long to file first, so the
  // doubles check has something to see. The on-demand check does not wait.
  settleMs: () => num('WISPR_SETTLE_MINUTES', 20) * 60 * 1000,
  // On-demand checks are throttled to one per tenant per this long.
  onDemandMinGapMs: () => num('WISPR_ON_DEMAND_GAP_SECONDS', 60) * 1000,
  // How long an unnamed recording keeps being asked about in chat.
  askWindowMs: () => num('WISPR_ASK_WINDOW_HOURS', 72) * 3600 * 1000,
  // Under this many characters of transcript there is nothing worth filing (a mis-tap).
  minTranscriptChars: () => num('WISPR_MIN_TRANSCRIPT_CHARS', 200),
};

module.exports = {
  SOURCE, MCP_URL, AUTH_BASE, AUTHORIZE_URL, TOKEN_URL, REGISTER_URL, SCOPE,
  feedTenants, feedEnabledFor, publicBase, redirectUri, oauthClientId, linkSecret, TUNING,
};
