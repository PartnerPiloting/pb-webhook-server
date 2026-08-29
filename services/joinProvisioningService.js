// services/joinProvisioningService.js
//
// Stage 4 of the Stripe cutover: a paid join from the knowaguy /join page
// drives the WHOLE provisioning chain, with a Postgres ledger so any failed
// step can resume from where it stopped - the customer never sees a failure.
//
// Steps, in order (each idempotent, each recorded on the job):
//   create_row      master Clients row (name from checkout's own questions)
//   send_ack        immediate acknowledgement email to the joiner, as Guy
//   create_base     "My Leads - <name>" built from the version-controlled schema
//   validate_base   structural check of the new base
//   finish_row      base id + standard tier defaults onto the row
//   mint_token      portal token + login URL
//   create_tasks    coaching task templates
//   draft_welcome   welcome email (login + first steps) into Guy's Gmail Drafts
//   activate        Status -> Active (the 24-hour promise, met)
//   notify_guy      "fully provisioned" summary to Guy
//
// A returning payer (row already exists by customer id or email) short-
// circuits: capture the subscription id, mark the job skipped, tell Guy.
//
// Env: JOIN_PROVISION_WORKSPACE_ID (Airtable workspace for new bases),
// JOIN_PROVISION_DISABLED=1 stops the auto-run (jobs still enqueue).
// Everything else rides on env the callers already require.

const crypto = require('crypto');
const { createLogger } = require('../utils/contextLogger');

const defaultLogger = createLogger({ runId: 'JOIN', clientId: 'SYSTEM', operation: 'join_provisioning' });

const PORTAL_BASE_URL = 'https://pb-webhook-server.vercel.app';
const GUY_EMAIL = 'guyralphwilson@gmail.com';
const COACH_ID = 'Guy-Wilson';

// ---------------------------------------------------------------------------
// Ledger plumbing (house pattern: shared pool, lazy schema, no-op without DB)
// ---------------------------------------------------------------------------

let schemaReady = false;
function getPool() {
  return require('./recallWebhookDb').getPool();
}

async function ensureSchema(client) {
  if (schemaReady) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS join_provision_jobs (
      id SERIAL PRIMARY KEY,
      checkout_session_id TEXT UNIQUE NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      current_step TEXT,
      steps JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL,
      client_record_id TEXT,
      client_id TEXT,
      base_id TEXT,
      portal_url TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaReady = true;
}

async function withDb(fn) {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

async function saveJob(job) {
  await withDb((db) => db.query(
    `UPDATE join_provision_jobs SET state=$2, current_step=$3, steps=$4, client_record_id=$5,
     client_id=$6, base_id=$7, portal_url=$8, error=$9, updated_at=now() WHERE id=$1`,
    [job.id, job.state, job.current_step, JSON.stringify(job.steps), job.client_record_id,
      job.client_id, job.base_id, job.portal_url, job.error]
  ));
}

async function loadJob(id) {
  const res = await withDb((db) => db.query('SELECT * FROM join_provision_jobs WHERE id=$1', [id]));
  return res && res.rows[0] ? res.rows[0] : null;
}

// ---------------------------------------------------------------------------
// Payload from the checkout session
// ---------------------------------------------------------------------------

function payloadFromSession(session) {
  const custom = Array.isArray(session.custom_fields) ? session.custom_fields : [];
  const fieldVal = (key) => {
    const f = custom.find((c) => c && c.key === key);
    return (f && f.text && f.text.value) ? String(f.text.value).trim() : '';
  };
  let firstName = fieldVal('first_name');
  let lastName = fieldVal('last_name');
  if (!firstName && !lastName) {
    // Sessions from before the name questions existed: billing name.
    const parts = String((session.customer_details && session.customer_details.name) || '').trim().split(/\s+/).filter(Boolean);
    firstName = parts.shift() || '';
    lastName = parts.join(' ');
  }
  return {
    email: ((session.customer_details && session.customer_details.email) || session.customer_email || '').trim(),
    firstName,
    lastName,
    customerId: session.customer ? String(session.customer) : '',
    subscriptionId: session.subscription ? String(session.subscription) : '',
    referrer: (session.metadata && session.metadata.referrer) || '',
  };
}

// ---------------------------------------------------------------------------
// Enqueue + kick
// ---------------------------------------------------------------------------

/**
 * Called by the Stripe webhook on checkout.session.completed. Inserts the job
 * (idempotent on session id) and kicks the runner out-of-band so the webhook
 * answers Stripe immediately. Without a database this degrades to running the
 * chain best-effort with an in-memory job (no resume).
 */
async function enqueueFromSession(session, logger = defaultLogger) {
  const payload = payloadFromSession(session);
  const inserted = await withDb((db) => db.query(
    `INSERT INTO join_provision_jobs (checkout_session_id, payload)
     VALUES ($1, $2) ON CONFLICT (checkout_session_id) DO NOTHING RETURNING id`,
    [session.id, JSON.stringify(payload)]
  ));

  let jobId = inserted && inserted.rows[0] && inserted.rows[0].id;
  if (!jobId) {
    if (inserted) {
      // Replayed webhook for a job we already hold - let the runner decide
      // whether anything is left to do.
      const existing = await withDb((db) => db.query(
        'SELECT id, state FROM join_provision_jobs WHERE checkout_session_id=$1', [session.id]
      ));
      const row = existing && existing.rows[0];
      if (!row || row.state === 'done' || row.state === 'skipped') {
        logger.info(`[join] Session ${session.id} already provisioned (${row ? row.state : 'gone'}) - nothing to do`);
        return null;
      }
      jobId = row.id;
    } else {
      logger.warn('[join] No DATABASE_URL - running provisioning without a ledger (no resume)');
      setImmediate(() => runChain({ id: null, state: 'running', steps: {}, payload }, logger)
        .catch((e) => logger.error(`[join] Ledgerless run failed: ${e && e.message}`)));
      return null;
    }
  }

  if (process.env.JOIN_PROVISION_DISABLED === '1') {
    logger.info(`[join] Job ${jobId} enqueued; auto-run disabled (JOIN_PROVISION_DISABLED=1)`);
    return jobId;
  }
  setImmediate(() => runJob(jobId, logger).catch((e) => logger.error(`[join] Job ${jobId} run crashed: ${e && e.message}`)));
  return jobId;
}

async function runJob(jobId, logger = defaultLogger) {
  const row = await loadJob(jobId);
  if (!row) { logger.error(`[join] Job ${jobId} not found`); return null; }
  if (row.state === 'done' || row.state === 'skipped') return row;
  const job = {
    id: row.id,
    state: 'running',
    current_step: row.current_step,
    steps: row.steps || {},
    payload: row.payload,
    client_record_id: row.client_record_id,
    client_id: row.client_id,
    base_id: row.base_id,
    portal_url: row.portal_url,
    error: null,
  };
  return runChain(job, logger);
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

const STEPS = [
  ['create_row', stepCreateRow],
  ['send_ack', stepSendAck],
  ['create_base', stepCreateBase],
  ['validate_base', stepValidateBase],
  ['finish_row', stepFinishRow],
  ['mint_token', stepMintToken],
  // Active the moment their login exists - the welcome draft is for Guy's
  // convenience and must never hold the client's access hostage.
  ['activate', stepActivate],
  ['create_tasks', stepCreateTasks],
  ['draft_welcome', stepDraftWelcome],
  ['notify_guy', stepNotifyGuy],
];

async function runChain(job, logger) {
  for (const [name, fn] of STEPS) {
    if (job.steps[name] && job.steps[name].status === 'done') continue;
    job.current_step = name;
    try {
      logger.info(`[join] Job ${job.id || '(no ledger)'} step ${name}...`);
      const output = await fn(job, logger);
      if (output && output.shortCircuit) {
        job.steps[name] = { status: 'done', at: new Date().toISOString(), output };
        job.state = 'skipped';
        if (job.id) await saveJob(job);
        logger.info(`[join] Job ${job.id || ''} short-circuited at ${name}: ${output.reason}`);
        return job;
      }
      job.steps[name] = { status: 'done', at: new Date().toISOString(), output: output || {} };
      if (job.id) await saveJob(job);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      job.steps[name] = { status: 'failed', at: new Date().toISOString(), error: msg };
      job.state = 'failed';
      job.error = `${name}: ${msg}`;
      if (job.id) await saveJob(job);
      logger.error(`[join] Job ${job.id || ''} FAILED at ${name}: ${msg}`);
      await alertGuyOfFailure(job, name, msg, logger);
      return job;
    }
  }
  job.state = 'done';
  job.current_step = null;
  job.error = null;
  if (job.id) await saveJob(job);
  logger.info(`[join] Job ${job.id || ''} complete - ${job.client_id} fully provisioned`);
  return job;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function masterBase() {
  const Airtable = require('airtable');
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  return Airtable.base(process.env.MASTER_CLIENTS_BASE_ID);
}

async function stepCreateRow(job, logger) {
  const p = job.payload;
  const shadow = require('./stripeEntitlementShadow');
  const fullName = `${p.firstName} ${p.lastName}`.trim() || p.email;

  const existing = await shadow.findClientForCustomer(p.customerId, p.email);
  if (existing) {
    if (p.subscriptionId) await shadow.captureSubscriptionId(existing, p.subscriptionId);
    await alertGuy(
      `Join payment from an EXISTING client: ${fullName}`,
      `${fullName} <${p.email}> paid on the join page but already has a Clients row (${existing.clientId || existing.id}). ` +
      'Subscription id captured; no provisioning run. Worth a look - this may be a rejoin or a duplicate payment.',
      logger
    );
    return { shortCircuit: true, reason: 'existing client', existingClientId: existing.clientId || existing.id };
  }

  const base = masterBase();
  const slugBase = fullName.replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/\s+/g, '-') || 'New-Member';
  let clientId = slugBase;
  for (let n = 2; n <= 9; n++) {
    const clash = await base('Clients').select({
      filterByFormula: `{Client ID} = "${clientId}"`, maxRecords: 1,
    }).firstPage();
    if (!clash.length) break;
    clientId = `${slugBase}-${n}`;
  }

  const record = {
    'Client ID': clientId,
    'Client Name': fullName,
    'Client First Name': p.firstName || fullName.split(' ')[0],
    'Client Email Address': p.email,
    'Status': 'Paused',
    // Manual + stripe from birth: keeps the PMPro sync's no-WP-ID
    // force-pause off them, and names their billing caretaker.
    'Status Management': 'Manual',
    'Billing Source': 'stripe',
    'Coach Notes': `Joined via knowaguy /join${p.referrer ? ` (ref: ${p.referrer})` : ''} - provisioning in progress`,
  };
  if (p.customerId) record['Stripe Customer ID'] = p.customerId;
  if (p.subscriptionId) record['Stripe Subscription ID'] = p.subscriptionId;

  const created = await base('Clients').create(record, { typecast: true });
  job.client_record_id = created.id;
  job.client_id = clientId;
  return { recordId: created.id, clientId };
}

async function stepSendAck(job) {
  const p = job.payload;
  const { sendTextEmail } = require('./gmailApiService');
  const first = p.firstName || 'there';
  const text = [
    `Hi ${first},`,
    '',
    "Payment's done - your receipt from Stripe is on its way separately.",
    '',
    "Here's what happens next: your workspace is being built right now, and you'll soon get a welcome email from me with your own login and your first set-up steps - each takes minutes.",
    '',
    "Nothing else is needed from you right now. If anything looks odd - no receipt, no welcome email by tomorrow - just reply to this email and I'll sort it.",
    '',
    'Guy',
  ].join('\n');
  const sent = await sendTextEmail({ to: p.email, subject: "You're in - welcome aboard", text });
  const { recordComm } = require('./commsLog');
  await recordComm({
    coachClientId: job.client_id || COACH_ID,
    channel: 'join-ack',
    recipient: p.email,
    subject: "You're in - welcome aboard",
    summary: 'Automatic joining acknowledgement (payment received, welcome email to follow)',
    meta: { gmailId: sent && sent.id, jobId: job.id },
  });
  return { gmailId: sent && sent.id };
}

async function stepCreateBase(job) {
  const workspaceId = (process.env.JOIN_PROVISION_WORKSPACE_ID || '').trim();
  if (!workspaceId) throw new Error('JOIN_PROVISION_WORKSPACE_ID not set - cannot create the client base');
  const { createClientBase } = require('./clientBaseBuilder');
  const fullName = `${job.payload.firstName} ${job.payload.lastName}`.trim() || job.client_id;
  const result = await createClientBase({ clientName: fullName, workspaceId });
  if (!result.ok) throw new Error(result.error);
  job.base_id = result.baseId;
  return { baseId: result.baseId, manualSteps: result.manualSteps, seedWarnings: result.seedWarnings };
}

async function stepValidateBase(job) {
  // Validate against the schema the base was built from. (The older
  // validateBaseStructure in scripts/onboard-new-client.js expects the
  // template-duplication era's extra tables - LinkedIn Posts, Connections -
  // which config/clientBaseSchema.json deliberately dropped.)
  const schema = require('../config/clientBaseSchema.json');
  const Airtable = require('airtable');
  Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
  const base = Airtable.base(job.base_id);
  const errors = [];
  for (const t of schema.tables) {
    try {
      await base(t.name).select({ maxRecords: 1 }).firstPage();
    } catch (e) {
      errors.push(`Table "${t.name}" not reachable: ${e && e.message}`);
    }
  }
  if (errors.length) throw new Error(`Base ${job.base_id} failed validation: ${errors.join('; ')}`);
  return { tablesChecked: schema.tables.map((t) => t.name) };
}

async function stepFinishRow(job) {
  const base = masterBase();
  await base('Clients').update(job.client_record_id, {
    'Airtable Base ID': job.base_id,
    // Same defaults the onboarding door writes - verified field-for-field
    // against Paul Salvage's row (the first Stripe-era client).
    'Service Level': '1-Lead Scoring',
    'Profile Scoring Token Limit': 6000,
    'Post Scoring Token Limit': 3000,
    'Posts Daily Target': 10,
    'Leads Batch Size for Post Collection': 10,
    'Max Post Batches Per Day Guardrail': 3,
    'Post Scrape Batch Size': 10,
    'Processing Stream': 1,
    'Wingguy Enabled': 'Yes',
    'Thanks for Connecting': 'Yes',
    'Followup Brief': 'Yes',
    'Coach': COACH_ID,
    'Coaching Status': 'Active',
    'Timezone': 'Australia/Brisbane',
  }, { typecast: true });
  return { baseLinked: job.base_id };
}

async function stepMintToken(job) {
  const base = masterBase();
  // Idempotent: never overwrite a token that already exists on the row.
  const row = await base('Clients').find(job.client_record_id);
  let token = row.fields['Portal Token'];
  if (!token) {
    token = crypto.randomBytes(18).toString('base64url');
    await base('Clients').update(job.client_record_id, { 'Portal Token': token });
  }
  job.portal_url = `${PORTAL_BASE_URL}/?token=${token}`;
  return { portalUrl: job.portal_url };
}

async function stepCreateTasks(job) {
  const clientService = require('./clientService');
  const fullName = `${job.payload.firstName} ${job.payload.lastName}`.trim() || job.client_id;
  const created = await clientService.createClientTasksFromTemplates(job.client_record_id, fullName);
  return { tasksCreated: Array.isArray(created) ? created.length : created };
}

async function stepDraftWelcome(job) {
  const p = job.payload;
  const clientService = require('./clientService');
  const mailProvider = require('./mailProvider');
  const coach = await clientService.getClientById(COACH_ID);
  if (!coach || !mailProvider.hasMailbox(coach)) {
    throw new Error(`No mailbox available for ${COACH_ID} - cannot place the welcome draft`);
  }
  const first = p.firstName || 'there';
  const html = [
    `<p>Hi ${first},</p>`,
    "<p>Welcome aboard - everything's built and ready for you.</p>",
    `<p>Your own login: <a href="${job.portal_url}">${job.portal_url}</a><br>`,
    "Keep that link safe - it's your key to everything.</p>",
    '<p>Three small things before we first sit down - each takes minutes:</p>',
    '<ol>',
    '<li>Open the link above and have a look around.</li>',
    '<li>Hit reply with a couple of times this week that suit you for your first session.</li>',
    '<li>If you use a password manager, save the login link in it now.</li>',
    '</ol>',
    '<p>Then we book your first session and the building starts.</p>',
    '<p>Guy</p>',
  ].join('\n');
  const res = await mailProvider.createDraft(coach, {
    subject: 'Welcome aboard - your login and first steps',
    html,
    to: [{ email: p.email, name: `${p.firstName} ${p.lastName}`.trim() }],
  });
  if (!res.ok) throw new Error(`Draft creation failed (${res.provider}): ${res.error}`);
  const { recordComm } = require('./commsLog');
  await recordComm({
    coachClientId: job.client_id || COACH_ID,
    channel: 'join-welcome-draft',
    recipient: p.email,
    subject: 'Welcome aboard - your login and first steps',
    summary: "Welcome email drafted into Guy's mailbox for review (not yet sent)",
    meta: { draftId: res.draftId, provider: res.provider, jobId: job.id },
  });
  return { draftId: res.draftId, provider: res.provider };
}

async function stepActivate(job) {
  const base = masterBase();
  await base('Clients').update(job.client_record_id, { Status: 'Active' }, { typecast: true });
  return { status: 'Active' };
}

async function stepNotifyGuy(job, logger) {
  const p = job.payload;
  const fullName = `${p.firstName} ${p.lastName}`.trim() || p.email;
  const baseStep = (job.steps.create_base && job.steps.create_base.output) || {};
  const extras = [];
  (baseStep.manualSteps || []).forEach((m) => extras.push(`MANUAL: ${m}`));
  (baseStep.seedWarnings || []).forEach((w) => extras.push(`SEED WARNING: ${w}`));
  const valWarnings = ((job.steps.validate_base && job.steps.validate_base.output) || {}).warnings || [];
  valWarnings.forEach((w) => extras.push(`VALIDATION: ${w}`));
  const text = [
    `${fullName} <${p.email}> is fully provisioned.`,
    '',
    `Client ID: ${job.client_id}`,
    `Base: ${job.base_id}`,
    `Portal: ${job.portal_url}`,
    p.referrer ? `Referred by: ${p.referrer}` : null,
    '',
    'Their acknowledgement email went out automatically. The WELCOME EMAIL is sitting in your drafts - read it, tweak it, send it. Booking the first session happens from their reply.',
    '',
    'Service Level starts at 1-Lead Scoring - adjust it on the row if this client is a different tier.',
    extras.length ? `\nNeeds a human (${extras.length}):\n- ${extras.join('\n- ')}` : null,
  ].filter((l) => l !== null).join('\n');
  await alertGuy(`Provisioned: ${fullName} (${job.client_id})`, text, logger);
  return { notified: true };
}

// ---------------------------------------------------------------------------
// Guy alerts (Gmail lane - same identity as the acknowledgement)
// ---------------------------------------------------------------------------

async function alertGuy(subject, text, logger = defaultLogger) {
  try {
    const { sendTextEmail } = require('./gmailApiService');
    await sendTextEmail({ to: GUY_EMAIL, subject, text });
  } catch (e) {
    logger.error(`[join] Could not email Guy (${subject}): ${e && e.message}`);
  }
}

async function alertGuyOfFailure(job, stepName, message, logger) {
  const p = job.payload || {};
  await alertGuy(
    `⚠ Join provisioning stopped: ${p.firstName || ''} ${p.lastName || ''}`.trim(),
    [
      `Provisioning for ${p.email} stopped at step "${stepName}".`,
      '',
      `Error: ${message}`,
      '',
      `Everything before that step is done and recorded (job ${job.id || 'no-ledger'}).`,
      'Fix the cause, then retry from the failed step:',
      `curl -X POST -H "x-debug-key: <key>" https://pb-webhook-server.onrender.com/api/join-provision/jobs/${job.id}/retry`,
      '',
      'The customer has not been shown any failure.',
    ].join('\n'),
    logger
  );
}

// ---------------------------------------------------------------------------
// Admin doors
// ---------------------------------------------------------------------------

async function listJobs(limit = 20) {
  const res = await withDb((db) => db.query(
    'SELECT id, checkout_session_id, state, current_step, client_id, base_id, error, created_at, updated_at FROM join_provision_jobs ORDER BY id DESC LIMIT $1',
    [Math.min(Number(limit) || 20, 100)]
  ));
  return res ? res.rows : [];
}

async function getJob(id) {
  return loadJob(id);
}

module.exports = { enqueueFromSession, runJob, listJobs, getJob };
