/* ===================================================================
   batchScorer.js — GPT-4o FLEX bulk scorer  (chunk mode)
   -------------------------------------------------------------------
   • Skips any lead whose Profile JSON has no "about" section
   • Updates skipped rows with AI Score = 0, Status = "Skipped – No About"
   • Sends only scorable leads to GPT, preventing array mis-alignment
=================================================================== */

require("dotenv").config();
console.log("▶︎ batchScorer module loaded");

const { Configuration, OpenAIApi } = require("openai");
const Airtable   = require("airtable");
const fetch      = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

/* ---------- local modules --------------------------------------- */
const { buildPrompt, slimLead }    = require("./promptBuilder");
const { loadAttributes }           = require("./attributeLoader");
const { computeFinalScore }        = require("./scoring");
const { buildAttributeBreakdown }  = require("./breakdown");
const { callGptScoring }           = require("./callGptScoring");

/* ---------- ENV & CONSTANTS ------------------------------------- */
const MODEL           = process.env.GPT_MODEL || "gpt-4o";
const CHUNK_SIZE      = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "30", 10));
const GPT_TIMEOUT_MS  = Math.max(30000, parseInt(process.env.GPT_TIMEOUT_MS || "120000", 10));
const TOKEN_SOFT_CAP  = 7500;
const ADMIN_EMAIL     = process.env.ADMIN_EMAIL || "";
const FROM_EMAIL      = process.env.FROM_EMAIL  || "";

/* ---------- OpenAI & Airtable ----------------------------------- */
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- helpers --------------------------------------------- */
const tokens = (s = "") => Math.ceil(s.length / 4);

/* ---------- Mailgun alert helper -------------------------------- */
async function alertAdmin(subject, text) {
  if (!process.env.MAILGUN_API_KEY || !ADMIN_EMAIL) return;
  const form = new (require("form-data"))();
  form.append("from", FROM_EMAIL);
  form.append("to", ADMIN_EMAIL);
  form.append("subject", subject);
  form.append("text", text);
  await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
    method : "POST",
    headers: { Authorization: "Basic " + Buffer.from("api:" + process.env.MAILGUN_API_KEY).toString("base64") },
    body   : form
  });
}

/* ---------- GPT call with time-out ------------------------------ */
function gptWithTimeout(messages) {
  const call  = openai.createChatCompletion({ model: MODEL, temperature: 0, messages });
  const timer = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("GPT timeout")), GPT_TIMEOUT_MS));
  return Promise.race([call, timer]);
}

/* ---------- simple queue ---------------------------------------- */
const queue = [];
let running = false;
async function enqueue(recs) {
  queue.push(recs);
  if (!running) {
    running = true;
    while (queue.length) {
      const batch = queue.shift();
      try { await scoreChunk(batch); }
      catch (err) {
        console.error("Chunk fatal:", err);
        await alertAdmin("[Scorer] Chunk failed", String(err));
      }
    }
    running = false;
  }
}

/* ---------- fetch leads ----------------------------------------- */
async function fetchLeads(limit) {
  const records = [];
  await base("Leads")
    .select({
      maxRecords     : limit,
      filterByFormula: `{Scoring Status} = 'To Be Scored'`
    })
    .eachPage((p, next) => { records.push(...p); next(); });
  return records;
}

/* =================================================================
   scoreChunk  –  main worker
=================================================================== */
async function scoreChunk(records) {

  /* ---------- skip leads that lack an About section ------------- */
  const scorable   = [];
  for (const rec of records) {
    const profile = JSON.parse(rec.get("Profile Full JSON") || "{}");
    if (!profile.about || !profile.about.trim()) {
      await base("Leads").update(rec.id, {
        "AI Score"       : 0,
        "Scoring Status" : "Skipped – No About",
        "AI Profile Assessment"  : "",
        "AI Attribute Breakdown" : ""
      });
      continue;                        // don’t send to GPT
    }
    scorable.push({ rec, profile });
  }

  /* no scorable leads? nothing to do ----------------------------- */
  if (!scorable.length) return;

  /* ---------- build prompt & user message ----------------------- */
  const prompt = await buildPrompt();
  const slim   = scorable.map(({ profile }) => slimLead(profile));
  const userMsg = JSON.stringify({ leads: slim });

  /* token split guard -------------------------------------------- */
  if (tokens(prompt) + tokens(userMsg) > TOKEN_SOFT_CAP && scorable.length > 1) {
    const mid = Math.ceil(records.length / 2);
    await enqueue(records.slice(0, mid));
    await enqueue(records.slice(mid));
    return;
  }

  /* ---------- chat call ----------------------------------------- */
  const resp       = await gptWithTimeout([
    { role: "system", content: prompt },
    { role: "user",   content: "Return an array of results in the same order:\n" + userMsg }
  ]);
  const rawContent = resp.data.choices[0].message.content || "";

  /* ---------- tolerant top-level parse -------------------------- */
  let output;
  try { output = JSON.parse(rawContent); }
  catch (_) {
    const fence = rawContent.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fence) output = JSON.parse(fence[1]);
    else throw new Error("Top-level parse failed: Unable to parse GPT reply as JSON array");
  }
  if (!Array.isArray(output)) throw new Error("Top-level parse failed: GPT did not return an array");

  /* length mismatch → enqueue solos ------------------------------ */
  if (output.length !== scorable.length) {
    console.warn(`⚠️ GPT returned ${output.length} of ${scorable.length} objects`);
    for (let i = 0; i < scorable.length; i++) {
      if (!output[i]) await enqueue([scorable[i].rec]);   // solo retry
    }
  }

  const { positives, negatives } = await loadAttributes();

  /* ---------- walk results in parallel -------------------------- */
  for (let i = 0; i < output.length; i++) {
    const rec  = scorable[i].rec;
    const raw  = JSON.stringify(output[i] || {});
    let gpt;
    try { gpt = callGptScoring(raw); }
    catch (err) {
      console.warn(`⚠️ Lead ${rec.id} — parser error: ${err.message}`);
      await base("Leads").update(rec.id, { "Scoring Status": "Failed" });
      continue;
    }

    const { percentage, rawScore: earned, denominator: max } =
      computeFinalScore(gpt.positive_scores, positives,
                        gpt.negative_scores, negatives,
                        gpt.contact_readiness, gpt.unscored_attributes);
    gpt.finalPct = Math.round((gpt.finalPct ?? percentage) * 100) / 100;

    const breakdown = buildAttributeBreakdown(
      gpt.positive_scores, positives,
      gpt.negative_scores, negatives,
      gpt.unscored_attributes, earned, max,
      gpt.attribute_reasoning, false, null
    );

    await base("Leads").update(rec.id, {
      "AI Score"              : gpt.finalPct,
      "AI Profile Assessment" : gpt.aiProfileAssessment,
      "AI Attribute Breakdown": breakdown,
      "Scoring Status"        : "Scored",
      "Date Scored"           : new Date().toISOString().split("T")[0],
      "AI_Excluded"           : (gpt.ai_excluded || "No") === "Yes",
      "Exclude Details"       : gpt.exclude_details
    });
  }
}

/* ---------- public runner --------------------------------------- */
async function run(req, res) {
  try {
    const limit = Number(req?.query?.limit) || 1000;
    const leads = await fetchLeads(limit);
    if (!leads.length) {
      res?.json?.({ ok: true, message: "No leads to score" });
      return;
    }

    const chunks = [];
    for (let i = 0; i < leads.length; i += CHUNK_SIZE)
      chunks.push(leads.slice(i, i + CHUNK_SIZE));

    console.log(`Queued ${leads.length} leads in ${chunks.length} chunk(s) of ${CHUNK_SIZE}`);
    for (const c of chunks) await enqueue(c);

    res?.json?.({ ok: true, message: "Batch queued", leads: leads.length });
    await alertAdmin("[Scorer] Batch finished OK", `${leads.length} leads processed`);
  } catch (err) {
    console.error("Batch fatal:", err);
    res?.status?.(500)?.json?.({ ok: false, error: String(err) });
    await alertAdmin("[Scorer] Batch failed", String(err));
  }
}

module.exports = { run };