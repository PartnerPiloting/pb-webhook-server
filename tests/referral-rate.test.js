/**
 * The referral rate, as the machine judges it (2026-09-14).
 *
 * Guy's rule: three currently-paying referrals -> $150 becomes $30, maintained not earned once.
 * These tests pin the judgements the nightly sweep is built on:
 *   - "currently paying" for a Stripe-billed referral = subscription active AND last invoice paid;
 *     a missed payment mid-retry does NOT count that day;
 *   - legacy (PMPro) referrals count on Status Active; complimentary never counts;
 *   - the credit goes on only when the renewal is close (inside the lead window), never after it;
 *   - one email per transition (reached / lost), none while nothing changes.
 *
 * Pure logic only - no Stripe, no Postgres, no Airtable.
 * Run: node tests/referral-rate.test.js
 */
const assert = require('assert');
const rate = require('../services/referralRateService');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const DAY = 24 * 60 * 60;

console.log('subscriptionIsPaying');
check('active with a paid latest invoice counts', () => {
  assert.strictEqual(rate.subscriptionIsPaying({ status: 'active', latest_invoice: { status: 'paid' } }), true);
});
check('past_due (a bounced card mid-retry) does not count that day', () => {
  assert.strictEqual(rate.subscriptionIsPaying({ status: 'past_due', latest_invoice: { status: 'open' } }), false);
});
check('active but the latest invoice is still open does not count', () => {
  assert.strictEqual(rate.subscriptionIsPaying({ status: 'active', latest_invoice: { status: 'open', amount_due: 15000 } }), false);
});
check('canceled never counts; a missing subscription never counts', () => {
  assert.strictEqual(rate.subscriptionIsPaying({ status: 'canceled', latest_invoice: { status: 'paid' } }), false);
  assert.strictEqual(rate.subscriptionIsPaying(null), false);
});
check('an unexpanded latest_invoice id falls back to status alone', () => {
  assert.strictEqual(rate.subscriptionIsPaying({ status: 'active', latest_invoice: 'in_123' }), true);
});

console.log('referredClientIsPaying');
check('stripe-billed: judged by the subscription', () => {
  const c = { billingSource: 'stripe', status: 'Active' };
  assert.strictEqual(rate.referredClientIsPaying(c, { status: 'active', latest_invoice: { status: 'paid' } }), true);
  assert.strictEqual(rate.referredClientIsPaying(c, { status: 'past_due', latest_invoice: { status: 'open' } }), false);
  assert.strictEqual(rate.referredClientIsPaying(c, null), false);
});
check('legacy (blank or pmpro): judged by Status Active', () => {
  assert.strictEqual(rate.referredClientIsPaying({ billingSource: null, status: 'Active' }, null), true);
  assert.strictEqual(rate.referredClientIsPaying({ billingSource: 'pmpro', status: 'Paused' }, null), false);
});
check('complimentary never counts, even when Active with a paid sub', () => {
  assert.strictEqual(rate.referredClientIsPaying({ billingSource: 'complimentary', status: 'Active' }, { status: 'active', latest_invoice: { status: 'paid' } }), false);
});

console.log('periodEndOf + renewalDue');
check('reads the period end from either API shape', () => {
  assert.strictEqual(rate.periodEndOf({ current_period_end: 100 }), 100);
  assert.strictEqual(rate.periodEndOf({ items: { data: [{ current_period_end: 200 }] } }), 200);
  assert.strictEqual(rate.periodEndOf({}), null);
});
check('the credit goes on inside the lead window only', () => {
  const now = 1_000_000 * 1000;
  assert.strictEqual(rate.renewalDue(1_000_000 + 2 * DAY, now), true, 'two days out');
  assert.strictEqual(rate.renewalDue(1_000_000 + 10 * DAY, now), false, 'ten days out is too early');
  assert.strictEqual(rate.renewalDue(1_000_000 - DAY, now), false, 'already renewed - never backdate');
  assert.strictEqual(rate.renewalDue(null, now), false);
});

console.log('standingTransition');
check('first sight at the rate = reached; first sight below = nothing', () => {
  assert.strictEqual(rate.standingTransition(undefined, { atRate: true }), 'reached');
  assert.strictEqual(rate.standingTransition(undefined, { atRate: false }), null);
});
check('reached / lost / unchanged', () => {
  assert.strictEqual(rate.standingTransition({ at_rate: false }, { atRate: true }), 'reached');
  assert.strictEqual(rate.standingTransition({ at_rate: true }, { atRate: false }), 'lost');
  assert.strictEqual(rate.standingTransition({ at_rate: true }, { atRate: true }), null);
});

console.log('constants');
check('the credit is $120 (150 -> 30), never the $130 said aloud', () => {
  assert.strictEqual(rate.CREDIT_CENTS, 12000);
});

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall referral-rate tests passed');
