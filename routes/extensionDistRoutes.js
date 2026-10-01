/**
 * routes/extensionDistRoutes.js — serves the extension to client machines that pull it
 * themselves, and takes their check-ins. See docs/extension-updater.md and
 * services/extensionDistStore.js for WHY this lane exists.
 *
 * Deliberately NO zip. The updater fetches the file list and then each file, because:
 *   - no archive library is needed on either end (nothing new in package.json);
 *   - the client never unzips, so the "which nested folder do I load?" trap disappears;
 *   - a partial download can be detected and discarded before anything is written in place.
 * The extension is ~14 small files, so the request count is irrelevant, and files are only
 * fetched at all when the version differs.
 *
 * AUTH: the client's own Portal Token (x-portal-token) — the same token the extension and
 * portal already use. It both authorises the pull and identifies who checked in, so the
 * updater needs exactly one secret and no separate identity.
 *
 * WHAT IS SERVED: the deployed wingguy-extension folder — identical to what
 * scripts/ship-extension.js copies into the OneDrive lane. One source of truth for both lanes.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const clientService = require('../services/clientService');
const { recordCheckin, latestForClient } = require('../services/extensionDistStore');
const { tailscaleAddress, buildRdpFile } = require('../services/clientMachineRdp');
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'extension_dist_routes');

const router = express.Router();

const EXT_DIR = path.join(__dirname, '..', 'wingguy-extension');
const LIST_TTL_MS = 60 * 1000;

let listCache = null;
let listCachedAt = 0;

/** Every file under wingguy-extension, with folder-relative POSIX paths. */
function collectFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collectFiles(path.join(dir, entry.name), relPath));
    else out.push(relPath);
  }
  return out;
}

function buildList() {
  if (listCache && Date.now() - listCachedAt < LIST_TTL_MS) return listCache;
  const relPaths = collectFiles(EXT_DIR);
  const files = relPaths.map((relPath) => {
    const abs = path.join(EXT_DIR, ...relPath.split('/'));
    const buf = fs.readFileSync(abs);
    return {
      path: relPath,
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  listCache = { version: manifest.version, files, updaterVersion: readUpdaterVersion() };
  listCachedAt = Date.now();
  return listCache;
}

const UPDATER_PS1 = path.join(__dirname, '..', 'scripts', 'extension-updater', 'wingguy-update.ps1');

/**
 * The version the Windows updater script declares ($script:UpdaterVersion). Installed copies
 * compare it with their own on every run and replace themselves when it differs (Update-Self in
 * the script, since 2026-09-26). Null if the line is missing - installed copies then do nothing.
 */
function readUpdaterVersion() {
  try {
    const m = fs.readFileSync(UPDATER_PS1, 'utf8').match(/\$script:UpdaterVersion = "([^"]+)"/);
    return m ? m[1] : null;
  } catch (_e) {
    return null;
  }
}

/** Today in Brisbane as YYYY-MM-DD - the date a proof is recorded against. */
function brisbaneDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
}

/** Portal-token gate. Sets req.wgClient on success. */
async function requireClient(req, res, next) {
  const token = (req.get('x-portal-token') || '').trim();
  if (!token) return res.status(401).json({ ok: false, error: 'missing x-portal-token' });
  try {
    const client = await clientService.getClientByPortalToken(token);
    if (!client || client.status !== 'Active') {
      return res.status(403).json({ ok: false, error: 'token not recognised or client not active' });
    }
    req.wgClient = client;
    return next();
  } catch (e) {
    log.warn(`token lookup failed: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'token lookup failed' });
  }
}

/**
 * GET /extension/dist
 * The file list plus the current version. The updater compares this version with the
 * manifest.json already on disk and does nothing at all when they match.
 */
router.get('/', requireClient, (req, res) => {
  try {
    const { version, files } = buildList();
    // format=text exists for the Mac updater: modern macOS ships no guaranteed JSON parser for
    // the shell (python3 needs the Command Line Tools), and adding a dependency to a client
    // machine defeats the point of this lane. Plain lines are read with `while read` and cannot
    // go wrong. PowerShell parses JSON natively, so Windows uses the JSON form.
    if (String(req.query.format || '').toLowerCase() === 'text') {
      const lines = [`version ${version}`]
        .concat(files.map((f) => `file ${f.bytes} ${f.path}`));
      res.type('text/plain').send(lines.join('\n') + '\n');
      return;
    }
    res.json({ ok: true, version, count: files.length, files, updaterVersion: buildList().updaterVersion });
  } catch (e) {
    log.error(`list failed: ${e.message}`);
    res.status(500).json({ ok: false, error: 'could not read the extension folder' });
  }
});

/**
 * GET /extension/dist/file?path=background.js
 * Only paths present in the freshly-built list are served, so traversal is impossible by
 * construction rather than by sanitising the input.
 */
router.get('/file', requireClient, (req, res) => {
  const wanted = String(req.query.path || '').trim();
  if (!wanted) return res.status(400).json({ ok: false, error: 'missing path' });
  try {
    const { files } = buildList();
    if (!files.some((f) => f.path === wanted)) {
      return res.status(404).json({ ok: false, error: 'not part of the extension' });
    }
    const abs = path.join(EXT_DIR, ...wanted.split('/'));
    res.type('application/octet-stream');
    res.sendFile(abs);
  } catch (e) {
    log.error(`file failed (${wanted}): ${e.message}`);
    res.status(500).json({ ok: false, error: 'could not read that file' });
  }
});

/**
 * GET /extension/dist/machine-icon
 * The client's desktop icon for their Linked Helper machine (a Remote Desktop file), built from
 * the address the machine itself reported to their row. The updater keeps it on the desktop, so
 * it is already there when the onboarding call switches it on. { rdp: null } = no machine yet.
 *
 * A client with a Machine Link (29 Sep 2026) gets { link } and NO rdp: their way in is a web
 * page, so the updater puts a shortcut to it on the desktop and takes the Remote Desktop icon
 * away. rdp is null on purpose - an updater too old to know about links then places nothing,
 * rather than an icon that cannot connect because the client has no Tailscale.
 */
router.get('/machine-icon', requireClient, (req, res) => {
  const raw = (req.wgClient.rawRecord && req.wgClient.rawRecord._rawJson && req.wgClient.rawRecord._rawJson.fields) || {};
  const link = String(raw['Machine Link'] || '').trim();
  if (/^https:\/\/[a-z0-9.-]+\/?$/i.test(link)) return res.json({ ok: true, link, rdp: null });
  const address = tailscaleAddress(raw['Machine Tailscale']);
  if (!address) return res.json({ ok: true, rdp: null });
  return res.json({ ok: true, address, rdp: buildRdpFile({ address }) });
});

/**
 * POST /extension/dist/checkin
 * Body: { version, action, agent, machine, note, updater }. The version reported is what is ON DISK
 * after the run, not what we hoped to deliver — a machine claiming an old version is the
 * signal we want. Never fails the run: a monitoring write must not break delivery.
 */
router.post('/checkin', requireClient, async (req, res) => {
  const b = req.body || {};
  await recordCheckin({
    clientId: req.wgClient.clientId,
    version: b.version,
    action: b.action,
    agent: b.agent,
    machine: b.machine,
    note: b.note,
    updater: b.updater,
  });
  // THE ICON PROOF (2026-09-26): the updater on the client's own laptop reached their machine's
  // Remote Desktop port - Tailscale is on, the share is accepted, the icon will connect. The first
  // time that happens, record the day. Never overwritten, never blanked; a failed write is logged
  // and costs the check-in nothing.
  if (b.machine_reachable === true) {
    const raw = (req.wgClient.rawRecord && req.wgClient.rawRecord._rawJson && req.wgClient.rawRecord._rawJson.fields) || {};
    if (!raw['Machine Icon Proven']) {
      try {
        const base = clientService.initializeClientsBase();
        await base(MASTER_TABLES.CLIENTS).update(req.wgClient.id, { 'Machine Icon Proven': brisbaneDate() });
        clientService.clearCache();
        log.info(`machine icon proven for ${req.wgClient.clientId} (${b.machine || 'unknown laptop'})`);
      } catch (e) {
        log.error(`could not record Machine Icon Proven for ${req.wgClient.clientId}: ${e.message}`);
      }
    }
  }
  res.json({ ok: true });
});

/**
 * GET /extension/dist/installer      -> the Windows updater script
 * GET /extension/dist/installer.sh   -> the macOS updater script
 *
 * Serving the updater itself is what turns installing on a client machine into ONE pasted line:
 * nothing has to be copied across the remote session first, which was the clumsiest step of the
 * whole job. Same portal-token gate as everything else here, so the line Guy pastes carries the
 * one secret it already needed.
 *
 * scripts/extension-install-command.js prints the ready-to-paste line for a given client.
 */
function serveUpdater(fileName, contentType) {
  return (req, res) => {
    const abs = path.join(__dirname, '..', 'scripts', 'extension-updater', fileName);
    try {
      const body = fs.readFileSync(abs, 'utf8');
      res.type(contentType).send(body);
    } catch (e) {
      log.error(`installer read failed (${fileName}): ${e.message}`);
      res.status(500).json({ ok: false, error: 'could not read the installer' });
    }
  };
}

router.get('/installer', requireClient, serveUpdater('wingguy-update.ps1', 'text/plain'));
router.get('/installer.sh', requireClient, serveUpdater('wingguy-update.sh', 'text/plain'));

/**
 * GET /extension/dist/download
 * The extension as ONE zip, for the portal "Install the extension" page - the lane for a client
 * whose antivirus refuses the background updater (Bitdefender shut it down on Steve Nelson's
 * machine, 2026-10-01), and the default for new clients. A person clicking a button and getting a
 * file is what no antivirus objects to; the hidden hourly updater is what they distrust.
 *
 * The zip holds the extension's files AT ITS ROOT (manifest.json at the top level), with NO
 * wrapping folder. That is deliberate, and it is the opposite of what feels natural: Windows
 * "Extract All" already creates a destination folder, so a zip that also wraps its contents in a
 * folder gives a folder inside a folder - the "which one do I load?" trap that is the reason the
 * updater lane has no zip. Files at the root extract straight into whatever folder the client
 * names, and the instructions name ONE: C:\Wingguy - the same folder the background updater uses.
 *
 * ONE FIXED FOLDER FOR BOTH LANES (Guy, 2026-10-01 - "bulletproof, not band-aids"). A loaded
 * extension points at exactly one folder; Chrome's refresh re-reads THAT folder. If an update is
 * unzipped anywhere else, refresh reloads the old files and nothing says so. So every install and
 * every update goes to C:\Wingguy, files replaced in place - precisely what the updater does. A
 * client can move between the two lanes with nothing to redo.
 *
 * Gated by the same Portal Token as everything here. The portal page fetches this WITH the token
 * header and saves the blob, so the token never rides in a URL. We also record the download as a
 * check-in (action 'downloaded') so the portal can later tell this client they are a version
 * behind - best-effort, and it never fails the download.
 */
router.get('/download', requireClient, async (req, res) => {
  try {
    const { version } = buildList();
    const zip = new AdmZip();
    // No second argument: files at the zip root, no wrapping folder - see the note above on why.
    zip.addLocalFolder(EXT_DIR);
    const buf = zip.toBuffer();

    const fileName = `wingguy-extension-${version}.zip`;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    res.set('Content-Length', String(buf.length));
    res.send(buf);

    // Monitoring only - mark what version this client just took, so the nag knows. A machine on
    // the background updater reports its real on-disk version separately; this covers the
    // portal-download machines that never run the updater.
    try {
      await recordCheckin({
        clientId: req.wgClient.clientId,
        version,
        action: 'downloaded',
        agent: 'portal',
        machine: 'portal-download',
      });
    } catch (e) {
      log.warn(`download check-in skipped for ${req.wgClient.clientId}: ${e.message}`);
    }
  } catch (e) {
    log.error(`download failed for ${req.wgClient && req.wgClient.clientId}: ${e.message}`);
    res.status(500).json({ ok: false, error: 'could not build the download' });
  }
});

/**
 * GET /extension/dist/portal-status
 * Drives the portal install page and the "you're a version behind" nag. Returns the current
 * version and the last version we have seen this client on (their latest check-in - a background
 * updater's real on-disk version, or the version they last downloaded from the portal).
 *
 *   installed = null  -> never seen; the page shows the first-time, six-step instructions.
 *   installed = X     -> seen; behind = (X !== current). The page shows the short update steps,
 *                        and the nag bar appears when behind.
 *
 * Best-effort: any failure still returns the current version with installed = null, so the page
 * degrades to "here is how to install it" rather than an error.
 */
router.get('/portal-status', requireClient, async (req, res) => {
  const { version } = buildList();
  let installed = null;
  let lastSeen = null;
  try {
    const row = await latestForClient(req.wgClient.clientId);
    if (row && row.version) {
      installed = String(row.version);
      lastSeen = row.checked_in_at || null;
    }
  } catch (e) {
    log.warn(`portal-status read skipped for ${req.wgClient.clientId}: ${e.message}`);
  }
  res.json({
    ok: true,
    current: version,
    installed,
    behind: Boolean(installed) && installed !== version,
    neverInstalled: !installed,
    lastSeen,
  });
});

module.exports = router;
