/**
 * The backup watcher - the thing that was missing on 8 September 2026.
 *
 * Every Linked Helper machine's nightly job writes /var/lib/lh-backup-state.json, and
 * lh-watchdog.py carries it to routes/linkedHelperMachineRoutes.js every five minutes,
 * which lands it on the client's 'Machine Last Backup' field. This service reads that
 * column once a day and tells Guy when a machine has gone quiet.
 *
 * WHY IT EXISTS. From 8 to 19 September 2026 not one Linked Helper machine had a working
 * backup. Guy's own failed 23 nights running. The job ran perfectly every night, built a
 * verified 293 MB export, and then failed to upload it - and wrote "UPLOAD FAILED" into a
 * log file nobody reads. Three other machines had never had the job installed at all. It
 * was found because Guy happened to ask a question, not because anything told him.
 *
 * So the rule here is: judge the AGE OF THE NEWEST OFFSITE COPY, never whether the job ran.
 * A job that runs flawlessly and uploads nothing is the exact failure this exists to catch.
 *
 * Silence is treated as failure in both directions:
 *   - a machine that has never reported a backup is reported as NOT INSTALLED, because
 *     three machines sat in exactly that state for weeks and looked like nothing at all;
 *   - a machine that has stopped reporting keeps its old date and ages into the alert.
 *
 * Read-only. It never touches a machine and never writes to a client row.
 */

const clientService = require('../services/clientService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');

const log = createSafeLogger({ module: 'lhBackupWatch' });

// Two days. One missed night is a slow upload or a reboot; two is a fault. Anything
// tighter and the alert cries wolf, anything looser and a week can pass again.
const STALE_DAYS = 2;

const F = {
  lastBackup: 'Machine Last Backup',
  lastSeen: 'Machine Last Seen',
  status: 'Machine Status',
  secret: 'Machine Report Secret',
};

function daysSince(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86400000;
}

function ageWords(iso) {
  const d = daysSince(iso);
  if (d === null) return 'never';
  if (d < 1) return 'today';
  return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
}

/**
 * Every client that is supposed to have a Linked Helper machine, with a verdict.
 *
 * "Supposed to have one" means the row carries a Machine Report Secret - that is what
 * Guy mints when he builds a machine, so it is the only field that says "this client has
 * a machine at all" without guessing from a status string.
 */
async function surveyMachines() {
  const base = clientService.initializeClientsBase();
  const rows = await base(MASTER_TABLES.CLIENTS).select({
    fields: [F.lastBackup, F.lastSeen, F.status, F.secret, 'Client Name', 'Client ID', 'Status'],
  }).all();

  const machines = [];
  for (const r of rows) {
    const g = (k) => r.get(k);
    if (!g(F.secret)) continue;                                   // no machine on this client
    if (String(g('Status') || '').toLowerCase() === 'paused') continue;  // not our problem while paused

    const lastBackup = g(F.lastBackup) || null;
    const age = daysSince(lastBackup);
    machines.push({
      clientId: String(g('Client ID') || '').trim(),
      name: String(g('Client Name') || g('Client ID') || 'unknown').trim(),
      lastBackup,
      lastSeen: g(F.lastSeen) || null,
      status: String(g(F.status) || '').trim(),
      // Never backed up is its own verdict, not a very old one - it reads differently and
      // it is fixed differently (install the job, rather than find out why it broke).
      verdict: age === null ? 'never' : (age > STALE_DAYS ? 'stale' : 'ok'),
      ageDays: age,
    });
  }
  machines.sort((a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity));
  return machines;
}

function buildEmail(bad, all) {
  const row = (m) => `<tr>
    <td style="padding:6px 12px 6px 0"><b>${m.name}</b></td>
    <td style="padding:6px 12px 6px 0">${m.verdict === 'never' ? 'never backed up' : `last backup ${ageWords(m.lastBackup)}`}</td>
    <td style="padding:6px 12px 6px 0">machine last seen ${ageWords(m.lastSeen)}</td>
  </tr>`;

  const html = `
    <p>${bad.length} Linked Helper machine${bad.length === 1 ? '' : 's'} ${bad.length === 1 ? 'has' : 'have'} no recent backup.</p>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      ${bad.map(row).join('')}
    </table>
    <p style="color:#555;font-size:13px">
      "Last backup" is when a copy actually reached Google Drive, not when the job last ran.<br>
      ${all.length - bad.length} of ${all.length} machines are fine.
    </p>
    <p style="color:#555;font-size:13px">
      Where to look: <code>/var/log/lh-backup.log</code> on the machine, and
      <code>rclone lsd gdrive:</code> to test Drive access.
    </p>`;

  const text = bad
    .map((m) => `${m.name}: ${m.verdict === 'never' ? 'NEVER BACKED UP' : `last backup ${ageWords(m.lastBackup)}`} (machine last seen ${ageWords(m.lastSeen)})`)
    .join('\n');

  return { html, text };
}

/**
 * The daily run. Emails Guy only when something is wrong - a clean fleet sends nothing,
 * because an alert that arrives every day stops being read, and this one has to be read.
 */
async function runBackupWatch({ dryRun = false } = {}) {
  const all = await surveyMachines();
  const bad = all.filter((m) => m.verdict !== 'ok');

  const summary = { checked: all.length, stale: bad.length, machines: all };
  if (!bad.length) {
    log.info(`LH-BACKUP-WATCH all ${all.length} machines backed up within ${STALE_DAYS} days`);
    return { ...summary, emailed: false };
  }

  log.error(`LH-BACKUP-WATCH ${bad.length}/${all.length} machines stale: ${bad.map((m) => m.name).join(', ')}`);
  if (dryRun) return { ...summary, emailed: false };

  try {
    const { sendAlertEmail } = require('./emailNotificationService');
    const { html, text } = buildEmail(bad, all);
    await sendAlertEmail(
      `Linked Helper backups: ${bad.length} machine${bad.length === 1 ? '' : 's'} not backed up`,
      html,
      null,
      { text },
    );
  } catch (e) {
    // A mail failure must not hide the finding - the log line above is already written.
    log.error(`LH-BACKUP-WATCH alert email failed: ${e.message}`);
    return { ...summary, emailed: false, emailError: e.message };
  }
  return { ...summary, emailed: true };
}

module.exports = { runBackupWatch, surveyMachines, STALE_DAYS };
