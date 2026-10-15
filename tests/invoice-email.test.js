/**
 * Tax invoice emails - the GST invoice PDF goes to the client's billing address after each
 * Stripe payment, so a bookkeeper never needs the client's portal link (Paul Faix / Fortix,
 * 15 Oct 2026).
 *
 * Pins: Billing Email wins and can hold several addresses, blank falls back to Client Email
 * Address; a replayed webhook never sends the same invoice twice; a failed send can be retried;
 * $0 invoices send nothing; staging only ever emails Guy; the wording uses the short dash.
 */
const assert = require('assert');

delete process.env.DATABASE_URL;
delete process.env.ENVIRONMENT;
delete process.env.RENDER_GIT_BRANCH;
process.env.FROM_EMAIL = 'alerts@example.test';
const svc = require('../services/invoiceEmailService.js');

const invoice = (id, cents = 15000) => ({
  id, number: `INV-${id}`, created: Date.parse('2026-10-15T00:00:00Z') / 1000, amount_paid: cents,
  status: 'paid', status_transitions: { paid_at: Date.parse('2026-10-15T01:00:00Z') / 1000 },
  customer: 'cus_paul', customer_email: 'pavol@fortix.com.au', customer_name: 'Pavol Faix',
  lines: { data: [{ description: '1 x Membership', amount: cents }] },
});

function harness() {
  const ledger = new Set();
  const sends = [];
  const comms = [];
  let failNext = false;
  const deps = {
    getClientById: async (id) => (id === 'Guy-Wilson' ? { clientEmailAddress: 'guy@wilsoar.com' } : null),
    generateInvoicePdf: async () => Buffer.from('%PDF-fake'),
    alreadySent: async (ids) => new Set(ids.filter((i) => ledger.has(i))),
    claim: async (id) => (ledger.has(id) ? false : (ledger.add(id), true)),
    release: async (id) => { ledger.delete(id); },
    send: async (msg) => { if (failNext) { failNext = false; throw new Error('Mailgun down'); } sends.push(msg); return { id: 'mg1' }; },
    recordComm: async (row) => { comms.push(row); return { ok: true }; },
  };
  return { deps, ledger, sends, comms, failOnce: () => { failNext = true; } };
}

(async () => {
  // 1. Recipients.
  assert.deepStrictEqual(svc.parseAddresses('Paul@Fortix.com.au, accounts@fortix.com.au; accounts@fortix.com.au junk'),
    ['paul@fortix.com.au', 'accounts@fortix.com.au']);
  const paul = { clientId: 'Paul-Faix', clientFirstName: 'Paul', clientEmailAddress: 'paul@fortix.com.au', billingEmail: 'accounts@fortix.com.au' };
  assert.deepStrictEqual(svc.billingRecipients(paul, invoice('a')).recipients, ['accounts@fortix.com.au']);
  assert.deepStrictEqual(svc.billingRecipients({ ...paul, billingEmail: '' }, invoice('a')).recipients, ['paul@fortix.com.au']);
  assert.deepStrictEqual(svc.billingRecipients(null, invoice('a')).recipients, ['pavol@fortix.com.au'], 'unmatched payer still gets it');

  const slip = svc.buildInvoiceEmail({ client: { clientId: 'Paul-Faix', clientFirstName: 'Paul-Faix' }, invoices: [invoice('a')] });
  assert.ok(/^Hi Paul,/.test(slip.text), 'Client ID in First Name never reaches the greeting');

  // 2. A paid invoice sends once; the replay is skipped.
  const h = harness();
  const deps = { ...h.deps, retrieveInvoice: async (id) => invoice(id), findClientForCustomer: async () => paul };
  const r1 = await svc.onInvoicePaid({ invoice: invoice('in_1'), deps });
  assert.deepStrictEqual(r1.sent, ['in_1']);
  assert.strictEqual(h.sends.length, 1);
  assert.strictEqual(h.sends[0].to, 'accounts@fortix.com.au');
  assert.strictEqual(h.sends[0]['h:Reply-To'], 'guy@wilsoar.com');
  assert.strictEqual(h.sends[0].from, 'Guy Wilson <alerts@example.test>');
  assert.strictEqual(h.sends[0].attachments[0].filename, 'Invoice-INV-in_1.pdf');
  assert.ok(/^Hi Paul,/.test(h.sends[0].text), h.sends[0].text);
  assert.ok(h.sends[0].text.includes('$150.00, paid 15 October 2026'), h.sends[0].text);
  assert.ok(!/[–—]/.test(h.sends[0].text + h.sends[0].subject), 'short dash only');
  assert.strictEqual(h.comms.length, 1);
  assert.strictEqual(h.comms[0].channel, 'tax-invoice');
  assert.strictEqual(h.comms[0].coachClientId, 'Paul-Faix');
  const r2 = await svc.onInvoicePaid({ invoice: invoice('in_1'), deps });
  assert.deepStrictEqual(r2.sent, []);
  assert.deepStrictEqual(r2.skipped, ['in_1']);
  assert.strictEqual(h.sends.length, 1, 'replayed event sends nothing');

  // 3. A failed send releases its claim so it can be retried.
  h.failOnce();
  const r3 = await svc.onInvoicePaid({ invoice: invoice('in_2'), deps });
  assert.ok(/Mailgun down/.test(r3.error));
  assert.ok(!h.ledger.has('in_2'), 'claim released');
  const r4 = await svc.onInvoicePaid({ invoice: invoice('in_2'), deps });
  assert.deepStrictEqual(r4.sent, ['in_2']);

  // 4. $0 invoices (trials) send nothing.
  const r5 = await svc.onInvoicePaid({ invoice: invoice('in_0', 0), deps });
  assert.ok(r5.skipped);
  assert.strictEqual(h.sends.length, 2);

  // 5. Backfill: several invoices in one email, already-sent ones left out; dry run sends nothing.
  const all = [invoice('in_1'), invoice('in_3'), invoice('in_4')];
  const dry = await svc.sendInvoices({ client: paul, invoices: all, dryRun: true, deps: h.deps });
  assert.deepStrictEqual(dry.wouldSend, ['in_3', 'in_4']);
  assert.strictEqual(h.sends.length, 2);
  const back = await svc.sendInvoices({ client: paul, invoices: all, deps: h.deps });
  assert.deepStrictEqual(back.sent, ['in_3', 'in_4']);
  assert.strictEqual(h.sends[2].attachments.length, 2);
  assert.ok(/2 attached/.test(h.sends[2].text), h.sends[2].text);

  // 6. Staging never reaches a client.
  process.env.RENDER_GIT_BRANCH = 'staging';
  const hs = harness();
  const rs = await svc.sendInvoices({ client: paul, invoices: [invoice('in_9')], deps: hs.deps });
  assert.deepStrictEqual(rs.sent, ['in_9']);
  assert.strictEqual(hs.sends[0].to, 'guyralphwilson@gmail.com');
  assert.ok(hs.sends[0].subject.startsWith('[TEST - staging, would have gone to accounts@fortix.com.au]'));
  delete process.env.RENDER_GIT_BRANCH;

  console.log('invoice-email tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
