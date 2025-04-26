/********************************************************************
 * promptBuilder.js
 * ---------------------------------------------------------------
 * Reads every row in the “Scoring Attributes” table and stitches
 * them into one Markdown document for GPT scoring.
 * ---------------------------------------------------------------
 * Requires these env vars (already used elsewhere in your project):
 *   AIRTABLE_API_KEY   = keyXXXXXXXXXXXX
 *   AIRTABLE_BASE_ID   = appXXXXXXXXXXXX
 *******************************************************************/
require("dotenv").config();
const Airtable = require("airtable");

/* Airtable connection */
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
               .base(process.env.AIRTABLE_BASE_ID);

/* Render a single Airtable record into a Markdown line or block */
function renderRow(rec) {
  const cat = rec.get("Category") || "";
  const id  = rec.get("Attribute Id") || "";
  const hd  = rec.get("Heading") || "";
  const txt = (rec.get("Instructions") || "").trim();
  const sig = rec.get("Signals")  ? `<br>**Signals** ${rec.get("Signals")}`   : "";
  const ex  = rec.get("Examples") ? `<br>**Examples** ${rec.get("Examples")}` : "";

  if (cat === "Positive") {
    const max = rec.get("Max Points")     || 0;
    const min = rec.get("Min To Qualify") || 0;
    return { section:"pos",
      line:`| ${id} | **${hd}** | ${max} | ${min} | ${txt}${sig}${ex} |` };
  }
  if (cat === "Negative") {
    const pen  = rec.get("Penalty")       || 0;
    const disq = rec.get("Disqualifying") ? "**Yes**" : "No";
    return { section:"neg",
      line:`| ${id} | **${hd}** | -${pen} | ${disq} | ${txt}${sig}${ex} |` };
  }
  /* Steps / Global rules */
  return { section:"misc", line:`### ${hd}\n${txt}${sig}${ex}\n` };
}

/* PUBLIC: buildPrompt() */
async function buildPrompt() {
  const rows = await base("Scoring Attributes").select().all();

  const pos = [], neg = [], misc = [];
  rows.forEach(r => {
    const { section, line } = renderRow(r);
    if (section === "pos") pos.push(line);
    else if (section === "neg") neg.push(line);
    else misc.push(line);
  });

  return `# ASH Candidate Attribute Scoring Framework (Auto-Generated)

## 1. Purpose
Evaluate LinkedIn profiles to identify candidates who are qualified, motivated, and well-positioned to explore a side-venture opportunity.

---

${misc.join("\n")}

---

## Positive Attributes

| ID | Attribute | Max Points | Min to Qualify | Notes |
|----|-----------|------------|----------------|-------|
${pos.join("\n")}

---

## Negative Attributes

| ID | Attribute | Penalty | Disqualifying? | Notes |
|----|-----------|---------|---------------|-------|
${neg.join("\n")}
`.trim();
}

/* Export as a named property (matches { buildPrompt } import) */
module.exports = { buildPrompt };