/**
 * Linked Helper machine self-registration - the server end of the watchdog's status report.
 *
 * Every Linked Helper machine (scripts/linked-helper/setup-ubuntu-vps.sh) runs lh-watchdog.py
 * every five minutes. When the machine's /etc/linked-helper-machine.conf carries REPORT_URL and
 * REPORT_SECRET, the watchdog POSTs a small JSON status here at the end of each cycle. This
 * route verifies the secret and writes what the machine just said about itself onto the
 * client's row in the master Clients table, so the record fills itself in and stays true:
 *
 *   LH Account ID       the Linked Helper account number the instance is running (from the
 *                       instance window title - the number that is a nuisance to re-derive)
 *   Machine Address     hostname + public IP
 *   Machine Tailscale   tailnet name + 100.x address (how Guy reaches it)
 *   Machine Status      one line: runner state, LinkedIn state, LH version, disk, launcher
 *   Machine Last Seen   timestamp of this report
 *
 * Why this exists (decided 10 Sep 2026 after Rick Wong's build): the fields above were being
 * written by hand after each build, or not at all, and a machine that goes quiet was invisible
 * until leads stopped arriving. With every machine reporting, "last seen" on the row answers
 * "is it alive?" from Airtable, for the whole fleet, without remoting in.
 *
 * Auth: per-client shared secret in the client's 'Machine Report Secret' field, sent as the
 * x-lh-machine-secret header. Timing-safe compare. No secret on the row = every report for that
 * client is rejected (the row is not writable until Guy mints one). Same pattern as the
 * Fireflies webhook: per-client URL, per-client secret, no cross-tenant ambiguity.
 *
 * Endpoints:
 *   GET  /webhooks/lh-machine/:clientId             probe - client known, secret configured
 *   POST /webhooks/lh-machine/:clientId             the report (JSON body from lh-watchdog.py)
 *   GET  /webhooks/lh-machine/:clientId/clipboard   collect text left for this machine's clipboard
 *
 * The route never trusts the body for identity: the client comes from the URL, the secret from
 * the row. Body fields are strings/numbers only; anything odd is clipped, never echoed.
 *
 * The clipboard endpoint (added 17 Sep 2026, see services/machineClipboardStore.js) is the fix
 * for "I can copy on my machine but I cannot paste into the VPS". It is polled by
 * lh-clipboard.py, behind the SAME per-client secret, so a machine can only ever collect its own
 * client's text. It is a GET that consumes: the body is handed over once and deleted.
 */

const express = require('express');
const crypto = require('crypto');
const { createSafeLogger } = require('../utils/loggerHelper');
const clientService = require('../services/clientService');
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');

const router = express.Router();
const log = createSafeLogger({ module: 'lhMachineRoutes' });

const FIELDS = {
  secret: 'Machine Report Secret',
  accountId: 'LH Account ID',
  address: 'Machine Address',
  tailscale: 'Machine Tailscale',
  status: 'Machine Status',
  lastSeen: 'Machine Last Seen',
  lastBackup: 'Machine Last Backup',
};

function clip(v, n = 120) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
}

/** Timing-safe equality on the stored secret vs the header. Fails closed on anything odd. */
function secretMatches(header, stored) {
  const a = Buffer.from(clip(header, 200));
  const b = Buffer.from(clip(stored, 200));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * How long ago, in plain words, for the status line. Anything we cannot parse reads
 * as 'never' rather than as a number nobody can trust.
 */
function ageWords(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'never';
  const hrs = Math.floor((Date.now() - t) / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** One human line for the Machine Status field, from the watchdog's health + machine blocks. */
function statusLine(body) {
  const h = body.health || {};
  const m = body.machine || {};
  const parts = [];
  parts.push(clip(h.state || 'UNKNOWN', 20));
  if (h.linkedin) parts.push(`LinkedIn ${clip(h.linkedin, 20)}`);
  if (h.version) parts.push(`LH ${clip(h.version, 20)}`);
  if (m.launcher) parts.push(`Launcher ${clip(m.launcher, 20)}`);
  if (m.disk_pct !== undefined && m.disk_pct !== null && m.disk_pct !== '') parts.push(`disk ${clip(m.disk_pct, 6)}%`);
  const actions = Array.isArray(body.actions) ? body.actions.map((a) => clip(a, 40)).filter(Boolean) : [];
  if (actions.length) parts.push(`did: ${actions.join(', ')}`);
  // The backup line rides along on every report so "is it alive?" and "is it backed up?"
  // are the same glance. A machine with no backup job says so rather than staying silent -
  // silence is what let every machine go unbacked from 8 to 19 Sep 2026.
  const b = body.backup || {};
  if (b.last_ok || b.result) {
    parts.push(`backup ${b.result === 'ok' ? 'ok' : 'FAILING'} ${ageWords(b.last_ok)}`);
  } else {
    parts.push('backup NOT INSTALLED');
  }
  return parts.join(' | ').slice(0, 250);
}

/**
 * Shared front door for the authenticated machine endpoints: resolve the client from the URL,
 * check the stored secret against the header, fail closed. Returns the client, or null after
 * having already answered 401/500 - callers just return when it hands back null.
 */
async function authenticateMachine(req, res) {
  const clientId = clip(req.params.clientId, 80);
  let client = null;
  try {
    client = await clientService.getClientById(clientId);
  } catch (e) {
    log.error(`LH-MACHINE lookup failed for ${clientId}: ${e.message}`);
    res.status(500).json({ ok: false, error: 'lookup failed' });
    return null;
  }
  if (!client || !client.machineReportSecret) {
    log.warn(`LH-MACHINE ${!client ? 'unknown client' : 'no report secret stored'} (${clientId}) - rejecting`);
    res.status(401).json({ ok: false, error: 'unauthorised' });
    return null;
  }
  if (!secretMatches(req.get('x-lh-machine-secret'), client.machineReportSecret)) {
    log.warn(`LH-MACHINE bad secret for ${clientId} - rejecting`);
    res.status(401).json({ ok: false, error: 'unauthorised' });
    return null;
  }
  return client;
}

router.get('/webhooks/lh-machine/:clientId', async (req, res) => {
  let client = null;
  try { client = await clientService.getClientById(req.params.clientId); } catch (_e) { /* reported below */ }
  return res.json({
    client_found: !!client,
    secret_configured: !!client?.machineReportSecret,
    last_seen: client?.machineLastSeen || null,
  });
});

router.post('/webhooks/lh-machine/:clientId', express.json({ limit: '32kb' }), async (req, res) => {
  const clientId = clip(req.params.clientId, 80);
  const client = await authenticateMachine(req, res);
  if (!client) return undefined;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const h = body.health || {};
  const m = body.machine || {};

  const fields = {
    [FIELDS.status]: statusLine(body),
    [FIELDS.lastSeen]: new Date().toISOString(),
  };
  // Only overwrite the identity fields when the machine actually knows them - a report from
  // a cycle where the instance window was NOT OPEN carries no account/version and must not
  // blank what a healthy cycle wrote.
  const accountId = clip(h.account || body.account_id, 20);
  if (accountId && accountId !== '0') fields[FIELDS.accountId] = accountId;
  const address = [clip(m.hostname, 60), clip(m.public_ip, 45)].filter(Boolean).join(' ');
  if (address) fields[FIELDS.address] = address;
  const ts = [clip(m.tailscale_name, 60), clip(m.tailscale_ip, 45)].filter(Boolean).join(' ');
  if (ts) fields[FIELDS.tailscale] = ts;
  // Only ever move this forward on a report that carries a real success. A machine whose
  // backup job has just been removed, or whose state file is unreadable, must keep the old
  // date and age into the alert - never quietly blank itself and look like a new machine.
  const lastOk = clip(body.backup && body.backup.last_ok, 40);
  if (lastOk && Number.isFinite(Date.parse(lastOk))) fields[FIELDS.lastBackup] = new Date(lastOk).toISOString();

  try {
    const base = clientService.initializeClientsBase();
    await base(MASTER_TABLES.CLIENTS).update(client.id, fields, { typecast: true });
    clientService.clearCache();
  } catch (e) {
    // A missing field on the master table lands here (rollout not run yet) - say so plainly.
    log.error(`LH-MACHINE write failed for ${clientId}: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'write failed' });
  }
  log.info(`LH-MACHINE ${clientId}: ${fields[FIELDS.status]}`);
  return res.json({ ok: true, wrote: Object.keys(fields) });
});

/**
 * Collect whatever has been left for this machine's clipboard. Polled by lh-clipboard.py every
 * couple of seconds WHILE SOMEONE IS LOOKING AT THE SCREEN, and otherwise only as a slow
 * heartbeat - so an unwatched machine costs nothing and a watched one feels instant.
 *
 * A GET that consumes, deliberately: handing the text over IS the delivery, and a clipboard item
 * that stayed on our server after it landed would be a copy of somebody's password we have no
 * reason to keep. Empty is the normal answer and stays cheap.
 */
router.get('/webhooks/lh-machine/:clientId/clipboard', async (req, res) => {
  const client = await authenticateMachine(req, res);
  if (!client) return undefined;

  let body = null;
  try {
    body = await require('../services/machineClipboardStore').takeForMachine(client.clientId);
  } catch (e) {
    log.error(`LH-MACHINE clipboard read failed for ${client.clientId}: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'read failed' });
  }
  if (body) log.info(`LH-MACHINE ${client.clientId} collected ${body.length} clipboard chars`);
  // Never echo the text back in a log line - it is the client's, and it may be a password.
  return res.json({ ok: true, clipboard: body });
});

module.exports = router;
