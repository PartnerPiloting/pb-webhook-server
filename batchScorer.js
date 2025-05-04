/* ===================================================================
   batchScorer.js  –  GPT-4o flex-window batch scorer
   (pull “To Be Scored” leads, submit /v1/batches, write AI fields back)
=================================================================== */
require("dotenv").config();
const fs       = require("fs");
const path     = require("path");
const fetch    = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const FormData = require("form-data");
const Airtable = require("airtable");
const { buildPrompt } = require("./promptBuilder");

/* ---------- config ------------------------------------------------ */
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_KEY  = process.env.AIRTABLE_API_KEY;
const OPENAI_KEY    = process.env.OPENAI_API_KEY;

const MODEL          = "gpt-4o";   // per-line now, not in envelope
const COMPLETION_WIN = "24h";
const MAX_PER_RUN    = Number(process.env.MAX_BATCH || 500);
/* ------------------------------------------------------------------ */

Airtable.configure({ apiKey: AIRTABLE_KEY });
const base = Airtable.base(AIRTABLE_BASE);

/* ---------- pull leads with Scoring Status = “To Be Scored” ------- */
async function fetchCandidates(limit) {
  const out = [];
  await base("Leads")
    .select({
      pageSize       : 100,
      filterByFormula: '{Scoring Status} = "To Be Scored"',
    })
    .eachPage((records, next) => {
      for (const r of records) {
        if (out.length >= limit) return;
        out.push(r);
      }
      if (out.length < limit) next();
    });
  return out;
}

/* ---------- upload JSONL to OpenAI -------------------------------- */
async function uploadJSONL(lines) {
  const tmp = path.join(__dirname, "batch.jsonl");
  fs.writeFileSync(tmp, lines.join("\n"));

  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", fs.createReadStream(tmp));

  const res = await fetch("https://api.openai.com/v1/files", {
    method : "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body   : form,
  }).then(r => r.json());

  fs.unlinkSync(tmp);
  if (!res.id) throw new Error("File upload failed: " + JSON.stringify(res));
  return res.id;
}

/* ---------- submit the batch job ---------------------------------- */
async function submitBatch(fileId) {
  const body = {
    input_file_id    : fileId,
    endpoint         : "/v1/chat/completions",   // required
    type             : "jsonl",
    completion_window: COMPLETION_WIN,
  };

  const res = await fetch("https://api.openai.com/v1/batches", {
    method : "POST",
    headers: {
      Authorization : `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then(r => r.json());

  if (!res.id) throw new Error("Batch submit failed: " + JSON.stringify(res));
  return res.id;
}

/* ---------- poll until finished ----------------------------------- */
async function pollBatch(id) {
  while (true) {
    const j = await fetch(`https://api.openai.com/v1/batches/${id}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    }).then(r => r.json());

    if (["completed", "completed_with_errors", "failed", "expired"].includes(j.status))
      return j;

    await new Promise(r => setTimeout(r, 60_000));
  }
}

/* ---------- download output file ---------------------------------- */
async function downloadResult(batchJson) {
  const fileId = batchJson.output_file_id;
  const url    = `https://api.openai.com/v1/files/${fileId}/content`;
  const txt    = await fetch(url, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
  }).then(r => r.text());

  return txt.trim().split("\n").map(l => JSON.parse(l));
}

/* ---------- build one JSONL line ---------------------------------- */
function buildPromptLine(prompt, leadObj) {
  return JSON.stringify({
    model   : MODEL,
    messages: [
      { role: "system", content: prompt },
      { role: "user",   content: `Lead:\n${JSON.stringify(leadObj, null, 2)}` },
    ],
  });
}

/* ---------- main runner ------------------------------------------- */
async function run(limit = MAX_PER_RUN) {
  const records = await fetchCandidates(limit);
  if (records.length === 0) {
    console.log("No records need scoring – exit.");
    return;
  }
  console.log(`Scoring ${records.length} leads…`);

  const prompt = await buildPrompt();
  const lines  = [];
  const ids    = [];

  for (const r of records) {
    lines.push(buildPromptLine(prompt, JSON.parse(r.get("Profile Full JSON") || "{}")));
    ids.push(r.id);
  }

  const batchId = await submitBatch(await uploadJSONL(lines));
  console.log("Batch ID:", batchId);

  let result = await pollBatch(batchId);
  if (["expired", "failed"].includes(result.status)) {
    console.log("Batch failed/expired – retrying once.");
    result = await pollBatch(await submitBatch(await uploadJSONL(lines)));
  }
  if (!["completed", "completed_with_errors"].includes(result.status))
    throw new Error("Batch did not complete: " + result.status);

  const rows  = await downloadResult(result);
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const out = rows[i];
    if (out.error) continue;

    await base("Leads").update(ids[i], {
      "AI Score"             : Math.round((out.final_score || out.finalPct || 0) * 100) / 100,
      "AI Profile Assessment": out.aiProfileAssessment || "",
      "AI Attribute Breakdown": out.attribute_breakdown || "",
      "Scoring Status"       : "Scored",
      "Date Scored"          : new Date(),
      "AI_Excluded"          : (out.ai_excluded || "No") === "Yes",
      "Exclude Details"      : out.exclude_details || "",
    });
    updated++;
  }
  console.log(`Updated ${updated} Airtable rows.`);
}

module.exports = { run };