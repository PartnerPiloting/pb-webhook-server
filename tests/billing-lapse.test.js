/**
 * Billing lapse - the human side of a card that stops working.
 *
 * 24 Sep 2026: Ashley Knowles' card failed on 9 Sep. Guy got nine "payment failed" emails while
 * Stripe retried, then - after Stripe cancelled and she paused - one "Inactive Client Webhook
 * Attempt" email for every lead her Linked Helper kept sending. Nobody drafted her anything.
 *
 * Pins: the paused client's Linked Helper alerts once then weekly (not per lead); retries of a
 * failed invoice never draft again; a Guy-made cancel (someone leaving) drafts no restart pitch;
 * the restart link is signed per client and can't be pointed at someone else; the client
 * emails use the plain short dash.
 */
const assert = require('assert');

process.env.REJOIN_LINK_SECRET = 'test-secret';
delete process.env.DATABASE_URL; // exercise the in-memory throttle, no ledger
const lapse = require('../services/billingLapseService.js');

(async () => {
  // 1. Inactive webhook: first refusal alerts, the rest of the week is quiet, then one reminder.
  const t0 = Date.parse('2026-09-24T00:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const a1 = await lapse.shouldAlertInactiveWebhook('Test-Client', 'Paused', t0);
  assert.strictEqual(a1.alert, true, 'first refusal emails');
  for (let i = 1; i <= 50; i++) {
    const a = await lapse.shouldAlertInactiveWebhook('Test-Client', 'Paused', t0 + i * 60000);
    assert.strictEqual(a.alert, false, `refusal ${i + 1} within the week stays quiet`);
  }
  const a8 = await lapse.shouldAlertInactiveWebhook('Test-Client', 'Paused', t0 + 7 * day);
  assert.strictEqual(a8.alert, true, 'weekly reminder');
  assert.strictEqual(a8.refusedCount, 52, 'counts every refusal');
  const text = lapse.inactiveWebhookText({ clientName: 'Test Client', status: 'Paused' }, a8);
  assert.ok(/Leads turned away since .*: 52/.test(text), text);

  // 2. Payment failed: retries never draft; a legacy (non-Stripe) client never drafts.
  const stripeClient = { clientId: 'Test-Client', billingSource: 'stripe', clientEmailAddress: 'x@y.z' };
  const retry = await lapse.onPaymentFailed({ client: stripeClient, invoice: { id: 'in_1', attempt_count: 2, hosted_invoice_url: 'https://pay' } });
  assert.strictEqual(retry.drafted, false);
  assert.ok(/retry 2/.test(retry.reason));
  const legacy = await lapse.onPaymentFailed({ client: { clientId: 'L', billingSource: '' }, invoice: { id: 'in_2', attempt_count: 1 } });
  assert.strictEqual(legacy.drafted, false);

  // 3. A cancel Guy made (customer leaving) is not a lapse - no restart pitch drafted.
  const left = await lapse.onPaused({ client: stripeClient, subscription: { id: 'sub_1', cancellation_details: { reason: 'cancellation_requested' } } });
  assert.strictEqual(left.done, false);
  assert.ok(/not a card lapse/.test(left.reason), left.reason);

  // 4. The restart link is signed per client.
  const url = new URL(lapse.rejoinUrl('Ashley-Knowles'));
  assert.strictEqual(url.searchParams.get('c'), 'Ashley-Knowles');
  const tok = url.searchParams.get('t');
  assert.ok(lapse.verifyRejoinToken('Ashley-Knowles', tok));
  assert.ok(!lapse.verifyRejoinToken('Someone-Else', tok), 'token cannot be reused for another client');
  assert.ok(!lapse.verifyRejoinToken('Ashley-Knowles', tok.slice(0, -1) + 'x'));

  // 5. House style in the client emails: short spaced dash, no em/en dash.
  const client = { clientId: 'Ashley-Knowles', clientFirstName: 'Ashley', clientName: 'Ashley Knowles' };
  for (const e of [lapse.pausedEmail(client), lapse.paymentFailedEmail(client, { amount_due: 15000, hosted_invoice_url: 'https://pay' })]) {
    assert.ok(!/[–—]/.test(e.subject + e.html), `no em/en dash in "${e.subject}"`);
    assert.ok(/Hi Ashley,/.test(e.html));
  }
  assert.ok(/\$150/.test(lapse.paymentFailedEmail(client, { amount_due: 15000, hosted_invoice_url: 'u' }).html));
  assert.ok(lapse.pausedEmail(client).html.includes('/rejoin?c=Ashley-Knowles'));

  console.log('billing-lapse: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
