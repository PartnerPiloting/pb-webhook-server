require("dotenv").config();
const Airtable = require("airtable");

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
               .base(process.env.AIRTABLE_BASE_ID);

(async () => {
  console.log("▶︎ Back-fill started…");

  /* 1. Get every Lead that does NOT yet have Profile Full JSON */
  const records = await base("Leads")
    .select({ filterByFormula: 'NOT({Profile Full JSON})' })
    .all();

  for (const r of records) {
    try {
      /* 2. Gather the easy-to-read columns */
      const core = {
        firstName:  r.get("First Name"),
        lastName:   r.get("Last Name"),
        headline:   r.get("Headline"),
        locationName: r.get("Location"),
        linkedinDescription: r.get("About"),
        jobTitle:   r.get("Job Title"),
        company:    r.get("Company Name"),
        linkedinProfileUrl: r.get("LinkedIn Profile URL")
      };

      /* 3. Pull in whatever was stored under Raw Profile Data */
      const raw = JSON.parse(r.get("Raw Profile Data") || "{}");

      /* 4. Merge them together */
      const full = { ...core, ...raw };

      /* 5. Save into the new field */
      await base("Leads").update(r.id, {
        "Profile Full JSON": JSON.stringify(full)
      });

      console.log(`✓ patched ${r.id}`);
    } catch (err) {
      console.error(`✗ ${r.id}: ${err.message}`);
    }
  }

  console.log("✓ All done.");
})();