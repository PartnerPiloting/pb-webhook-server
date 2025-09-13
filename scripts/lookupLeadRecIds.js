#!/usr/bin/env node
// scripts/lookupLeadRecIds.js
// Look up Airtable Lead record IDs and key fields by LinkedIn Profile URLs for a given client.

require('dotenv').config();
const { getClientBase } = require('../config/airtableClient');
const { getAirtableRecordByProfileUrl } = require('../utils/pbPostsSync');

const LEADS_TABLE = 'Leads';
const LINKEDIN_URL_FIELD = 'LinkedIn Profile URL';
const STATUS_FIELD = 'Posts Harvest Status';
const LAST_CHECK_AT_FIELD = 'Last Post Check At';
const FOUND_LAST_RUN_FIELD = 'Posts Found (Last Run)';
const POSTS_CONTENT_FIELD = 'Posts Content';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { urls: [], client: process.env.CLIENT_ID || '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--client' && args[i+1]) { out.client = args[++i]; continue; }
    if (a === '--urls' && args[i+1]) {
      const raw = args[++i];
      out.urls = raw.split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
  }
  if (!out.urls.length && process.env.TARGET_URLS) {
    out.urls = String(process.env.TARGET_URLS).split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

(async () => {
  try {
    const { client, urls } = parseArgs();
    if (!client) {
      console.error('Usage: node scripts/lookupLeadRecIds.js --client <Client-ID> --urls <comma-separated-urls>');
      process.exit(1);
    }
    if (!urls || !urls.length) {
      console.error('Provide --urls or TARGET_URLS env (comma-separated).');
      process.exit(1);
    }

    const base = await getClientBase(client);
    if (!base) {
      console.error(`No Airtable base for client ${client}`);
      process.exit(1);
    }

    console.log(`Client: ${client}`);
    console.log(`URLs: ${urls.join(', ')}`);

    const results = [];
    for (const url of urls) {
      try {
        const rec = await getAirtableRecordByProfileUrl(url, base);
        if (!rec) {
          results.push({ url, found: false });
          continue;
        }
        // Re-fetch with additional fields
        const full = await base(LEADS_TABLE).find(rec.id).catch(() => rec);
        results.push({
          url,
          found: true,
          id: rec.id,
          fields: {
            [LINKEDIN_URL_FIELD]: full.get ? full.get(LINKEDIN_URL_FIELD) : undefined,
            [STATUS_FIELD]: full.get ? full.get(STATUS_FIELD) : undefined,
            [FOUND_LAST_RUN_FIELD]: full.get ? full.get(FOUND_LAST_RUN_FIELD) : undefined,
            [LAST_CHECK_AT_FIELD]: full.get ? full.get(LAST_CHECK_AT_FIELD) : undefined,
            postsLen: (() => {
              try {
                const v = full.get ? full.get(POSTS_CONTENT_FIELD) : undefined;
                if (!v) return 0;
                const arr = JSON.parse(v);
                return Array.isArray(arr) ? arr.length : 0;
              } catch { return 0; }
            })()
          }
        });
      } catch (e) {
        results.push({ url, found: false, error: e.message });
      }
    }

    console.log('\nResults:');
    for (const r of results) {
      if (!r.found) {
        console.log(`- ${r.url} -> NOT FOUND`);
      } else {
        console.log(`- ${r.url} -> ${r.id} | Status: ${r.fields[STATUS_FIELD] || ''} | Posts: ${r.fields.postsLen} | LastCheck: ${r.fields[LAST_CHECK_AT_FIELD] || ''}`);
      }
    }

    // Output JSON blob at the end for easy copy
    console.log('\nJSON:');
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('Lookup failed:', e.message);
    process.exit(1);
  }
})();
