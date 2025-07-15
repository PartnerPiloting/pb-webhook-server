// attributeLoader.js - UPDATED to use centralized 'base' from config

require("dotenv").config();
// No longer need: const Airtable = require("airtable");

// Import the centralized Airtable base instance
// This path assumes attributeLoader.js is in the project root, and config/ is a subdirectory.
const base = require('./config/airtableClient.js'); 

/* ---------- configuration -------------------------------------- */
const TABLE_NAME = process.env.ATTR_TABLE_NAME || "Scoring Attributes";
// Removed: Airtable.configure(...) and internal const base = ...

/* ---------- helper: strip markdown + collapse whitespace -------- */
function clean(text = "") {
  return String(text)
    .replace(/[*`_~#>\-]|(?:\r?\n|\r)/g, " ")    // remove md chars & newlines
    .replace(/\s+/g, " ")                      // collapse runs of spaces
    .trim();
}

/* ---------- simple cache (10-min TTL) --------------------------- */
let cache = null;
let cacheUntil = 0;

/* ----------------------------------------------------------------
    loadAttributes – fetches Airtable rows (or fallback) and builds
    { preamble, positives, negatives } with token-saving clean-ups
----------------------------------------------------------------- */
async function loadAttributes() {
  // Check if the centralized base was loaded successfully
  if (!base) {
    console.error("⚠︎ attributeLoader.js: Airtable 'base' instance not available from config/airtableClient.js. Using fallback attributes.");
    return fallbackAttributes(); // Proceed with fallback if base isn't available
  }

  const now = Date.now();
  if (cache && now < cacheUntil) {
    // console.log("attributeLoader.js: Serving attributes from cache."); // Optional: for debugging cache hits
    return cache; // serve cached copy
  }

  try {
    console.log("attributeLoader.js: Fetching attributes from Airtable...");
    const rows = await base(TABLE_NAME).select().all(); // Uses the imported 'base'
    const positives = {};
    const negatives = {};
    let   preamble  = "";

    rows.forEach(r => {
      const id    = String(r.get("Attribute Id") || "").trim();
      const cat   = String(r.get("Category")     || "").toLowerCase(); 
      const label = String(r.get("Heading")      || "").trim();

      if (!id) return; 

      if (id === "PREAMBLE" || cat === "meta") {
        preamble = r.get("Instructions") ? String(r.get("Instructions")) : "";
        return; 
      }

      let instructions = clean(r.get("Instructions") || "");
      instructions = instructions.replace(
        /Scoring Range[\s\S]*?\bpts?\b[^]*?(?=\s[A-Z0-9]{1,2}\b|$)/i,
        ""
      ).trim();

      const common = {
        label,
        instructions,
        examples : clean(r.get("Examples") || ""),
        signals  : clean(r.get("Signals")  || "")
      };

      if (!common.examples) delete common.examples;

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
          penalty       : penalty <= 0 ? penalty : -penalty, 
          disqualifying: !!r.get("Disqualifying")
        };
      }
    });

    cache = { preamble, positives, negatives }; 
    cacheUntil = now + 10 * 60 * 1000;          // 10-minute cache
    console.log(
      `attributeLoader.js: • Loaded ${rows.length} rows  →  ` +
      `${Object.keys(positives).length} positives, ` +
      `${Object.keys(negatives).length} negatives. Cached for 10 minutes.`
    );
    return cache;
  } catch (err) {
    console.error("⚠︎ attributeLoader.js: Attribute fetch from Airtable failed – using fallback list.", err.message);
    return fallbackAttributes();
  }
}

/* ----------------------------------------------------------------
    loadAttributeForEditing – fetches a single attribute with draft fields
    Returns: { live: {...}, draft: {...} } for the editing UI
----------------------------------------------------------------- */
async function loadAttributeForEditing(attributeId) {
  if (!base) {
    throw new Error("Airtable base not available");
  }

  try {
    const record = await base(TABLE_NAME).find(attributeId);
    
    const live = {
      id: record.id,
      heading: record.get("Heading") || "",
      instructions: record.get("Instructions") || "",
      maxPoints: Number(record.get("Max Points") || 0),
      minToQualify: Number(record.get("Min To Qualify") || 0),
      penalty: Number(record.get("Penalty") || 0),
      category: record.get("Category") || "",
      disqualifying: !!record.get("Disqualifying")
    };

    const draft = {
      heading: record.get("Draft Heading") || null,
      instructions: record.get("Draft Instructions") || null,
      maxPoints: record.get("Draft Max Points") || null,
      minToQualify: record.get("Draft Min To Qualify") || null,
      penalty: record.get("Draft Penalty") || null,
      updatedAt: record.get("Draft Updated At") || null
    };

    return { live, draft };
  } catch (error) {
    console.error("Error loading attribute for editing:", error);
    throw error;
  }
}

/* ----------------------------------------------------------------
    updateAttributeDraft – saves draft fields without affecting live
----------------------------------------------------------------- */
async function updateAttributeDraft(attributeId, draftData) {
  if (!base) {
    throw new Error("Airtable base not available");
  }

  try {
    const updateFields = {
      "Draft Heading": draftData.heading,
      "Draft Instructions": draftData.instructions,
      "Draft Max Points": draftData.maxPoints,
      "Draft Min To Qualify": draftData.minToQualify,
      "Draft Penalty": draftData.penalty,
      "Draft Updated At": new Date().toISOString()
    };

    await base(TABLE_NAME).update(attributeId, updateFields);
    
    // Clear cache since draft changed
    cache = null;
    cacheUntil = 0;
    
    return { success: true };
  } catch (error) {
    console.error("Error updating attribute draft:", error);
    throw error;
  }
}

/* ----------------------------------------------------------------
    publishAttributeDraft – copies draft fields to live fields
----------------------------------------------------------------- */
async function publishAttributeDraft(attributeId) {
  if (!base) {
    throw new Error("Airtable base not available");
  }

  try {
    const record = await base(TABLE_NAME).find(attributeId);
    
    const updateFields = {
      "Heading": record.get("Draft Heading"),
      "Instructions": record.get("Draft Instructions"),
      "Max Points": record.get("Draft Max Points"),
      "Min To Qualify": record.get("Draft Min To Qualify"),
      "Penalty": record.get("Draft Penalty"),
      // Clear draft fields
      "Draft Heading": null,
      "Draft Instructions": null,
      "Draft Max Points": null,
      "Draft Min To Qualify": null,
      "Draft Penalty": null,
      "Draft Updated At": null
    };

    await base(TABLE_NAME).update(attributeId, updateFields);
    
    // Clear cache since live data changed
    cache = null;
    cacheUntil = 0;
    
    return { success: true };
  } catch (error) {
    console.error("Error publishing attribute draft:", error);
    throw error;
  }
}

/* ----------------------------------------------------------------
    discardAttributeDraft – clears all draft fields
----------------------------------------------------------------- */
async function discardAttributeDraft(attributeId) {
  if (!base) {
    throw new Error("Airtable base not available");
  }

  try {
    const updateFields = {
      "Draft Heading": null,
      "Draft Instructions": null,
      "Draft Max Points": null,
      "Draft Min To Qualify": null,
      "Draft Penalty": null,
      "Draft Updated At": null
    };

    await base(TABLE_NAME).update(attributeId, updateFields);
    return { success: true };
  } catch (error) {
    console.error("Error discarding attribute draft:", error);
    throw error;
  }
}

/* ---------- fallback list (unchanged, but with preamble:"") ----- */
function fallbackAttributes() {
  // ... (fallbackAttributes function remains the same as you provided)
  const positives = { A: { label:"Founder / Co-Founder",maxPoints:5,minQualify:0,instructions:"",examples:"",signals:""},B:{label:"C-Suite / Director",maxPoints:5,minQualify:0,instructions:"",examples:"",signals:""},C:{label:"Tech / Product seniority",maxPoints:3,minQualify:0,instructions:"",examples:"",signals:""},D:{label:"Prior exit",maxPoints:5,minQualify:0,instructions:"",examples:"",signals:""},E:{label:"Raised funding",maxPoints:4,minQualify:0,instructions:"",examples:"",signals:""},F:{label:"Hiring team",maxPoints:3,minQualify:0,instructions:"",examples:"",signals:""},G:{label:"Large AU network",maxPoints:3,minQualify:0,instructions:"",examples:"",signals:""},H:{label:"Media / public speaker",maxPoints:2,minQualify:0,instructions:"",examples:"",signals:""},I:{label:"Ready for contact",maxPoints:3,minQualify:0,instructions:"",examples:"",signals:""},J:{label:"Social proof",maxPoints:2,minQualify:0,instructions:"",examples:"",signals:""},K:{label:"Inbound warm-up",maxPoints:3,minQualify:0,instructions:"",examples:"",signals:""}};
  const negatives = {L1:{label:"Recruiter / consultant",penalty:-5,disqualifying:true,instructions:"",examples:"",signals:""},N1:{label:"Job-seeker keywords",penalty:-3,disqualifying:false,instructions:"",examples:"",signals:""},N2:{label:"Unrelated industry",penalty:-4,disqualifying:false,instructions:"",examples:"",signals:""},N3:{label:"Very short tenure",penalty:-2,disqualifying:false,instructions:"",examples:"",signals:""},N4:{label:"Spam-my headline",penalty:-2,disqualifying:false,instructions:"",examples:"",signals:""},N5:{label:"Low credibility signals",penalty:-3,disqualifying:false,instructions:"",examples:"",signals:""}};
  return { preamble:"", positives, negatives };
}

module.exports = { loadAttributes, loadAttributeForEditing, updateAttributeDraft, publishAttributeDraft, discardAttributeDraft };