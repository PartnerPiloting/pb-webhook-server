/**
 * repairAirtablePostsContentQuotes.js
 * Attempts to repair unescaped double quotes in "Posts Content" JSON for specific records in Airtable Leads table.
 * Usage: node repairAirtablePostsContentQuotes.js
 * Loads base from your config/airtableClient.js.
 */

require("dotenv").config(); // Inherit env vars (works on Render and locally)
const base = require("./config/airtableClient"); // Use your configured Airtable base

const TABLE_NAME = "Leads";
const POSTS_FIELD = "Posts Content";

// Paste your stubborn broken record IDs here:
const BROKEN_RECORD_IDS = [
  "rec1UrAtCfS8X4rzE", "recSS5otfW1HplXUr", "recPxzumLjBG4ir5U", "recOc6vvRNPYi2JGO", "recAErpv0Fv2sKjzP",
  "recgKIEUFzx7wx6Kx", "rec9IPh9z5Ovrng4e", "recTAtYpDSEXrSu4T", "rec7j4x44Dnd6ur52", "recm4DJlkC10vo7DM",
  "recKo0RuWPiESR5ns", "recIb0lkzy6zXQUuL", "recoU0SnKqraYKZbL", "rec2FAVEDYY1Wdtx2", "recKpv0lQK9ALJKDu",
  "recNxRDhw462sPm3h", "reca99lXhGFVllIGS", "recTP3YYmtEIogl2Y", "recjZ7OBq8mSM1NEa", "rec31VcLqyZdRu5sc",
  "recw5rreNtKxv7KX4", "reccIKOmAJE6QcPYO", "recx5AEAWJ5FTriTh", "rec86TocEj3Vh79bP", "recWg6ATO24i0eG8w",
  "recWifDveCw1cq606", "recOQUwLXgac799r1", "recFWt3nOLr7YzlHp", "recxkHwGfCd2iMN06", "rec59gbwZi8fUrkwT",
  "recLSiuIazH4lk5gb", "recAUx9UrjG65gwKU", "rec177yZ8yUyksDE0", "recWCZv7KjUao1Muk", "recmORricwlobmTYk",
  "receV2fSDOaEKFnkC", "recfATnzrpFnQqmrq", "recBmDFUjsb2YqWUq", "rec786T9NuvjaZgaa", "recynrgZJVfsfZGVj",
  "recYH1SqbxLEP7WXl", "recb9Q7M3FLiAgTb1", "recLvH6gATzZBT59f", "recVkomEJMOpDE0PF", "recNJuaFNDJ3d3Hp4",
  "rect0RIpwv0VLRz8d", "rechP82j8I4ujXG8X", "recI7bS0PDsqgQx2C", "reciq8KGILEldANzL", "recQHlyp4aG490c24",
  "rec17sIFugxHuD1iC", "recU5YMRMLRu5anDm", "recdAi2br8r6102BB", "recCfK7X2co73ahqH", "reco9WvphfsfldXVy",
  "recNH6QLqTDEV9CfG", "recLStOtznJIl8ryY", "rec1dgBXUe8wIbsGp", "recsN4y5mspEueVBA", "recO80wZNtEMq8wK7",
  "recxZ71geihOVrBNi", "recyGetDgvWdAS98o", "recKKnYTSMe17G9td"
];

// Utility: Attempts to escape unescaped quotes in postContent string fields inside JSON string
function fixUnescapedQuotes(jsonStr) {
  let repaired = jsonStr.replace(
    /("postContent"\s*:\s*")((?:[^"\\]|\\.)*)"/g,
    (match, p1, p2) => {
      const fixed = p2.replace(/([^\\])"/g, '$1\\"');
      return p1 + fixed + '"';
    }
  );
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

(async () => {
  let fixed = 0, failed = 0;

  for (let id of BROKEN_RECORD_IDS) {
    try {
      let record = await base(TABLE_NAME).find(id);
      let jsonStr = record.get(POSTS_FIELD);

      if (!jsonStr || typeof jsonStr !== "string" || jsonStr.trim() === "") {
        console.log(`Skipped blank: ${id}`);
        continue;
      }

      const repaired = fixUnescapedQuotes(jsonStr);

      if (repaired) {
        await base(TABLE_NAME).update([
          { id, fields: { [POSTS_FIELD]: repaired } }
        ]);
        fixed++;
        console.log(`✔️ Fixed and updated: ${id}`);
      } else {
        failed++;
        console.log(`❌ Could not fix: ${id}`);
      }
    } catch (err) {
      failed++;
      console.log(`❌ Error on ${id}: ${err.message}`);
    }
  }

  console.log(`\n--- Repair Summary ---`);
  console.log(`Total attempted: ${BROKEN_RECORD_IDS.length}`);
  console.log(`Fixed and updated: ${fixed}`);
  console.log(`Failed (manual review needed): ${failed}`);
})();