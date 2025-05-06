/* ===================================================================
   attributeLoader.js – dynamic attribute list (matches your table)
   ------------------------------------------------------------------
   • Reads the “Scoring Attributes” Airtable table
   • Converts each row into { positives, negatives } dictionaries
   • Includes rich guidance (Instructions / Examples / Signals) with
     markdown stripped and whitespace collapsed
   • 10-minute in-memory cache to minimise API calls
   • Falls back to a hard-coded list if Airtable is unreachable
=================================================================== */
require("dotenv").config();
const Airtable = require("airtable");

/* ---------- configuration -------------------------------------- */
const TABLE_NAME = process.env.ATTR_TABLE_NAME || "Scoring Attributes";
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- helper: strip markdown + collapse whitespace -------- */
function clean(text = "") {
  return String(text)
    .replace(/[*`_~#>\-]|(?:\r?\n|\r)/g, " ") // remove md chars & newlines
    .replace(/\s+/g, " ")                    // collapse runs of spaces
    .trim();
}

/* ---------- simple cache (10-min TTL) --------------------------- */
let cache = null;
let cacheUntil = 0;

/* ---------- public: loadAttributes ------------------------------ */
async function loadAttributes() {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;      // serve cached copy

  try {
    const rows = await base(TABLE_NAME).select().all();
    const positives = {};
    const negatives = {};

    rows.forEach(r => {
      /* --- map your column names exactly ------------------------ */
      const id    = String(r.get("Attribute Id") || "").trim();
      const cat   = String(r.get("Category")     || "").toLowerCase(); // positive | negative
      const label = String(r.get("Heading")      || "").trim();

      if (!id || !label) return;                           // skip bad rows

      const common = {
        label,
        instructions: clean(r.get("Instructions") || ""),
        examples    : clean(r.get("Examples")     || ""),
        signals     : clean(r.get("Signals")      || "")
      };

      if (cat === "positive") {
        positives[id] = {
          ...common,
          maxPoints : Number(r.get("Max Points")     || 0),
          minQualify: Number(r.get("Min To Qualify") || 0)
        };
      } else if (cat === "negative") {
        const penalty = Number(r.get("Penalty") || 0);
        negatives[id] = {
          ...common,
          penalty      : penalty <= 0 ? penalty : -penalty, // ensure negative
          disqualifying: !!r.get("Disqualifying")
        };
      }
    });

    cache = { positives, negatives };
    cacheUntil = now + 10 * 60 * 1000;             // 10-minute cache
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
function fallbackAttributes() {
  const positives = {
    A: { label:"Founder / Co-Founder",     maxPoints:5, minQualify:0,
         instructions:"", examples:"", signals:"" },
    B: { label:"C-Suite / Director",       maxPoints:5, minQualify:0,
         instructions:"", examples:"", signals:"" },
    C: { label:"Tech / Product seniority", maxPoints:3, minQualify:0,
         instructions:"", examples:"", signals:"" },
    D: { label:"Prior exit",               maxPoints:5, minQualify:0,
         instructions:"", examples:"", signals:"" },
    E: { label:"Raised funding",           maxPoints:4, minQualify:0,
         instructions:"", examples:"", signals:"" },
    F: { label:"Hiring team",              maxPoints:3, minQualify:0,
         instructions:"", examples:"", signals:"" },
    G: { label:"Large AU network",         maxPoints:3, minQualify:0,
         instructions:"", examples:"", signals:"" },
    H: { label:"Media / public speaker",   maxPoints:2, minQualify:0,
         instructions:"", examples:"", signals:"" },
    I: { label:"Ready for contact",        maxPoints:3, minQualify:0,
         instructions:"", examples:"", signals:"" },
    J: { label:"Social proof",             maxPoints:2, minQualify:0,
         instructions:"", examples:"", signals:"" },
    K: { label:"Inbound warm-up",          maxPoints:3, minQualify:0,
         instructions:"", examples:"", signals:"" }
  };

  const negatives = {
    L1:{ label:"Recruiter / consultant", penalty:-5, disqualifying:true,
         instructions:"", examples:"", signals:"" },
    N1:{ label:"Job-seeker keywords",    penalty:-3, disqualifying:false,
         instructions:"", examples:"", signals:"" },
    N2:{ label:"Unrelated industry",     penalty:-4, disqualifying:false,
         instructions:"", examples:"", signals:"" },
    N3:{ label:"Very short tenure",      penalty:-2, disqualifying:false,
         instructions:"", examples:"", signals:"" },
    N4:{ label:"Spam-my headline",       penalty:-2, disqualifying:false,
         instructions:"", examples:"", signals:"" },
    N5:{ label:"Low credibility signals",penalty:-3, disqualifying:false,
         instructions:"", examples:"", signals:"" }
  };

  return { positives, negatives };
}

module.exports = { loadAttributes };