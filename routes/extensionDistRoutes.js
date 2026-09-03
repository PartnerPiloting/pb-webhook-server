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

const clientService = require('../services/clientService');
const { recordCheckin } = require('../services/extensionDistStore');
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
  listCache = { version: manifest.version, files };
  listCachedAt = Date.now();
  return listCache;
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
    res.json({ ok: true, version, count: files.length, files });
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
 * POST /extension/dist/checkin
 * Body: { version, action, agent, machine, note }. The version reported is what is ON DISK
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
  });
  res.json({ ok: true });
});

module.exports = router;
