// services/recorderKeys.js
// "Your meeting recorder" - portal self-service for the client's recorder key (Guy, 7 Oct 2026).
// Before this, every client emailed their key to Guy and he pasted it onto their row (and for
// Granola, ran a script and pasted a secret too). Now the client pastes the key into Settings, it is
// tested against the recorder BEFORE anything is stored, and whatever else that recorder needs is
// done in the same step:
//
//   fathom    - key only. The 5-minute poller (fathomPollService) picks the client up by itself.
//   granola   - key, then we register our webhook with Granola on their key and store the signing
//               secret Granola returns (once). Replaces scripts/register-granola-webhook.js + paste.
//   fireflies - key, then we mint a signing secret and store it; the client pastes our webhook URL
//               and that secret into Fireflies (Fireflies has no API for registering webhooks).
//
// Keys are write-only, like the Claude key: stored on the master record, never sent back to a
// browser - status serves a masked tail only. The one thing that IS shown is the Fireflies signing
// secret, because the client has to paste it into Fireflies themselves.
//
// Choosing a recorder sets `Transcript Provider` on the record (the seam in transcriptProvider.js).

const crypto = require('crypto');

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
const GRANOLA_API_BASE = (process.env.GRANOLA_API_BASE || 'https://public-api.granola.ai/v1').replace(/\/$/, '');
const FIREFLIES_API_URL = (process.env.FIREFLIES_API_URL || 'https://api.fireflies.ai/graphql').replace(/\/$/, '');

const PROVIDERS = {
  fathom: { label: 'Fathom', keyField: 'Fathom API Key', clientKey: 'fathomApiKey' },
  granola: { label: 'Granola', keyField: 'Granola API Key', clientKey: 'granolaApiKey', secretField: 'Granola Webhook Secret', clientSecret: 'granolaWebhookSecret' },
  fireflies: { label: 'Fireflies', keyField: 'Fireflies API Key', clientKey: 'firefliesApiKey', secretField: 'Fireflies Webhook Secret', clientSecret: 'firefliesWebhookSecret' },
};

const maskKey = (key) => (String(key || '').trim() ? `…${String(key).trim().slice(-4)}` : '');

/** A pasted key worth sending anywhere: one token, no spaces, a sane length. */
function looksLikeKey(key) {
  const k = String(key || '').trim();
  return k.length >= 16 && k.length <= 512 && !/\s/.test(k);
}

/** Which recorder the client is on: their Transcript Provider, else whichever key they hold, else fathom. */
function currentProvider(client) {
  const p = String((client && client.transcriptProvider) || '').trim().toLowerCase();
  if (PROVIDERS[p]) return p;
  for (const id of ['fathom', 'granola', 'fireflies']) if (String((client && client[PROVIDERS[id].clientKey]) || '').trim()) return id;
  return 'fathom';
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || 'https://pb-webhook-server.onrender.com').replace(/\/+$/, '');
}
const webhookUrl = (provider, clientId) => `${publicBase()}/webhooks/${provider}/${encodeURIComponent(clientId)}`;

const classify = (status) => (status === 401 || status === 403 ? 'rejected' : status === 429 || status >= 500 ? 'transient' : 'error');

// ---------------------------------------------------------------------------
// Probes - the cheapest real call per recorder. Never throw.
// @returns {ok:true, lastRecording:{title,at}|null} | {ok:false, reason:'rejected'|'transient'|'error', status?}
// ---------------------------------------------------------------------------

async function probeFathom(key, fetchImpl) {
  const u = new URL(`${FATHOM_API_BASE}/meetings`);
  u.searchParams.set('limit', '1');
  let res;
  try { res = await fetchImpl(u.toString(), { headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' } }); } catch (e) { return { ok: false, reason: 'transient', error: e.message }; }
  if (!res.ok) return { ok: false, reason: classify(res.status), status: res.status };
  let data = {};
  try { data = await res.json(); } catch (_) { /* an empty body still means the key worked */ }
  const m = (data.items || data.meetings || data.results || data.data || [])[0];
  return { ok: true, lastRecording: m ? { title: m.title || m.meeting_title || 'Untitled recording', at: m.recording_start_time || m.scheduled_start_time || m.created_at || null } : null };
}

async function probeGranola(key, fetchImpl) {
  let res;
  try { res = await fetchImpl(`${GRANOLA_API_BASE}/webhook-endpoints`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }); } catch (e) { return { ok: false, reason: 'transient', error: e.message }; }
  if (!res.ok) return { ok: false, reason: classify(res.status), status: res.status };
  return { ok: true, lastRecording: null };
}

async function probeFireflies(key, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(FIREFLIES_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ user { email } transcripts(limit: 1) { title date } }' }),
    });
  } catch (e) { return { ok: false, reason: 'transient', error: e.message }; }
  if (!res.ok) return { ok: false, reason: classify(res.status), status: res.status };
  let data = {};
  try { data = await res.json(); } catch (_) { /* fall through to the auth check below */ }
  // Fireflies answers a bad key with HTTP 200 and an auth error in the body.
  const errs = (data && data.errors) || [];
  if (!(data && data.data && data.data.user) && errs.length) {
    const authish = errs.some((e) => /auth|api key|token|unauthor|forbidden/i.test(`${e.message || ''} ${(e.extensions && e.extensions.code) || ''}`));
    return { ok: false, reason: authish ? 'rejected' : 'error', status: res.status };
  }
  const t = (data && data.data && data.data.transcripts || [])[0];
  return { ok: true, lastRecording: t ? { title: t.title || 'Untitled meeting', at: t.date ? new Date(Number(t.date) || t.date).toISOString() : null } : null };
}

async function probe(provider, key, { fetchImpl = fetch } = {}) {
  const k = String(key || '').trim();
  if (provider === 'granola') return probeGranola(k, fetchImpl);
  if (provider === 'fireflies') return probeFireflies(k, fetchImpl);
  return probeFathom(k, fetchImpl);
}

// ---------------------------------------------------------------------------
// The extra step after a good key
// ---------------------------------------------------------------------------

/** Register our webhook with Granola on the client's key. Returns { ok, secret } - the secret is shown ONCE. */
async function registerGranolaWebhook(key, clientId, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${GRANOLA_API_BASE}/webhook-endpoints`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(key).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl('granola', clientId), scopes: ['personal'], events: ['note.generated', 'note.regenerated'] }),
    });
  } catch (e) { return { ok: false, error: e.message }; }
  let data = {};
  try { data = await res.json(); } catch (_) { /* handled below */ }
  const secret = data && (data.signing_secret || (data.data && data.data.signing_secret));
  if (!res.ok || !secret) return { ok: false, error: `Granola HTTP ${res.status}${data && data.message ? ` - ${data.message}` : ''}` };
  return { ok: true, secret: String(secret) };
}

/** A Fireflies signing secret: 32 characters, inside Fireflies' 16-32 limit. */
const mintFirefliesSecret = () => crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32).padEnd(32, 'x');

/**
 * The record fields for connecting `provider` with `key` (+ secret). Switching recorder clears the
 * old recorder's key so it stops being polled or trusted.
 */
function connectFields(provider, key, secret) {
  const p = PROVIDERS[provider];
  const fields = { 'Transcript Provider': p.label, [p.keyField]: String(key).trim() };
  if (p.secretField) fields[p.secretField] = secret || '';
  for (const [id, other] of Object.entries(PROVIDERS)) {
    if (id === provider) continue;
    fields[other.keyField] = '';
    if (other.secretField) fields[other.secretField] = '';
  }
  return fields;
}

/** The record fields for disconnecting `provider`. Leaves Transcript Provider alone. */
function disconnectFields(provider) {
  const p = PROVIDERS[provider];
  const fields = { [p.keyField]: '' };
  if (p.secretField) fields[p.secretField] = '';
  return fields;
}

module.exports = {
  PROVIDERS, maskKey, looksLikeKey, currentProvider, webhookUrl, probe, registerGranolaWebhook,
  mintFirefliesSecret, connectFields, disconnectFields,
};
