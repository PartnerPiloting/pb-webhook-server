// One-time local helper: mint the Google refresh token that lets scripts/ship-extension.js
// write into Wingguy update folders as Guy. Run ON GUY'S MACHINE (it opens a browser sign-in),
// never on the server.
//
// Before running, create an OAuth client once in Google Cloud Console (project: any, the
// existing leads-scoring project is fine): APIs & Services -> Credentials -> Create credentials
// -> OAuth client ID -> Application type "Desktop app", name "Wingguy ship". Copy its client ID
// + secret, then:
//
//   node scripts/ship-extension-google-auth.js <clientId> <clientSecret>
//
// It prints a URL - open it, sign in AS guyralphwilson@gmail.com (the wrong-account trap applies
// here too: check the account on the consent screen), approve Drive access, and the script
// catches the redirect and prints the three env values to set on the prod service:
// GOOGLE_SHIP_CLIENT_ID, GOOGLE_SHIP_CLIENT_SECRET, GOOGLE_SHIP_REFRESH_TOKEN.
// (Render env changes do NOT auto-redeploy - but one-off jobs read env live, so ship runs pick
// them up immediately; only the web service needs a deploy, which shipping doesn't.)
const http = require('http');
const { google } = require('googleapis');

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/ship-extension-google-auth.js <clientId> <clientSecret>');
  process.exit(1);
}

const PORT = 8765;
const auth = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${PORT}/`);
const url = auth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh token even if previously consented
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) { res.end('No code - close this tab and re-run.'); return; }
  res.end('Done - you can close this tab and go back to the terminal.');
  server.close();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\nNo refresh token returned - remove the app under myaccount.google.com -> Security -> Third-party access, then re-run.');
    process.exit(1);
  }
  console.log('\nSet these on the prod Render service (and .env.local if shipping locally):');
  console.log(`GOOGLE_SHIP_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_SHIP_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_SHIP_REFRESH_TOKEN=${tokens.refresh_token}`);
  process.exit(0);
});

server.listen(PORT, () => {
  console.log('Open this URL, sign in as guyralphwilson@gmail.com, and approve:\n');
  console.log(url + '\n');
  console.log(`Waiting on http://localhost:${PORT}/ ...`);
});
