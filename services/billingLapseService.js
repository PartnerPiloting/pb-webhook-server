// services/billingLapseService.js
//
// What happens around a client whose card stops working. Stripe runs the
// money side (retries for about three weeks, then cancels the subscription);
// the entitlement watcher (stripeEntitlementShadow) flips Status to Paused on
// the cancel. This module does the human side at each of those moments:
//
//   first failed payment  -> "your card didn't go through" drafted into Guy's
//                            mailbox, with Stripe's own pay-this-invoice link
//   Stripe gives up       -> "your account has paused" drafted, with a restart
//                            link (no set-up fee), plus one summary email to
//                            Guy: what paused, what is still switched on
//   paused client's Linked Helper keeps sending leads
//                         -> ONE email to Guy, then at most one reminder a
//                            week while it keeps going (it used to be one
//                            email per refused lead)
//
// Drafts only - nothing here ever sends to a client. Nothing is removed on a
// pause either: a lapsed card is not a client leaving, and a restart must find
// everything exactly as it was. The tidy-up (key, mailbox, portal) is
// clientOffboardService - on Guy's say-so, or 30 days after a lapse.
//
// Every action is keyed in a Postgres ledger (billing_lapse_events), so Stripe
// replaying an event never produces a second draft.

const crypto = require('crypto');
const { createLogger } = require('../utils/contextLogger');

const defaultLogger = createLogger({ runId: 'LAPSE', clientId: 'SYSTEM', operation: 'billing_lapse' });

const GUY_EMAIL = 'guyralphwilson@gmail.com';
const COACH_ID = 'Guy-Wilson';
const SITE_ORIGIN = 'https://knowaguy.com.au';
const REMINDER_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ledger (house pattern: shared pool, lazy schema, no-op without a DB)
// ---------------------------------------------------------------------------

let schemaReady = false;

async function ensureLedger(db = require('./recallWebhookDb').getPool()) {
  if (schemaReady || !db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_lapse_events (
      id SERIAL PRIMARY KEY,
      event_key TEXT UNIQUE NOT NULL,
      client_id TEXT,
      kind TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS inactive_webhook_alerts (
      client_id TEXT PRIMARY KEY,
      status TEXT,
      first_refused_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_alerted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      refused_count INTEGER NOT NULL DEFAULT 1
    )
  `);
  schemaReady = true;
}

async function withDb(fn) {
  const pool = require('./recallWebhookDb').getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await ensureLedger(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Claim an event key. true = first time (go ahead), false = already done. */
async function claim(eventKey, clientId, kind, detail = {}) {
  const res = await withDb((db) => db.query(
    `INSERT INTO billing_lapse_events (event_key, client_id, kind, detail)
     VALUES ($1,$2,$3,$4) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [eventKey, clientId, kind, JSON.stringify(detail)]
  ));
  if (!res) return true; // no ledger: act, accepting a replay could repeat
  return res.rows.length > 0;
}

async function release(eventKey) {
  await withDb((db) => db.query('DELETE FROM billing_lapse_events WHERE event_key=$1', [eventKey]));
}

// ---------------------------------------------------------------------------
// Restart link: signed, so it can sit in an email for months and still work,
// and can't be pointed at somebody else's record.
// ---------------------------------------------------------------------------

function linkSecret() {
  return process.env.REJOIN_LINK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '';
}

function signClientId(clientId) {
  return crypto.createHmac('sha256', linkSecret()).update(`rejoin:${clientId}`).digest('base64url').slice(0, 24);
}

function verifyRejoinToken(clientId, token) {
  if (!linkSecret() || !clientId || !token) return false;
  const want = Buffer.from(signClientId(clientId));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function rejoinUrl(clientId) {
  return `${SITE_ORIGIN}/rejoin?c=${encodeURIComponent(clientId)}&t=${signClientId(clientId)}`;
}

// ---------------------------------------------------------------------------
// The client emails (Guy's voice; drafts only)
// ---------------------------------------------------------------------------

function firstNameOf(client) {
  return (client.clientFirstName || String(client.clientName || '').split(' ')[0] || 'there').trim();
}

function money(cents) {
  const n = Number(cents || 0) / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function paymentFailedEmail(client, invoice) {
  const first = firstNameOf(client);
  return {
    subject: "Your card didn't go through",
    html: [
      `<p>Hi ${first},</p>`,
      `<p>This month's ${money(invoice.amount_due)} didn't go through - usually it's an expired or replaced card.</p>`,
      `<p>You can pay it here with a current card: <a href="${invoice.hosted_invoice_url}">pay this month's invoice</a></p>`,
      "<p>Nothing's switched off. Stripe will keep trying for a few weeks, but it's quicker to sort it now.</p>",
      '<p>Guy</p>',
    ].join('\n'),
  };
}

function pausedEmail(client) {
  const first = firstNameOf(client);
  const link = rejoinUrl(client.clientId);
  return {
    subject: 'Your I Know A Guy account has paused',
    html: [
      `<p>Hi ${first},</p>`,
      "<p>Your card didn't go through over the last few weeks, so your account has paused.</p>",
      "<p>Nothing's lost - your leads, notes and set-up are all still there, just switched off. While it's paused, the leads Linked Helper finds aren't being scored, so it's worth pausing your campaigns until you're back.</p>",
      `<p>To pick it back up, it's $150 a month as before, with no set-up fee: <a href="${link}">restart my membership</a></p>`,
      "<p>Everything switches back on as soon as it goes through. If you've decided to stop, that's fine too - just reply and let me know.</p>",
      '<p>Guy</p>',
    ].join('\n'),
  };
}

async function placeDraft(client, email, channel, logger) {
  const clientService = require('./clientService');
  const mailProvider = require('./mailProvider');
  const coach = await clientService.getClientById(COACH_ID);
  if (!coach || !mailProvider.hasMailbox(coach)) {
    throw new Error(`No mailbox available for ${COACH_ID} - cannot place the draft`);
  }
  if (!client.clientEmailAddress) throw new Error(`${client.clientId} has no Client Email Address`);
  const res = await mailProvider.createDraft(coach, {
    subject: email.subject,
    html: email.html,
    to: [{ email: client.clientEmailAddress, name: client.clientName || '' }],
  });
  if (!res.ok) throw new Error(`Draft creation failed (${res.provider}): ${res.error}`);
  try {
    await require('./commsLog').recordComm({
      coachClientId: client.clientId,
      channel,
      recipient: client.clientEmailAddress,
      subject: email.subject,
      summary: "Drafted into Guy's mailbox for review (not yet sent)",
      meta: { draftId: res.draftId, provider: res.provider },
    });
  } catch (e) {
    logger.warn(`[lapse] draft placed but comms log failed: ${e.message}`);
  }
  return res;
}

async function emailGuy(subject, text, logger) {
  try {
    const { sendTextEmail } = require('./gmailApiService');
    await sendTextEmail({ to: GUY_EMAIL, subject, text });
  } catch (e) {
    logger.error(`[lapse] Could not email Guy (${subject}): ${e && e.message}`);
  }
}

function isStripeBilled(client) {
  return !!client && String(client.billingSource || '').trim().toLowerCase() === 'stripe';
}

// ---------------------------------------------------------------------------
// Moment 1: a payment failed
// ---------------------------------------------------------------------------

/**
 * Called from the Stripe webhook on invoice.payment_failed. Drafts the
 * card-didn't-go-through email on the FIRST failure of an invoice only -
 * Stripe's retries don't produce more drafts. Never throws.
 * @returns {{drafted: boolean, reason?: string, draftId?: string}}
 */
async function onPaymentFailed({ client, invoice }, logger = defaultLogger) {
  try {
    if (!isStripeBilled(client)) return { drafted: false, reason: 'not a Stripe-billed client' };
    if ((invoice.attempt_count || 1) > 1) return { drafted: false, reason: `retry ${invoice.attempt_count} - already handled on the first failure` };
    if (!invoice.hosted_invoice_url) return { drafted: false, reason: 'invoice has no pay link' };
    const key = `failed:${invoice.id}`;
    if (!(await claim(key, client.clientId, 'payment_failed_draft', { invoice: invoice.id }))) {
      return { drafted: false, reason: 'already drafted for this invoice' };
    }
    try {
      const res = await placeDraft(client, paymentFailedEmail(client, invoice), 'lapse-card-failed-draft', logger);
      logger.info(`[lapse] ${client.clientId}: card-failed draft placed (${res.draftId})`);
      return { drafted: true, draftId: res.draftId };
    } catch (e) {
      await release(key); // let a replay try again
      throw e;
    }
  } catch (e) {
    logger.error(`[lapse] payment-failed draft for ${client && client.clientId}: ${e.message}`);
    return { drafted: false, reason: e.message };
  }
}

// ---------------------------------------------------------------------------
// Moment 2: Stripe gave up and the client is now paused
// ---------------------------------------------------------------------------

/**
 * Called when a Stripe-billed client's subscription ends in a pause. Drafts
 * the paused email (with the restart link) and sends Guy one summary. Keyed
 * on the subscription, so it runs once per lapse. Never throws.
 *
 * @param {Object} p
 * @param {Object} p.client        clientService record
 * @param {Object} p.subscription  Stripe subscription (id, cancellation_details)
 * @param {boolean} [p.dryRun]     build everything, draft and send nothing
 */
async function onPaused({ client, subscription, dryRun = false }, logger = defaultLogger) {
  if (!isStripeBilled(client)) return { done: false, reason: 'not a Stripe-billed client' };
  const reason = subscription && subscription.cancellation_details && subscription.cancellation_details.reason;
  const cardFailure = reason === 'payment_failed';
  const email = pausedEmail(client);
  const summary = await pausedSummaryForGuy(client, subscription, cardFailure);

  if (dryRun) return { done: false, dryRun: true, draft: email, guySubject: summary.subject, guyText: summary.text };

  // A cancel Guy made himself (someone leaving) is not a lapse - no restart
  // pitch goes into his drafts for a client who has already said goodbye.
  if (!cardFailure) return { done: false, reason: `subscription ended (${reason || 'no reason given'}) - not a card lapse, nothing drafted` };

  const key = `paused:${subscription.id}`;
  if (!(await claim(key, client.clientId, 'paused_draft', { subscription: subscription.id }))) {
    return { done: false, reason: 'already handled for this subscription' };
  }
  try {
    const res = await placeDraft(client, email, 'lapse-paused-draft', logger);
    await emailGuy(summary.subject, summary.text, logger);
    logger.info(`[lapse] ${client.clientId}: paused draft placed (${res.draftId}) and Guy told`);
    return { done: true, draftId: res.draftId };
  } catch (e) {
    await release(key);
    logger.error(`[lapse] paused chain for ${client.clientId} failed: ${e.message}`);
    await emailGuy(
      `Paused, but the draft failed: ${client.clientName}`,
      `${client.clientName} has paused (card failed), but the "your account has paused" draft could not be placed:\n\n${e.message}\n\nNothing else was changed.`,
      logger
    );
    return { done: false, reason: e.message };
  }
}

async function pausedSummaryForGuy(client, subscription, cardFailure) {
  const name = client.clientName || client.clientId;
  let openInvoice = null;
  try {
    const stripe = require('../config/stripeClient').getStripeClient();
    if (stripe && client.stripeCustomerId) {
      const open = await stripe.invoices.list({ customer: client.stripeCustomerId, status: 'open', limit: 3 });
      openInvoice = open.data[0] || null;
    }
  } catch (_) { /* summary still goes without it */ }

  const on = (v) => (v ? 'yes' : 'no');
  const offboardDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Brisbane' });
  const lines = [
    cardFailure
      ? `Stripe gave up on ${name}'s card after its retries and cancelled the subscription, so their account is now Paused.`
      : `${name}'s subscription has ended and their account is now Paused.`,
    '',
    `A draft is waiting in your mailbox: "Your I Know A Guy account has paused". It has a link to restart at $150 a month with no set-up fee. Read it, tweak it, send it.`,
    '',
    'Nothing has been removed. Still switched on:',
    `- Claude key: ${on(client.anthropicApiKey)}`,
    `- Mailbox connection: ${on(client.unipileAccountId)}`,
    `- Portal login: ${on(client.portalToken)}`,
    "- Linked Helper: you'll get one email if it sends a lead while they're paused",
    '',
    'If they restart, everything switches back on by itself.',
    `If they haven't restarted by ${offboardDate}, they're offboarded automatically: their mailbox connection, Claude key and portal login are removed, and you get a summary.`,
    `If they've told you they're leaving, don't wait - tell Claude "offboard ${name}".`,
  ];
  if (openInvoice) {
    lines.push('', `Their unpaid ${money(openInvoice.amount_due)} invoice (${openInvoice.number || openInvoice.id}) is still open in Stripe. Stripe won't charge it again, but if they restart, void it so it doesn't sit there as money owed.`);
  }
  return { subject: `Paused: ${name}${cardFailure ? ' (card failed)' : ''}`, text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Moment 3: a paused client's Linked Helper is still sending leads
// ---------------------------------------------------------------------------

// Fallback when there's no DB: remember in memory (resets on deploy).
const memoryAlerts = new Map();

/**
 * Decide whether a refused webhook from an inactive client deserves an
 * email: the first refusal does, then one reminder a week while it keeps
 * happening. Returns { alert, refusedCount, since }.
 */
async function shouldAlertInactiveWebhook(clientId, status, now = Date.now()) {
  const res = await withDb(async (db) => {
    const cur = await db.query('SELECT * FROM inactive_webhook_alerts WHERE client_id=$1', [clientId]);
    const row = cur.rows[0];
    if (!row) {
      await db.query('INSERT INTO inactive_webhook_alerts (client_id, status) VALUES ($1,$2) ON CONFLICT (client_id) DO NOTHING', [clientId, status]);
      return { alert: true, refusedCount: 1, since: new Date(now) };
    }
    // A different status (say Paused, then later Inactive) starts a fresh run.
    if (row.status !== status) {
      await db.query(
        'UPDATE inactive_webhook_alerts SET status=$2, refused_count=1, first_refused_at=now(), last_alerted_at=now() WHERE client_id=$1',
        [clientId, status]
      );
      return { alert: true, refusedCount: 1, since: new Date(now) };
    }
    const count = row.refused_count + 1;
    const due = now - new Date(row.last_alerted_at).getTime() >= REMINDER_EVERY_MS;
    await db.query(
      `UPDATE inactive_webhook_alerts SET refused_count=$2${due ? ', last_alerted_at=now()' : ''} WHERE client_id=$1`,
      [clientId, count]
    );
    return { alert: due, refusedCount: count, since: row.first_refused_at };
  }).catch(() => null);
  if (res) return res;

  const m = memoryAlerts.get(clientId);
  if (!m || now - m.last >= REMINDER_EVERY_MS) {
    memoryAlerts.set(clientId, { last: now, count: (m ? m.count : 0) + 1, since: m ? m.since : new Date(now) });
    return { alert: true, refusedCount: (m ? m.count : 0) + 1, since: m ? m.since : new Date(now) };
  }
  m.count += 1;
  return { alert: false, refusedCount: m.count, since: m.since };
}

/** The alert body for a paused client's Linked Helper still sending leads. */
function inactiveWebhookText(client, { refusedCount, since }) {
  const name = client.clientName || client.clientId;
  const sinceStr = new Date(since).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Brisbane' });
  return [
    `${name} is ${client.status}, but their Linked Helper is still sending leads. The server is turning them away, so those leads aren't being scored.`,
    '',
    refusedCount > 1 ? `Leads turned away since ${sinceStr}: ${refusedCount}` : 'This is the first one.',
    '',
    "If they're coming back, nothing to do - it all resumes when they're Active again.",
    "If they've left, stop the campaign on their Linked Helper machine.",
    '',
    "You'll get this once, then at most one reminder a week while it keeps happening.",
  ].join('\n');
}

module.exports = {
  onPaymentFailed,
  onPaused,
  shouldAlertInactiveWebhook,
  inactiveWebhookText,
  rejoinUrl,
  verifyRejoinToken,
  ensureLedger,
  // exposed for tests
  paymentFailedEmail,
  pausedEmail,
};
