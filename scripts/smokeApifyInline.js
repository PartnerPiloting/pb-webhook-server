// scripts/smokeApifyInline.js
// Inline run smoke test for /api/apify/run
// Uses env: BASE_URL, PB_WEBHOOK_SECRET, CLIENT_ID, TARGET_URLS (comma-separated), APIFY_MAX_POSTS, APIFY_POSTED_LIMIT

require('dotenv').config();
const { getFetch } = require('../utils/safeFetch');
const fetch = getFetch();

(async () => {
  const BASE_URL = process.env.BASE_URL
    || process.env.API_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_API_BASE_URL
    || `http://localhost:${process.env.PORT || 3001}`;
  const SECRET = process.env.PB_WEBHOOK_SECRET;
  const CLIENT_ID = process.env.CLIENT_ID || process.env.X_CLIENT_ID || process.env.CLIENT || '';
  const TARGET_URLS = (process.env.TARGET_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const maxPosts = Number(process.env.APIFY_MAX_POSTS || 2);
  const postedLimit = process.env.APIFY_POSTED_LIMIT || 'year';
  const expectsCookies = /^(1|true|yes|on)$/i.test(String(process.env.APIFY_EXPECTS_COOKIES || ''));

  if (!SECRET) {
    console.error('Missing PB_WEBHOOK_SECRET');
    process.exit(1);
  }
  if (!CLIENT_ID) {
    console.error('Missing CLIENT_ID');
    process.exit(1);
  }
  if (!TARGET_URLS.length) {
    console.error('Missing TARGET_URLS (comma-separated)');
    process.exit(1);
  }

  console.log('Running inline Apify smoke test...');
  console.log('Base URL:', BASE_URL);
  console.log('Client ID:', CLIENT_ID);
  console.log('Target URLs:', TARGET_URLS);

  try {
    const resp = await fetch(`${BASE_URL}/api/apify/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET}`,
        'x-client-id': CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetUrls: TARGET_URLS,
        mode: 'inline',
        options: { maxPosts, postedLimit, expectsCookies }
      })
    });

    const data = await resp.json().catch(() => ({}));
    console.log('Status:', resp.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (!resp.ok || !data.ok) process.exit(2);

    console.log('Inline run smoke test completed.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(2);
  }
})();
