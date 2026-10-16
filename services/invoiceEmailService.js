// services/invoiceEmailService.js
//
// Emails each client's GST tax invoice PDF to their billing address, so a bookkeeper gets a
// proper tax invoice without anyone handing over the client's portal link (which opens all
// their leads). Paul Faix asked on 15 Oct 2026 for Fortix's invoices to go to
// accounts@fortix.com.au - that is the case this was built for.
//
// Stripe's own receipts carry no ABN or GST, so the document sent is the portal PDF
// (services/invoicePdfService.js), built from the same invoice data the portal download uses.
//
//   paid invoice (Stripe invoice.payment_succeeded, amount > 0)
//       -> PDF -> Mailgun to the Billing Email addresses (blank = Client Email Address)
//   backfill (POST /api/billing/invoice-email/send)
//       -> every paid invoice not yet sent, in one email
//
// Every invoice is claimed in a Postgres ledger (invoice_email_sends) before it is sent, so a
// replayed webhook never sends the same invoice twice. Each send is recorded in
// wingguy_comms_log (channel 'tax-invoice').
//
// On the staging server nothing reaches a client: every send goes to Guy instead, marked TEST,
// and its ledger keys are kept apart from production's.

const { createLogger } = require('../utils/contextLogger');

const defaultLogger = createLogger({ runId: 'INVOICE-EMAIL', clientId: 'SYSTEM', operation: 'invoice_email' });

const GUY_EMAIL = 'guyralphwilson@gmail.com';
const COACH_ID = 'Guy-Wilson';
const CHANNEL = 'tax-invoice';
const TZ = 'Australia/Brisbane';
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function isStagingServer() {
  return (process.env.ENVIRONMENT || '').toLowerCase() === 'staging'
    || (process.env.RENDER_GIT_BRANCH || '') === 'staging';
}

function envTag() {
  return isStagingServer() ? 'staging' : 'prod';
}

// ---------------------------------------------------------------------------
// Ledger (house pattern: shared pool, lazy schema, no-op without a DB)
// ---------------------------------------------------------------------------

let schemaReady = false;

async function withDb(fn) {
  const pool = require('./recallWebhookDb').getPool();
  if (!pool) return null;
  const db = await pool.connect();
  try {
    if (!schemaReady) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS invoice_email_sends (
          send_key TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          client_id TEXT,
          recipients TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      schemaReady = true;
    }
    return await fn(db);
  } finally {
    db.release();
  }
}

function sendKey(invoiceId) {
  return `${envTag()}:${invoiceId}`;
}

/** Claim an invoice. true = not sent before (go ahead), false = already sent. */
async function claim(invoiceId, clientId, recipients) {
  const res = await withDb((db) => db.query(
    `INSERT INTO invoice_email_sends (send_key, invoice_id, client_id, recipients)
     VALUES ($1,$2,$3,$4) ON CONFLICT (send_key) DO NOTHING RETURNING send_key`,
    [sendKey(invoiceId), invoiceId, clientId || null, recipients.join(', ')]
  ));
  if (!res) return true; // no ledger: send, accepting a replay could repeat
  return res.rows.length > 0;
}

async function release(invoiceId) {
  await withDb((db) => db.query('DELETE FROM invoice_email_sends WHERE send_key=$1', [sendKey(invoiceId)]));
}

async function alreadySent(invoiceIds) {
  if (!invoiceIds.length) return new Set();
  const res = await withDb((db) => db.query(
    'SELECT invoice_id FROM invoice_email_sends WHERE send_key = ANY($1)',
    [invoiceIds.map(sendKey)]
  ));
  return new Set(res ? res.rows.map((r) => r.invoice_id) : []);
}

// ---------------------------------------------------------------------------
// Who it goes to
// ---------------------------------------------------------------------------

/** "a@x.com, b@y.com" -> ['a@x.com', 'b@y.com'] (lower-cased, de-duplicated, junk dropped). */
function parseAddresses(raw) {
  const out = [];
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const e = part.trim().replace(/^<|>$/g, '').toLowerCase();
    if (e && EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Billing Email, else Client Email Address, else the email Stripe has on the invoice. */
function billingRecipients(client, invoice) {
  const fromBilling = parseAddresses(client && client.billingEmail);
  if (fromBilling.length) return { recipients: fromBilling, source: 'Billing Email' };
  const fromClient = parseAddresses(client && client.clientEmailAddress);
  if (fromClient.length) return { recipients: fromClient, source: 'Client Email Address' };
  const fromStripe = parseAddresses(invoice && invoice.customer_email);
  if (fromStripe.length) return { recipients: fromStripe, source: 'Stripe customer email' };
  return { recipients: [], source: 'none' };
}

// ---------------------------------------------------------------------------
// The email (Guy's voice)
// ---------------------------------------------------------------------------

function firstNameFor(client, invoice) {
  let first = (client && client.clientFirstName) || String((invoice && invoice.customer_name) || '').trim().split(/\s+/)[0];
  // A First Name filled with the Client ID ("Paul-Faix", seen 16 Oct 2026) must not reach the greeting.
  if (client && first && first === client.clientId) first = first.split('-')[0];
  return first || 'there';
}

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

function paidDate(invoice) {
  const t = (invoice.status_transitions && invoice.status_transitions.paid_at) || invoice.created;
  return new Date(t * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
}

function monthOf(invoice) {
  return new Date(invoice.created * 1000).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: TZ });
}

function buildInvoiceEmail({ client, invoices }) {
  const name = firstNameFor(client, invoices[0]);
  let subject;
  let body;
  if (invoices.length === 1) {
    const inv = invoices[0];
    subject = `Tax invoice - ${monthOf(inv)} - I Know a Guy`;
    body = [
      `Hi ${name},`,
      '',
      `Your tax invoice for ${monthOf(inv)} is attached - ${money(inv.amount_paid)}, paid ${paidDate(inv)}.`,
      '',
      `These come to this address by themselves each month. If they should go somewhere else, just reply and tell me.`,
      '',
      'Guy',
    ];
  } else {
    subject = `Your tax invoices - I Know a Guy`;
    body = [
      `Hi ${name},`,
      '',
      `Here are your tax invoices so far - ${invoices.length} attached, one for each payment.`,
      '',
      `From here on each month's invoice comes to this address by itself. If it should go somewhere else, just reply and tell me.`,
      '',
      'Guy',
    ];
  }
  const text = body.join('\n');
  const html = body.map((l) => (l ? `<p style="margin:0 0 12px">${escapeHtml(l)}</p>` : '')).join('');
  return { subject, text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${html}</div>` };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function replyToAddress(deps) {
  try {
    const getClientById = deps.getClientById || require('./clientService').getClientById;
    const guy = await getClientById(COACH_ID);
    const e = parseAddresses(guy && guy.clientEmailAddress)[0];
    if (e) return e;
  } catch (_) { /* fall through */ }
  return process.env.ALERT_EMAIL || GUY_EMAIL;
}

function retrieveInvoice(invoiceId) {
  const { stripe } = require('../config/stripeClient');
  return stripe.invoices.retrieve(invoiceId, { expand: ['customer', 'lines.data'] });
}

/**
 * Email one or more invoices (all for the same client) in a single message. Claims each
 * invoice first; any already claimed is dropped unless force. Returns what happened.
 */
async function sendInvoices({ client, invoices, force = false, dryRun = false, deps = {}, logger = defaultLogger }) {
  const { recipients, source } = billingRecipients(client, invoices[0]);
  const result = { clientId: client ? client.clientId : null, recipients, source, sent: [], skipped: [] };
  if (!recipients.length) {
    result.error = 'no email address for this client';
    return result;
  }

  let toSend = invoices;
  if (!force) {
    const done = await (deps.alreadySent || alreadySent)(invoices.map((i) => i.id));
    toSend = invoices.filter((i) => !done.has(i.id));
    result.skipped = invoices.filter((i) => done.has(i.id)).map((i) => i.id);
  }
  if (!toSend.length) return result;
  if (dryRun) {
    result.wouldSend = toSend.map((i) => i.id);
    result.email = buildInvoiceEmail({ client, invoices: toSend });
    return result;
  }

  const claimed = [];
  for (const inv of toSend) {
    if (force || await (deps.claim || claim)(inv.id, result.clientId, recipients)) claimed.push(inv);
    else result.skipped.push(inv.id);
  }
  if (!claimed.length) return result;

  try {
    const { generateInvoicePdf, invoicePdfData } = require('./invoicePdfService');
    const attachments = [];
    for (const inv of claimed) {
      const { pdfData, filename } = invoicePdfData(inv);
      attachments.push({ filename, content: await (deps.generateInvoicePdf || generateInvoicePdf)(pdfData), contentType: 'application/pdf' });
    }
    const email = buildInvoiceEmail({ client, invoices: claimed });
    const replyTo = await replyToAddress(deps);
    let to = recipients;
    let { subject, text, html } = email;
    // Staging: Guy's own addresses may receive for real (that's how a several-address list is
    // proven end to end); anything else goes to Guy instead.
    const guyOwn = parseAddresses(process.env.STAGING_EMAIL_ALLOW || `${GUY_EMAIL}, guy@wilsoar.com`);
    if (isStagingServer() && recipients.every((r) => guyOwn.includes(r))) {
      subject = `[TEST - staging] ${subject}`;
    } else if (isStagingServer()) {
      to = [process.env.ALERT_EMAIL || GUY_EMAIL];
      subject = `[TEST - staging, would have gone to ${recipients.join(', ')}] ${subject}`;
      text = `THIS IS A TEST from the staging server - no client was emailed.\n\n${text}`;
      html = `<p><b>THIS IS A TEST from the staging server - no client was emailed.</b></p>${html}`;
    }
    const addr = String(process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`).trim();
    const send = deps.send || require('./emailNotificationService').sendMailgunEmailWithAttachments;
    const sent = await send({
      from: addr.includes('<') ? addr : `Guy Wilson <${addr}>`,
      to: to.join(', '),
      'h:Reply-To': replyTo,
      subject, text, html,
      attachments,
    });
    result.sent = claimed.map((i) => i.id);
    result.subject = subject;
    result.mailgunId = sent && sent.id;
    logger.info(`[invoice-email] ${result.clientId || 'unmatched'}: ${result.sent.join(', ')} -> ${to.join(', ')}`);

    const record = deps.recordComm || require('./commsLog').recordComm;
    await record({
      coachClientId: result.clientId || `stripe:${invoiceCustomerId(claimed[0])}`,
      channel: CHANNEL,
      recipient: to.join(', '),
      subject,
      summary: `Tax invoice${claimed.length > 1 ? 's' : ''} ${claimed.map((i) => i.number || i.id).join(', ')} emailed (${source})`,
      meta: { invoices: result.sent, staging: isStagingServer(), mailgunId: result.mailgunId },
    });
  } catch (e) {
    for (const inv of claimed) await (deps.release || release)(inv.id).catch(() => {});
    result.sent = [];
    result.error = e.message;
    logger.error(`[invoice-email] ${result.clientId || 'unmatched'}: send failed - ${e.message}`);
  }
  return result;
}

function invoiceCustomerId(invoice) {
  return typeof invoice.customer === 'object' && invoice.customer ? invoice.customer.id : invoice.customer;
}

/**
 * Webhook entry: a Stripe invoice was paid. $0 invoices (trials, fully credited months) are
 * not tax invoices worth sending and are skipped.
 */
async function onInvoicePaid({ invoice, deps = {}, logger = defaultLogger }) {
  if (!invoice || !invoice.id) return { skipped: 'no invoice' };
  if (!(invoice.amount_paid > 0)) return { skipped: `amount paid ${invoice.amount_paid || 0}` };
  const full = await (deps.retrieveInvoice || retrieveInvoice)(invoice.id);
  const findClient = deps.findClientForCustomer || require('./stripeEntitlementShadow').findClientForCustomer;
  const client = await findClient(invoiceCustomerId(full), full.customer_email);
  return sendInvoices({ client, invoices: [full], deps, logger });
}

/**
 * Backfill / resend for one client: every paid invoice on their Stripe customer (or just the
 * ids given), not yet sent, in one email. force resends ones already sent.
 */
async function sendForClient({ clientId, invoiceIds, force = false, dryRun = false, deps = {}, logger = defaultLogger }) {
  const getClientById = deps.getClientById || require('./clientService').getClientById;
  const client = await getClientById(clientId);
  if (!client) return { error: `no client ${clientId}` };
  let invoices;
  if (invoiceIds && invoiceIds.length) {
    invoices = [];
    for (const id of invoiceIds) invoices.push(await (deps.retrieveInvoice || retrieveInvoice)(id));
    const bad = invoices.find((i) => client.stripeCustomerId && invoiceCustomerId(i) !== client.stripeCustomerId);
    if (bad) return { error: `${bad.id} belongs to another Stripe customer` };
  } else {
    if (!client.stripeCustomerId) return { error: `${clientId} has no Stripe Customer ID` };
    const { stripe } = require('../config/stripeClient');
    const list = await stripe.invoices.list({ customer: client.stripeCustomerId, status: 'paid', limit: 100, expand: ['data.customer'] });
    invoices = list.data;
  }
  invoices = invoices.filter((i) => i.status === 'paid' && i.amount_paid > 0).sort((a, b) => a.created - b.created);
  if (!invoices.length) return { clientId, error: 'no paid invoices' };
  return sendInvoices({ client, invoices, force, dryRun, deps, logger });
}

// ---------------------------------------------------------------------------
// The portal field (Settings > Billing & Invoices): the client picks where invoices go
// ---------------------------------------------------------------------------

/**
 * Check what a client typed into "Where should we send your monthly tax invoices?".
 * Blank is allowed (= their login email, resolved at send time). Otherwise every comma-separated
 * address must look like an email AND its domain must accept mail (the Ayaan run-on guard,
 * utils/emailDeliverable.js). Returns { ok, value } with value normalised to "a@x.com, b@y.com",
 * or { ok: false, error } naming the address that failed.
 */
async function validateBillingEmailInput(raw, deps = {}) {
  const parts = String(raw || '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { ok: true, value: '' };
  const emails = [];
  for (const p of parts) {
    const e = p.toLowerCase();
    if (!EMAIL_RE.test(e)) return { ok: false, error: `"${p}" doesn't look like an email address.` };
    if (!emails.includes(e)) emails.push(e);
  }
  if (emails.length > 5) return { ok: false, error: 'Up to five addresses, please.' };
  const check = deps.undeliverableAddresses || require('../utils/emailDeliverable').undeliverableAddresses;
  const bad = await check(emails);
  if (bad.length) return { ok: false, error: `${bad[0].email} can't receive email - check the part after the @.` };
  return { ok: true, value: emails.join(', ') };
}

/** The last tax invoice emailed for this client on this server: { at, recipients } or null. */
async function lastSentFor(clientId) {
  if (!clientId) return null;
  const res = await withDb((db) => db.query(
    `SELECT created_at, recipients FROM invoice_email_sends
     WHERE client_id = $1 AND send_key LIKE $2 ORDER BY created_at DESC LIMIT 1`,
    [clientId, `${envTag()}:%`]
  ));
  const row = res && res.rows[0];
  return row ? { at: row.created_at, recipients: row.recipients } : null;
}

module.exports = {
  validateBillingEmailInput,
  lastSentFor,
  onInvoicePaid,
  sendForClient,
  sendInvoices,
  buildInvoiceEmail,
  billingRecipients,
  parseAddresses,
  isStagingServer,
};
