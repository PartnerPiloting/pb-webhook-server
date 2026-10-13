/**
 * Can this address actually receive mail? Asked of DNS right before an invite or draft goes out.
 *
 * The last guard against a damaged address on a lead record: Ayaan Malik's calendar invite went to
 * "ayaanaihub@gmail.com.looking" (2026-10-12) and bounced - the domain "gmail.com.looking" does not
 * exist. Whatever wrote the bad address, a domain with no mail server (MX) and no address record
 * (A/AAAA, the fallback mail delivery uses) can never deliver, so we refuse before sending.
 *
 * Only a DEFINITE "this domain does not exist / has no mail route" blocks. A timeout or any other
 * DNS hiccup lets the send through - a flaky lookup must never stop a real booking.
 */
const dns = require('dns').promises;

const LOOKUP_MS = 4000;
const DEAD = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);
const cache = new Map(); // domain -> { ok, at }
const CACHE_MS = 60 * 60 * 1000;

function withTimeout(p) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), LOOKUP_MS))]);
}

// 'yes' | 'no' (definitely dead) | 'unknown' (lookup failed some other way)
async function probe(fn) {
  try { const r = await withTimeout(fn()); return r && r.length ? 'yes' : 'no'; } catch (e) { return DEAD.has(e.code) ? 'no' : 'unknown'; }
}

async function domainAcceptsMail(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!d) return false;
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
  const mx = await probe(() => dns.resolveMx(d));
  let ok = mx !== 'no';
  if (mx === 'no') {
    const a = await probe(() => dns.resolve4(d));
    const aaaa = a === 'yes' ? 'yes' : await probe(() => dns.resolve6(d));
    ok = a !== 'no' || aaaa !== 'no';
  }
  cache.set(d, { ok, at: Date.now() });
  return ok;
}

/**
 * Check a list of addresses (strings or {email}). Returns the ones that cannot receive mail,
 * with a reason a human can act on. Empty array = all clear.
 */
async function undeliverableAddresses(list) {
  const emails = (Array.isArray(list) ? list : [list])
    .map((x) => String((x && typeof x === 'object' ? x.email : x) || '').trim())
    .filter(Boolean);
  const bad = [];
  for (const email of [...new Set(emails)]) {
    const at = email.lastIndexOf('@');
    const domain = at > 0 ? email.slice(at + 1) : '';
    if (!domain || !domain.includes('.')) { bad.push({ email, reason: 'is not a complete email address' }); continue; }
    if (!(await domainAcceptsMail(domain))) bad.push({ email, reason: `cannot receive mail - "${domain}" does not exist` });
  }
  return bad;
}

function describeUndeliverable(bad) {
  return bad.map((b) => `${b.email} ${b.reason}`).join('; ') +
    '. Nothing was sent. Check the lead\'s email on their record (a sentence glued onto the end, like ".Looking", is the usual cause), fix it, then try again.';
}

module.exports = { undeliverableAddresses, describeUndeliverable, domainAcceptsMail };
