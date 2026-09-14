// services/referralRateService.js
// The referral rate, applied by the machine (built 2026-09-14).
//
// Guy's rule: a client who has introduced THREE people who are CURRENTLY PAYING has the base $150
// reduced to $30. Maintained, not earned once. Nobody should have to remember it.
//
// How it is applied - a CREDIT LINE on the invoice, never a coupon or a price swap:
//   * Every night the sweep works out each referrer's standing: how many of the clients they
//     introduced (Clients.Introduced By) are paying right now.
//   * A referrer whose Stripe renewal is due within the next few days, and who is at the rate,
//     gets ONE pending invoice item of -$120 on their Stripe customer. Stripe pulls pending items
//     into the next subscription invoice, so the invoice reads "$150, Referral rate -$120, $30".
//   * The default is always the full $150. The credit exists only when earned, one period at a
//     time, so "they no longer have three" needs no undo step: nothing is added and the invoice is
//     $150. If this job ever dies the failure is a client paying full price for a month, which
//     Guy hears about, never a client under-paying forever.
//   * A Postgres ledger makes the grant idempotent per (client, billing period) and remembers each
//     referrer's last standing so Guy gets ONE email when someone reaches the rate or drops off it.
//
// "Currently paying", checked on the day the referrer's invoice is being prepared:
//   * Billing Source stripe   -> their Stripe subscription is ACTIVE and its latest invoice is
//                                paid for a non-zero amount. past_due (a missed payment mid-retry)
//                                does NOT count that day - Guy's rule, stated 2026-09-14. Nor does
//                                trialing: a free period Guy has granted (Guy McPhee to Feb 2027)
//                                is access, not payment. A prepaid deal modelled as a long trial
//                                (Jonathan Bunch's $797) is the known exception - by hand if ever
//                                it matters.
//   * Billing Source blank/pmpro (legacy members) -> Status Active, which the daily PMPro sync
//                                keeps honest.
//   * Billing Source complimentary -> never counts (the field says so).
//
// The referrer themself must be on Stripe billing for the credit to be applied. A referrer at the
// rate on legacy billing is reported to Guy as "apply by hand" until they are migrated.
//
// Nothing here changes a price or a subscription. The dollar figure is one constant below and
// the count lives in referralService - see memory project_business_model for the rule's history.

const clientService = require('./clientService');
const referrals = require('./referralService');
const { createLogger } = require('../utils/contextLogger');

const defaultLogger = createLogger({ runId: 'REFRATE', clientId: 'SYSTEM', operation: 'referral_rate' });

const CREDIT_CENTS = 12000;                  // $150 -> $30
const CURRENCY = 'aud';
const LEAD_DAYS = 3;                         // add the credit when the renewal is this close
const CREDIT_DESCRIPTION = 'Referral rate - three paying referrals';
const GUY_EMAIL = process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
// Entitlement (the webhook) treats trialing as access; "currently paying" for the referral count
// is stricter - money actually changed hands on the last invoice.
const PAYING_SUB_STATUSES = ['active'];
const LIVE_SUB_STATUSES = ['active', 'trialing'];

const lower = (v) => String(v || '').trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// Pure judgements (unit tested in tests/referral-rate.test.js)

/** Is a Stripe subscription paid up today? Active, and the last invoice paid for real money. */
function subscriptionIsPaying(sub) {
  if (!sub || !PAYING_SUB_STATUSES.includes(sub.status)) return false;
  const inv = sub.latest_invoice;
  if (!inv) return false;                      // nothing invoiced yet = nothing paid yet
  if (typeof inv === 'string') return true;    // not expanded - status alone has to do
  return inv.status === 'paid' && Number(inv.amount_paid || 0) > 0;
}

/**
 * Does this referred client count today? `sub` is their Stripe subscription (or null) when they
 * are stripe-billed; ignored otherwise.
 */
function referredClientIsPaying(client, sub) {
  if (!client) return false;
  const source = lower(client.billingSource);
  if (source === 'complimentary') return false;
  if (source === 'stripe') return subscriptionIsPaying(sub);
  return client.status === 'Active';
}

/** The subscription's period end in seconds, across the two shapes the Stripe API has used. */
function periodEndOf(sub) {
  if (!sub) return null;
  if (sub.current_period_end) return sub.current_period_end;
  const item = sub.items && sub.items.data && sub.items.data[0];
  return (item && item.current_period_end) || null;
}

/** Is a renewal close enough that the credit should be sitting on the customer now? */
function renewalDue(periodEndSec, nowMs = Date.now(), leadDays = LEAD_DAYS) {
  if (!periodEndSec) return false;
  const endMs = periodEndSec * 1000;
  return endMs > nowMs && endMs - nowMs <= leadDays * 24 * 60 * 60 * 1000;
}

/** What changed between last night's standing and tonight's. */
function standingTransition(prev, next) {
  const was = Boolean(prev && prev.at_rate);
  if (was === next.atRate) return null;
  return next.atRate ? 'reached' : 'lost';
}

// ---------------------------------------------------------------------------------------------
// Ledger

function getPool() {
  return require('./recallWebhookDb').getPool();
}

let schemaReady = false;
async function ensureSchema(c) {
  if (schemaReady) return;
  await c.query(`
    CREATE TABLE IF NOT EXISTS referral_rate_standing (
      client_id TEXT PRIMARY KEY,
      at_rate BOOLEAN NOT NULL DEFAULT false,
      paying_count INTEGER NOT NULL DEFAULT 0,
      paying_names TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS referral_rate_credits (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      period_end BIGINT NOT NULL,
      stripe_customer_id TEXT,
      stripe_invoice_item_id TEXT,
      amount_cents INTEGER NOT NULL,
      paying_names TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (client_id, period_end)
    );
  `);
  schemaReady = true;
}

async function withDb(fn) {
  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL not set - the referral-rate ledger needs Postgres');
  const c = await pool.connect();
  try {
    await ensureSchema(c);
    return await fn(c);
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Stripe reads (cached per sweep)

async function fetchSubscription(stripe, client, cache) {
  if (!stripe || !client) return null;
  const key = client.stripeSubscriptionId || `cus:${client.stripeCustomerId}`;
  if (cache.has(key)) return cache.get(key);
  let sub = null;
  try {
    if (client.stripeSubscriptionId) {
      sub = await stripe.subscriptions.retrieve(client.stripeSubscriptionId, { expand: ['latest_invoice'] });
    } else if (client.stripeCustomerId) {
      const list = await stripe.subscriptions.list({ customer: client.stripeCustomerId, status: 'all', limit: 5, expand: ['data.latest_invoice'] });
      sub = list.data.find((s) => LIVE_SUB_STATUSES.includes(s.status)) || list.data[0] || null;
    }
  } catch (e) {
    defaultLogger.warn(`stripe read failed for ${client.clientId}: ${e.message}`);
  }
  cache.set(key, sub);
  return sub;
}

// ---------------------------------------------------------------------------------------------
// The sweep

/**
 * One referrer's standing tonight: who they introduced, who is paying, whether they are at the rate.
 */
async function standingFor(referrer, all, stripe, cache) {
  const referred = all.filter((c) => (referrals.introducedByOf(c) || [])[0] === referrer.id);
  const paying = [];
  for (const c of referred) {
    const sub = lower(c.billingSource) === 'stripe' ? await fetchSubscription(stripe, c, cache) : null;
    if (referredClientIsPaying(c, sub)) paying.push(c);
  }
  return {
    referred,
    payingNames: paying.map((c) => c.clientName),
    count: paying.length,
    atRate: paying.length >= referrals.REFERRAL_RATE_COUNT,
  };
}

async function emailGuy(subject, lines, logger) {
  try {
    const { sendTextEmail } = require('./gmailApiService');
    await sendTextEmail({ to: GUY_EMAIL, subject, text: lines.join('\n') });
  } catch (e) {
    logger.error(`[refrate] could not email Guy (${subject}): ${e.message}`);
  }
}

/**
 * Run the nightly sweep. Returns a report; with dryRun nothing is written to Stripe, the ledger
 * or Guy's inbox - the report says what WOULD happen.
 */
async function runReferralRateSweep({ dryRun = false, now = Date.now(), logger = defaultLogger } = {}) {
  const { stripe } = require('../config/stripeClient');
  const all = await clientService.getAllClients();
  const cache = new Map();
  const report = { dryRun, at: new Date(now).toISOString(), referrers: [], credits: [], transitions: [], notes: [] };

  // Anyone who has introduced at least one client is a referrer worth a standing row.
  const referrerIds = new Set(all.map((c) => (referrals.introducedByOf(c) || [])[0]).filter(Boolean));
  const referrers = all.filter((c) => referrerIds.has(c.id));
  if (!referrers.length) {
    report.notes.push('No client has Introduced By set yet - nothing to judge.');
    return report;
  }

  const prevRows = dryRun && !getPool() ? [] : await withDb(async (c) => (await c.query('SELECT * FROM referral_rate_standing')).rows).catch((e) => {
    report.notes.push(`ledger unavailable: ${e.message}`);
    return [];
  });
  const prev = new Map(prevRows.map((r) => [r.client_id, r]));

  for (const r of referrers) {
    const s = await standingFor(r, all, stripe, cache);
    const line = { clientId: r.clientId, clientName: r.clientName, billingSource: lower(r.billingSource) || 'pmpro', count: s.count, payingNames: s.payingNames, atRate: s.atRate, credit: null };
    const transition = standingTransition(prev.get(r.clientId), s);

    // The credit: only for stripe-billed referrers at the rate whose renewal is close.
    if (s.atRate && lower(r.billingSource) === 'stripe' && stripe) {
      const sub = await fetchSubscription(stripe, r, cache);
      const periodEnd = periodEndOf(sub);
      if (!sub || !LIVE_SUB_STATUSES.includes(sub.status)) {
        line.credit = 'skipped: their own subscription is not active';
      } else if (!renewalDue(periodEnd, now)) {
        line.credit = `not yet: renewal ${periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : 'unknown'}`;
      } else {
        const already = await withDb(async (c) => (await c.query(
          'SELECT stripe_invoice_item_id FROM referral_rate_credits WHERE client_id = $1 AND period_end = $2', [r.clientId, periodEnd],
        )).rows[0]).catch(() => null);
        if (already) {
          line.credit = `already granted for this period (${already.stripe_invoice_item_id})`;
        } else if (dryRun) {
          line.credit = `WOULD grant -$${CREDIT_CENTS / 100} for the invoice due ${new Date(periodEnd * 1000).toISOString().slice(0, 10)}`;
          report.credits.push({ clientId: r.clientId, periodEnd, dryRun: true });
        } else {
          const customer = sub.customer ? String(sub.customer) : r.stripeCustomerId;
          const item = await stripe.invoiceItems.create({
            customer,
            amount: -CREDIT_CENTS,
            currency: CURRENCY,
            description: CREDIT_DESCRIPTION,
            metadata: { referral_rate: '1', client_id: r.clientId, period_end: String(periodEnd), paying: s.payingNames.join(', ') },
          });
          await withDb((c) => c.query(
            'INSERT INTO referral_rate_credits (client_id, period_end, stripe_customer_id, stripe_invoice_item_id, amount_cents, paying_names) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (client_id, period_end) DO NOTHING',
            [r.clientId, periodEnd, customer, item.id, -CREDIT_CENTS, s.payingNames.join(', ')],
          ));
          line.credit = `granted ${item.id} for the invoice due ${new Date(periodEnd * 1000).toISOString().slice(0, 10)}`;
          report.credits.push({ clientId: r.clientId, periodEnd, invoiceItemId: item.id });
          logger.info(`[refrate] credit ${item.id} for ${r.clientId} (period ${periodEnd})`);
          await emailGuy(`Referral rate applied: ${r.clientName}`, [
            `${r.clientName}'s next invoice (due ${new Date(periodEnd * 1000).toISOString().slice(0, 10)}) carries a $${CREDIT_CENTS / 100} referral credit, so they pay $30.`,
            '',
            `Paying referrals today: ${s.payingNames.join(', ')}.`,
            '',
            'Nothing to do. The credit is one month only - next month is judged again on its own day.',
          ], logger);
        }
      }
    } else if (s.atRate) {
      line.credit = `cannot apply: billed via ${line.billingSource} - apply by hand until they are on Stripe`;
    }

    if (transition) {
      report.transitions.push({ clientId: r.clientId, transition, count: s.count, payingNames: s.payingNames });
      if (!dryRun) {
        const subject = transition === 'reached'
          ? `Referral rate reached: ${r.clientName}`
          : `Referral rate lost: ${r.clientName}`;
        const body = transition === 'reached'
          ? [
            `${r.clientName} now has ${s.count} paying referrals: ${s.payingNames.join(', ')}.`,
            '',
            lower(r.billingSource) === 'stripe'
              ? 'Their invoices will carry the $120 referral credit automatically from the next renewal while this holds.'
              : `They are billed via ${line.billingSource}, not Stripe, so the $30 rate has to be applied by hand until they are migrated.`,
            '',
            'Worth a line to them - this is the moment.',
          ]
          : [
            `${r.clientName} has dropped to ${s.count} paying referral${s.count === 1 ? '' : 's'}${s.payingNames.length ? ` (${s.payingNames.join(', ')})` : ''}.`,
            '',
            'No more referral credits until they are back to three. Their next invoice will be the full $150.',
            '',
            'Worth a line to them so the change is not a surprise.',
          ];
        await emailGuy(subject, body, logger);
      }
    }

    if (!dryRun) {
      await withDb((c) => c.query(
        `INSERT INTO referral_rate_standing (client_id, at_rate, paying_count, paying_names, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (client_id) DO UPDATE SET at_rate = EXCLUDED.at_rate, paying_count = EXCLUDED.paying_count, paying_names = EXCLUDED.paying_names, updated_at = now()`,
        [r.clientId, s.atRate, s.count, s.payingNames.join(', ')],
      )).catch((e) => report.notes.push(`standing not saved for ${r.clientId}: ${e.message}`));
    }
    report.referrers.push(line);
  }

  logger.info(`[refrate] sweep${dryRun ? ' (dry)' : ''}: ${report.referrers.length} referrers, ${report.credits.length} credits, ${report.transitions.length} transitions`);
  return report;
}

module.exports = {
  CREDIT_CENTS,
  LEAD_DAYS,
  CREDIT_DESCRIPTION,
  subscriptionIsPaying,
  referredClientIsPaying,
  periodEndOf,
  renewalDue,
  standingTransition,
  standingFor,
  runReferralRateSweep,
};
