// services/linkedinCollect.js
// Reconnect (docs/RECONNECT-BUILD-PLAN.md, "The client process", step 2): collect each connected
// client's LinkedIn history BY ITSELF, a day at a time, and tell Guy where each client is up to.
//
// How Unipile fills an inbox (Pierre, Unipile support, 5 Oct 2026): at most 3,000 conversations per
// 24 hours, newest first, continuing by itself every day until the history is complete. So this
// runs once a day and, for every client with a LinkedIn connection on file, takes Wingguy's own
// copy of whatever has arrived (services/linkedinNetworkSync.js - it only ever adds).
//
// Nobody waits for the whole history (Guy, 5 Oct 2026). The states, in order:
//   waiting    - connected, nothing has arrived yet
//   ready      - the first batch is in: the client can have their session   -> EMAIL to Guy, and
//                the client gets the self-setup steps, coach copied (buildClientReadyEmail)
//   collecting - older history is still arriving each day
//   complete   - nothing new for two days running                           -> EMAIL to Guy
//   stalled    - connected more than a day ago and still nothing            -> EMAIL to Guy
// "complete" is judged by the count standing still, so the email says exactly that and gives the
// numbers - a stall part-way looks the same from here, and Guy can tell which it is. Unipile's
// SYNC_SUCCESS webhook should replace this guess once its behaviour is confirmed.
//
// THE MONTH ENDS BY ITSELF (Guy, 5 Oct 2026). A client's LinkedIn connection is for one month - each
// one is a charge to Guy every month it stays. Five days before the month is up Guy is emailed; on
// the day, after one last collect and top-up, the connection is switched off at Unipile and taken
// off the client's record, and Guy is emailed what the last top-up added. It is automatic because
// a switch-off that waits for a click gets forgotten and costs money. A client paying to keep the
// connection (LinkedIn Feed = Yes) is left alone. The client's list carries on working - Wingguy
// has its own copy.
//
// Rules this file keeps:
//   - It NEVER calls Unipile's /accounts/{id}/sync route. A run of that route ends the automatic
//     daily continuation for the account.
//   - The connections list is read through LinkedIn, so it is read on the first run, weekly after
//     that, and once more when the history completes - not every day.
//   - One client failing never stops the others; the error is kept on that client's row.
//   - THE TOP-UP: for a client whose Reconnect list is switched on (they said both yeses in their
//     session), each day's newly arrived conversations are then read and the good ones added at
//     their cut-off - on their own Claude key, which their first yes covered. A client who is not
//     switched on yet is only collected. A top-up failing never fails the collect.

const { Pool } = require('pg');
const { createLogger } = require('../utils/contextLogger');

const MS_HOUR = 3600000;
const QUIET_HOURS_FOR_COMPLETE = 47;   // two daily runs with no growth
const STALL_HOURS = 24;
const RELATIONS_EVERY_HOURS = 7 * 24;
const NEAR_LIMIT = 25000;              // LinkedIn stops at 30,000 connections
const MONTH_DAYS = 30;
const WARN_DAYS = 5;
const MS_DAY = 24 * MS_HOUR;

// ---------------------------------------------------------------------------
// Pure: what a run means
// ---------------------------------------------------------------------------

/**
 * Decide the new state from the previous row and this run's counts.
 * @returns {{ state, firstBatchAt, lastGrowthAt, completeAt, notify: null|'ready'|'complete'|'stalled' }}
 */
function nextStatus(prev, { messages, nowMs, connectedAtMs }) {
  const p = prev || {};
  const had = Number(p.messages) || 0;
  const now = new Date(nowMs).toISOString();
  const out = {
    state: p.state || 'waiting',
    firstBatchAt: p.first_batch_at || null,
    lastGrowthAt: p.last_growth_at || null,
    completeAt: p.complete_at || null,
    notify: null,
  };
  if (!messages) {
    const waited = connectedAtMs ? (nowMs - connectedAtMs) / MS_HOUR : 0;
    if (waited >= STALL_HOURS) { out.state = 'stalled'; if (!p.notified_stalled_at) out.notify = 'stalled'; } else out.state = 'waiting';
    return out;
  }
  if (messages > had) {
    out.lastGrowthAt = now;
    out.completeAt = null;
    if (!out.firstBatchAt) { out.firstBatchAt = now; out.state = 'ready'; if (!p.notified_ready_at) out.notify = 'ready'; } else out.state = 'collecting';
    return out;
  }
  const quietHours = out.lastGrowthAt ? (nowMs - new Date(out.lastGrowthAt).getTime()) / MS_HOUR : Infinity;
  if (quietHours >= QUIET_HOURS_FOR_COMPLETE) {
    out.state = 'complete';
    if (!out.completeAt) out.completeAt = now;
    if (!p.notified_complete_at) out.notify = 'complete';
  } else if (out.state === 'waiting' || out.state === 'stalled') out.state = 'ready';
  return out;
}

/**
 * Where a client is in their month. null = nothing to do; 'warn' = five days to go and Guy has not
 * been told; 'end' = the month is up.
 */
function monthEndStep(client, prev, nowMs) {
  if (String((client && client.linkedinFeed) || '').trim() === 'Yes') return null;
  const at = client && client.linkedinConnectedAt ? new Date(client.linkedinConnectedAt).getTime() : 0;
  if (!at) return null;
  const days = (nowMs - at) / MS_DAY;
  if (days >= MONTH_DAYS) return 'end';
  if (days >= MONTH_DAYS - WARN_DAYS && !(prev && prev.notified_ending_at)) return 'warn';
  return null;
}

const endsOn = (client) => new Date(new Date(client.linkedinConnectedAt).getTime() + MONTH_DAYS * MS_DAY).toISOString().slice(0, 10);

/** Read the connections list on the first run, weekly, and when the history completes. */
function wantRelations(prev, nowMs) {
  if (!prev || !prev.last_relations_at) return true;
  return (nowMs - new Date(prev.last_relations_at).getTime()) / MS_HOUR >= RELATIONS_EVERY_HOURS;
}

const fmt = (n) => Number(n || 0).toLocaleString('en-AU');
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : 'unknown');

/** The email for one event. Plain, short, and says what to do. */
function buildEmail(kind, c) {
  const who = c.clientName || c.tenantId;
  const numbers = `${fmt(c.connections)} connections, ${fmt(c.conversations)} conversations with messages, going back to ${dayOf(c.oldestMsgAt)}.`;
  if (kind === 'ready') {
    return {
      subject: `Reconnect: ${who} is ready for a session`,
      text: `${who}'s first batch of LinkedIn history is in.\n\n${numbers}\n\nThey can have their Reconnect session now. Older conversations keep arriving each day (about 3,000 a day) and are collected without anyone doing anything.`,
    };
  }
  if (kind === 'complete') {
    return {
      subject: `Reconnect: ${who}'s LinkedIn history has stopped growing`,
      text: `Nothing new has arrived for ${who} for two days, so their history is being treated as complete.\n\n${numbers}\n\nIf that looks too short for how long they have been on LinkedIn, the collecting may have stalled part-way - tell Claude and it will check with Unipile.`,
    };
  }
  if (kind === 'ending') {
    return {
      subject: `Reconnect: ${who}'s LinkedIn connection ends on ${c.endsOn}`,
      text: `${who}'s LinkedIn connection is a month old on ${c.endsOn}. On that day Wingguy does one last collect and top-up, then switches the connection off so the charge for it stops.\n\nNothing is needed from you. Their Reconnect list carries on working - Wingguy has its own copy of their history.\n\nTo keep it connected instead (they pay for it), tell Claude before then and it will set LinkedIn Feed to Yes on their record.`,
    };
  }
  if (kind === 'ended') {
    return {
      subject: `Reconnect: ${who}'s LinkedIn connection has been switched off`,
      text: `${who}'s month is up, so their LinkedIn connection has been switched off and the charge for it has stopped.\n\n${c.lastTopUp}\n\nTheir Reconnect list carries on working.`,
    };
  }
  return {
    subject: `Reconnect: ${who} connected LinkedIn but no history has arrived`,
    text: `${who} connected their LinkedIn more than a day ago and no conversations have arrived yet.\n\nWorth a look before their session: the connection may have failed on their side, or Unipile may not have started. Tell Claude and it will check.`,
  };
}

/**
 * The email to the CLIENT when their first batch is in (Guy, 7 Oct 2026): the steps to switch on
 * their Reconnect list themselves, in their own Claude, with their coach copied. It saves booking a
 * call just to type one sentence. The description is the one place a client alone can go wrong, so
 * the email says why it matters, gives an example, and offers a call instead.
 */
function buildClientReadyEmail(c) {
  const first = String(c.clientFirstName || '').trim() || String(c.clientName || '').trim().split(/\s+/)[0] || 'there';
  const coachFirst = String(c.coachName || '').trim().split(/\s+/)[0] || 'Guy';
  const subject = 'Your LinkedIn conversations are in - one step and your Reconnect list is live';
  const text = [
    `Hi ${first},`,
    'Good news - your LinkedIn conversations have landed in Wingguy, so you\'re ready for the fun bit.',
    'Over the years you\'ve had hundreds of good conversations on LinkedIn that simply stopped. Your Reconnect list finds the ones worth picking up and hands you 20 a day on your Follow-Ups screen, each with a suggested message.',
    'To switch it on, open your Claude and type:\n\n    set up my reconnect list',
    'Then Wingguy takes you through it:',
    '1. It asks who you want to hear from again. Take your time here - this description decides the quality of your list for months. Be specific. Something like: "Founders and senior leaders of growing businesses who have had a real conversation with me about the work I do. Not people who only pitched me something, and not anyone who showed no interest." A vague answer gives you a vague list.\n'
      + '2. It shows you 30 of your own conversations, scored. Look at them properly and tell it which ones it\'s got wrong - it learns from that.\n'
      + '3. You say yes twice - once to read all your conversations (it shows you the cost first, usually a few dollars on your own Claude key), and once to choose how many people to bring in.',
    'That\'s it - your Reconnect section then appears on your Follow-Ups screen with your first 20 people.',
    'It only reads your LinkedIn - it never posts, connects or messages anyone without you pressing send.',
    'If you\'d rather do it together, just reply and we\'ll grab 20 minutes - happy either way.',
    `Cheers,\n${coachFirst}`,
  ].join('\n\n');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = text.split('\n\n').map((p) => (p.trim() === 'set up my reconnect list'
    ? `<p style="margin-left:24px"><b>${esc(p.trim())}</b></p>`
    : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)).join('');
  return { subject, text, html };
}

/**
 * Should the client get that email? Only when they can act on it today: an email address, and their
 * own Claude key on the record (the read runs on it). Returns null when yes, else the reason not.
 */
function clientEmailBlocker(client) {
  if (!String((client && client.clientEmailAddress) || '').trim()) return 'there is no email address on their record';
  if (!String((client && client.anthropicApiKey) || '').trim() && !(client && client.managedClaudeKey)) return 'their Claude key is not on their record yet, so they cannot do the setup';
  return null;
}

// ---------------------------------------------------------------------------
// Store
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

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS linkedin_collect_status (
      tenant_id            TEXT PRIMARY KEY,
      account_id           TEXT,
      state                TEXT NOT NULL DEFAULT 'waiting',
      connections          INTEGER NOT NULL DEFAULT 0,
      conversations        INTEGER NOT NULL DEFAULT 0,   -- people with at least one message
      messages             INTEGER NOT NULL DEFAULT 0,
      oldest_msg_at        TIMESTAMPTZ,
      first_batch_at       TIMESTAMPTZ,
      last_growth_at       TIMESTAMPTZ,
      complete_at          TIMESTAMPTZ,
      last_relations_at    TIMESTAMPTZ,
      last_run_at          TIMESTAMPTZ,
      runs                 INTEGER NOT NULL DEFAULT 0,
      notified_ready_at    TIMESTAMPTZ,
      notified_complete_at TIMESTAMPTZ,
      notified_stalled_at  TIMESTAMPTZ,
      last_error           TEXT
    );
    -- the month end: when Guy was warned, and when the connection was switched off.
    ALTER TABLE linkedin_collect_status ADD COLUMN IF NOT EXISTS notified_ending_at TIMESTAMPTZ;
    ALTER TABLE linkedin_collect_status ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;
  `);
}

async function getStatus(db, tenantId) {
  const r = await db.query('SELECT * FROM linkedin_collect_status WHERE tenant_id = $1', [tenantId]);
  return r.rows[0] || null;
}

/** Every client's row, for the board. {} when the store is down. */
async function statusByTenant() {
  const db = getPool();
  if (!db) return {};
  try {
    await ensureSchema(db);
    const r = await db.query('SELECT tenant_id, state, connections, conversations, messages, oldest_msg_at, first_batch_at, complete_at, last_run_at, last_error FROM linkedin_collect_status');
    const out = {};
    for (const row of r.rows) out[row.tenant_id] = { ...row, nearLimit: Number(row.connections) >= NEAR_LIMIT };
    return out;
  } catch (_) { return {}; }
}

// ---------------------------------------------------------------------------
// One client, then all of them
// ---------------------------------------------------------------------------

async function collectOne(client, { nowMs = Date.now(), dryRun = false, force = false, coach = {}, deps = {} } = {}) {
  const tenantId = client.clientId;
  const db = getPool();
  if (!db) return { tenantId, ok: false, error: 'DATABASE_URL not configured' };
  await ensureSchema(db);
  const prev = await getStatus(db, tenantId);
  const accountId = String(client.unipileLinkedinAccountId || '').trim();
  // A different account id on the record means they reconnected: start their story again.
  const fresh = prev && prev.account_id && prev.account_id !== accountId ? null : prev;
  // force = the last collect before the month-end switch-off, which a finished client still gets.
  if (!force && fresh && fresh.state === 'complete' && String(client.linkedinFeed || '').trim() !== 'Yes') {
    return { tenantId, ok: true, skipped: 'complete', state: 'complete' };
  }

  const relations = force || wantRelations(fresh, nowMs);
  const sync = deps.sync || require('./linkedinNetworkSync').syncLinkedinNetwork;
  let run;
  try { run = await sync(tenantId, { dryRun, relations }); } catch (e) { run = { ok: false, error: e.message }; }
  if (!run.ok) {
    if (!dryRun) {
      await db.query(
        `INSERT INTO linkedin_collect_status (tenant_id, account_id, last_run_at, runs, last_error) VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (tenant_id) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, runs = linkedin_collect_status.runs + 1, last_error = EXCLUDED.last_error`,
        [tenantId, accountId, new Date(nowMs).toISOString(), String(run.error || 'failed').slice(0, 500)]
      );
    }
    return { tenantId, ok: false, error: run.error };
  }

  const s = run.summary || {};
  const messages = Number(s.messages) || 0;
  const connectedAtMs = client.linkedinConnectedAt ? new Date(client.linkedinConnectedAt).getTime() : 0;
  const next = nextStatus(fresh, { messages, nowMs, connectedAtMs });
  // A capped or skipped connections read keeps the last full count.
  const connections = run.relationsComplete ? Number(s.connections) || 0 : Number((fresh && fresh.connections) || 0);
  const result = { tenantId, ok: true, state: next.state, notify: next.notify, messages, conversations: Number(s.withMessages) || 0, connections, relationsRead: !!run.relationsComplete };
  if (dryRun) return result;

  const oldest = await db.query('SELECT min(sent_at) AS oldest FROM linkedin_messages WHERE tenant_id = $1', [tenantId]);
  const oldestMsgAt = oldest.rows[0] && oldest.rows[0].oldest ? new Date(oldest.rows[0].oldest).toISOString() : null;

  // Guy is not emailed about a client already working their list - "ready" would be noise.
  let notified = null;
  const alreadyOn = String(client.reconnect || '').trim() === 'Yes';
  if (next.notify && !(next.notify === 'ready' && alreadyOn)) {
    const mail = buildEmail(next.notify, { tenantId, clientName: client.clientName, connections, conversations: result.conversations, oldestMsgAt });
    // "ready" also goes to the client, coach copied - and Guy's email says whether it went.
    if (next.notify === 'ready') {
      const blocker = clientEmailBlocker(client);
      if (blocker) {
        result.clientEmailed = false;
        mail.text += `\n\nThey have NOT been emailed the setup steps: ${blocker}.`;
      } else {
        const coachEmail = String(coach.email || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
        const cm = buildClientReadyEmail({ clientFirstName: client.clientFirstName, clientName: client.clientName, coachName: coach.name });
        const addr = String(process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`).trim();
        try {
          const sendClient = deps.sendClientEmail || require('./emailNotificationService').sendMailgunEmail;
          await sendClient({
            from: addr.includes('<') ? addr : `${coach.name || 'Guy Wilson'} <${addr}>`,
            to: String(client.clientEmailAddress).trim(),
            cc: coachEmail,
            'h:Reply-To': coachEmail,
            subject: cm.subject, text: cm.text, html: cm.html,
          });
          result.clientEmailed = true;
          mail.text += `\n\nWingguy has emailed them the steps to set up their Reconnect list themselves ("set up my reconnect list" in their Claude) - you are copied. They can reply to book a session with you instead.`;
        } catch (e) {
          result.clientEmailed = false;
          result.clientEmailError = e.message;
          mail.text += `\n\nWingguy tried to email them the setup steps but it failed (${e.message}) - send them yourself.`;
        }
      }
    }
    try {
      const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
      await send(mail.subject, `<p>${mail.text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`, null, { text: mail.text });
      notified = next.notify;
    } catch (e) { result.emailError = e.message; }
    // The client was emailed, so "ready" is done even if Guy's copy failed - never email them twice.
    if (result.clientEmailed) notified = 'ready';
  } else if (next.notify) notified = next.notify; // recorded so it is not reconsidered every day

  const nowIso = new Date(nowMs).toISOString();
  await db.query(
    `INSERT INTO linkedin_collect_status (tenant_id, account_id, state, connections, conversations, messages, oldest_msg_at,
       first_batch_at, last_growth_at, complete_at, last_relations_at, last_run_at, runs,
       notified_ready_at, notified_complete_at, notified_stalled_at, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15,NULL)
     ON CONFLICT (tenant_id) DO UPDATE SET account_id = EXCLUDED.account_id, state = EXCLUDED.state, connections = EXCLUDED.connections,
       conversations = EXCLUDED.conversations, messages = EXCLUDED.messages, oldest_msg_at = EXCLUDED.oldest_msg_at,
       first_batch_at = EXCLUDED.first_batch_at, last_growth_at = EXCLUDED.last_growth_at, complete_at = EXCLUDED.complete_at,
       last_relations_at = EXCLUDED.last_relations_at, last_run_at = EXCLUDED.last_run_at, runs = linkedin_collect_status.runs + 1,
       notified_ready_at = EXCLUDED.notified_ready_at, notified_complete_at = EXCLUDED.notified_complete_at,
       notified_stalled_at = EXCLUDED.notified_stalled_at, last_error = NULL`,
    [
      tenantId, accountId, next.state, connections, result.conversations, messages, oldestMsgAt,
      next.firstBatchAt, next.lastGrowthAt, next.completeAt,
      run.relationsComplete ? nowIso : ((fresh && fresh.last_relations_at) || null), nowIso,
      notified === 'ready' ? nowIso : ((fresh && fresh.notified_ready_at) || null),
      notified === 'complete' ? nowIso : ((fresh && fresh.notified_complete_at) || null),
      notified === 'stalled' ? nowIso : ((fresh && fresh.notified_stalled_at) || null),
    ]
  );
  result.emailed = !!notified && !(notified === 'ready' && alreadyOn) && !result.emailError;
  if (alreadyOn && messages) result.topUp = await topUp(tenantId, deps);
  return result;
}

/**
 * Read whatever has not been read yet and add anyone at the client's cut-off. Both steps only
 * ever add, so running this daily is safe. Never throws.
 */
async function topUp(tenantId, deps = {}) {
  try {
    const score = deps.score || require('./conversationScore').scoreConversations;
    const read = await score(tenantId, {});
    if (!read.ok) return { ok: false, step: 'read', error: read.error };
    const leads = deps.leads || require('./reconnectLeads').syncReconnectLeads;
    const added = await leads(tenantId, { dryRun: false });
    if (!added.ok) return { ok: false, step: 'leads', read: read.read, error: added.error };
    return { ok: true, read: read.read || 0, costUsd: read.costUsd || 0, created: added.created || 0, updated: added.updated || 0 };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * The month end for one client (see the top of this file). Returns null when there is nothing to
 * do, else { step: 'warn' | 'end', ... }. Never throws.
 */
async function monthEnd(client, { nowMs = Date.now(), dryRun = false, deps = {} } = {}) {
  const tenantId = client.clientId;
  const db = getPool();
  if (!db) return null;
  await ensureSchema(db);
  const prev = await getStatus(db, tenantId);
  const step = monthEndStep(client, prev, nowMs);
  if (!step) return null;
  if (dryRun) return { step, dryRun: true, endsOn: endsOn(client) };
  const send = deps.sendAlertEmail || require('./emailNotificationService').sendAlertEmail;
  const mail = async (kind, extra) => {
    const m = buildEmail(kind, { tenantId, clientName: client.clientName, endsOn: endsOn(client), ...extra });
    await send(m.subject, `<p>${m.text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`, null, { text: m.text });
  };
  const stamp = (col) => db.query(
    `INSERT INTO linkedin_collect_status (tenant_id, ${col}) VALUES ($1, now())
     ON CONFLICT (tenant_id) DO UPDATE SET ${col} = now()`, [tenantId]);
  try {
    if (step === 'warn') {
      await mail('ending');
      await stamp('notified_ending_at');
      return { step, endsOn: endsOn(client) };
    }
    const accountId = String(client.unipileLinkedinAccountId || '').trim();
    // Never the mail-and-calendar connection: switching THAT off would cut the client's email.
    if (!accountId || accountId === String(client.unipileAccountId || '').trim()) return { step, ok: false, error: 'no separate LinkedIn connection on the record - nothing switched off' };
    const last = await collectOne(client, { nowMs, force: true, deps });
    const t = last.topUp;
    const lastTopUp = !last.ok ? `The last collect failed (${last.error}), so nothing new was added at the end.`
      : t && t.ok ? `The last top-up read ${t.read} conversations and added ${t.created} people to their list.`
        : 'Nothing new was added at the end.';
    const remove = deps.deleteUnipileAccount || require('./clientOffboardService').deleteUnipileAccount;
    const outcome = await remove(accountId);
    const update = deps.updateMaster || (async (fields) => {
      const Airtable = require('airtable');
      const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);
      await base('Clients').update(client.recordId || client.id, fields);
      try { require('./clientService').clearCache(); } catch (_) { /* next read refreshes it */ }
    });
    await update({ 'Unipile LinkedIn Account ID': null });
    await stamp('disconnected_at');
    await db.query("UPDATE linkedin_collect_status SET state = 'complete' WHERE tenant_id = $1", [tenantId]);
    await mail('ended', { lastTopUp });
    return { step, ok: true, unipile: outcome, lastTopUp };
  } catch (e) { return { step, ok: false, error: e.message }; }
}

/**
 * The daily run: every client with a LinkedIn connection on file, one after another.
 * @param {{dryRun?: boolean, only?: string}} opts  only = one client id
 */
async function runCollectDaily({ dryRun = false, only = '', nowMs = Date.now() } = {}) {
  const logger = createLogger({ runId: 'LI-COLLECT', clientId: only || 'ALL', operation: 'linkedin_collect_daily' });
  const clientService = require('./clientService');
  const all = await clientService.getAllClients();
  const due = (all || []).filter((c) => String(c.unipileLinkedinAccountId || '').trim() && (!only || c.clientId === only));
  const results = [];
  for (const client of due) {
    try {
      // The coach copied on the client's "ready" email: their Coach record, else Guy (ALERT_EMAIL).
      const coachRec = client.coach ? (all || []).find((c) => c.clientId === client.coach) : null;
      const coach = coachRec ? { name: coachRec.clientName, email: coachRec.clientEmailAddress } : {};
      const r = await collectOne(client, { nowMs, dryRun, coach });
      // The month end comes after the day's collect, so a warning or switch-off never skips it.
      const m = await monthEnd(client, { nowMs, dryRun });
      if (m) r.monthEnd = m;
      results.push(r);
      logger.info(`${client.clientId}: ${r.ok ? `${r.skipped ? 'skipped (complete)' : r.state}${r.notify ? `, notify ${r.notify}` : ''}` : `FAILED ${r.error}`}`);
    } catch (e) {
      results.push({ tenantId: client.clientId, ok: false, error: e.message });
      logger.error(`${client.clientId}: ${e.message}`);
    }
  }
  return { ok: true, dryRun, clients: due.length, results };
}

module.exports = { runCollectDaily, collectOne, topUp, monthEnd, monthEndStep, MONTH_DAYS, WARN_DAYS, nextStatus, wantRelations, buildEmail, buildClientReadyEmail, clientEmailBlocker, statusByTenant, ensureSchema, _setPool, NEAR_LIMIT };
