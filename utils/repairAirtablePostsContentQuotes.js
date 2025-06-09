/**
 * utils/repairAirtablePostsContentQuotes.js
 * Scanner version – v2025-06-09-scan
 * ---------------------------------------------------------------
 * Algorithm
 * 1.  Attempt JSON.parse(raw).  If it works ➜ SKIP (valid).
 * 2.  If it fails, locate each "postContent": "<string>" value.
 * 3.  For each string, scan char-by-char:
 *       • Track whether we’re inside an escape (back-slash).
 *       • If we meet a bare " while not escaped ➜ prepend back-slash.
 * 4.  Reassemble the JSON, parse again, write back if valid.
 * 5.  If still invalid ➜ log FAILED with 60-char snippet.
 */

console.log(">>> Repair Script v2025-06-09-scan running <<<");

require("dotenv").config();
const base = require("../config/airtableClient");

const TABLE = "Leads";
const FIELD = "Posts Content";

const IDS = [ /* 63 IDs omitted for brevity – keep full list here */ ];

/* ------------------------------------------------------------------ */
/*  Scan one postContent string and escape bare quotes                */
/* ------------------------------------------------------------------ */
function escapeQuotesInString(str) {
  let out = '';
  let escaped = false;
  for (let ch of str) {
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === '\\') {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      out += '\\"';          // bare quote ➜ escape it
    } else {
      out += ch;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Walk the whole JSON text and patch each postContent occurrence    */
/* ------------------------------------------------------------------ */
function scanAndFix(raw) {
  const pcKey = '"postContent"';
  let i = 0, out = '';

  while (i < raw.length) {
    const idx = raw.indexOf(pcKey, i);
    if (idx === -1) { out += raw.slice(i); break; }

    const startQuote = raw.indexOf('"', idx + pcKey.length + 1);
    if (startQuote === -1) { out += raw.slice(i); break; }

    // copy chunk up to startQuote
    out += raw.slice(i, startQuote + 1);
    let j = startQuote + 1;
    let escaped = false;

    // scan until we find the terminating un-escaped quote
    while (j < raw.length) {
      const ch = raw[j];
      if (!escaped && ch === '"') {
        // end of string
        const inner = raw.slice(startQuote + 1, j);
        out += escapeQuotesInString(inner) + '"';
        i = j + 1;
        break;
      }
      escaped = !escaped && ch === '\\';
      j++;
    }
    if (j >= raw.length) {  // malformed – bail out
      out += raw.slice(i);
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main repair loop                                                  */
/* ------------------------------------------------------------------ */
async function run() {
  let fixed = 0, ok = 0, failed = 0;

  for (const id of IDS) {
    try {
      const rec = await base(TABLE).find(id);
      const raw = rec.get(FIELD);

      if (!raw || typeof raw !== 'string' || !raw.trim()) {
        console.log(`SKIP blank   – ${id}`);
        ok++; continue;
      }

      try { JSON.parse(raw); console.log(`SKIP valid   – ${id}`); ok++; continue; }
      catch { /* fall through */ }

      const repaired = scanAndFix(raw);

      try {
        JSON.parse(repaired);
        await base(TABLE).update([{ id, fields: { [FIELD]: repaired } }]);
        console.log(`FIXED        – ${id}`);
        fixed++;
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