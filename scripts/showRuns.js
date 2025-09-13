// scripts/showRuns.js
// Show Apify run details and recent runs for a client.
// Env: BASE_URL, PB_WEBHOOK_SECRET, CLIENT_ID, RUN_ID (optional)

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
  const RUN_ID = process.env.RUN_ID || '';

  if (!SECRET) return console.error('Missing PB_WEBHOOK_SECRET');
  if (!CLIENT_ID) return console.error('Missing CLIENT_ID');

  try {
    console.log('Base URL:', BASE_URL);
    if (RUN_ID) {
      const r = await fetch(`${BASE_URL}/api/apify/runs/${encodeURIComponent(RUN_ID)}`, {
        headers: { 'Authorization': `Bearer ${SECRET}` }
      });
      const j = await r.json().catch(()=>({}));
      console.log('Run details:', JSON.stringify(j, null, 2));
    }

    const rc = await fetch(`${BASE_URL}/api/apify/runs/client/${encodeURIComponent(CLIENT_ID)}?limit=5`, {
      headers: { 'Authorization': `Bearer ${SECRET}` }
    });
    const jc = await rc.json().catch(()=>({}));
    console.log('Recent runs:', JSON.stringify(jc, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
