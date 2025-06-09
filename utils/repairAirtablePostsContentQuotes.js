/**
 * utils/repairAirtablePostsContentQuotes.js
 * Scanner version – v2025-06-09-scan-FULL
 * ------------------------------------------------------------------
 * Fixes legacy “Posts Content” JSON that contains un-escaped quotes
 * inside postContent strings.
 *
 * HOW IT WORKS
 * 1.  Try JSON.parse(raw).  If it succeeds → SKIP (valid).
 * 2.  If parse fails → scan each postContent string character-by-character,
 *     escaping every bare " (not already preceded by a back-slash).
 * 3.  Re-parse.  If now valid → FIXED and write back to Airtable.
 * 4.  Else → FAILED; prints a 60-char snippet around the parse error.
 */

console.log(">>> Repair Script v2025-06-09-scan-FULL running <<<");

require("dotenv").config();
const base = require("../config/airtableClient");

const TABLE = "Leads";
const FIELD = "Posts Content";

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

/* ------------------------------------------------------------------ */
/*  Escape every bare " inside a string                               */
/* ------------------------------------------------------------------ */
function escapeQuotesInString(str) {
  let out = '', escaped = false;
  for (const ch of str) {
    if (escaped) { out += ch; escaped = false; }
    else if (ch === '\\') { out += ch; escaped = true; }
    else if (ch === '"') { out += '\\"'; }
    else { out += ch; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Scan whole JSON text and patch each postContent                    */
/* ------------------------------------------------------------------ */
function scanAndFix(raw) {
  const key = '"postContent"';
  let i = 0, out = '';

  while (i < raw.length) {
    const idx = raw.indexOf(key, i);
    if (idx === -1) { out += raw.slice(i); break; }

    const start = raw.indexOf('"', idx + key.length + 1);
    if (start === -1) { out += raw.slice(i); break; }

    out += raw.slice(i, start + 1);        // copy up to opening quote
    let j = start + 1, escaped = false;

    while (j < raw.length) {
      const ch = raw[j];
      if (!escaped && ch === '"') {
        const inner = raw.slice(start + 1, j);
        out += escapeQuotesInString(inner) + '"';
        i = j + 1;
        break;
      }
      escaped = !escaped && ch === '\\';
      j++;
    }
    if (j >= raw.length) { out += raw.slice(i); break; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main loop                                                          */
/* ------------------------------------------------------------------ */
async function run() {
  let ok = 0, fixed = 0, failed = 0;

  for (const id of IDS) {
    try {
      const rec = await base(TABLE).find(id);
      const raw = rec.get(FIELD);

      if (!raw || typeof raw !== 'string' || !raw.trim()) {
        console.log(`SKIP blank   – ${id}`); ok++; continue;
      }

      try { JSON.parse(raw); console.log(`SKIP valid   – ${id}`); ok++; continue; }
      catch { /* fall through */ }

      const repaired = scanAndFix(raw);

      try {
        JSON.parse(repaired);
        await base(TABLE).update([{ id, fields: { [FIELD]: repaired } }]);
        console.log(`FIXED        – ${id}`); fixed++;
      } catch (e) {
        const pos = (e.message.match(/position (\d+)/) || [])[1];
        const snippet = pos ? repaired.slice(Math.max(0, pos-30), +pos+30) : '';
        console.log(`FAILED       – ${id} (${e.message})`);
        if (snippet) console.log("  → snippet:", snippet.replace(/\n/g, "\\n"));
        failed++;
      }

    } catch (err) {
      console.log(`ERROR        – ${id} (${err.message})`);
      failed++;
    }
  }

  console.log(`\nSUMMARY ▸ attempted ${IDS.length} | fixed ${fixed} | skipped ${ok} | failed ${failed}`);
  return { attempted: IDS.length, fixed, skipped: ok, failed };
}

module.exports = run;
if (require.main === module) run().then(()=>process.exit(0));