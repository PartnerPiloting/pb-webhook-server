/**
 * Contacts ingest door - the GENERIC way to hand Wingguy a contact from outside.
 *
 * Built (2026-09-13) so a coach's own address book can flow into the contacts warehouse
 * (services/contactsStore.js) from whatever they use - Make.com watching Google Contacts is the
 * first feed (Guy's), but nothing here is Make-specific: Zapier, a spreadsheet script, or a
 * hand-rolled curl all speak the same shape. The row is filed under the tenant in the URL and
 * tagged `ingest:<source>` so the lookup can say where an address came from.
 *
 * Endpoints:
 *   GET  /webhooks/contacts/:clientId   probe - is the client known and active (no data)
 *   POST /webhooks/contacts/:clientId   body: one contact, or { contacts: [...] } (max 500)
 *
 * Contact shape - TWO dialects, both accepted, so Make can point straight at this door:
 *   plain   { email, name | first_name/last_name, company, headline, location, phone,
 *             linkedin_url, source, seen_at }
 *   Google  the People API shape Make's Google Contacts modules emit - names[{givenName,
 *           familyName}], emailAddresses[{value}], phoneNumbers[{value}],
 *           organizations[{name,title}], addresses[{formattedValue}], urls[{value}]
 * Anything else is ignored; strings are clipped, never echoed. A contact with several addresses
 * becomes several rows sharing one identity, the same way a lead's primary and alt emails do.
 * A contact with NO email is skipped - there is nothing to file it under - and counted in the
 * `skipped` figure so a caller can see it happened.
 *
 * AUTH: the tenant's Portal Token - the same per-client secret the Chrome extension sends as
 * x-portal-token and the /mcp2 connector carries in its URL - sent here as the x-portal-token
 * header (or ?token= for tools that cannot set headers). It must match the client named in the
 * URL: a valid token for a different client is refused, so a pasted-wrong URL cannot file one
 * coach's contacts under another. Inactive client = refused. No shared secret, no env fallback.
 *
 * Parses its own JSON at router level, so it is fine to mount before or after the global parser.
 */

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const clientService = require('../services/clientService');
const contactsStore = require('../services/contactsStore');

const router = express.Router();
const log = createSafeLogger({ module: 'contactsIngest' });
const MAX_BATCH = 500;

function clip(v, n = 200) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
}

function tokenMatches(given, stored) {
  const a = Buffer.from(clip(given, 200));
  const b = Buffer.from(clip(stored, 200));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Resolve + authorise the tenant in the URL. Returns { client } or { status, error }. */
async function authorise(req) {
  const clientId = clip(req.params.clientId, 80);
  if (!clientId) return { status: 404, error: 'unknown client' };
  let client = null;
  try { client = await clientService.getClientById(clientId); } catch (e) { return { status: 500, error: 'client lookup failed' }; }
  if (!client) return { status: 404, error: 'unknown client' };
  const given = req.get('x-portal-token') || (req.query && req.query.token) || '';
  if (!client.portalToken || !tokenMatches(given, client.portalToken)) return { status: 401, error: 'unauthorized' };
  if (String(client.status || '').toLowerCase() !== 'active') return { status: 403, error: 'client not active' };
  return { client };
}

/**
 * Pull a value out of either a flat field or one of Google's repeated-field arrays.
 *
 * Google People (which is what Make's Google Contacts modules hand over) nests almost everything:
 * `emailAddresses: [{value}]`, `phoneNumbers: [{value}]`, `names: [{givenName, familyName}]`,
 * `organizations: [{name, title}]`. Understanding that here means a coach can point Make straight
 * at this door instead of hand-mapping a dozen fields into a JSON body and getting one wrong.
 * Plain field names still work, so a spreadsheet or a curl is unaffected.
 */
function pick(raw, flatKeys = [], arrayKey = null, itemKeys = []) {
  for (const k of flatKeys) {
    const v = raw && raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const list = arrayKey && raw ? raw[arrayKey] : null;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      for (const k of itemKeys) {
        const v = item && item[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
  }
  return '';
}

/** Every email on a contact, flat field or Google's emailAddresses[]. Lowercased, deduped. */
function allEmails(raw) {
  const out = [];
  const add = (v) => {
    const e = String(v || '').trim().toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  };
  add(raw && raw.email);
  for (const key of ['emailAddresses', 'emails', 'email_addresses']) {
    const list = raw && raw[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) add(typeof item === 'string' ? item : (item && (item.value || item.email || item.address)));
  }
  return out;
}

/** First usable phone number, from a plain string or any of the array shapes. Pure. */
function firstPhone(raw) {
  if (!raw) return '';
  const direct = raw.phone || raw.phone_number || raw.mobile;
  if (typeof direct === 'string' && direct.trim()) return clip(direct, 60);
  for (const key of ['phoneNumbers', 'phone_numbers', 'phones']) {
    const list = raw[key] || (key === 'phones' && Array.isArray(direct) ? direct : null);
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const n = typeof p === 'string' ? p : (p && (p.value || p.number || p.phone));
      if (n && String(n).trim()) return clip(n, 60);
    }
  }
  return '';
}

/** A LinkedIn profile out of Google's urls[] if one is in there. */
function linkedinFrom(raw) {
  const flat = clip(raw.linkedin_url || raw.linkedin, 300);
  if (flat) return flat;
  for (const key of ['urls', 'websites']) {
    const list = raw[key];
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      const v = typeof u === 'string' ? u : (u && (u.value || u.url));
      if (v && /linkedin\.com\/in\//i.test(v)) return clip(v, 300);
    }
  }
  return '';
}

/**
 * One inbound contact -> the store's input shape. Returns an ARRAY: a contact with three
 * addresses is three rows sharing one identity, exactly as a lead's primary and alt emails are,
 * so the lookup can match on any of them and still fold them into one person. Pure.
 * Returns [] for anything with no usable address - a phone-only contact has nothing to key on.
 */
function shapeContact(raw, defaultSource) {
  if (!raw || typeof raw !== 'object') return [];
  const source = clip(raw.source, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || defaultSource;
  const first = clip(pick(raw, ['first_name', 'given_name', 'firstName'], 'names', ['givenName', 'given_name']), 80);
  const last = clip(pick(raw, ['last_name', 'surname', 'family_name', 'lastName'], 'names', ['familyName', 'family_name']), 80);
  const shared = {
    name: clip(pick(raw, ['name', 'display_name', 'displayName'], 'names', ['displayName', 'display_name']), 160),
    first_name: first,
    last_name: last,
    company: clip(pick(raw, ['company', 'company_name', 'organisation', 'organization'], 'organizations', ['name']), 120),
    headline: clip(pick(raw, ['headline', 'job_title', 'title', 'jobTitle'], 'organizations', ['title']), 200),
    location: clip(pick(raw, ['location', 'city'], 'addresses', ['formattedValue', 'city']), 120),
    phone: firstPhone(raw),
    linkedin_url: linkedinFrom(raw),
    source: `ingest:${source}`,
    last_seen_at: raw.seen_at || raw.updated_at || raw.last_seen_at || null,
    evidence: `from your ${source} feed`,
  };
  return allEmails(raw).map((email) => ({ ...shared, email }));
}

router.get('/webhooks/contacts/:clientId', async (req, res) => {
  let client = null;
  try { client = await clientService.getClientById(clip(req.params.clientId, 80)); } catch (_e) { /* reported below */ }
  res.status(200).json({
    ok: true,
    contacts_ingest: true,
    client_found: !!client,
    client_active: !!client && String(client.status || '').toLowerCase() === 'active',
    token_configured: !!(client && client.portalToken),
  });
});

router.post('/webhooks/contacts/:clientId', express.json({ limit: '2mb' }), async (req, res) => {
  const auth = await authorise(req);
  if (!auth.client) {
    log.warn(`CONTACTS-INGEST refused ${clip(req.params.clientId, 80)}: ${auth.error}`);
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }
  const tenant = auth.client.clientId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const defaultSource = clip(body.source, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'feed';
  const list = Array.isArray(body.contacts) ? body.contacts : (Array.isArray(body) ? body : [body]);
  if (list.length > MAX_BATCH) return res.status(413).json({ ok: false, error: `max ${MAX_BATCH} contacts per call` });

  // One contact can carry several addresses, so rows out can exceed people in.
  const usable = list.flatMap((c) => shapeContact(c, defaultSource)).filter((c) => contactsStore.cleanEmail(c.email));
  const peopleFiled = new Set(usable.map((c) => `${c.first_name}|${c.last_name}|${c.name}`)).size;
  if (!usable.length) {
    return res.status(200).json({
      ok: true, received: list.length, filed: 0,
      reason: 'no contact had a usable email address (a phone-only contact has nothing to file it under)',
    });
  }

  const w = await contactsStore.upsertContacts(tenant, usable);
  if (!w.ok) {
    log.error(`CONTACTS-INGEST store failed for ${tenant}: ${w.error}`);
    return res.status(500).json({ ok: false, error: 'store failed' });
  }
  // Stamp the feed so the staleness alert can watch it. An outside feed cannot be derived from
  // the client record the way a mailbox can - Wingguy has no way to know a coach INTENDS to send
  // contacts from Make. So the first successful delivery is what arms the watch: before one
  // arrives nothing is expected, and after one the feed going quiet is worth a word.
  const feedSources = [...new Set(usable.map((c) => c.source))];
  for (const src of feedSources) {
    try { await contactsStore.recordSweep(tenant, src, { rowsSeen: w.written, note: `${list.length} contacts delivered` }); }
    catch (_e) { /* bookkeeping must never fail a delivery */ }
  }
  log.info(`CONTACTS-INGEST ${tenant}: filed ${w.written} address rows from ${list.length} contacts (source ${defaultSource})`);
  return res.status(200).json({
    ok: true,
    received: list.length,
    filed: w.written,
    people: peopleFiled,
    skipped: list.length - peopleFiled,
  });
});

module.exports = router;
module.exports.shapeContact = shapeContact;
module.exports.firstPhone = firstPhone;
module.exports.allEmails = allEmails;
module.exports.linkedinFrom = linkedinFrom;
