/* ===================================================================
   attributeLoader.js – dynamic attribute dictionary for scoring
   -------------------------------------------------------------------
   • Reads the “Scoring Attributes” Airtable table and converts each row
     into the dictionaries GPT and the server use.
   • Caches the result for 10 minutes to minimise API calls.
   • Falls back to a hard-coded list if Airtable is unreachable.
   • Exports:  loadAttributes()  →  { positives, negatives }
=================================================================== */
require("dotenv").config();
const Airtable = require("airtable");

/* ---------- config ---------------------------------------------- */
const TABLE_NAME = process.env.ATTR_TABLE_NAME || "Scoring Attributes";
const BASE_ID    = process.env.AIRTABLE_BASE_ID;
const API_KEY    = process.env.AIRTABLE_API_KEY;

/* ---------- Airtable setup --------------------------------------- */
Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

/* ---------- in-memory cache (10-min TTL) ------------------------- */
let cache      = null;
let cacheUntil = 0;

/* ---------- public: loadAttributes ------------------------------ */
async function loadAttributes () {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;        // serve from cache

  try {
    const rows = await base(TABLE_NAME).select().all();
    const positives = {};
    const negatives = {};

    rows.forEach(r => {
      const id     = String(r.get("ID")    || "").trim();
      const type   = String(r.get("Type")  || "").toLowerCase();
      const label  = String(r.get("Label") || "").trim();
      if (!id || !label || !type) return;              // skip bad rows

      if (type === "positive") {
        positives[id] = {
          label,
          maxPoints : Number(r.get("Max / Penalty") || 0),
          minQualify: Number(r.get("MinQualify")    || 0),
        };
      } else if (type === "negative") {
        negatives[id] = {
          label,
          penalty      : Number(r.get("Max / Penalty") || 0),
          disqualifying: !!r.get("Disqualify"),
        };
      }
    });

    cache = { positives, negatives };
    cacheUntil = now + 10 * 60 * 1000;      // refresh in 10 minutes
    console.log(`• Loaded ${rows.length} attributes from Airtable`);
    return cache;
  } catch (err) {
    console.error("⚠︎ Attribute fetch failed – using fallback list", err);
    return fallbackAttributes();            // keep service running
  }
}

/* ---------- fallback constants ---------------------------------- */
function fallbackAttributes () {
  const positives = {
    A: { label:"Founder / Co-Founder",     maxPoints:5, minQualify:0 },
    B: { label:"C-Suite / Director",       maxPoints:5, minQualify:0 },
    C: { label:"Tech / Product seniority", maxPoints:3, minQualify:0 },
    D: { label:"Prior exit",               maxPoints:5, minQualify:0 },
    E: { label:"Raised funding",           maxPoints:4, minQualify:0 },
    F: { label:"Hiring team",              maxPoints:3, minQualify:0 },
    G: { label:"Large AU network",         maxPoints:3, minQualify:0 },
    H: { label:"Media / public speaker",   maxPoints:2, minQualify:0 },
    I: { label:"Ready for contact",        maxPoints:3, minQualify:0 },
    J: { label:"Social proof",             maxPoints:2, minQualify:0 },
    K: { label:"Inbound warm-up",          maxPoints:3, minQualify:0 },
  };

  const negatives = {
    L1:{ label:"Recruiter / consultant", penalty:-5, disqualifying:true  },
    N1:{ label:"Job-seeker keywords",    penalty:-3, disqualifying:false },
    N2:{ label:"Unrelated industry",     penalty:-4, disqualifying:false },
    N3:{ label:"Very short tenure",      penalty:-2, disqualifying:false },
    N4:{ label:"Spam-my headline",       penalty:-2, disqualifying:false },
    N5:{ label:"Low credibility signals",penalty:-3, disqualifying:false },
  };

  return { positives, negatives };
}

module.exports = { loadAttributes };