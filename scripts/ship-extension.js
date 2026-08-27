// Ship the Wingguy extension to every client's update folder - one command per environment.
//
//   node scripts/ship-extension.js --dry-run              list targets + versions, push nothing
//   node scripts/ship-extension.js                        push to every configured folder
//   node scripts/ship-extension.js --client=Guy-Wilson    one client only
//
// DELIVERY LANES (updated 2026-08-25 - doctrine in docs/wingguy-onboarding-checklist.md):
// every update folder is GUY-OWNED and shared to the client VIEW-ONLY. Client rows carry
// 'Extension Folder Provider' (gdrive | onedrive) + 'Extension Folder Ref'.
//
//   onedrive - THE DEFAULT synced lane. Folder in Guy's PERSONAL OneDrive. No API, no Azure
//              app, no consent screens: the ship copies files into the locally synced folder
//              and the OneDrive client carries them up. Therefore it runs ON GUY'S MACHINE
//              (where %OneDrive% exists; override with ONEDRIVE_ROOT). Ref = the folder path
//              relative to the OneDrive root, ending at the folder that holds manifest.json.
//   (zip)    - no code here: git archive "origin/main:wingguy-extension" --prefix=Wingguy/
//              --format=zip, handed to a tech client to self-manage.
//   gdrive   - PARKED as a client lane 2026-08-25 (Drive's streamed G: mount loses the boot
//              race and Chrome silently removes the extension - see the checklist doc). The
//              push still works, kept dormant: folder in Guy's My Drive, pushed via the Drive
//              API as Guy, anywhere the GOOGLE_SHIP_* env is set (prod Render one-off job;
//              mint the refresh token with scripts/ship-extension-google-auth.js). Ref = the
//              folder ID (or full drive.google.com URL) of the folder holding manifest.json.
//
// A lane that can't run in the current environment reports SKIPPED per client - never silently
// dropped; run the same command in the other environment to cover those clients. Failures are
// named per client. Verification = the folder's manifest.json is read back after the push and
// must match the shipped version.
//
// M365 WORK accounts are NOT a lane - rejected 2026-08-21. Do not add a Graph/Azure lane here
// without Guy explicitly reopening that decision.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const cs = require('../services/clientService');

const EXT_DIR = path.join(__dirname, '..', 'wingguy-extension');
const DRY = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--client=')) || '').split('=')[1] || null;

// ---- the build: every file under wingguy-extension, with folder-relative paths ---------------
function collectFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collectFiles(path.join(dir, entry.name), relPath));
    else out.push({ relPath, abs: path.join(dir, entry.name) });
  }
  return out;
}

function mimeFor(name) {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.js')) return 'text/javascript';
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.md') || name.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

// ---- Google Drive lane -----------------------------------------------------------------------
function driveClient() {
  const { GOOGLE_SHIP_CLIENT_ID, GOOGLE_SHIP_CLIENT_SECRET, GOOGLE_SHIP_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_SHIP_CLIENT_ID || !GOOGLE_SHIP_CLIENT_SECRET || !GOOGLE_SHIP_REFRESH_TOKEN) return null;
  const auth = new google.auth.OAuth2(GOOGLE_SHIP_CLIENT_ID, GOOGLE_SHIP_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_SHIP_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

// Accept a bare folder ID or a full drive.google.com URL.
function driveFolderId(ref) {
  const m = String(ref).match(/folders\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : String(ref).trim();
}

async function driveEnsureSubfolder(drive, parentId, name, cache) {
  const key = `${parentId}/${name}`;
  if (cache.has(key)) return cache.get(key);
  const q = `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  let id = res.data.files[0] && res.data.files[0].id;
  if (!id) {
    const made = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id', supportsAllDrives: true,
    });
    id = made.data.id;
  }
  cache.set(key, id);
  return id;
}

async function drivePush(ref, files) {
  const drive = driveClient();
  if (!drive) return { skip: true, reason: 'gdrive lane not configured here (GOOGLE_SHIP_* env) - run as a Render one-off job' };
  const rootId = driveFolderId(ref);
  const subCache = new Map();
  for (const f of files) {
    const parts = f.relPath.split('/');
    let parentId = rootId;
    for (const dirName of parts.slice(0, -1)) parentId = await driveEnsureSubfolder(drive, parentId, dirName, subCache);
    const name = parts[parts.length - 1];
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const existing = await drive.files.list({ q, fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
    const media = { mimeType: mimeFor(name), body: fs.createReadStream(f.abs) };
    const id = existing.data.files[0] && existing.data.files[0].id;
    if (id) await drive.files.update({ fileId: id, media, supportsAllDrives: true });
    else await drive.files.create({ requestBody: { name, parents: [parentId] }, media, fields: 'id', supportsAllDrives: true });
  }
  // Verify: read the folder's manifest back.
  const mq = `'${rootId}' in parents and name = 'manifest.json' and trashed = false`;
  const m = await drive.files.list({ q: mq, fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (!m.data.files[0]) return { ok: false, error: 'verify failed: no manifest.json in folder after push' };
  const body = await drive.files.get({ fileId: m.data.files[0].id, alt: 'media', supportsAllDrives: true });
  const version = (typeof body.data === 'object' ? body.data : JSON.parse(body.data)).version;
  return { ok: true, version };
}

// ---- personal OneDrive lane (local copy - the OneDrive sync client does the uploading) --------
function onedriveRoot() {
  const root = process.env.ONEDRIVE_ROOT || process.env.OneDrive || '';
  return root && fs.existsSync(root) ? root : null;
}

function onedrivePush(ref, files) {
  const root = onedriveRoot();
  if (!root) return { skip: true, reason: "onedrive lane is a local copy into Guy's synced OneDrive - run this on Guy's machine" };
  const rel = String(ref).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!rel || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    return { ok: false, error: `bad onedrive ref '${ref}' - expected a folder path relative to the OneDrive root` };
  }
  const dest = path.join(root, ...rel.split('/'));
  for (const f of files) {
    const target = path.join(dest, ...f.relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(f.abs, target);
  }
  // Verify: read the folder's manifest back from disk. The OneDrive client carries it up from
  // here - give it a moment before telling the client to refresh.
  const version = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).version;
  return { ok: true, version, note: 'local copy done - OneDrive sync carries it up' };
}

// ---- main ------------------------------------------------------------------------------------
(async () => {
  const files = collectFiles(EXT_DIR);
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  console.log(`Ship ${manifest.version} - ${files.length} file(s) from ${EXT_DIR}${DRY ? ' [DRY RUN]' : ''}\n`);

  const clients = await cs.getAllClients();
  const targets = clients
    .map((c) => {
      const raw = (c.rawRecord && c.rawRecord._rawJson && c.rawRecord._rawJson.fields) || {};
      return { clientId: c.clientId, provider: raw['Extension Folder Provider'] || '', ref: raw['Extension Folder Ref'] || '' };
    })
    .filter((t) => t.provider && t.ref && (!ONLY || t.clientId === ONLY));

  if (!targets.length) {
    console.log(ONLY ? `No update folder configured for ${ONLY} (Extension Folder Provider/Ref blank).`
      : 'No clients have an update folder configured yet.');
    process.exit(0);
  }

  let failed = 0;
  let skipped = 0;
  for (const t of targets) {
    if (DRY) { console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} would push ${manifest.version}`); continue; }
    try {
      const r = t.provider === 'gdrive' ? await drivePush(t.ref, files)
        : t.provider === 'onedrive' ? onedrivePush(t.ref, files)
          : { ok: false, error: `unknown provider '${t.provider}' (expected gdrive | onedrive)` };
      if (r.skip) {
        skipped++;
        console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} SKIPPED - ${r.reason}`);
      } else if (r.ok && r.version === manifest.version) {
        console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} ${r.version}  OK${r.note ? ` (${r.note})` : ''}`);
      } else {
        failed++;
        console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} FAILED - ${r.error || `verify mismatch: folder has ${r.version}`}`);
      }
    } catch (e) {
      failed++;
      console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} FAILED - ${e.message}`);
    }
  }
  const tail = [];
  if (failed) tail.push(`${failed} FAILURE(S) - fix and re-run (safe to repeat).`);
  if (skipped) tail.push(`${skipped} skipped - run the same command in the other environment to cover them.`);
  if (!failed && !skipped) tail.push('All folders shipped and verified.');
  console.log(`\n${DRY ? 'Dry run complete.' : tail.join(' ')}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SHIP ERROR:', e); process.exit(1); });
