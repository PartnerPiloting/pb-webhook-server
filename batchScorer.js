/* ===================================================================
   batchScorer.js — GPT-4o Flex batch scorer (dynamic attributes, slim prompt)
   -------------------------------------------------------------------
   • Pulls Airtable leads where Scoring Status = “To Be Scored”
   • Builds JSONL with:   slimLead() + compact JSON framework prompt
   • Submits /v1/batches  (24-h flex window) and polls until done
   • Writes scores back to Airtable
   • Uses live attribute dictionaries from attributeLoader.js
=================================================================== */
require("dotenv").config();
console.log("▶︎ batchScorer module loaded");

const fs       = require("fs");
const path     = require("path");
const fetch    = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const FormData = require("form-data");
const Airtable = require("airtable");
const { buildPrompt, slimLead } = require("./promptBuilder");
const { loadAttributes }        = require("./attributeLoader");  // dynamic list
const { computeFinalScore }     = require("./scoring");          // your helper

/* ---------- config ------------------------------------------------ */
const {
  AIRTABLE_BASE_ID: AIRTABLE_BASE,
  AIRTABLE_API_KEY: AIRTABLE_KEY,
  OPENAI_API_KEY  : OPENAI_KEY
} = process.env;

const MODEL          = "gpt-4o";
const COMPLETION_WIN = "24h";
const MAX_PER_RUN    = Number(process.env.MAX_BATCH || 500);

/* ---------- Airtable connection ---------------------------------- */
Airtable.configure({ apiKey: AIRTABLE_KEY });
const base = Airtable.base(AIRTABLE_BASE);

/* ---------- fetchCandidates (one-shot, no hang) ------------------ */
async function fetchCandidates(limit) {
  const recs = await base("Leads")
    .select({
      maxRecords      : limit,
      pageSize        : limit,
      filterByFormula : '{Scoring Status} = "To Be Scored"',
    })
    .firstPage();

  console.log(`• Airtable returned ${recs.length} candidate(s)`);
  return recs;
}

/* ---------- helper: build one JSONL line ------------------------- */
function buildPromptLine(prompt, leadJson, recId) {
  return JSON.stringify({
    custom_id: recId,
    method   : "POST",
    url      : "/v1/chat/completions",
    body     : {
      model   : MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: `Lead:\n${JSON.stringify(leadJson, null, 2)}` }
      ]
    }
  });
}

/* ---------- upload JSONL file ------------------------------------ */
async function uploadJSONL(lines) {
  const tmp = path.join(__dirname, "batch.jsonl");
  fs.writeFileSync(tmp, lines.join("\n"));
  console.log(`• JSONL prepared → ${lines.length} line(s)`);

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
  console.log(`✔︎ JSONL uploaded → fileId ${res.id}`);
  return res.id;
}

/* ---------- submit batch job ------------------------------------- */
async function submitBatch(fileId) {
  const body = {
    input_file_id    : fileId,
    endpoint         : "/v1/chat/completions",
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
  console.log(`✔︎ Batch submitted → batchId ${res.id} (status: ${res.status})`);
  return res.id;
}

/* ---------- poll batch until terminal state ---------------------- */
async function pollBatch(id) {
  let poll = 0;
  while (true) {
    const j = await fetch(`https://api.openai.com/v1/batches/${id}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    }).then(r => r.json());

    poll++;
    console.log(`  ↻ Poll #${poll} – status ${j.status}, ok ${j.num_completed}, err ${j.num_failed}`);

    if (["failed", "expired"].includes(j.status))
      console.error("⨯ Batch failed details:", JSON.stringify(j, null, 2));

    if (["completed", "completed_with_errors", "failed", "expired"].includes(j.status))
      return j;

    await new Promise(r => setTimeout(r, 60_000));
  }
}

/* ---------- download output -------------------------------------- */
async function downloadResult(j) {
  const url = `https://api.openai.com/v1/files/${j.output_file_id}/content`;
  const txt = await fetch(url, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
  }).then(r => r.text());
  return txt.trim().split("\n").map(l => JSON.parse(l));
}

/* ------------------------------------------------------------------
   main runner
------------------------------------------------------------------ */
async function run(limit = MAX_PER_RUN) {
  console.log("▶︎ batchScorer.run entered");

  try {
    const recs = await fetchCandidates(limit);
    if (!recs.length) {
      console.log("No records need scoring – exit.");
      return;
    }
    console.log(`Scoring ${recs.length} leads…`);

    const prompt                   = await buildPrompt();
    const { positives, negatives } = await loadAttributes();   // live dicts

    const lines = [], ids = [];
    for (const r of recs) {
      const full = JSON.parse(r.get("Profile Full JSON") || "{}");
      const slim = slimLead(full);
      lines.push(buildPromptLine(prompt, slim, r.id));
      ids.push(r.id);
    }

    const batchId = await submitBatch(await uploadJSONL(lines));
    console.log("Batch ID:", batchId);

    let result = await pollBatch(batchId);
    if (["expired", "failed"].includes(result.status)) {
      console.log("⚠︎ Batch failed/expired – retrying once.");
      result = await pollBatch(await submitBatch(await uploadJSONL(lines)));
    }
    if (!["completed", "completed_with_errors"].includes(result.status))
      throw new Error("Batch did not complete: " + result.status);

    console.log(`✔︎ Batch finished (${result.status}) – downloading results`);
    const rows  = await downloadResult(result);
    let updated = 0;

    for (const o of rows) {
      if (o.error) continue;
      const idx = ids.indexOf(o.custom_id);
      if (idx === -1) continue;

      /* ---------- derive finalPct if GPT omitted it ------------- */
      let finalPct = o.finalPct;
      if (finalPct === undefined) {
        const { percentage } = computeFinalScore(
          o.positive_scores || {},
          positives,
          o.negative_scores || {},
          negatives,
          o.contact_readiness,
          o.unscored_attributes || []
        );
        finalPct = Math.round(percentage * 100) / 100;
      }

      await base("Leads").update(ids[idx], {
        "AI Score"              : finalPct,
        "AI Profile Assessment" : o.aiProfileAssessment || "",
        "AI Attribute Breakdown": o.attribute_breakdown  || "",
        "Scoring Status"        : "Scored",
        "Date Scored"           : new Date().toISOString().split("T")[0],
        "AI_Excluded"           : (o.ai_excluded || "No") === "Yes",
        "Exclude Details"       : o.exclude_details || "",
      });
      updated++;
    }
    console.log(`✔︎ Updated ${updated} Airtable row(s).`);
  } catch (err) {
    console.error("⨯ batchScorer fatal:", err);
  }
}

module.exports = { run };