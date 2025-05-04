/* ===================================================================
   attributeLoader.js – dynamic attribute list (matches your table)
   ------------------------------------------------------------------
   • Reads the “Scoring Attributes” Airtable table
   • Converts each row into { positives, negatives } dictionaries
   • 10-minute in-memory cache to minimise API calls
   • Falls back to a hard-coded list if Airtable is unreachable
=================================================================== */
require("dotenv").config();
const Airtable = require("airtable");

/* ---------- configuration -------------------------------------- */
const TABLE_NAME = process.env.ATTR_TABLE_NAME || "Scoring Attributes";
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- simple cache (10-min TTL) --------------------------- */
let cache = null;
let cacheUntil = 0;

/* ---------- public: loadAttributes ------------------------------ */
async function loadAttributes () {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;          // serve cached copy

  try {
    const rows = await base(TABLE_NAME).select().all();
    const positives = {};
    const negatives = {};

    rows.forEach(r => {
      /* --- map your column names exactly ------------------------ */
      const id     = String(r.get("Attribute Id") || "").trim();
      const cat    = String(r.get("Category")     || "").toLowerCase(); // positive / negative
      const label  = String(r.get("Heading")      || "").trim();

      if (!id || !label) return;                               // skip bad rows

      if (cat === "positive") {
        positives[id] = {
          label,
          maxPoints : Number(r.get("Max Points")      || 0),
          minQualify: Number(r.get("Min To Qualify")  || 0),
        };
      } else if (cat === "negative") {
        const penalty = Number(r.get("Penalty") || 0);
        negatives[id] = {
          label,
          penalty      : penalty <= 0 ? penalty : -penalty,   // ensure negative
          disqualifying: !!r.get("Disqualifying"),
        };
      }
    });

    cache = { positives, negatives };
    cacheUntil = now + 10 * 60 * 1000;                      // 10-minute cache
    console.log(
      `• Loaded ${rows.length} rows  →  ` +
      `${Object.keys(positives).length} positives, ` +
      `${Object.keys(negatives).length} negatives`
    );
    return cache;
  } catch (err) {
    console.error("⚠︎ Attribute fetch failed – using fallback list", err);
    return fallbackAttributes();
  }
}

/* ---------- fallback list (same defaults as before) ------------- */
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