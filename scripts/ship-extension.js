// Ship the Wingguy extension to every client's update folder - one command, no hand-uploads.
//
//   node scripts/ship-extension.js --dry-run              list targets + versions, push nothing
//   node scripts/ship-extension.js                        push to every configured folder
//   node scripts/ship-extension.js --client=Guy-Wilson    one client only
//
// Born 2026-08-20 (the Ashley OneDrive call): delivery moves from hand-updated synced-folder
// masters to an API fan-out. Each client row carries 'Extension Folder Provider' (gdrive |
// onedrive) + 'Extension Folder Ref' (Drive folder ID | OneDrive share link). The client's own
// sync tool pulls the files down; Chrome picks them up at the next browser restart (or ↻).
// Failures are named per client, never swallowed. Verification = the folder's manifest.json is
// read back after upload and must match the shipped version.
//
// Runs on prod as a Render one-off job, so the deployed wingguy-extension folder IS the build
// (identical to origin/main). Local runs work too if .env carries the same secrets.
//
// Auth (one-time setups):
//   gdrive   - OAuth as Guy (files land owned by Guy, which dodges the service-account quota
//              trap on consumer Drive folders). Env: GOOGLE_SHIP_CLIENT_ID,
//              GOOGLE_SHIP_CLIENT_SECRET, GOOGLE_SHIP_REFRESH_TOKEN
//              (mint the refresh token locally with scripts/ship-extension-google-auth.js).
//   onedrive - Microsoft Graph as Guy's Microsoft account, refresh-token flow. Env:
//              MS_SHIP_CLIENT_ID, MS_SHIP_REFRESH_TOKEN (device-code setup documented in the
//              auth helper's header). Until set, the lane reports "not configured" per client
//              rather than failing the run.
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
  if (!drive) return { ok: false, error: 'gdrive lane not configured (GOOGLE_SHIP_* env missing)' };
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

// ---- Microsoft Graph (OneDrive) lane ---------------------------------------------------------
async function graphToken() {
  const { MS_SHIP_CLIENT_ID, MS_SHIP_REFRESH_TOKEN } = process.env;
  if (!MS_SHIP_CLIENT_ID || !MS_SHIP_REFRESH_TOKEN) return null;
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_SHIP_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: MS_SHIP_REFRESH_TOKEN,
      scope: 'Files.ReadWrite.All offline_access',
    }),
  });
  if (!res.ok) throw new Error(`graph token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// A OneDrive share link resolves to the underlying drive item via the /shares door.
function shareId(url) {
  return 'u!' + Buffer.from(String(url).trim()).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

async function graphPush(ref, files) {
  const token = await graphToken();
  if (!token) return { ok: false, error: 'onedrive lane not configured (MS_SHIP_* env missing)' };
  const headers = { Authorization: `Bearer ${token}` };
  const root = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId(ref)}/driveItem`, { headers });
  if (!root.ok) return { ok: false, error: `resolve share link: ${root.status} ${await root.text()}` };
  const item = await root.json();
  const base = `https://graph.microsoft.com/v1.0/drives/${item.parentReference.driveId}/items/${item.id}`;
  for (const f of files) {
    // Path-addressed upload creates folders and replaces files in one move. <4MB per file.
    const up = await fetch(`${base}:/${f.relPath}:/content`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': mimeFor(f.relPath) },
      body: fs.readFileSync(f.abs),
    });
    if (!up.ok) return { ok: false, error: `upload ${f.relPath}: ${up.status} ${await up.text()}` };
  }
  const check = await fetch(`${base}:/manifest.json:/content`, { headers });
  if (!check.ok) return { ok: false, error: 'verify failed: no manifest.json in folder after push' };
  const version = (await check.json()).version;
  return { ok: true, version };
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
  for (const t of targets) {
    if (DRY) { console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} would push ${manifest.version}`); continue; }
    try {
      const r = t.provider === 'gdrive' ? await drivePush(t.ref, files) : await graphPush(t.ref, files);
      if (r.ok && r.version === manifest.version) {
        console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} ${r.version}  OK`);
      } else {
        failed++;
        console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} FAILED - ${r.error || `verify mismatch: folder has ${r.version}`}`);
      }
    } catch (e) {
      failed++;
      console.log(`  ${t.clientId.padEnd(16)} ${t.provider.padEnd(9)} FAILED - ${e.message}`);
    }
  }
  console.log(`\n${DRY ? 'Dry run complete.' : failed ? `${failed} FAILURE(S) - fix and re-run (safe to repeat).` : 'All folders shipped and verified.'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SHIP ERROR:', e); process.exit(1); });
