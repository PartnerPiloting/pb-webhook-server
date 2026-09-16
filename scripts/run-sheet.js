/**
 * Make the onboarding run sheet for one client - a single tick-off page with their links in it.
 *
 *   node scripts/run-sheet.js <Client-ID> [--concierge|--standard] [--mint] [--out <file>]
 *                            [--fact "Recorder=none"] [--fact "Machine=Windows, his own"] ...
 *
 * --fact puts what the client said in their reply to the pre-session email at the top of the
 * sheet ("From Alex's reply"), one Key=Value per flag; a Key with no value renders as "not
 * answered - ask on the call". Claude fills these from the reply email before making the sheet.
 *
 * WHY: Guy onboards the not-technical client himself, over remote access, in one sitting, and
 * wants "almost like an email I'd get, with every step and everything in it, that I tick off".
 * This prints that page. The steps come from docs/concierge-run-sheet.md (default) or the
 * standard journey's overview in docs/wingguy-onboarding-checklist.md (--standard); the links
 * come from the client's record via the portal's board API (connector, installer line, portal
 * link), and --mint asks Unipile for the calendar-and-mail approval link the same way the
 * portal does - with the callback in it, so the record sets itself when the client approves.
 *
 * Runs from Guy's machine, not on a Render job: it needs no server env, only his own portal
 * token (the same auth the My Clients page uses). Put it in .env as WINGGUY_PORTAL_TOKEN, or
 * pass --token. RUN_SHEET_API overrides the server (defaults to prod).
 *
 * Publish the output as an Artifact with capabilities {artifact:{}, sample:{}} - then the ticks
 * save into the page itself and every step has an "Ask Claude" box. Make it the same day as
 * the session: a minted approval link lasts a day.
 */
// dotenv is a nicety, not a need: the script only wants a token and a URL, so it runs from a bare
// checkout (a temp worktree with no node_modules) with --token just as well.
try { require('dotenv').config(); } catch (_) { /* no dotenv here - env or --token still work */ }
const fs = require('fs');
const path = require('path');
const { parseConciergeDoc, parseStandardOverview, renderRunSheet, buildData, initialTicks } = require('../services/runSheet');

const args = process.argv.slice(2);
const clientId = (args.find((a) => !a.startsWith('--')) || '').trim();
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const facts = args.reduce((acc, a, i) => {
  if (a !== '--fact') return acc;
  const raw = String(args[i + 1] || '');
  const eq = raw.indexOf('=');
  acc.push(eq >= 0 ? { k: raw.slice(0, eq), v: raw.slice(eq + 1) } : { k: raw, v: '' });
  return acc;
}, []);

if (!clientId) {
  console.error('Usage: node scripts/run-sheet.js <Client-ID> [--concierge|--standard] [--mint] [--out <file>] [--token <portal token>]');
  process.exit(2);
}
const mode = flag('standard') ? 'standard' : 'concierge';
const token = (opt('token') || process.env.WINGGUY_PORTAL_TOKEN || '').trim();
if (!token) {
  console.error('No portal token. Set WINGGUY_PORTAL_TOKEN in .env (your own, the one My Clients uses) or pass --token.');
  process.exit(2);
}
const api = (process.env.RUN_SHEET_API || 'https://pb-webhook-server.onrender.com').replace(/\/+$/, '');
const headers = { 'x-portal-token': token, 'x-client-id': 'Guy-Wilson', 'Content-Type': 'application/json' };

async function call(method, url) {
  const res = await fetch(url, { method, headers, body: method === 'POST' ? '{}' : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  if (!res.ok || !json || json.success === false) {
    throw new Error(`${method} ${url} -> HTTP ${res.status}: ${(json && json.error) || text.slice(0, 200)}`);
  }
  return json;
}

(async () => {
  const docsDir = path.join(__dirname, '..', 'docs');
  const docFile = mode === 'concierge' ? 'concierge-run-sheet.md' : 'wingguy-onboarding-checklist.md';
  const docText = fs.readFileSync(path.join(docsDir, docFile), 'utf8');
  const steps = mode === 'concierge' ? parseConciergeDoc(docText) : parseStandardOverview(docText);
  if (!steps.length) throw new Error(`no steps parsed from docs/${docFile}`);

  process.stderr.write(`Reading ${clientId}'s record and live checks (this probes the calendar seam - up to a minute)...\n`);
  const detail = await call('GET', `${api}/api/client-board/${encodeURIComponent(clientId)}/detail`);

  let minted = null;
  if (flag('mint')) {
    if (detail.setup && detail.setup.unipileConnected) {
      process.stderr.write('Calendar and mail already connected on the record - not minting.\n');
    } else {
      process.stderr.write('Minting the calendar-and-mail approval link...\n');
      minted = await call('POST', `${api}/api/client-board/${encodeURIComponent(clientId)}/unipile-link`);
    }
  }

  const data = buildData({ mode, detail, steps, docText, minted, facts });
  // Steps the record already proves DONE arrive ticked, so a part-way client's sheet opens
  // showing where they are up to rather than blank.
  const ticks = initialTicks(data);
  const html = renderRunSheet(data, { ticks });
  const out = opt('out') || path.join(process.cwd(), `run-sheet-${clientId}.html`);
  fs.writeFileSync(out, html, 'utf8');

  const missing = [];
  if (!data.links.connectorUrl) missing.push('connector link (no portal token on the record)');
  if (steps.some((s) => s.link === 'unipile') && !minted && !(data.setup && data.setup.unipileConnected)) missing.push('calendar-and-mail link (run with --mint on the day)');
  console.log(`${out}`);
  console.log(`${steps.length} steps (${mode}) for ${data.client.name}${minted ? ' - approval link minted, lasts a day' : ''}${missing.length ? `\nMISSING: ${missing.join('; ')}` : ''}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
