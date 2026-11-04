/**
 * The per-client top-up link - knowaguy.com.au/top-up?c=<client>&k=<signature>.
 *
 * WHY (5 Nov 2026): the Monday numbers email says "time to top up the search" and now carries a
 * button that opens a page where the client pastes their search link. The page has no sign-in,
 * so the link itself has to say who it is for and prove it was ours: the client id plus an HMAC
 * over it. Anyone with the link can queue a top-up for THAT client's campaign - the same trust
 * level as the machine link already in the same email - and nothing else: the page never shows
 * leads, numbers or settings, and the worst a stranger could do is point the campaign at a search.
 *
 * Secret: TOPUP_LINK_SECRET, else PB_WEBHOOK_SECRET (always set on Render). Rotating it only
 * breaks links in old emails; the next Monday email carries a fresh one.
 */
const crypto = require('crypto');

function secret() {
  const s = (process.env.TOPUP_LINK_SECRET || process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!s) throw new Error('no TOPUP_LINK_SECRET or PB_WEBHOOK_SECRET - top-up links cannot be signed');
  return s;
}

function sign(clientId) {
  return crypto.createHmac('sha256', secret()).update(`topup:${String(clientId)}`).digest('base64url').slice(0, 24);
}

/** The link for one client. base defaults to the public site. */
function topUpLink(clientId, base = process.env.SITE_BASE_URL || 'https://knowaguy.com.au') {
  const id = String(clientId || '').trim();
  if (!id) return null;
  return `${String(base).replace(/\/$/, '')}/top-up?c=${encodeURIComponent(id)}&k=${sign(id)}`;
}

/** The client id the query names, or null when the signature does not match. */
function verifyTopUpQuery(query = {}) {
  const id = String(query.c || '').trim();
  const k = String(query.k || '').trim();
  if (!id || !k) return null;
  let expected;
  try { expected = sign(id); } catch (_e) { return null; }
  const a = Buffer.from(expected);
  const b = Buffer.from(k);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

module.exports = { topUpLink, verifyTopUpQuery, sign };
