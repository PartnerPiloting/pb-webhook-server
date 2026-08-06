/**
 * wingguyDraftLink — signed links from the queue to the read-only draft page.
 *
 * "Show me Andrew's draft" costs a whole chat turn; a [draft] link on the queue line costs a
 * click (Guy 2026-07-28). Each queue line links to GET /wingguy/draft
 * (routes/wingguyDraftRoutes.js): memory-jog + the pre-written message + a copy button + the
 * LinkedIn profile link. READ-ONLY by design — tweaking, sending, parking, dropping all stay in
 * chat, so the page can never drift from the stores it reads.
 *
 * Links carry an HMAC because draft pages hold real names and message text: the signature covers
 * tenant+person, so a leaked link exposes exactly one person's page and nothing else, and pages
 * are unguessable without the server secret.
 */
require('dotenv').config();
const crypto = require('crypto');

const PUBLIC_BASE = (process.env.API_PUBLIC_BASE_URL || 'https://pb-webhook-server.onrender.com').replace(/\/$/, '');

// Dedicated secret preferred (WINGGUY_DRAFT_LINK_SECRET on Render); the fallback derives from
// credentials that are already secret so the feature never runs unsigned. Rotating any of them
// invalidates old links — fine: the queue re-mints links on every serve.
function secret() {
  const s = (process.env.WINGGUY_DRAFT_LINK_SECRET || '').trim();
  if (s) return s;
  return crypto.createHash('sha256')
    .update(String(process.env.DATABASE_URL || '') + '|' + String(process.env.AIRTABLE_API_KEY || ''))
    .digest('hex');
}

function keyFor(tenant, name) {
  return `${String(tenant).trim().toLowerCase()}|${String(name).trim().toLowerCase()}`;
}

function sign(tenant, name) {
  return crypto.createHmac('sha256', secret()).update(keyFor(tenant, name)).digest('hex').slice(0, 32);
}

function verify(tenant, name, sig) {
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(sign(tenant, name));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function draftUrl(tenant, name) {
  return `${PUBLIC_BASE}/wingguy/draft?c=${encodeURIComponent(tenant)}&n=${encodeURIComponent(name)}&s=${sign(tenant, name)}`;
}

module.exports = { sign, verify, draftUrl };
