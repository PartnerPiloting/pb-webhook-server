// promptApi.js - UPDATED to use passed-in 'base'

// No longer need: const Airtable = require("airtable");
const { buildPrompt } = require("./promptBuilder.js"); // Assuming promptBuilder is in the same directory

module.exports = function mountPromptAPI(app, base) { // <-- Now accepts 'base'
  // Airtable connection is now passed in as 'base'
  // No internal 'const base = new Airtable(...)' needed here anymore

  if (!base) {
    console.error("promptApi.js: Airtable 'base' instance was not provided. API will not function correctly.");
    // Optionally, you could prevent routes from being mounted if base is missing,
    // but index.js already logs a fatal error if base doesn't initialize.
    // This check is an additional safeguard within the module.
    return; // Stop further execution if base is not available
  }

  /* GET /prompt ------------------------------------------------ */
  app.get("/prompt", async (req, res) => {
    console.log("promptApi.js: GET /prompt hit");
    try {
      const md = await buildPrompt();
      if (req.query.raw) return res.type("text/markdown").send(md);
      res.json({ prompt: md });
    } catch (err) {
      console.error("promptApi.js - Error in /prompt:", err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  });

  /* PATCH /attribute/:id --------------------------------------- */
  app.patch("/attribute/:id", async (req, res) => {
    console.log("promptApi.js: PATCH /attribute/:id hit");
    try {
      const { fieldName, value } = req.body || {};
      if (!fieldName) {
        return res.status(400).json({ error: "fieldName required" });
      }

      const id = req.params.id;
      // Use the passed-in 'base'
      const [rec] = await base("Scoring Attributes")
        .select({ filterByFormula: `{Attribute Id} = "${id}"`, maxRecords: 1 })
        .firstPage();

      if (!rec) return res.status(404).json({ error: "Attribute not found" });

      // Use the passed-in 'base'
      await base("Scoring Attributes").update(rec.id, { [fieldName]: value });
      res.json({ ok: true });
    } catch (err) {
      console.error("promptApi.js - Error in /attribute/:id:", err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  });
};