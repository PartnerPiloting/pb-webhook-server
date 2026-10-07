// services/fathomKey.js
// "Your meeting recorder" - portal self-service for the client's Fathom API key (Guy, 7 Oct 2026).
// Before this, every client emailed their key to Guy and he pasted it onto their row. Now the client
// pastes it into Settings, it is tested against Fathom BEFORE it is stored, and the answer they see
// is proof, not configuration: "Connected - your last recording was <title>, <date>".
//
// The key is write-only, like the Claude key: stored on the master record ('Fathom API Key'), never
// sent back to a browser - status serves a masked tail only. Once stored, the 5-minute poller
// (services/fathomPollService.js) picks the client up by itself; nothing else is needed.

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

const maskFathomKey = (key) => (String(key || '').trim() ? `…${String(key).trim().slice(-4)}` : '');

/** A pasted key worth sending to Fathom at all: one token, no spaces, a sane length. */
function looksLikeFathomKey(key) {
  const k = String(key || '').trim();
  return k.length >= 16 && k.length <= 512 && !/\s/.test(k);
}

/** The newest recording, as the page shows it. null when the account has none yet. */
function lastRecordingOf(items) {
  const m = (items || [])[0];
  if (!m) return null;
  return {
    title: m.title || m.meeting_title || 'Untitled recording',
    at: m.recording_start_time || m.scheduled_start_time || m.created_at || null,
  };
}

/**
 * Try the key on Fathom with the cheapest real call (newest meeting only).
 * @returns {Promise<{ok:true, lastRecording:object|null} | {ok:false, reason:'rejected'|'transient'|'error', status?:number, error?:string}>}
 * Never throws.
 */
async function probeFathomKey(key, { fetchImpl = fetch } = {}) {
  const u = new URL(`${FATHOM_API_BASE}/meetings`);
  u.searchParams.set('limit', '1');
  let res;
  try {
    res = await fetchImpl(u.toString(), { headers: { 'X-Api-Key': String(key).trim(), 'Content-Type': 'application/json' } });
  } catch (e) {
    return { ok: false, reason: 'transient', error: e.message };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected', status: res.status };
  if (res.status === 429 || res.status >= 500) return { ok: false, reason: 'transient', status: res.status };
  if (!res.ok) return { ok: false, reason: 'error', status: res.status };
  let data = {};
  try { data = await res.json(); } catch (_) { /* an empty body still means the key worked */ }
  const items = data.items || data.meetings || data.results || data.data || [];
  return { ok: true, lastRecording: lastRecordingOf(items) };
}

module.exports = { probeFathomKey, maskFathomKey, looksLikeFathomKey, lastRecordingOf, FATHOM_API_BASE };
