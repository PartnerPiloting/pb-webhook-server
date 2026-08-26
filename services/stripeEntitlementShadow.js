// services/stripeEntitlementShadow.js
// Stage 2b of the PMPro->Stripe cutover: the entitlement watcher, in SHADOW mode.
//
// The webhook (routes/billingRoutes.js) hands every relevant Stripe event here.
// This module decides what the event WOULD do to the client's Status - and only
// records that decision (Postgres + log line). It never writes Status. The flip
// to live (stage 2c, after the shadow record has proven itself) is one function:
// applyShadowDecision() below starts actually writing, gated by SHADOW_MODE.
//
// Decision rule (the design in the cutover brief):
//   subscription status active | trialing | past_due  -> would be Active
//     (past_due = the card is bouncing but Stripe is still retrying - the
//      three-week dunning window. Access stays on until Stripe gives up.)
//   canceled | unpaid | incomplete_expired | paused   -> would be Paused
// Only clients with Billing Source = stripe are ever judged; everyone else's
// events are recorded as observations with no would-be verdict.

const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'STRIPE-SHADOW', clientId: 'SYSTEM', operation: 'entitlement_shadow' });

// Live-shadow switch. 'shadow' (default) = record only. 'live' = also write
// Status for Billing Source=stripe clients. Flip via env after the proving window.
function mode() {
    return String(process.env.STRIPE_ENTITLEMENT_MODE || 'shadow').trim().toLowerCase();
}

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
const PAUSED_STATUSES = ['canceled', 'unpaid', 'incomplete_expired', 'paused'];

let pool = null;
let schemaReady = false;

function getPool() {
    if (pool) return pool;
    if (!process.env.DATABASE_URL) return null;
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 2,
    });
    return pool;
}

async function ensureSchema(client) {
    if (schemaReady) return;
    await client.query(`
        CREATE TABLE IF NOT EXISTS stripe_entitlement_shadow (
            id BIGSERIAL PRIMARY KEY,
            event_id TEXT UNIQUE,
            event_type TEXT NOT NULL,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            subscription_status TEXT,
            tenant_id TEXT,
            billing_source TEXT,
            current_status TEXT,
            would_status TEXT,
            decision TEXT NOT NULL,
            detail TEXT,
            mode TEXT NOT NULL DEFAULT 'shadow',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
    schemaReady = true;
}

/**
 * Record what a Stripe event would mean for entitlement. Never throws - the
 * webhook must 200 to Stripe even if our bookkeeping hiccups.
 *
 * @param {Object} p
 * @param {string} p.eventId        Stripe event id (evt_...) - dedupe key
 * @param {string} p.eventType      e.g. customer.subscription.updated
 * @param {string} p.customerId     cus_...
 * @param {string} [p.subscriptionId] sub_...
 * @param {string} [p.subscriptionStatus] Stripe subscription status
 * @param {Object|null} p.client    matched clientService record or null
 * @returns {{wouldStatus: string|null, decision: string}}
 */
async function recordShadowDecision(p) {
    let wouldStatus = null;
    let decision;
    const source = String(p.client?.billingSource || '').trim().toLowerCase();

    if (!p.client) {
        decision = 'no-matching-client';
    } else if (source !== 'stripe') {
        decision = `observed-only (Billing Source = ${source || 'blank/legacy'})`;
    } else if (p.subscriptionStatus && ACTIVE_STATUSES.includes(p.subscriptionStatus)) {
        wouldStatus = 'Active';
        decision = p.client.status === 'Active' ? 'would-keep-active' : 'would-activate';
    } else if (p.subscriptionStatus && PAUSED_STATUSES.includes(p.subscriptionStatus)) {
        wouldStatus = 'Paused';
        decision = p.client.status === 'Paused' ? 'would-keep-paused' : 'would-pause';
    } else {
        decision = `observed-only (subscription status ${p.subscriptionStatus || 'unknown'})`;
    }

    const line = `[shadow] ${p.eventType} ${p.customerId || '?'} sub=${p.subscriptionStatus || '-'} ` +
        `tenant=${p.client?.clientId || '-'} current=${p.client?.status || '-'} -> ${decision}` +
        (wouldStatus ? ` (would set ${wouldStatus})` : '');
    logger.info(line);

    try {
        const db = getPool();
        if (db) {
            const c = await db.connect();
            try {
                await ensureSchema(c);
                await c.query(
                    `INSERT INTO stripe_entitlement_shadow
                     (event_id, event_type, stripe_customer_id, stripe_subscription_id,
                      subscription_status, tenant_id, billing_source, current_status,
                      would_status, decision, mode)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                     ON CONFLICT (event_id) DO NOTHING`,
                    [p.eventId || null, p.eventType, p.customerId || null, p.subscriptionId || null,
                     p.subscriptionStatus || null, p.client?.clientId || null, source || null,
                     p.client?.status || null, wouldStatus, decision, mode()]
                );
            } finally {
                c.release();
            }
        } else {
            logger.warn('[shadow] DATABASE_URL not set - decision logged only, not stored');
        }
    } catch (e) {
        logger.error(`[shadow] store failed (decision still logged): ${e.message}`);
    }

    return { wouldStatus, decision };
}

/**
 * Capture the subscription id onto the client's Airtable row when it's missing -
 * a benign write that makes the stage 6 migration clerical. Never touches Status.
 */
async function captureSubscriptionId(client, subscriptionId) {
    if (!client || !subscriptionId || client.stripeSubscriptionId) return;
    try {
        const Airtable = require('airtable');
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        await base('Clients').update(client.id, { 'Stripe Subscription ID': subscriptionId }, { typecast: true });
        logger.info(`[shadow] captured Stripe Subscription ID ${subscriptionId} for ${client.clientId}`);
    } catch (e) {
        logger.warn(`[shadow] could not capture subscription id for ${client.clientId}: ${e.message}`);
    }
}

/**
 * The stage 2c flip lives here so going live is one reviewed function, not a
 * rewrite: in 'live' mode, a would-status different from the current one is
 * written to Airtable. In 'shadow' mode (now) this is a no-op.
 */
async function applyShadowDecision(client, wouldStatus, reason) {
    if (mode() !== 'live') return { applied: false, reason: 'shadow mode' };
    if (!client || !wouldStatus || client.status === wouldStatus) return { applied: false, reason: 'no change' };
    try {
        const Airtable = require('airtable');
        Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
        const base = Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
        await base('Clients').update(client.id, { Status: wouldStatus }, { typecast: true });
        logger.info(`[LIVE] ${client.clientId}: Status ${client.status} -> ${wouldStatus} (${reason})`);
        const { clearCache } = require('./clientService');
        try { clearCache(); } catch (_) {}
        return { applied: true };
    } catch (e) {
        logger.error(`[LIVE] failed to set Status for ${client.clientId}: ${e.message}`);
        return { applied: false, reason: e.message };
    }
}

/**
 * Find the client a Stripe customer id belongs to - stored id first (the join
 * key), email fallback for the not-yet-mapped.
 */
async function findClientForCustomer(customerId, customerEmail) {
    const clientService = require('./clientService');
    const all = await clientService.getAllClients();
    if (customerId) {
        const byId = all.find((c) => c.stripeCustomerId === customerId);
        if (byId) return byId;
    }
    if (customerEmail) {
        const em = String(customerEmail).toLowerCase().trim();
        const byEmail = all.find((c) => String(c.clientEmailAddress || '').toLowerCase().trim() === em);
        if (byEmail) return byEmail;
    }
    return null;
}

module.exports = {
    recordShadowDecision,
    captureSubscriptionId,
    applyShadowDecision,
    findClientForCustomer,
    mode,
};
