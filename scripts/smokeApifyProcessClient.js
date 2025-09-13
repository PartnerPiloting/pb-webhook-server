// scripts/smokeApifyProcessClient.js
// Smoke test for /api/apify/process-client batching logic
// Env: BASE_URL (optional), PB_WEBHOOK_SECRET, CLIENT_ID, MAX_BATCHES (default 1)

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
  const MAX_BATCHES = Number(process.env.MAX_BATCHES || 1);
  const DEBUG = /^(1|true|yes|on)$/i.test(String(process.env.DEBUG || ''));

  if (!SECRET) {
    console.error('Missing PB_WEBHOOK_SECRET');
    process.exit(1);
  }
  if (!CLIENT_ID) {
    console.error('Missing CLIENT_ID');
    process.exit(1);
  }

  console.log('Running process-client smoke...');
  console.log('Base URL:', BASE_URL);
  console.log('Client ID:', CLIENT_ID);
  console.log('Max Batches:', MAX_BATCHES);

  try {
    const resp = await fetch(`${BASE_URL}/api/apify/process-client${DEBUG ? '?debug=1' : ''}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET}`,
        'x-client-id': CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ maxBatchesOverride: MAX_BATCHES, debug: DEBUG })
    });

    const data = await resp.json().catch(() => ({}));
    console.log('Status:', resp.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (!resp.ok || !data.ok) process.exit(2);

    console.log('process-client smoke test completed.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(2);
  }
})();
