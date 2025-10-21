const { createLogger } = require('./contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'util' });

/**
 * utils/repairAirtablePostsContentQuotes.js
 * -------------------------------------------------------------------
 * One-time repair: normalize every “Posts Content” JSON to valid,
 * single-line JSON by parsing then re-stringifying (no pretty-print).
 */

require("dotenv").config();
const base = require("../config/airtableClient");

const TABLE = "Leads";
const FIELD = "Posts Content";

// List of the 63 record IDs to repair:
const IDS = [
  "rec1UrAtCfS8X4rzE","recSS5otfW1HplXUr","recPxzumLjBG4ir5U","recOc6vvRNPYi2JGO","recAErpv0Fv2sKjzP",
  "recgKIEUFzx7wx6Kx","rec9IPh9z5Ovrng4e","recTAtYpDSEXrSu4T","rec7j4x44Dnd6ur52","recm4DJlkC10vo7DM",
  "recKo0RuWPiESR5ns","recIb0lkzy6zXQUuL","recoU0SnKqraYKZbL","rec2FAVEDYY1Wdtx2","recKpv0lQK9ALJKDu",
  "recNxRDhw462sPm3h","reca99lXhGFVllIGS","recTP3YYmtEIogl2Y","recjZ7OBq8mSM1NEa","rec31VcLqyZdRu5sc",
  "recw5rreNtKxv7KX4","reccIKOmAJE6QcPYO","recx5AEAWJ5FTriTh","rec86TocEj3Vh79bP","recWg6ATO24i0eG8w",
  "recWifDveCw1cq606","recOQUwLXgac799r1","recFWt3nOLr7YzlHp","recxkHwGfCd2iMN06","rec59gbwZi8fUrkwT",
  "recLSiuIazH4lk5gb","recAUx9UrjG65gwKU","rec177yZ8yUyksDE0","recWCZv7KjUao1Muk","recmORricwlobmTYk",
  "receV2fSDOaEKFnkC","recfATnzrpFnQqmrq","recBmDFUjsb2YqWUq","rec786T9NuvjaZgaa","recynrgZJVfsfZGVj",
  "recYH1SqbxLEP7WXl","recb9Q7M3FLiAgTb1","recLvH6gATzZBT59f","recVkomEJMOpDE0PF","recNJuaFNDJ3d3Hp4",
  "rect0RIpwv0VLRz8d","rechP82j8I4ujXG8X","recI7bS0PDsqgQx2C","reciq8KGILEldANzL","recQHlyp4aG490c24",
  "rec17sIFugxHuD1iC","recU5YMRMLRu5anDm","recdAi2br8r6102BB","recCfK7X2co73ahqH","reco9WvphfsfldXVy",
  "recNH6QLqTDEV9CfG","recLStOtznJIl8ryY","rec1dgBXUe8wIbsGp","recsN4y5mspEueVBA","recO80wZNtEMq8wK7",
  "recxZ71geihOVrBNi","recyGetDgvWdAS98o","recKKnYTSMe17G9td"
];

/**
 * Remove any trailing commas before a closing } or ]
 */
function stripTrailingCommas(str) {
  return str.replace(/,\s*([}\]])/g, "$1");
}

async function repair() {
  let fixed = 0, failed = 0;

  for (const id of IDS) {
    try {
      const rec = await base(TABLE).find(id);
      const raw = rec.get(FIELD) || "";

      // 1) Clean up any trailing commas
      const cleaned = stripTrailingCommas(raw);

      // 2) Parse into JS array/object
      let data;
      try {
        data = JSON.parse(cleaned);
      } catch (e) {
        logger.info(`FAILED parse – ${id} (${e.message})`);
        failed++;
        continue;
      }

      // 3) Re-serialize without pretty-print
      const normalized = JSON.stringify(data);

      // 4) Write back to Airtable
      await base(TABLE).update([
        { id, fields: { [FIELD]: normalized } }
      ]);
      logger.info(`FIXED       – ${id}`);
      fixed++;

    } catch (err) {
      logger.info(`ERROR       – ${id} (${err.message})`);
      failed++;
    }
  }

  logger.info(`\nSUMMARY → attempted ${IDS.length} | fixed ${fixed} | failed ${failed}`);
  return { attempted: IDS.length, fixed, failed };
}

// If run from CLI, execute immediately
if (require.main === module) {
  repair().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = repair;
