/**
 * One-time: open browser, sign in as guyralphwilson@gmail.com, print refresh token.
 * Uses Desktop OAuth client (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).
 *
 * PowerShell:
 *   $env:GOOGLE_OAUTH_CLIENT_ID="....apps.googleusercontent.com"
 *   $env:GOOGLE_OAUTH_CLIENT_SECRET="GOCSPX-..."
 *   node scripts/gmail-oauth-get-refresh-token.js
 *
 * If Google says redirect_uri_mismatch: Google Cloud → Clients → your Desktop client →
 * add Authorized redirect URI: http://127.0.0.1:3456/oauth2callback
 */
require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const PORT = 3456;
const REDIRECT_PATH = '/oauth2callback';
const REDIRECT_URI = `http://127.0.0.1:${PORT}${REDIRECT_PATH}`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (shell or .env).'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith(REDIRECT_PATH)) {
    res.writeHead(404);
    res.end();
    return;
  }

  const params = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams;
  const code = params.get('code');
  const err = params.get('error');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (err) {
    res.end(`<p>Google returned error: <strong>${err}</strong></p>`);
    server.close();
    process.exit(1);
    return;
  }
  if (!code) {
    res.end('<p>No <code>code</code> in URL.</p>');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end(
      '<p><strong>Done.</strong> Close this tab and return to the terminal.</p>'
    );
    server.close();

    if (!tokens.refresh_token) {
      console.error(
        '\nNo refresh_token in response. Revoke app access at https://myaccount.google.com/permissions then run this script again.\n'
      );
      process.exit(1);
      return;
    }

    console.log('\nAdd this to your server env (keep secret):\n');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    process.exit(0);
  } catch (e) {
    res.end(`<p>${String(e.message || e)}</p>`);
    server.close();
    console.error(e);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n1. Sign in in the browser as the Gmail account you send from.');
  console.log('2. If you see "unverified app", use Advanced → continue.\n');
  console.log(authUrl);
  console.log('\nWaiting for redirect on', REDIRECT_URI, '...\n');
});
