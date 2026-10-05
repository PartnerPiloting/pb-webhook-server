// services/reconnectLeads.js
// Reconnect, brick 3 (docs/RECONNECT-BUILD-PLAN.md): carry the conversation score onto the client's
// LEADS, because everything a person can be worked with - the Follow-Ups screen, /wg, park, cease -
// works on leads.
//
//   scored person already a lead        -> the five conversation fields are written; nothing else
//   not a lead, scored at the cut-off+  -> a lead is created from what LinkedIn gave us
//   not a lead, scored below it         -> left out (a base is not filled with polite closers)
//   not a lead by link, but a lead has  -> UNSURE: neither created nor updated, and reported. A
//     exactly that name                    duplicate lead is worse than a missing one.
//
// Rules this file keeps:
//   - Matching is strict equality on the canonical profile slug (utils/linkedinCanonical), against
//     both the vanity slug and the member id, since stored lead links come in both forms.
//   - An existing lead is never changed beyond the five conversation fields.
//   - A new lead gets NO messages in its Notes. The nightly follow-up sweep reads Notes, and a lead
//     whose notes show they once spoke would land in the LIVE follow-up queue. These people belong
//     to the Reconnect list (brick 4); the thread stays in linkedin_messages until that hand-over
//     exists.
//   - Always a dry run first. The real run is the caller's deliberate second step.

const { Pool } = require('pg');
const { canonicalLinkedinSlug } = require('../utils/linkedinCanonical');
const { createLogger } = require('../utils/contextLogger');

const DEFAULT_CUT_OFF = 3;
const SOURCE = 'Existing Connection Added by PB';
const WRITE_CHUNK = 10; // Airtable's per-request record limit

// Stored on the lead in plain English - the keys stay in linkedin_conversation_scores.
const ENDING_LABELS = {
  open_question_or_offer: 'Left something open',
  stalled_after_interest: 'Stalled after interest',
  answered_then_dropped: 'Answered, then dropped',
  not_now: 'Not now',
  closed_politely: 'Closed politely',
  declined: 'Declined',
  their_pitch: 'Their pitch',
  moved_to_call_or_email: 'Moved to a call or email',
  other: 'Other',
};

const F = {
  score: 'Conversation Score', ending: 'Conversation Ending', why: 'Conversation Why',
  pickUp: 'Pick Up On', scoredAt: 'Conversation Scored At',
};

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const nrm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const sameMoment = (a, b) => !!a && !!b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 1000;

function conversationFields(p) {
  return {
    [F.score]: Number(p.warmth),
    [F.ending]: ENDING_LABELS[p.ending] || ENDING_LABELS.other,
    [F.why]: String(p.why || ''),
    [F.pickUp]: String(p.pick_up_on || ''),
    [F.scoredAt]: new Date(p.scored_at).toISOString(),
  };
}

function newLeadFields(p) {
  const slug = String(p.public_identifier || '').trim();
  const name = String(p.name || '').trim().split(/\s+/);
  const fields = {
    'First Name': String(p.first_name || name[0] || '').trim(),
    'Last Name': String(p.last_name || name.slice(1).join(' ') || '').trim(),
    'LinkedIn Profile URL': String(p.profile_url || '').trim() || `https://www.linkedin.com/in/${slug}`,
    Source: SOURCE,
    'LinkedIn Connection Status': 'Connected',
    Status: 'In Process',
    ...conversationFields(p),
  };
  if (p.headline) fields.Headline = String(p.headline);
  // "Connected" means Date Connected is set - and this is the real date, from LinkedIn.
  if (p.connected_at) fields['Date Connected'] = new Date(p.connected_at).toISOString();
  return fields;
}

/**
 * Decide what happens to each scored person. Pure: leads are plain { id, fields } rows.
 * @returns {{ updates, creates, unsure, upToDate, leftOut, noLink }}
 */
function planLeads(people, leads, { cutOff = DEFAULT_CUT_OFF } = {}) {
  const bySlug = new Map(); const byName = new Map();
  for (const l of leads) {
    const f = l.fields || {};
    const slug = canonicalLinkedinSlug(f['LinkedIn Profile URL']);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, l);
    const n = nrm(`${f['First Name'] || ''} ${f['Last Name'] || ''}`);
    if (n) byName.set(n, (byName.get(n) || 0) + 1);
  }
  const plan = { updates: [], creates: [], unsure: [], upToDate: [], leftOut: 0, noLink: 0 };
  for (const p of people) {
    const lead = [p.public_identifier, p.member_id].map((s) => canonicalLinkedinSlug(s)).filter(Boolean)
      .map((s) => bySlug.get(s)).find(Boolean);
    if (lead) {
      const bucket = sameMoment((lead.fields || {})[F.scoredAt], p.scored_at) ? plan.upToDate : plan.updates;
      bucket.push({ person: p, leadId: lead.id, fields: conversationFields(p) });
      continue;
    }
    if (Number(p.warmth) < cutOff) { plan.leftOut++; continue; }
    if (byName.has(nrm(p.name))) { plan.unsure.push({ person: p }); continue; }
    // Without a proper profile link the lead could never be matched again - leave them out.
    if (!p.public_identifier && !p.profile_url) { plan.noLink++; continue; }
    plan.creates.push({ person: p, fields: newLeadFields(p) });
  }
  return plan;
}

function summarise(plan, cutOff) {
  const brief = (x) => `${x.person.name} (${x.person.warmth})`;
  return {
    cutOff,
    alreadyLeads: plan.updates.length + plan.upToDate.length,
    toUpdate: plan.updates.length,
    alreadyUpToDate: plan.upToDate.length,
    toCreate: plan.creates.length,
    unsure: plan.unsure.length,
    leftOutBelowCutOff: plan.leftOut,
    leftOutNoProfileLink: plan.noLink,
    createByScore: [5, 4, 3, 2, 1].reduce((o, w) => { const n = plan.creates.filter((c) => Number(c.person.warmth) === w).length; if (n) o[w] = n; return o; }, {}),
    createExamples: plan.creates.slice(0, 12).map(brief),
    unsureExamples: plan.unsure.slice(0, 12).map(brief),
  };
}

// ---------------------------------------------------------------------------
// Store + Airtable
// ---------------------------------------------------------------------------

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}
/** Test seam. */
function _setPool(fake) { pool = fake; }

async function loadScoredPeople(db, tenantId) {
  const r = await db.query(
    `SELECT p.person_key, p.member_id, p.public_identifier, p.profile_url, p.name, p.first_name, p.last_name,
            p.headline, p.connected_at, s.ending, s.warmth, s.why, s.pick_up_on, s.scored_at
     FROM linkedin_conversation_scores s
     JOIN linkedin_people p ON p.tenant_id = s.tenant_id AND p.person_key = s.person_key
     WHERE s.tenant_id = $1
     ORDER BY s.warmth DESC, p.last_msg_at DESC`,
    [tenantId]
  );
  return r.rows;
}

async function loadLeads(base) {
  const records = await base('Leads').select({ fields: ['First Name', 'Last Name', 'LinkedIn Profile URL', F.scoredAt] }).all();
  return records.map((r) => ({ id: r.id, fields: r.fields }));
}

async function rememberLeads(db, tenantId, pairs) {
  for (let i = 0; i < pairs.length; i += 500) {
    await db.query(
      `UPDATE linkedin_people p SET lead_rec_id = x.lead_rec_id
       FROM jsonb_to_recordset($2::jsonb) AS x(person_key text, lead_rec_id text)
       WHERE p.tenant_id = $1 AND p.person_key = x.person_key`,
      [tenantId, JSON.stringify(pairs.slice(i, i + 500))]
    );
  }
}

/**
 * @param {string} tenantId
 * @param {{dryRun?: boolean}} opts  dryRun defaults to TRUE - writing is the deliberate choice.
 */
async function syncReconnectLeads(tenantId, { dryRun = true } = {}) {
  const logger = createLogger({ runId: 'RECONNECT-LEADS', clientId: tenantId, operation: 'reconnect_leads' });
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenantId);
  if (!client) return { ok: false, error: `no client ${tenantId}` };
  const base = client.airtableBaseId && clientService.getClientBase(client.airtableBaseId);
  if (!base) return { ok: false, error: `${tenantId} has no leads base` };
  const db = getPool();
  if (!db) return { ok: false, error: 'DATABASE_URL not configured' };

  const cutOff = Number(client.reconnectLeadCutOff) || DEFAULT_CUT_OFF;
  const [people, leads] = [await loadScoredPeople(db, tenantId), await loadLeads(base)];
  const plan = planLeads(people, leads, { cutOff });
  const result = { ok: true, dryRun, scoredPeople: people.length, leadsInBase: leads.length, ...summarise(plan, cutOff) };
  if (dryRun) return result;

  let updated = 0; let created = 0;
  for (let i = 0; i < plan.updates.length; i += WRITE_CHUNK) {
    const chunk = plan.updates.slice(i, i + WRITE_CHUNK);
    await base('Leads').update(chunk.map((u) => ({ id: u.leadId, fields: u.fields })));
    updated += chunk.length;
  }
  const pairs = [...plan.updates, ...plan.upToDate].map((u) => ({ person_key: u.person.person_key, lead_rec_id: u.leadId }));
  for (let i = 0; i < plan.creates.length; i += WRITE_CHUNK) {
    const chunk = plan.creates.slice(i, i + WRITE_CHUNK);
    const recs = await base('Leads').create(chunk.map((c) => ({ fields: c.fields })));
    recs.forEach((rec, j) => pairs.push({ person_key: chunk[j].person.person_key, lead_rec_id: rec.id }));
    created += recs.length;
    if ((i / WRITE_CHUNK) % 10 === 9) logger.info(`created ${created} of ${plan.creates.length}`);
  }
  await rememberLeads(db, tenantId, pairs);
  logger.info(`updated ${updated}, created ${created}`);
  return { ...result, updated, created };
}

module.exports = { syncReconnectLeads, planLeads, conversationFields, newLeadFields, summarise, ENDING_LABELS, FIELDS: F, DEFAULT_CUT_OFF, _setPool };
