// Lightweight smoke test for Help/Start-Here APIs
// Usage:
//   BASE_URL=http://localhost:3001 node scripts/smokeHelp.js
//   BASE_URL=https://pb-webhook-server.onrender.com node scripts/smokeHelp.js

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || '45000', 10);

async function getJson(path) {
  const url = `${BASE_URL}${path}`;
  const res = await axios.get(url, { timeout: TIMEOUT_MS });
  return { status: res.status, data: res.data };
}

function ok(label) {
  console.log(`PASS ${label}`);
}

function fail(label, err) {
  console.error(`FAIL ${label}:`, err?.message || err);
}

async function run() {
  let failures = 0;

  // 1) Health
  try {
    const { status } = await getJson('/basic-test');
    if (status === 200) ok('basic-test 200'); else throw new Error(`status ${status}`);
  } catch (e) {
    failures++; fail('basic-test', e);
  }

  // 2) Start-Here (include bodies so we can follow-up with a topic fetch)
  let meta, anyTopicId;
  try {
    const { status, data } = await getJson('/api/help/start-here?include=body');
    if (status !== 200) throw new Error(`status ${status}`);

    // Accept either array or object with meta; probe for some expected keys
    if (data && (data.meta || data.categories || data.subCategories || Array.isArray(data))) {
      // try to find a topic id to fetch
      const categories = data.categories || [];
      for (const cat of categories) {
        for (const sub of cat.subCategories || []) {
          for (const t of sub.topics || []) {
            if (t.id) { anyTopicId = t.id; break; }
          }
          if (anyTopicId) break;
        }
        if (anyTopicId) break;
      }
      meta = data.meta;
      ok('help/start-here shape');
    } else {
      throw new Error('unexpected payload shape');
    }
  } catch (e) {
    failures++; fail('help/start-here', e);
  }

  // 3) Topic by ID
  if (anyTopicId) {
    try {
      const { status, data } = await getJson(`/api/help/topic/${encodeURIComponent(anyTopicId)}`);
      if (status !== 200) throw new Error(`status ${status}`);
      if (!data || !(data.bodyHtml || data.blocks)) throw new Error('missing bodyHtml/blocks');
      ok('help/topic/:id payload');
    } catch (e) {
      failures++; fail('help/topic/:id', e);
    }
  } else {
    console.warn('WARN no topic id discovered from start-here; skipping topic check');
  }

  // 4) Context (optional, just check 200 if area present)
  try {
    const { status } = await getJson('/api/help/context?area=settings&include=body');
    if (status === 200) ok('help/context 200'); else throw new Error(`status ${status}`);
  } catch (e) {
    // Not fatal for smoke; only warn
    console.warn('WARN help/context check skipped or failed:', e?.message || e);
  }

  if (failures > 0) {
    console.error(`\nSmoke tests completed with ${failures} failure(s).`);
    process.exit(1);
  } else {
    console.log('\nAll Help API smoke tests passed.');
  }
}

run().catch((e) => {
  console.error('UNCAUGHT smoke error:', e);
  process.exit(1);
});
