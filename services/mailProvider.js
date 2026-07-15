/**
 * Mail provider adapter — the ONE swappable seam for writing a coach's email, mirroring
 * services/calendarProvider.js (which does the same for calendar). Multi-tenant by construction:
 * every call reads the tenant's OWN Nylas grant, so onboarding a coach = giving them a grant, no
 * code change.
 *
 * WHY THIS EXISTS: creating a Gmail draft through Google's hosted Gmail MCP connector rewrites every
 * hyperlink into a `https://www.google.com/url?q=...` redirect at compose time — baked into the
 * stored message, so recipients hit an interstitial and the sender has to hand-fix every link. Nylas
 * writes the draft straight to the provider's own API (Gmail, Outlook, …), which does NOT rewrite
 * links, so the HTML lands byte-for-byte. This adapter is that clean write path.
 *
 * Provider switch (CALENDAR_PROVIDER is calendar's; mail uses the coach's Nylas grant directly —
 * a mailbox behind a Nylas grant is the only compose path we support, by design). The Google
 * service account is read-only and cannot compose, exactly as in calendarProvider.
 *
 * Nylas v3 Drafts API: POST/GET /v3/grants/{grantId}/drafts[/{id}]. `body` carries HTML verbatim.
 */

const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'mail_provider');

function nylasConfig(coach) {
  const apiKey = process.env.NYLAS_API_KEY;
  const grantId = (coach && coach.nylasGrantId) || process.env.NYLAS_GRANT_ID;
  const apiUri = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/$/, '');
  return { apiKey, grantId, apiUri };
}

/** Normalise a recipient list: accepts ["a@b.com"] or [{email,name}] → [{email,name}]. */
function toParticipants(list) {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  return arr
    .map((r) => (typeof r === 'string' ? { email: r } : r))
    .filter((r) => r && r.email)
    .map((r) => ({ email: String(r.email).trim(), ...(r.name ? { name: String(r.name).trim() } : {}) }));
}

/**
 * Create a draft (no send) in the coach's mailbox via their Nylas grant.
 * @param {object} coach   client record (needs nylasGrantId)
 * @param {object} details { subject, html, to, cc, bcc, replyTo, replyToMessageId }
 *   to/cc/bcc: array of "email" strings or {email,name} objects.
 *   replyToMessageId: Nylas message id being replied to — Nylas sets In-Reply-To/References and
 *   files the draft on that message's thread (a real threaded reply, not a standalone message).
 * @returns {Promise<{ok:boolean, draftId?:string, error?:string, provider:string}>}
 */
async function createDraft(coach, details = {}) {
  const { apiKey, grantId, apiUri } = nylasConfig(coach);
  if (!apiKey || !grantId) return { ok: false, error: 'NYLAS_API_KEY / grant not configured for this coach', provider: 'nylas' };

  const to = toParticipants(details.to);
  if (!to.length) return { ok: false, error: 'at least one "to" recipient is required', provider: 'nylas' };
  const subject = String(details.subject || '').trim();
  if (!subject) return { ok: false, error: 'subject is required', provider: 'nylas' };

  const body = {
    subject,
    body: details.html || '',
    to,
  };
  const cc = toParticipants(details.cc);
  const bcc = toParticipants(details.bcc);
  const replyTo = toParticipants(details.replyTo);
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;
  if (replyTo.length) body.reply_to = replyTo;
  if (details.replyToMessageId) body.reply_to_message_id = String(details.replyToMessageId).trim();

  const u = `${apiUri}/v3/grants/${grantId}/drafts`;
  let res;
  try {
    res = await fetch(u, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `nylas request failed: ${e.message}`, provider: 'nylas' };
  }
  const text = await res.text();
  if (!res.ok) {
    log.warn(`[mailProvider] nylas draft create failed HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { ok: false, error: `nylas HTTP ${res.status}: ${text.slice(0, 200)}`, provider: 'nylas' };
  }
  let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
  const d = json.data || json;
  return { ok: true, draftId: d.id, threadId: d.thread_id, provider: 'nylas' };
}

/**
 * Find recent messages in the coach's mailbox — the lookup that feeds replyToMessageId. Works for
 * ANY Nylas grant (Gmail, Outlook, IMAP), so threading never depends on the Gmail connector's ids.
 * @param {object} coach   client record (needs nylasGrantId)
 * @param {object} query   { from, subject, threadId, receivedAfter, queryImap, limit } — all
 *   optional, newest first. receivedAfter = epoch SECONDS (Nylas `received_after`). queryImap
 *   makes Nylas query the IMAP server live instead of its 90-day rolling cache — IMAP grants
 *   (e.g. Zoho mail) only; pass it when the window reaches beyond ~90 days. Deliberately NO
 *   search_query_native: Google/Microsoft restrict which params combine with it and IMAP has
 *   no equivalent, so it does not abstract across providers — these typed filters do.
 * @returns {Promise<{ok:boolean, messages?:Array<{id,threadId,subject,from,date,snippet}>, error?:string}>}
 */
async function findMessages(coach, { from, subject, threadId, receivedAfter, queryImap, limit } = {}) {
  const { apiKey, grantId, apiUri } = nylasConfig(coach);
  if (!apiKey || !grantId) return { ok: false, error: 'NYLAS_API_KEY / grant not configured for this coach' };

  const params = new URLSearchParams();
  params.set('limit', String(Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20)));
  if (from) params.set('from', String(from).trim());
  if (subject) params.set('subject', String(subject).trim());
  if (threadId) params.set('thread_id', String(threadId).trim());
  if (receivedAfter) params.set('received_after', String(Math.floor(Number(receivedAfter))));
  if (queryImap) params.set('query_imap', 'true');

  const u = `${apiUri}/v3/grants/${grantId}/messages?${params.toString()}`;
  let res;
  try {
    res = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, error: `nylas request failed: ${e.message}` };
  }
  const text = await res.text();
  if (!res.ok) {
    log.warn(`[mailProvider] nylas message search failed HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { ok: false, error: `nylas HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  let json = {}; try { json = JSON.parse(text); } catch (_) { /* leave empty */ }
  const messages = (json.data || []).map((m) => ({
    id: m.id,
    threadId: m.thread_id,
    subject: m.subject,
    from: toParticipants(m.from).map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(', '),
    date: m.date ? new Date(m.date * 1000).toISOString() : null,
    snippet: m.snippet,
  }));
  return { ok: true, messages };
}

/**
 * Read a draft back (used to VERIFY the stored HTML — the "are the links clean?" proof, and any
 * future read need). Returns the raw Nylas draft object.
 * @returns {Promise<{ok:boolean, draft?:object, error?:string}>}
 */
async function getDraft(coach, draftId) {
  const { apiKey, grantId, apiUri } = nylasConfig(coach);
  if (!apiKey || !grantId) return { ok: false, error: 'NYLAS_API_KEY / grant not configured for this coach' };
  if (!draftId) return { ok: false, error: 'draftId required' };
  const u = `${apiUri}/v3/grants/${grantId}/drafts/${encodeURIComponent(draftId)}`;
  let res;
  try {
    res = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, error: `nylas request failed: ${e.message}` };
  }
  const textBody = await res.text();
  if (!res.ok) return { ok: false, error: `nylas HTTP ${res.status}: ${textBody.slice(0, 200)}` };
  let json = {}; try { json = JSON.parse(textBody); } catch (_) { /* leave empty */ }
  return { ok: true, draft: json.data || json };
}

module.exports = { createDraft, getDraft, findMessages, toParticipants };
