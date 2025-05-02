cd ~/Desktop/pb-webhook-server

cat > batchScorer.js <<'BATCH'
/* ===================================================================
   batchScorer.js  –  Overnight GPT-4o flex-window scorer
   -------------------------------------------------------------------
   • Pulls Airtable “To Be Scored” records (cap configurable)
   • Builds JSONL → submits /v1/batches  (completion_window:"24h")
   • Polls until   completed | completed_with_errors | expired | failed
   • Writes AI fields back & flips Scoring Status  ⚬  Date Scored
   • Re-submits once if expired/failed (no duplicate billing)
   Usage:
       const batch = require("./batchScorer");
       batch.run(500);
=================================================================== */
require("dotenv").config();
const fs       = require("fs");
const path     = require("path");
const fetch    = (...a) => import("node-fetch").then(({default:f}) => f(...a));
const Airtable = require("airtable");
const { buildPrompt } = require("./promptBuilder");

const AIRTABLE_BASE   = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_KEY    = process.env.AIRTABLE_API_KEY;
const OPENAI_KEY      = process.env.OPENAI_API_KEY;
const MODEL           = "gpt-4o";
const COMPLETION_WIN  = "24h";          // flex window
const MAX_PER_RUN     = Number(process.env.MAX_BATCH || 500); // safety cap
const VIEW_NAME       = "🔍 Needs Scoring"; // filter view (Scoring Status=To Be Scored)

Airtable.configure({ apiKey: AIRTABLE_KEY });
const base = Airtable.base(AIRTABLE_BASE);

async function fetchCandidates(limit) {
  const out = [];
  await base("Leads")
    .select({ view: VIEW_NAME, pageSize: 100 })
    .eachPage((records, fetchNext) => {
      for (const r of records) {
        if (out.length >= limit) return;
        out.push(r);
      }
      if (out.length < limit) fetchNext();
    });
  return out;
}

async function uploadJSONL(lines) {
  const tmp = path.join(__dirname, "batch.jsonl");
  fs.writeFileSync(tmp, lines.join("\n"));
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", fs.createReadStream(tmp));

  const up = await fetch("https://api.openai.com/v1/files", {
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_KEY}` },
    body:form,
  }).then(r=>r.json());
  fs.unlinkSync(tmp);
  if (!up.id) throw new Error("File upload failed: "+JSON.stringify(up));
  return up.id;
}

async function submitBatch(fileId) {
  const body = {
    input_file_id : fileId,
    model         : MODEL,
    type          : "jsonl",
    completion_window: COMPLETION_WIN,
  };
  const resp = await fetch("https://api.openai.com/v1/batches",{
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify(body),
  }).then(r=>r.json());
  if (!resp.id) throw new Error("Batch submit failed: "+JSON.stringify(resp));
  return resp.id;
}

async function pollBatch(id) {
  while (true) {
    const j = await fetch(`https://api.openai.com/v1/batches/${id}`,{
      headers:{ Authorization:`Bearer ${OPENAI_KEY}` }
    }).then(r=>r.json());
    if (["completed","completed_with_errors","failed","expired"].includes(j.status))
      return j;
    await new Promise(r=>setTimeout(r, 60_000)); // 1-min poll
  }
}

async function downloadResult(j) {
  const fileId = j.output_file_id;
  const url = `https://api.openai.com/v1/files/${fileId}/content`;
  const txt = await fetch(url,{
    headers:{ Authorization:`Bearer ${OPENAI_KEY}` }
  }).then(r=>r.text());
  return txt.trim().split("\n").map(l=>JSON.parse(l));
}

function buildPromptLine(prompt, leadObj) {
  return JSON.stringify({
    messages:[
      { role:"system", content: prompt },
      { role:"user",  content:`Lead:\n${JSON.stringify(leadObj,null,2)}` }
    ]
  });
}

async function run(limit = MAX_PER_RUN) {
  const candidates = await fetchCandidates(limit);
  if (candidates.length === 0) {
    console.log("No records need scoring – exit.");
    return;
  }
  console.log(`Scoring ${candidates.length} leads…`);

  const prompt = await buildPrompt();            // 2 500-token rules
  const lines  = [];
  const idMap  = [];                             // Airtable IDs in same order

  for (const r of candidates) {
    const raw = JSON.parse(r.get("Profile Full JSON") || "{}");
    lines.push(buildPromptLine(prompt, raw));
    idMap.push(r.id);
  }

  const fileId  = await uploadJSONL(lines);
  const batchId = await submitBatch(fileId);
  console.log("Batch ID:", batchId);

  let result = await pollBatch(batchId);

  if (["expired","failed"].includes(result.status)) {
    console.log("Batch expired/failed – retrying once.");
    const newFile = await uploadJSONL(lines);
    const newId   = await submitBatch(newFile);
    result        = await pollBatch(newId);
  }
  if (!["completed","completed_with_errors"].includes(result.status))
    throw new Error("Batch did not complete: "+result.status);

  const rows = await downloadResult(result);
  let updated = 0;

  for (let i=0;i<rows.length;i++) {
    const out = rows[i];
    if (out.error) continue;           // skip errored rows
    const {
      positive_scores  = {},
      negative_scores  = {},
      contact_readiness= false,
      unscored_attributes=[],
      aiProfileAssessment="",
      aiScore = out.final_score || out.finalPct || 0,
      aiAttributeBreakdown = out.attribute_breakdown || "",
      aiExcluded = out.ai_excluded || "No",
      excludeDetails = out.exclude_details || "",
    } = out;

    const fields = {
      "AI Score"            : Math.round(aiScore*100)/100,
      "AI Profile Assessment": aiProfileAssessment,
      "AI Attribute Breakdown": aiAttributeBreakdown,
      "Scoring Status"      : "Scored",
      "Date Scored"         : new Date(),
      "AI_Excluded"         : aiExcluded === "Yes",
      "Exclude Details"     : excludeDetails,
    };
    await base("Leads").update(idMap[i], fields);
    updated++;
  }
  console.log(`Updated ${updated} Airtable rows.`);
}

module.exports = { run };
BATCH