#!/usr/bin/env node
// scripts/previewNextBatch.js
// Preview which Leads would be picked next for a client (record IDs + URLs)

require('dotenv').config();
const { getClientBase } = require('../config/airtableClient');

const LEADS_TABLE = 'Leads';
const LINKEDIN_URL_FIELD = 'LinkedIn Profile URL';
const STATUS_FIELD = 'Posts Harvest Status';
const LAST_CHECK_AT_FIELD = 'Last Post Check At';
const POSTS_ACTIONED_FIELD = 'Posts Actioned';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { client: process.env.CLIENT_ID || '', limit: Number(process.env.BATCH_LIMIT || 5) };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--client' && args[i+1]) { out.client = args[++i]; continue; }
    if (a === '--limit' && args[i+1]) { out.limit = Number(args[++i]); continue; }
  }
  return out;
}

(async () => {
  try {
    const { client, limit } = parseArgs();
    if (!client) {
      console.error('Usage: node scripts/previewNextBatch.js --client <Client-ID> [--limit N]');
      process.exit(1);
    }
    const base = await getClientBase(client);
    if (!base) {
      console.error(`No Airtable base for client ${client}`);
      process.exit(1);
    }

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const formula = `AND(
      {${LINKEDIN_URL_FIELD}} != '',
      OR(
        {${STATUS_FIELD}} = 'Pending',
        {${STATUS_FIELD}} = '',
        LEN({${STATUS_FIELD}}) = 0,
        AND({${STATUS_FIELD}} = 'Processing', {${LAST_CHECK_AT_FIELD}} < '${thirtyMinAgo}')
      ),
      {${STATUS_FIELD}} != 'No Posts',
      OR({${POSTS_ACTIONED_FIELD}} = 0, {${POSTS_ACTIONED_FIELD}} = '', {${POSTS_ACTIONED_FIELD}} = BLANK())
    )`;

    const records = await base(LEADS_TABLE).select({
      filterByFormula: formula,
      maxRecords: limit,
      fields: [LINKEDIN_URL_FIELD, STATUS_FIELD]
    }).firstPage();

    if (!records.length) {
      console.log('No eligible leads found.');
      process.exit(0);
    }

    console.log(`Client: ${client}`);
    console.log(`Previewing up to ${limit} records:`);
    const out = records.map(r => ({ id: r.id, url: r.get(LINKEDIN_URL_FIELD), status: r.get(STATUS_FIELD) || '' }));
    out.forEach(o => console.log(`- ${o.id} | ${o.url} | Status: ${o.status}`));
    console.log('\nJSON:');
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Preview failed:', e.message);
    process.exit(1);
  }
})();
