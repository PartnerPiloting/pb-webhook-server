const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

/****************************************************************

  GET /latest-lead  →  returns selected fields for the “current” lead
  (current = record ID stored in Credentials → Record ID for Chat)
*****************************************************************/
module.exports = function latestLeadApi(app, base) {
    app.get("/latest-lead", async (_req, res) => {
      try {
        // 1  pointer row
        const credsRow = (await base("Credentials")
                          .select({ maxRecords: 1 }).firstPage())[0];
        if (!credsRow) throw new Error("No Credentials row");
  
        const wanted = (credsRow.get("GPT Visible Fields") || "")
          .split(/[,]/)            // comma-separated list
          .map(f => f.trim())
          .filter(Boolean);        // removes blanks / trailing comma
  
        const recordId = credsRow.get("Record ID for Chat");
        if (!recordId) throw new Error("No Record ID in Credentials");
  
        // 2  fetch the lead
        const rec = await base("Leads").find(recordId);
  
        // 3  keep only requested fields
        const cleaned = {};
        for (const f of wanted) cleaned[f] = rec.get(f);
  
        res.json(cleaned);
      } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
      }
    });
  };
