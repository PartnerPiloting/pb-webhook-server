#!/usr/bin/env node
// scripts/checkLeadScoringFields.js
// Verify scoring fields for given Airtable Lead record IDs in a given client base.

require('dotenv').config();
const { getClientBase } = require('../config/airtableClient');

const LEADS_TABLE = 'Leads';
const FIELDS = {
  LINKEDIN_URL: 'LinkedIn Profile URL',
  DATE_SCORED: 'Date Posts Scored',
  SCORE: 'Posts Relevance Score',
  TOP: 'Top Scoring Post',
  EVAL: 'Posts AI Evaluation',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { ids: [], client: process.env.CLIENT_ID || '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--client' && args[i+1]) { out.client = args[++i]; continue; }
    if (a === '--ids' && args[i+1]) {
      const raw = args[++i];
      out.ids = raw.split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
  }
  return out;
}

(async () => {
  try {
    const { client, ids } = parseArgs();
    if (!client || !ids.length) {
      console.error('Usage: node scripts/checkLeadScoringFields.js --client <Client-ID> --ids <comma-separated-record-ids>');
      process.exit(1);
    }
    const base = await getClientBase(client);
    if (!base) { console.error(`No Airtable base for client ${client}`); process.exit(1); }

    console.log(`Client: ${client}`);
    console.log(`Record IDs: ${ids.join(', ')}`);

    const res = [];
    for (const id of ids) {
      try {
        const rec = await base(LEADS_TABLE).find(id);
        const row = {
          id,
          url: rec.get(FIELDS.LINKEDIN_URL),
          dateScored: rec.get(FIELDS.DATE_SCORED) || '',
          score: rec.get(FIELDS.SCORE),
          topScoringPostPreview: (() => {
            const v = rec.get(FIELDS.TOP) || '';
            return typeof v === 'string' ? v.slice(0, 120) : '';
          })(),
          hasAiEvaluation: Boolean(rec.get(FIELDS.EVAL)),
        };
        res.push(row);
      } catch (e) {
        res.push({ id, error: e.message });
      }
    }

    console.log('\nResults:');
    for (const r of res) {
      if (r.error) {
        console.log(`- ${r.id} -> ERROR: ${r.error}`);
      } else {
        console.log(`- ${r.id} | URL: ${r.url}`);
        console.log(`  DateScored: ${r.dateScored} | Score: ${r.score} | HasEvaluation: ${r.hasAiEvaluation}`);
        console.log(`  TopScoringPost (preview): ${r.topScoringPostPreview.replace(/\n/g, ' ')}`);
      }
    }
    console.log('\nJSON:');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Check failed:', e.message);
    process.exit(1);
  }
})();
