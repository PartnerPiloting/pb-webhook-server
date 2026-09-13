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
 * Contact shape (all optional but email): { email, name | first_name/last_name, company,
 * headline, location, linkedin_url, source, seen_at }. Anything else is ignored; strings are
 * clipped, never echoed.
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

/** One inbound contact -> the store's input shape, with the source tagged. Pure. */
function shapeContact(raw, defaultSource) {
  if (!raw || typeof raw !== 'object') return null;
  const source = clip(raw.source, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || defaultSource;
  return {
    email: clip(raw.email, 200),
    name: clip(raw.name, 160),
    first_name: clip(raw.first_name || raw.given_name || raw.firstName, 80),
    last_name: clip(raw.last_name || raw.surname || raw.family_name || raw.lastName, 80),
    company: clip(raw.company || raw.company_name || raw.organisation || raw.organization, 120),
    headline: clip(raw.headline || raw.job_title || raw.title, 200),
    location: clip(raw.location, 120),
    linkedin_url: clip(raw.linkedin_url || raw.linkedin, 300),
    source: `ingest:${source}`,
    last_seen_at: raw.seen_at || raw.updated_at || raw.last_seen_at || null,
    evidence: `from your ${source} feed`,
  };
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

  const shaped = list.map((c) => shapeContact(c, defaultSource)).filter(Boolean);
  const usable = shaped.filter((c) => contactsStore.cleanEmail(c.email));
  if (!usable.length) return res.status(200).json({ ok: true, received: list.length, filed: 0, reason: 'no contact with a valid email' });

  const w = await contactsStore.upsertContacts(tenant, usable);
  if (!w.ok) {
    log.error(`CONTACTS-INGEST store failed for ${tenant}: ${w.error}`);
    return res.status(500).json({ ok: false, error: 'store failed' });
  }
  log.info(`CONTACTS-INGEST ${tenant}: filed ${w.written} of ${list.length} (source ${defaultSource})`);
  return res.status(200).json({ ok: true, received: list.length, filed: w.written, skipped: list.length - usable.length });
});

module.exports = router;
module.exports.shapeContact = shapeContact;
