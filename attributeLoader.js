// attributeLoader.js - MULTI-TENANT SUPPORT: Updated to use client-specific bases

require("dotenv").config();
const { createLogger } = require('./utils/contextLogger');

// Import multi-tenant Airtable client functions
const { getClientBase } = require('./config/airtableClient.js');
const base = require('./config/airtableClient.js'); // Fallback for backward compatibility 

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

/* ---------- simple cache (10-min TTL) - Multi-tenant aware --------------------------- */
let cache = {}; // Changed to object to support per-client caching
let cacheUntil = 0;

/* ----------------------------------------------------------------
    loadAttributes – fetches Airtable rows (or fallback) and builds
    { preamble, positives, negatives } with token-saving clean-ups
    MULTI-TENANT: Now accepts optional clientId parameter
----------------------------------------------------------------- */
async function loadAttributes(logger = null, clientId = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attribute_loader' });
  }

  logger.info( `Starting attribute loading from Airtable${clientId ? ` for client: ${clientId}` : ''}`);

  // Get the appropriate base instance
  let attributeBase;
  if (clientId) {
    // Multi-tenant mode: use client-specific base
    attributeBase = await getClientBase(clientId);
    if (!attributeBase) {
      logger.error('loadAttributes', `Invalid client ID: ${clientId} - cannot load attributes.`);
      throw new Error(`Invalid client ID: ${clientId} - cannot load attributes.`);
    }
  } else {
    // Legacy mode: use global base for backward compatibility
    attributeBase = base;
    if (!attributeBase) {
      logger.error('loadAttributes', 'Airtable base instance not available from config/airtableClient.js - cannot load attributes.');
      throw new Error('Airtable base instance not available from config/airtableClient.js - cannot load attributes.');
    }
  }

  const now = Date.now();
  // Use client-specific cache key to prevent cross-client cache pollution
  const cacheKey = clientId || 'global';
  if (cache && cache[cacheKey] && now < cacheUntil) {
    logger.debug('loadAttributes', `Serving attributes from cache for ${cacheKey}`);
    return cache[cacheKey]; // serve cached copy
  }

  try {
    logger.debug( `Fetching attributes from Airtable table: ${TABLE_NAME}`);
    const rows = await attributeBase(TABLE_NAME).select().all(); // Uses the client-specific base
    const positives = {};
    const negatives = {};
    let   preamble  = "";

    rows.forEach(r => {
      const id    = String(r.get("Attribute Id") || "").trim();
      const cat   = String(r.get("Category")     || "").toLowerCase(); 
      const label = String(r.get("Heading")      || "").trim();
      const isActive = !!r.get("Active"); // Convert to boolean: unchecked = false, checked = true

      if (!id) return;
      
      // Skip inactive attributes (unless they're PREAMBLE/meta)
      if (!isActive && id !== "PREAMBLE" && cat !== "meta") {
        logger.debug('loadAttributes', `Skipping inactive attribute ${id}`);
        return;
      } 

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
          minQualify: Number(r.get("Min To Qualify") || 0),
          bonusPoints: !!r.get("Bonus Points")
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

    const result = { preamble, positives, negatives };
    
    // Store in client-specific cache
    if (!cache) cache = {};
    cache[cacheKey] = result;
    cacheUntil = now + 10 * 60 * 1000;          // 10-minute cache
    
    logger.summary('loadAttributes', 
      `Loaded ${rows.length} rows → ${Object.keys(positives).length} positives, ` +
      `${Object.keys(negatives).length} negatives. Cached for 10 minutes for ${cacheKey}.`
    );
    return result;
  } catch (err) {
    logger.error('loadAttributes', `Attribute fetch from Airtable failed for client ${clientId || 'global'}: ${err.message}`);
    throw new Error(`Attribute fetch from Airtable failed for client ${clientId || 'global'}: ${err.message}`);
  }
}

/* ----------------------------------------------------------------
    loadAttributeForEditing – fetches a single attribute for editing
    Returns: complete attribute object with all fields
    LEGACY VERSION: Uses global base for backward compatibility
----------------------------------------------------------------- */
async function loadAttributeForEditing(attributeId, logger = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attr_edit' });
  }

  try {
    logger.info( `Loading attribute ${attributeId} for editing`);
    
    if (!base) {
      logger.error('loadAttributeForEditing', 'Airtable base not available from config/airtableClient.js');
      throw new Error("Airtable base not available from config/airtableClient.js");
    }
    
    const record = await base(TABLE_NAME).find(attributeId);
    
    const attribute = {
      id: record.id,
      attributeId: record.get("Attribute Id") || "",
      heading: record.get("Heading") || "",
      category: record.get("Category") || "",
      instructions: record.get("Instructions") || "",
      maxPoints: Number(record.get("Max Points") || 0),
      minToQualify: Number(record.get("Min To Qualify") || 0),
      penalty: Number(record.get("Penalty") || 0),
      disqualifying: !!record.get("Disqualifying"),
      bonusPoints: !!record.get("Bonus Points"), // Convert to boolean: unchecked = false, checked = true
      signals: record.get("Signals") || "",
      examples: record.get("Examples") || "",
      active: !!record.get("Active") // Convert to boolean: unchecked = false, checked = true
    };
    
    logger.summary('loadAttributeForEditing', `Successfully loaded attribute ${attributeId}`);
    return attribute;
  } catch (error) {
    logger.error('loadAttributeForEditing', `Error loading attribute ${attributeId}: ${error.message}`);
    throw new Error(`Failed to load attribute: ${error.message}`);
  }
}

/* ----------------------------------------------------------------
    updateAttribute – saves changes directly to live fields
----------------------------------------------------------------- */
async function updateAttribute(attributeId, data, logger = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attr_update' });
  }

  try {
    logger.info( `Updating attribute ${attributeId} with fields: ${Object.keys(data).join(', ')}`);
    
    if (!base) {
      logger.error('updateAttribute', 'Airtable base not available from config/airtableClient.js');
      throw new Error("Airtable base not available from config/airtableClient.js");
    }
    
    const updateFields = {};
    
    // Only update fields that are provided
    if (data.heading !== undefined) updateFields["Heading"] = data.heading;
    if (data.instructions !== undefined) updateFields["Instructions"] = data.instructions;
    if (data.maxPoints !== undefined) updateFields["Max Points"] = Number(data.maxPoints);
    if (data.minToQualify !== undefined) updateFields["Min To Qualify"] = Number(data.minToQualify);
    if (data.penalty !== undefined) updateFields["Penalty"] = Number(data.penalty);
    if (data.disqualifying !== undefined) updateFields["Disqualifying"] = !!data.disqualifying;
    if (data.bonusPoints !== undefined) updateFields["Bonus Points"] = !!data.bonusPoints;
    if (data.signals !== undefined) updateFields["Signals"] = data.signals;
    if (data.examples !== undefined) updateFields["Examples"] = data.examples;
    if (data.active !== undefined) updateFields["Active"] = !!data.active;

    const record = await base(TABLE_NAME).update(attributeId, updateFields);
    
    // Clear cache since live data changed
    cache = null;
    cacheUntil = 0;
    
    logger.summary('updateAttribute', `Successfully updated attribute ${attributeId}`);
    return { success: true, id: record.id };
  } catch (error) {
    logger.error('updateAttribute', `Error updating attribute ${attributeId}: ${error.message}`);
    throw new Error(`Failed to update attribute: ${error.message}`);
  }
}

/* ----------------------------------------------------------------
    listAttributesForEditing – fetches all attributes for the library view
----------------------------------------------------------------- */
async function listAttributesForEditing(logger = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attr_list' });
  }

  try {
    logger.info( 'Loading all attributes for editing');
    
    if (!base) {
      logger.error('listAttributesForEditing', 'Airtable base not available from config/airtableClient.js');
      throw new Error("Airtable base not available from config/airtableClient.js");
    }
    
    const records = await base(TABLE_NAME)
      .select({
        fields: [
          "Attribute Id", "Heading", "Category", "Max Points", 
          "Min To Qualify", "Penalty", "Disqualifying", "Bonus Points", "Active"
        ]
      })
      .all();
      
    const attributes = records.map(record => ({
      id: record.id,
      attributeId: record.get("Attribute Id") || "",
      heading: record.get("Heading") || "[Unnamed Attribute]",
      category: record.get("Category") || "",
      maxPoints: Number(record.get("Max Points") || 0),
      minToQualify: Number(record.get("Min To Qualify") || 0),
      penalty: Number(record.get("Penalty") || 0),
      disqualifying: !!record.get("Disqualifying"),
      bonusPoints: !!record.get("Bonus Points"), // Convert to boolean: unchecked = false, checked = true
      active: !!record.get("Active"), // Convert to boolean: unchecked = false, checked = true
      isEmpty: !record.get("Heading") && !record.get("Instructions")
    }));
    
    logger.summary('listAttributesForEditing', `Successfully loaded ${attributes.length} attributes for editing`);
    return attributes;
  } catch (error) {
    logger.error('listAttributesForEditing', `Error loading attributes for editing: ${error.message}`);
    throw new Error(`Failed to load attributes: ${error.message}`);
  }
}

/* ---------- fallback list (unchanged, but with preamble:"") ----- */
/* ----------------------------------------------------------------
    loadAttributeForEditingWithClientBase – fetches a single attribute for editing from client-specific base
    Returns: complete attribute object with all fields
----------------------------------------------------------------- */
async function loadAttributeForEditingWithClientBase(attributeId, clientBase, logger = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attr_edit_client' });
  }

  try {
    logger.info( `Loading attribute ${attributeId} for editing from client base`);
    
    if (!clientBase) {
      logger.error('loadAttributeForEditingWithClientBase', 'Client-specific Airtable base not provided');
      throw new Error("Client-specific Airtable base not provided");
    }
    
    const record = await clientBase(TABLE_NAME).find(attributeId);
    
    const attribute = {
      id: record.id,
      attributeId: record.get("Attribute Id") || "",
      heading: record.get("Heading") || "",
      category: record.get("Category") || "",
      instructions: record.get("Instructions") || "",
      maxPoints: Number(record.get("Max Points") || 0),
      minToQualify: Number(record.get("Min To Qualify") || 0),
      penalty: Number(record.get("Penalty") || 0),
      disqualifying: !!record.get("Disqualifying"),
      bonusPoints: !!record.get("Bonus Points"), // Convert to boolean: unchecked = false, checked = true
      signals: record.get("Signals") || "",
      examples: record.get("Examples") || "",
      active: !!record.get("Active") // Convert to boolean: unchecked = false, checked = true
    };
    
    logger.summary('loadAttributeForEditingWithClientBase', `Successfully loaded attribute ${attributeId} from client base`);
    return attribute;
  } catch (error) {
    logger.error('loadAttributeForEditingWithClientBase', `Error loading attribute ${attributeId}: ${error.message}`);
    throw new Error(`Failed to load attribute: ${error.message}`);
  }
}

/* ----------------------------------------------------------------
    updateAttributeWithClientBase – saves changes to client-specific base
----------------------------------------------------------------- */
async function updateAttributeWithClientBase(attributeId, data, clientBase, logger = null) {
  // Initialize logger if not provided (backward compatibility)
  if (!logger) {
    logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'attr_update_client' });
  }

  try {
    logger.info( `Updating attribute ${attributeId} with fields: ${Object.keys(data).join(', ')}`);
    
    if (!clientBase) {
      logger.error('updateAttributeWithClientBase', 'Client-specific Airtable base not provided');
      throw new Error("Client-specific Airtable base not provided");
    }
    
    const updateFields = {};
    
    // Only update fields that are provided
    if (data.heading !== undefined) updateFields["Heading"] = data.heading;
    if (data.instructions !== undefined) updateFields["Instructions"] = data.instructions;
    if (data.maxPoints !== undefined) updateFields["Max Points"] = Number(data.maxPoints);
    if (data.minToQualify !== undefined) updateFields["Min To Qualify"] = Number(data.minToQualify);
    if (data.penalty !== undefined) updateFields["Penalty"] = Number(data.penalty);
    if (data.disqualifying !== undefined) updateFields["Disqualifying"] = !!data.disqualifying;
    if (data.bonusPoints !== undefined) updateFields["Bonus Points"] = !!data.bonusPoints;
    if (data.signals !== undefined) updateFields["Signals"] = data.signals;
    if (data.examples !== undefined) updateFields["Examples"] = data.examples;
    if (data.active !== undefined) updateFields["Active"] = !!data.active;

    const record = await clientBase(TABLE_NAME).update(attributeId, updateFields);
    
    // Clear cache since live data changed
    cache = null;
    
    logger.summary('updateAttributeWithClientBase', `Successfully updated attribute ${attributeId}`);
    return record;
  } catch (error) {
    logger.error('updateAttributeWithClientBase', `Error updating attribute ${attributeId}: ${error.message}`);
    throw new Error(`Failed to update attribute: ${error.message}`);
  }
}



module.exports = { 
  loadAttributes, 
  loadAttributeForEditing, 
  loadAttributeForEditingWithClientBase,
  updateAttribute,
  updateAttributeWithClientBase,
  listAttributesForEditing 
};