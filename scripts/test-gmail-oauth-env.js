/**
 * Verifies Render/local Gmail OAuth env: client id, secret, refresh token work together.
 * Does not send email — only refreshes an access token.
 *
 * Render Shell: npm run test:gmail-oauth
 */
require('dotenv').config();

const { google } = require('googleapis');

const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const refresh = process.env.GMAIL_REFRESH_TOKEN;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  if (!id || !secret || !refresh) {
    fail(
      'Missing env: need GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_REFRESH_TOKEN'
    );
  }

  const oauth2 = new google.auth.OAuth2(id, secret);
  oauth2.setCredentials({ refresh_token: refresh });

  let token;
  try {
    const res = await oauth2.getAccessToken();
    token = res?.token;
  } catch (e) {
    fail(`Google OAuth refresh failed: ${e.message || e}`);
  }

  if (!token) {
    fail('No access token returned — check client id/secret and refresh token.');
  }

  console.log('OK: Gmail OAuth env vars are valid (refresh → access token works).');
  process.exit(0);
}

main();
