/********************************************************************
 * recordApi.js  –  expose a single GET /profileRecord?id=RECORD_ID
 *******************************************************************/
const Airtable = require("airtable");

module.exports = function mountRecordAPI(app) {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
                 .base(process.env.AIRTABLE_BASE_ID);

  app.get("/profileRecord", async (req, res) => {
    try {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id query param required" });

      const row = await base("Leads").find(id);
      const json = JSON.parse(row.get("Profile Full JSON") || "{}");

      res.json({ profile: json });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
};