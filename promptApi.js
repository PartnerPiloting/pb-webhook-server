/********************************************************************
 * promptApi.js  –  minimal routes for the ASH framework
 * ---------------------------------------------------------------
 *  • GET    /prompt
 *      returns { prompt: "<markdown>" }
 *      add ?raw=1 to get text/markdown for a browser
 *
 *  • PATCH  /attribute/:id     (body JSON: { fieldName, value })
 *      updates one cell in the Scoring Attributes table
 *
 *  Usage inside index.js:
 *      const app = express();
 *      ...
 *      require("./promptApi")(app);
 *******************************************************************/
const Airtable       = require("airtable");
const { buildPrompt } = require("./promptBuilder");

module.exports = function mountPromptAPI(app) {
  /* Airtable connection ---------------------------------------- */
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
                 .base(process.env.AIRTABLE_BASE_ID);

  /* GET /prompt ------------------------------------------------ */
  app.get("/prompt", async (req, res) => {
    try {
      const md = await buildPrompt();
      if (req.query.raw) return res.type("text/markdown").send(md);
      res.json({ prompt: md });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  /* PATCH /attribute/:id --------------------------------------- */
  app.patch("/attribute/:id", async (req, res) => {
    try {
      const { fieldName, value } = req.body || {};
      if (!fieldName)
        return res.status(400).json({ error: "fieldName required" });

      const id = req.params.id;
      const [rec] = await base("Scoring Attributes")
        .select({ filterByFormula: `{Attribute Id} = "${id}"`, maxRecords: 1 })
        .firstPage();

      if (!rec) return res.status(404).json({ error: "Attribute not found" });

      await base("Scoring Attributes").update(rec.id, { [fieldName]: value });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
};