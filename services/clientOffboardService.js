// services/clientOffboardService.js
//
// Offboarding: switch off everything a departed client still has with us.
//
// A pause already locks a client out of the portal, the Claude connector, the
// extension, the updater and the Fathom poll (all check Status = Active). So
// offboarding is about the rest:
//   - stop the money: cancel a still-live Stripe subscription (immediately, no
//     proration - the same call Guy made by hand for Luke and Olivier)
//   - stop what bills US: delete their Unipile mailbox connection (Unipile
//     charges per connected account)
//   - stop holding their secrets: clear their Claude key, notetaker keys,
//     calendar token, portal token and machine report secret off the row
//   - switch off their assistants
// Their Airtable base (their leads) is kept. The Linked Helper machine, its
// licence and the VPS are listed for Guy - nothing here can reach them.
//
// Two doors, same function:
//   Guy says "offboard <name>"  -> scripts/offboard-client.js (dry run, then --go)
//   30 days after a card lapse with no restart -> runLapseOffboardSweep, run by
//     the nightly billing cron (routes/billingRoutes.js)
//
// Not reversible in one step: a client who comes back reconnects their mailbox
// and gets a fresh portal link. That's why a pause alone never triggers this.

const { createLogger } = require('../utils/contextLogger');

const defaultLogger = createLogger({ runId: 'OFFBOARD', clientId: 'SYSTEM', operation: 'client_offboard' });

const GUY_EMAIL = 'guyralphwilson@gmail.com';
const OWNER_ID = 'Guy-Wilson';
const LAPSE_GRACE_DAYS = 30;

// Row fields cleared on offboarding - every secret or live connection the row
// holds. Values are never logged or stored; only which ones were set.
const CLEARED_FIELDS = [
  ['Anthropic API Key', 'Claude key'],
  ['Managed Claude Key', 'Claude key on your account'],
  ['Unipile Account ID', 'mailbox + calendar connection'],
  ['Nylas Grant ID', 'old Nylas connection'],
  ['Calendar Provider Token', 'calendar token'],
  ['Portal Token', 'portal login'],
  ['Fathom API Key', 'Fathom key'],
  ['Granola API Key', 'Granola key'],
  ['Granola Webhook Secret', 'Granola webhook'],
  ['Fireflies API Key', 'Fireflies key'],
  ['Fireflies Webhook Secret', 'Fireflies webhook'],
  ['Machine Report Secret', 'Linked Helper machine reporting'],
  ['Wingguy Enabled', 'Wingguy switched on'],
];

const LIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

function masterBase() {
  const Airtable = require('airtable');
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  return Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
}

function stripeClient() {
  return require('../config/stripeClient').getStripeClient();
}

function money(cents) {
  const n = Number(cents || 0) / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function dateStr(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Brisbane' });
}

// ---------------------------------------------------------------------------
// The plan - everything read, nothing written
// ---------------------------------------------------------------------------

/**
 * Work out what offboarding this client would do. Read-only.
 * @returns {{ok: boolean, error?: string, client?, actions: Array, warnings: Array, manual: Array, recordFields: Object}}
 */
async function planOffboard(clientId) {
  const clientService = require('./clientService');
  const plan = { ok: false, actions: [], warnings: [], manual: [], recordFields: {} };
  if (!clientId) return { ...plan, error: 'no client id given' };
  if (clientId === OWNER_ID) return { ...plan, error: `${OWNER_ID} is the owner account - it can't be offboarded` };

  const client = await clientService.getClientById(clientId);
  if (!client) return { ...plan, error: `no client "${clientId}"` };
  plan.client = client;
  const name = client.clientName || clientId;

  // Raw row: every field we clear, including ones clientService doesn't map.
  const row = await masterBase()('Clients').find(client.id);
  const set = CLEARED_FIELDS.filter(([field]) => {
    const v = row.fields[field];
    return v !== undefined && v !== null && v !== '' && v !== false;
  });

  // 1. Status
  if (client.status === 'Active') {
    plan.actions.push({ kind: 'status', text: 'Switch their account to Paused (locks the portal, Claude connector and extension)' });
    plan.recordFields.Status = 'Paused';
  }

  // 2. Stripe
  if (client.stripeSubscriptionId) {
    try {
      const stripe = stripeClient();
      const sub = stripe ? await stripe.subscriptions.retrieve(client.stripeSubscriptionId) : null;
      if (sub && LIVE_SUB_STATUSES.includes(sub.status)) {
        const until = sub.trial_end && sub.status === 'trialing' ? ` - ⚠ it's in a free or prepaid period until ${dateStr(sub.trial_end)}, and cancelling ends that now` : '';
        const paused = sub.pause_collection ? ' (collection is already paused - no invoices are being charged)' : '';
        plan.actions.push({ kind: 'stripe', subscriptionId: sub.id, text: `Cancel their Stripe subscription now, no refund or proration (${sub.status})${paused}${until}` });
        if (until) plan.warnings.push(`Their subscription is ${sub.status} until ${dateStr(sub.trial_end)} - offboarding now cuts that short.`);
      }
    } catch (e) {
      plan.warnings.push(`Couldn't read their Stripe subscription (${e.message}) - check Stripe by hand.`);
    }
  }
  try {
    const stripe = stripeClient();
    if (stripe && client.stripeCustomerId) {
      const open = await stripe.invoices.list({ customer: client.stripeCustomerId, status: 'open', limit: 5 });
      open.data.forEach((inv) => plan.manual.push(`Void their unpaid ${money(inv.amount_due)} invoice ${inv.number || inv.id} in Stripe, so it doesn't sit there as money owed`));
    }
  } catch (_) { /* the plan still stands without it */ }

  // 3. Unipile - bills per connected account. Never delete one another row uses.
  if (client.unipileAccountId) {
    const all = await clientService.getAllClients();
    const sharers = all.filter((c) => c.clientId !== clientId && c.unipileAccountId === client.unipileAccountId);
    if (sharers.length) {
      plan.warnings.push(`Their Unipile connection is also on ${sharers.map((c) => c.clientId).join(', ')} - it will be unlinked from this row but NOT deleted.`);
    } else {
      plan.actions.push({ kind: 'unipile', accountId: client.unipileAccountId, text: 'Delete their mailbox + calendar connection in Unipile (stops the per-account charge)' });
    }
  }

  // 4. Secrets on the row
  if (set.length) {
    plan.actions.push({ kind: 'fields', fields: set.map(([f]) => f), text: `Clear from their record: ${set.map(([, label]) => label).join(', ')}` });
    set.forEach(([field]) => { plan.recordFields[field] = null; });
  }

  // 5. Assistants working in their account
  const assistants = (await clientService.getAllAssistants()).filter((a) => a.clientRecordId === client.id && a.status !== 'Off');
  if (assistants.length) {
    plan.actions.push({ kind: 'assistants', ids: assistants.map((a) => a.id), text: `Switch off ${assistants.length === 1 ? 'their assistant' : `their ${assistants.length} assistants`}: ${assistants.map((a) => a.name).join(', ')}` });
  }

  plan.manual.push(
    "Stop their Linked Helper campaigns, and cancel the Linked Helper licence and the machine (VPS) if you pay for them",
    `Their Airtable base (their leads) is kept - delete it in Airtable only if ${name} asks you to`
  );
  plan.ok = true;
  return plan;
}

function planText(plan) {
  const name = plan.client ? (plan.client.clientName || plan.client.clientId) : '?';
  if (!plan.ok) return `Can't offboard: ${plan.error}`;
  const lines = [`Offboarding ${name} would:`];
  if (!plan.actions.length) lines.push('- nothing - they have nothing switched on');
  plan.actions.forEach((a) => lines.push(`- ${a.text}`));
  if (plan.warnings.length) { lines.push('', 'Worth knowing:'); plan.warnings.forEach((w) => lines.push(`- ${w}`)); }
  lines.push('', 'Still yours to do by hand:');
  plan.manual.forEach((m) => lines.push(`- ${m}`));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------

async function deleteUnipileAccount(accountId) {
  const dsn = String(process.env.UNIPILE_DSN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!process.env.UNIPILE_API_KEY || !dsn) throw new Error('UNIPILE_API_KEY / UNIPILE_DSN not set');
  const res = await fetch(`https://${dsn}/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY, Accept: 'application/json' },
  });
  // Already gone counts as done.
  if (res.status === 404) return 'already gone';
  if (!res.ok) throw new Error(`Unipile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return 'deleted';
}

/**
 * Offboard a client. Each action runs on its own - one failing doesn't stop
 * the rest, and the summary says exactly what did and didn't happen.
 * @param {string} clientId
 * @param {{reason?: string, logger?}} opts
 */
async function runOffboard(clientId, { reason = 'Guy asked', logger = defaultLogger } = {}) {
  const plan = await planOffboard(clientId);
  if (!plan.ok) return { ok: false, error: plan.error, plan };
  const client = plan.client;
  const name = client.clientName || clientId;
  const done = [];
  const failed = [];

  for (const a of plan.actions) {
    try {
      if (a.kind === 'stripe') {
        await stripeClient().subscriptions.cancel(a.subscriptionId, { invoice_now: false, prorate: false });
        done.push('Stripe subscription cancelled');
      } else if (a.kind === 'unipile') {
        const r = await deleteUnipileAccount(a.accountId);
        done.push(`Unipile connection ${r}`);
      } else if (a.kind === 'assistants') {
        const base = masterBase();
        for (const id of a.ids) await base('Assistants').update(id, { Status: 'Off' }, { typecast: true });
        done.push(`${a.ids.length} assistant(s) switched off`);
      }
    } catch (e) {
      failed.push(`${a.text}: ${e.message}`);
      logger.error(`[offboard] ${clientId} ${a.kind} failed: ${e.message}`);
    }
  }

  // Row last, in one write: status + cleared secrets + a dated note.
  try {
    const row = await masterBase()('Clients').find(client.id);
    const today = new Date().toISOString().slice(0, 10);
    const note = `${today} - offboarded (${reason}). ${done.join('; ') || 'nothing external to switch off'}${failed.length ? `; FAILED: ${failed.length}` : ''}.`;
    const fields = { ...plan.recordFields, 'Coach Notes': [row.fields['Coach Notes'], note].filter(Boolean).join('\n') };
    await masterBase()('Clients').update(client.id, fields, { typecast: true });
    const cleared = plan.actions.find((a) => a.kind === 'fields');
    if (cleared) done.push(`Cleared from their record: ${cleared.fields.length} item(s)`);
    if (fields.Status) done.push('Status set to Paused');
    try { require('./clientService').clearCache(); } catch (_) {}
  } catch (e) {
    failed.push(`Updating their record: ${e.message}`);
    logger.error(`[offboard] ${clientId} record update failed: ${e.message}`);
  }

  await record(`offboard:${clientId}:${Date.now()}`, clientId, { reason, done, failed });
  const text = [
    `${name} is offboarded (${reason}).`,
    '',
    'Done:',
    ...(done.length ? done.map((d) => `- ${d}`) : ['- nothing needed switching off']),
    ...(failed.length ? ['', `FAILED - needs you (${failed.length}):`, ...failed.map((f) => `- ${f}`)] : []),
    ...(plan.warnings.length ? ['', 'Worth knowing:', ...plan.warnings.map((w) => `- ${w}`)] : []),
    '',
    'Still yours to do by hand:',
    ...plan.manual.map((m) => `- ${m}`),
    '',
    'If they ever come back: they reconnect their mailbox and get a fresh portal link.',
  ].join('\n');
  await emailGuy(`Offboarded: ${name}${failed.length ? ' (something needs you)' : ''}`, text, logger);
  logger.info(`[offboard] ${clientId}: ${done.length} done, ${failed.length} failed`);
  return { ok: failed.length === 0, done, failed, plan, summary: text };
}

async function record(eventKey, clientId, detail) {
  try {
    const pool = require('./recallWebhookDb').getPool();
    if (!pool) return;
    // Same ledger as the lapse chain (billingLapseService creates it).
    await require('./billingLapseService').ensureLedger();
    await pool.query(
      `INSERT INTO billing_lapse_events (event_key, client_id, kind, detail) VALUES ($1,$2,'offboarded',$3) ON CONFLICT (event_key) DO NOTHING`,
      [eventKey, clientId, JSON.stringify(detail)]
    );
  } catch (_) { /* the email is the record of last resort */ }
}

async function emailGuy(subject, text, logger) {
  try {
    const { sendTextEmail } = require('./gmailApiService');
    await sendTextEmail({ to: GUY_EMAIL, subject, text });
  } catch (e) {
    logger.error(`[offboard] Could not email Guy (${subject}): ${e && e.message}`);
  }
}

// ---------------------------------------------------------------------------
// The 30-day door: card lapsed, never restarted
// ---------------------------------------------------------------------------

/**
 * Clients whose card lapse paused them 30+ days ago, who are still Paused on
 * the same dead subscription, and haven't been offboarded since. Run nightly.
 */
async function runLapseOffboardSweep({ dryRun = false, logger = defaultLogger, now = Date.now() } = {}) {
  const pool = require('./recallWebhookDb').getPool();
  if (!pool) return { checked: 0, offboarded: [], note: 'no database' };
  await require('./billingLapseService').ensureLedger();
  const { rows } = await pool.query(
    `SELECT p.client_id, p.detail->>'subscription' AS subscription, p.created_at
       FROM billing_lapse_events p
      WHERE p.kind = 'paused_draft'
        AND p.created_at <= to_timestamp($1 / 1000.0) - make_interval(days => $2)
        AND NOT EXISTS (
          SELECT 1 FROM billing_lapse_events o
           WHERE o.kind = 'offboarded' AND o.client_id = p.client_id AND o.created_at > p.created_at)`,
    [now, LAPSE_GRACE_DAYS]
  );
  const clientService = require('./clientService');
  const offboarded = [];
  const skipped = [];
  for (const r of rows) {
    const client = await clientService.getClientById(r.client_id);
    // Restarted (new subscription on the row) or reactivated by hand: leave alone.
    if (!client || client.status !== 'Paused' || client.stripeSubscriptionId !== r.subscription) {
      skipped.push(`${r.client_id}: ${!client ? 'gone' : client.status !== 'Paused' ? `now ${client.status}` : 'restarted on a new subscription'}`);
      continue;
    }
    if (dryRun) { offboarded.push(`${r.client_id} (dry run)`); continue; }
    const res = await runOffboard(r.client_id, { reason: `card lapsed ${LAPSE_GRACE_DAYS}+ days ago with no restart`, logger });
    offboarded.push(`${r.client_id}${res.ok ? '' : ' (with failures)'}`);
  }
  return { checked: rows.length, offboarded, skipped };
}

module.exports = { planOffboard, planText, runOffboard, runLapseOffboardSweep, LAPSE_GRACE_DAYS };
