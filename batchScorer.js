/* ===================================================================
   batchScorer.js — GPT-4o Flex scorer  (now uses the shared parser)
=================================================================== */
require("dotenv").config();
console.log("▶︎ batchScorer module loaded");

const fs       = require("fs");
const path     = require("path");
const fetch    = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const FormData = require("form-data");
const Airtable = require("airtable");

const { buildPrompt, slimLead } = require("./promptBuilder");
const { loadAttributes }        = require("./attributeLoader");
const { computeFinalScore }     = require("./scoring");
const { callGptScoring }        = require("./callGptScoring");   // ← shared parser

/* ---------- env & config ---------------------------------------- */
const {
  AIRTABLE_BASE_ID: AIRTABLE_BASE,
  AIRTABLE_API_KEY: AIRTABLE_KEY,
  OPENAI_API_KEY  : OPENAI_KEY
} = process.env;

const MODEL             = "gpt-4o";
const COMPLETION_WINDOW = "24h";
const MAX_PER_RUN       = Number(process.env.MAX_BATCH || 500);

const TOKENS_PER_LEAD   = 4300;
const MAX_BATCH_TOKENS  = 80000;

/* ---------- Airtable connection ---------------------------------- */
Airtable.configure({ apiKey: AIRTABLE_KEY });
const base = Airtable.base(AIRTABLE_BASE);

/* ---------- helper: split by token budget ------------------------ */
function chunkByTokens(records) {
  const chunks = [];
  let current  = [];
  records.forEach(r => {
    if (current.length * TOKENS_PER_LEAD >= MAX_BATCH_TOKENS) {
      chunks.push(current); current = [];
    }
    current.push(r);
  });
  if (current.length) chunks.push(current);
  return chunks;
}

/* ---------- fetch candidates ------------------------------------- */
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

/* ---------- build one JSONL line --------------------------------- */
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

/* ---------- upload JSONL to OpenAI --------------------------------*/
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

/* ---------- submit a batch job ----------------------------------- */
async function submitBatch(fileId) {
  const body = {
    input_file_id    : fileId,
    endpoint         : "/v1/chat/completions",
    completion_window: COMPLETION_WINDOW,
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

/* ---------- poll until batch finishes ---------------------------- */
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

    await new Promise(r => setTimeout(r, 60000));
  }
}

/* ---------- download batch output -------------------------------- */
async function downloadResult(j) {
  const url = `https://api.openai.com/v1/files/${j.output_file_id}/content`;
  const txt = await fetch(url, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
  }).then(r => r.text());
  return txt.trim().split("\n").map(l => JSON.parse(l));
}

/* ---------- process one sub-batch -------------------------------- */
async function processOneBatch(records, positives, negatives, prompt) {
  const lines = [], ids = [];
  for (const r of records) {
    const full = JSON.parse(r.get("Profile Full JSON") || "{}");
    const slim = slimLead(full);
    lines.push(buildPromptLine(prompt, slim, r.id));
    ids.push(r.id);
  }

  const batchId = await submitBatch(await uploadJSONL(lines));
  console.log(`✔︎ Batch submitted (${records.length} leads) → ${batchId}`);

  const result = await pollBatch(batchId);
  if (["expired", "failed"].includes(result.status))
    throw new Error(`Batch ${batchId} failed: ${result.status}`);

  const rows      = await downloadResult(result);
  let updated     = 0;
  let unparsable  = 0;

  for (const o of rows) {
    if (o.error) continue;
    const idx = ids.indexOf(o.custom_id);
    if (idx === -1) continue;

    const raw = o.response?.body?.choices?.[0]?.message?.content;
    if (!raw) { unparsable++; continue; }

    let parsed;
    try { parsed = callGptScoring(raw); }
    catch (err) {
      console.warn(`⚠️  Lead ${o.custom_id} – parser threw: ${err.message}`);
      unparsable++; continue;
    }

    if (parsed.finalPct === undefined) {
      const { percentage } = computeFinalScore(
        parsed.positive_scores || {},
        positives,
        parsed.negative_scores || {},
        negatives,
        parsed.contact_readiness,
        parsed.unscored_attributes || []
      );
      parsed.finalPct = Math.round(percentage * 100) / 100;
    }

    await base("Leads").update(ids[idx], {
      "AI Score"              : parsed.finalPct,
      "AI Profile Assessment" : parsed.aiProfileAssessment  || "",
      "AI Attribute Breakdown": parsed.attribute_breakdown  || "",
      "Scoring Status"        : "Scored",
      "Date Scored"           : new Date().toISOString().split("T")[0],
      "AI_Excluded"           : (parsed.ai_excluded || "No") === "Yes",
      "Exclude Details"       : parsed.exclude_details || "",
    });
    updated++;
  }

  console.log(`✔︎ Updated ${updated} Airtable row(s).`);
  if (unparsable)
    console.warn(`⚠️  ${unparsable} result line(s) could not be parsed – see logs above.`);
}

/* ---------- main runner ------------------------------------------ */
async function run(limit = MAX_PER_RUN) {
  console.log("▶︎ batchScorer.run entered");

  const recs = await fetchCandidates(limit);
  if (!recs.length) { console.log("No records need scoring – exit."); return; }

  const prompt                   = await buildPrompt();
  const { positives, negatives } = await loadAttributes();

  const chunks = chunkByTokens(recs);
  console.log(`Scoring ${recs.length} leads in ${chunks.length} sub-batch(es)…`);

  for (let i = 0; i < chunks.length; i++) {
    const list = chunks[i];
    console.log(`→ Sub-batch ${i + 1}/${chunks.length} (${list.length} leads)`);

    let done = false;
    while (!done) {
      try {
        await processOneBatch(list, positives, negatives, prompt);
        done = true;
      } catch (err) {
        if (String(err).includes("token_limit_exceeded")) {
          console.log("Queue is full → waiting 60 s before retrying this chunk…");
          await new Promise(r => setTimeout(r, 60000));
        } else {
          throw err;
        }
      }
    }
  }
}

module.exports = { run };