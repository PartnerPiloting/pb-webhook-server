/**
 * Connect Wispr - the one-time sign-in that lets Wingguy collect a client's Wispr Flow calls
 * (13 Nov 2026). Mounted at /auth/wispr. See services/wisprFeedService.js for what happens after.
 *
 *   GET /auth/wispr/start?c=<clientId>&k=<signature>
 *       The client's own Connect Wispr link (services/wisprAuth.connectLink - shown in Settings,
 *       and sent in the "your connection dropped" email). Checks the signature and THE SWITCH
 *       (WISPR_FEED_TENANTS), then sends the browser to Wispr's own sign-in page.
 *   GET /auth/wispr/callback?code=..&state=..
 *       Wispr sends the browser back here after the client clicks Allow. Swaps the code for a pass
 *       and a renewal ticket, saves the connection, and starts collecting straight away - on a
 *       reconnect that is the catch-up of everything since the last good check.
 *   GET /auth/wispr/status?key=<PB_WEBHOOK_SECRET>
 *       For Guy: the switch, every connection's status and last good check. No secrets in it.
 *
 * Read-only towards Wispr: the sign-in asks only for "openid offline_access" on the read-only
 * connector. No token is ever put in a page, a redirect or a log line.
 */

const express = require('express');
const cfg = require('../services/wisprConfig');
const auth = require('../services/wisprAuth');
const { getStore } = require('../services/wisprStore');

const router = express.Router();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)}</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;`
    + `margin:60px auto;padding:0 20px;color:#333;line-height:1.5}h1{font-size:20px}.ok{color:#137333}.err{color:#c5221f}</style>`
    + `</head><body>${body}</body></html>`;
}

function log() {
  try { return require('../utils/loggerHelper').createSafeLogger('SYSTEM', null, 'wispr_auth'); } catch (_) { return console; }
}

router.get('/start', async (req, res) => {
  const clientId = String(req.query.c || '').trim();
  const sig = String(req.query.k || '').trim();
  if (!clientId || !auth.verifyConnectLink(clientId, sig)) {
    return res.status(403).send(page('Link not valid', '<h1 class="err">This link is not valid</h1><p>Open the Connect Wispr link from your Wingguy Settings page, or from the email Wingguy sent you.</p>'));
  }
  if (!cfg.feedEnabledFor(clientId)) {
    return res.status(403).send(page('Not switched on', '<h1>Connecting Wispr is not switched on for your account yet</h1><p>Guy will let you know when it is ready.</p>'));
  }
  try {
    const url = await auth.beginSignIn(clientId, { store: getStore() });
    log().info(`wispr: sign-in started for ${clientId}`);
    return res.redirect(url);
  } catch (e) {
    log().error(`wispr: could not start sign-in for ${clientId}: ${e.message}`);
    return res.status(500).send(page('Could not start', '<h1 class="err">Wingguy could not start the Wispr sign-in</h1><p>Nothing has changed. Please try again in a minute, or let Guy know.</p>'));
  }
});

router.get('/callback', async (req, res) => {
  const { code, state, error, iss } = req.query;
  if (error) {
    log().warn(`wispr: sign-in came back with an error (${String(error).slice(0, 60)})`);
    return res.status(400).send(page('Not connected', '<h1 class="err">Wispr did not connect</h1><p>It looks like the sign-in was cancelled or not allowed. Nothing has changed - open your Connect Wispr link to try again.</p>'));
  }
  if (iss && String(iss).replace(/\/+$/, '') !== cfg.AUTH_BASE) {
    log().warn('wispr: callback named an unexpected issuer - refused');
    return res.status(400).send(page('Not connected', '<h1 class="err">That sign-in did not come from Wispr</h1><p>Nothing has changed.</p>'));
  }
  if (!code || !state) {
    return res.status(400).send(page('Not connected', '<h1 class="err">This sign-in link is incomplete</h1><p>Open your Connect Wispr link to start again.</p>'));
  }
  let r;
  try {
    r = await auth.completeSignIn({ state: String(state), code: String(code) }, { store: getStore() });
  } catch (e) {
    log().error(`wispr: sign-in could not be completed: ${e.message}`);
    return res.status(500).send(page('Not connected', '<h1 class="err">Wingguy could not save the connection</h1><p>Please open your Connect Wispr link and try once more.</p>'));
  }
  if (!r.ok) {
    log().warn(`wispr: sign-in not completed${r.coachClientId ? ` for ${r.coachClientId}` : ''} (${r.error})`);
    return res.status(400).send(page('Not connected', `<h1 class="err">Wispr did not connect</h1><p>${esc(r.message)}</p><p>Open your Connect Wispr link to try again.</p>`));
  }
  log().info(`wispr: ${r.coachClientId} CONNECTED`);
  // Start collecting now (first connect: the last week; reconnect: everything since the last good
  // check). Not awaited - the page should not hang on it.
  setImmediate(() => {
    const feed = require('../services/wisprFeedService');
    feed.syncTenant(r.coachClientId, { onDemand: true })
      .then(() => feed.notifyUnnamed(r.coachClientId))
      .catch((e) => log().warn(`wispr: first check after connect failed for ${r.coachClientId}: ${e.message}`));
  });
  return res.send(page('Wispr connected', '<h1 class="ok">Wispr is connected ✓</h1>'
    + '<p>From now on Wingguy collects your Wispr calls by itself, within about 15 minutes of each one being written up - and straight away when you ask your Claude about a call.</p>'
    + '<p>It can only read your recordings. It cannot change or delete anything in Wispr. You can close this tab.</p>'));
});

router.get('/status', async (req, res) => {
  const key = String(req.query.key || req.headers['x-webhook-secret'] || '').trim();
  if (!key || key !== String(process.env.PB_WEBHOOK_SECRET || '').trim()) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const feed = require('../services/wisprFeedService');
    const status = await feed.getFeedStatus();
    return res.json({ ok: true, ...status, lines: status.connections.map((c) => `${c.coachClientId}: ${feed.statusLine(c)}`) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
