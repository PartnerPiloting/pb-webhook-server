/* ===================================================================
   batchScorer.js — GPT-4o batch scorer  (hybrid breakdown, show zeros)
   ------------------------------------------------------------------
   • Trims profiles with slimLead()
   • Submits JSONL to the OpenAI Batch API
   • Polls with a 3-minute timeout (exits on “cancelling”)
   • Recomputes scores with computeFinalScore()
   • Builds Markdown via buildAttributeBreakdown(showZeros = true)
=================================================================== */

require("dotenv").config();
const fs       = require("fs");
const path     = require("path");
const fetch    = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
const FormData = require("form-data");
const Airtable = require("airtable");

const { buildPrompt, slimLead }   = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { callGptScoring }          = require("./callGptScoring");

/* ------------------------------------------------------------------
   ENV & CONFIG
------------------------------------------------------------------*/
const {
  AIRTABLE_BASE_ID: AIRTABLE_BASE,
  AIRTABLE_API_KEY: AIRTABLE_KEY,
  OPENAI_API_KEY  : OPENAI_KEY,
} = process.env;

const MODEL             = "gpt-4o";
const COMPLETION_WINDOW = "24h";
const MAX_PER_RUN       = Number(process.env.MAX_BATCH || 500);  // manual ?limit= sets lower cap

const TOKENS_PER_LEAD   = 4300;   // rough upper bound for prompt & response
const MAX_BATCH_TOKENS  = 80_000; // OpenAI Batch limit

/* ------------------------------------------------------------------
   Airtable setup
------------------------------------------------------------------*/
Airtable.configure({ apiKey: AIRTABLE_KEY });
const base = Airtable.base(AIRTABLE_BASE);

/* ------------------------------------------------------------------
   helper: chunkByTokens  (splits Airtable records into size-safe chunks)
------------------------------------------------------------------*/
function chunkByTokens(records) {
  const chunks = [];
  let current  = [];
  for (const r of records) {
    if (current.length * TOKENS_PER_LEAD >= MAX_BATCH_TOKENS) {
      chunks.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/* ------------------------------------------------------------------
   helper: fetchCandidates  ("To Be Scored" leads from Airtable)
------------------------------------------------------------------*/
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

/* ------------------------------------------------------------------
   helper: buildPromptLine  (one JSONL line per lead)
------------------------------------------------------------------*/
function buildPromptLine(prompt, leadJson, recId) {
  return JSON.stringify({
    custom_id: recId,
    method   : "POST",
    url      : "/v1/chat/completions",
    body     : {
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: `Lead:\n${JSON.stringify(leadJson, null, 2)}` }
      ]
    }
  });
}

/* ------------------------------------------------------------------
   helper: uploadJSONL  (returns file_id)
------------------------------------------------------------------*/
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

/* ------------------------------------------------------------------
   helper: submitBatch  (returns batch_id)
------------------------------------------------------------------*/
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

/* ------------------------------------------------------------------
   helper: pollBatch  (waits until batch reaches a terminal status)
------------------------------------------------------------------*/
async function pollBatch(id, timeoutMs = 180_000, intervalMs = 15_000) {
  const terminal = [
    "completed",
    "completed_with_errors",
    "failed",
    "expired",
    "cancelled",
    "cancelling",
  ];
  const start = Date.now();
  let poll = 0;

  while (true) {
    const j = await fetch(`https://api.openai.com/v1/batches/${id}`, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    }).then(r => r.json());

    poll++;
    const ok  = j.request_counts?.completed ?? j.num_completed ?? "undef";
    const err = j.request_counts?.failed    ?? j.num_failed     ?? "undef";
    console.log(`  ↻ Poll #${poll} – status ${j.status}, ok ${ok}, err ${err}`);

    if (["failed", "expired"].includes(j.status))
      console.error("⨯ Batch failed details:", JSON.stringify(j, null, 2));

    if (terminal.includes(j.status)) return j;

    if (Date.now() - start > timeoutMs) {
      console.error(`⏰ Batch ${id} timed out after ${timeoutMs / 1000} s`);
      j.status = "timeout";
      return j;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/* ------------------------------------------------------------------
   helper: downloadResult  (returns array of result objects)
------------------------------------------------------------------*/
async function downloadResult(batchJson) {
  const url = `https://api.openai.com/v1/files/${batchJson.output_file_id}/content`;
  const txt = await fetch(url, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
  }).then(r => r.text());
  return txt.trim().split("\n").map(l => JSON.parse(l));
}

/* ------------------------------------------------------------------
   processOneBatch  (single sub-batch of Airtable records)
------------------------------------------------------------------*/
async function processOneBatch(records, positives, negatives, prompt) {
  const lines = [];
  const ids   = [];

  for (const r of records) {
    const full = JSON.parse(r.get("Profile Full JSON") || "{}");
    const slim = slimLead(full);
    lines.push(buildPromptLine(prompt, slim, r.id));
    ids.push(r.id);
  }

  const batchId = await submitBatch(await uploadJSONL(lines));
  console.log(`✔︎ Batch submitted (${records.length} leads) → ${batchId}`);

  const result = await pollBatch(batchId);
  if (["expired", "failed", "cancelled", "timeout"].includes(result.status))
    throw new Error(`Batch ${batchId} ended with status: ${result.status}`);

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

    const { percentage, rawScore: earned, denominator: max } = computeFinalScore(
      parsed.positive_scores,
      positives,
      parsed.negative_scores,
      negatives,
      parsed.contact_readiness,
      parsed.unscored_attributes || []
    );
    parsed.finalPct = Math.round(percentage * 100) / 100;

    const breakdown = buildAttributeBreakdown(
      parsed.positive_scores,
      positives,
      parsed.negative_scores,
      negatives,
      parsed.unscored_attributes || [],
      earned,
      max,
      parsed.attribute_reasoning || {},
      true,         // SHOW zero-score attributes
      null
    );

    await base("Leads").update(ids[idx], {
      "AI Score"              : parsed.finalPct,
      "AI Profile Assessment" : parsed.aiProfileAssessment || "",
      "AI Attribute Breakdown": breakdown,
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

/* ------------------------------------------------------------------
   main runner  (called by /run-batch-score)
------------------------------------------------------------------*/
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
          console.log("Queue full → waiting 60 s before retrying this chunk…");
          await new Promise(r => setTimeout(r, 60_000));
        } else {
          throw err;
        }
      }
    }
  }
}

module.exports = { run };