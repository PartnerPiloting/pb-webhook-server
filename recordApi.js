// recordApi.js - UPDATED to use passed-in 'base'

// No longer need: const Airtable = require("airtable");

module.exports = function mountRecordAPI(app, base) { // <-- Now accepts 'base'
  // Airtable connection is now passed in as 'base'

  if (!base) {
    console.error("recordApi.js: Airtable 'base' instance was not provided. API will not function correctly.");
    return; // Stop further execution if base is not available
  }

  app.get("/profileRecord", async (req, res) => {
    console.log("recordApi.js: GET /profileRecord hit");
    try {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id query param required" });

      // Use the passed-in 'base'
      const row = await base("Leads").find(id);
      const json = JSON.parse(row.get("Profile Full JSON") || "{}");

      res.json({ profile: json });
    } catch (err) {
      console.error("recordApi.js - Error in /profileRecord:", err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  });
};