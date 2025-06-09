/**
 * utils/repairAirtablePostsContentQuotes.js
 * ------------------------------------------------------------------
 * One-time fixer for legacy “Posts Content” JSON that contains
 * un-escaped double-quotes inside postContent strings.
 *
 * HOW IT WORKS
 * 1.  Try JSON.parse(raw).  If it succeeds → record already valid, skip.
 * 2.  If parse fails, run safeQuoteFix() to escape inner quotes.
 * 3.  Parse again.  If it now parses → update Airtable.
 * 4.  Else log as FAIL (field left unchanged).
 *
 * Run from CLI :  node utils/repairAirtablePostsContentQuotes.js
 * Or via HTTP  :  POST /admin/repair-posts-content  (endpoint already set up)
 */

require("dotenv").config();
const base = require("../config/airtableClient");

const TABLE_NAME  = "Leads";
const POSTS_FIELD = "Posts Content";

// --- 63 legacy record IDs to repair ---
const BROKEN_RECORD_IDS = [
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
 * Escapes every un-escaped " inside each postContent value.
 * Works on arrays or single post objects and spans newlines.
 */
function safeQuoteFix(raw) {
  return raw.replace(
    /("postContent"\s*:\s*")(.*?)(")/gs,
    (_, open, content, close) => {
      const fixed = content.replace(/\\?"/g, q => (q === '"' ? '\\"' : q));
      return open + fixed + close;
    }
  );
}

async function repairAirtablePostsContentQuotes() {
  let fixed = 0, skipped = 0, failed = 0;

  for (const id of BROKEN_RECORD_IDS) {
    try {
      const record = await base(TABLE_NAME).find(id);
      const raw    = record.get(POSTS_FIELD);

      if (!raw || typeof raw !== "string" || !raw.trim()) {
        console.log(`SKIP (blank)  – ${id}`);
        skipped++;   continue;
      }

      // 1) Already valid?
      try {
        JSON.parse(raw);
        console.log(`SKIP (valid)  – ${id}`);
        skipped++;   continue;
      } catch { /* fall through to fix */ }

      // 2) Attempt repair
      const repaired = safeQuoteFix(raw);
      try {
        JSON.parse(repaired); // confirm fixed
        await base(TABLE_NAME).update([{ id, fields: { [POSTS_FIELD]: repaired } }]);
        console.log(`FIXED         – ${id}`);
        fixed++;
      } catch (e) {
        console.log(`FAIL          – ${id} (${e.message})`);
        failed++;
      }

    } catch (err) {
      console.log(`ERROR         – ${id} (${err.message})`);
      failed++;
    }
  }

  console.log(`\nSUMMARY ► attempted ${BROKEN_RECORD_IDS.length} | fixed ${fixed} | skipped ${skipped} | failed ${failed}`);
  return { attempted: BROKEN_RECORD_IDS.length, fixed, skipped, failed };
}

module.exports = repairAirtablePostsContentQuotes;

if (require.main === module) {
  repairAirtablePostsContentQuotes()
    .then(() => { console.log("✔︎ Repair complete"); process.exit(0); })
    .catch(e => { console.error("✖ Repair script error:", e); process.exit(1); });
}