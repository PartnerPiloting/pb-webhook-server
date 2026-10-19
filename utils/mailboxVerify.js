/**
 * Does this exact MAILBOX exist? Asked of a verification service right before an invite goes out.
 *
 * utils/emailDeliverable.js checks the DOMAIN (does infocus.com.au have a mail server?). That passed
 * for "iscraig.carolan@infocus.com.au" - the domain is real, the mailbox is not - and the invite
 * bounced four hours later with nobody told (Craig Carolan, 2026-10-19). A verification service asks
 * the receiving server "is there a mailbox called iscraig.carolan?" without sending anything, which
 * is the same question Microsoft answered in the bounce, just before the send instead of after.
 *
 * Verdicts are deliberately three-way: 'valid' | 'invalid' | 'unknown'. Only a DEFINITE 'invalid'
 * blocks anything. Catch-all domains, greylisting, a timeout, no API key, an unexpected answer -
 * all 'unknown', and 'unknown' lets the send through (the bounce watcher covers what slips past).
 *
 * Provider is pluggable through env; no key = every answer 'unknown' = the check is off.
 *   MAILBOX_VERIFY_PROVIDER = zerobounce | emailable
 *   MAILBOX_VERIFY_API_KEY  = that provider's key
 */
const LOOKUP_MS = 6000;
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // email -> { result, at }

const PROVIDERS = {
  zerobounce: {
    url: (email, key) => `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&ip_address=`,
    read: (j) => {
      const s = String(j && j.status || '').toLowerCase();
      if (s === 'valid') return { state: 'valid', detail: 'zerobounce: valid' };
      if (s === 'invalid') return { state: 'invalid', detail: `zerobounce: invalid${j.sub_status ? ` (${j.sub_status})` : ''}` };
      return { state: 'unknown', detail: `zerobounce: ${s || 'no status'}` };
    },
  },
  emailable: {
    url: (email, key) => `https://api.emailable.com/v1/verify?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`,
    read: (j) => {
      const s = String(j && j.state || '').toLowerCase();
      if (s === 'deliverable') return { state: 'valid', detail: 'emailable: deliverable' };
      if (s === 'undeliverable') return { state: 'invalid', detail: `emailable: undeliverable${j.reason ? ` (${j.reason})` : ''}` };
      return { state: 'unknown', detail: `emailable: ${s || 'no state'}` };
    },
  },
};

function configured() {
  const provider = String(process.env.MAILBOX_VERIFY_PROVIDER || '').trim().toLowerCase();
  const key = String(process.env.MAILBOX_VERIFY_API_KEY || '').trim();
  return provider && key && PROVIDERS[provider] ? { provider, key } : null;
}

/**
 * @param {string} email
 * @param {object} [deps]  { fetchImpl } for tests
 * @returns {Promise<{state:'valid'|'invalid'|'unknown', detail:string, provider:string|null}>}
 */
async function verifyMailbox(email, deps = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return { state: 'unknown', detail: 'not an address', provider: null };
  const cfg = configured();
  if (!cfg) return { state: 'unknown', detail: 'no verification service configured', provider: null };
  const hit = cache.get(e);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const p = PROVIDERS[cfg.provider];
  const doFetch = deps.fetchImpl || fetch;
  let result;
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), LOOKUP_MS) : null;
    let res;
    try { res = await doFetch(p.url(e, cfg.key), { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined }); }
    finally { if (timer) clearTimeout(timer); }
    if (!res || !res.ok) {
      result = { state: 'unknown', detail: `${cfg.provider}: HTTP ${res ? res.status : 'no response'}`, provider: cfg.provider };
    } else {
      let json = {};
      try { json = await res.json(); } catch (_) { json = {}; }
      result = { ...p.read(json), provider: cfg.provider };
    }
  } catch (err) {
    result = { state: 'unknown', detail: `${cfg.provider}: ${err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error'}`, provider: cfg.provider };
  }
  // Only settled answers are worth remembering; an 'unknown' from a hiccup should be asked again.
  if (result.state !== 'unknown') cache.set(e, { result, at: Date.now() });
  return result;
}

function describeInvalidMailbox(email, v) {
  return `The mail server for "${email}" says that mailbox does not exist (${v.detail}). Nothing was sent. ` +
    'Ask the human to check the address with the lead.';
}

module.exports = { verifyMailbox, describeInvalidMailbox, _cache: cache };
