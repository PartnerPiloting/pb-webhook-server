/* ===================================================================
   batchScorer.js  –  GPT-4o bulk scorer (chunked lead scoring)
   -------------------------------------------------------------------
   • Pulls “To Be Scored” leads from Airtable in chunks (default 40)
   • Sends each chunk to GPT-4o with a strict schema prompt
   • Handles partial / malformed replies:
       – Wraps solo-object replies
       – Re-asks once if JSON is invalid
       – Retries missing leads in mini-chunks
   • ALWAYS uses our locally-computed percentage when writing AI Score
   • VERBOSE_SCORING env-flag lets you switch between:
       – verbose mode   → full objects back from GPT
       – lean mode      → numeric subtotals so we recompute %
=================================================================== */

require("dotenv").config();
console.log("▶︎ batchScorer module loaded");

const { Configuration, OpenAIApi } = require("openai");
const Airtable                     = require("airtable");
const fetch                        = (...a) => import("node-fetch").then(({ default: f }) => f(...a));

const { buildPrompt, slimLead }   = require("./promptBuilder");
const { loadAttributes }          = require("./attributeLoader");
const { computeFinalScore }       = require("./scoring");
const { buildAttributeBreakdown } = require("./breakdown");
const { callGptScoring }          = require("./callGptScoring");

/* ---------- ENV -------------------------------------------------- */
const MODEL          = process.env.GPT_MODEL || "gpt-4o";
const CHUNK_SIZE     = Math.max(1, parseInt(process.env.BATCH_CHUNK_SIZE || "40", 10));
const VERBOSE        = process.env.VERBOSE_SCORING !== "false";   // default = true
const GPT_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GPT_TIMEOUT_MS || "120000", 10));
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || "";
const FROM_EMAIL     = process.env.FROM_EMAIL  || "";

/* ---------- OpenAI / Airtable ----------------------------------- */
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ---------- helpers --------------------------------------------- */
const tokens = (s = "") => Math.ceil(s.length / 4);

/* ---------- send email ------------------------------------------ */
async function alertAdmin(subject, text) {
  if (!process.env.MAILGUN_API_KEY || !ADMIN_EMAIL) return;
  const FormData = require("form-data");
  const form = new FormData();
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

/* ---------- critical-field detector ----------------------------- */
function isMissingCritical(profile = {}) {
  const about = (
    profile.about ||
    profile.summary ||
    profile.linkedinDescription ||
    ""
  ).trim();
  const hasBio      = about.length >= 40;
  const hasHeadline = !!profile.headline?.trim();

  let hasJob = Array.isArray(profile.experience) && profile.experience.length;
  if (!hasJob) {
    for (let i = 1; i <= 5; i++) {
      if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
        hasJob = true;
        break;
      }
    }
  }
  return !(hasBio && hasHeadline && hasJob);   // true → something missing
}

/* ---------- GPT wrapper with timeout + caller-supplied maxTokens - */
function gptWithTimeout(messages, maxTokens) {
  const fallbackMax = Math.min(4096, CHUNK_SIZE * 350);
  const OUTPUT_MAX  = Math.min(4096, Math.max(1, maxTokens || fallbackMax));

  const call = openai.createChatCompletion({
    model       : MODEL,
    temperature : 0,
    max_tokens  : OUTPUT_MAX,
    messages
  });

  const timer = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("GPT timeout")), GPT_TIMEOUT_MS));

  return Promise.race([call, timer]);
}

/* ---------- tiny queue ------------------------------------------ */
const queue   = [];
let   running = false;
async function enqueue(recs) {
  queue.push(recs);
  if (running) return;
  running = true;
  while (queue.length) {
    const chunk = queue.shift();
    try { await scoreChunk(chunk); }
    catch (err) {
      console.error("Chunk fatal:", err);
      await alertAdmin("[Scorer] Chunk failed", String(err));
    }
  }
  running = false;
}

/* ---------- fetch leads ----------------------------------------- */
async function fetchLeads(limit) {
  const records = [];
  await base("Leads")
    .select({ maxRecords: limit, filterByFormula: "{Scoring Status} = 'To Be Scored'" })
    .eachPage((p, next) => { records.push(...p); next(); });
  return records;
}

/* =================================================================
   scoreChunk
=================================================================== */
async function scoreChunk(records) {

  const scorable = [];

  /* ---------- pre-flight skip-guard ----------------------------- */
  for (const rec of records) {
    const profile = JSON.parse(rec.get("Profile Full JSON") || "{}");

    const aboutText = (
      profile.about ||
      profile.summary ||
      profile.linkedinDescription ||
      ""
    ).trim();

    /* detect any job history ------------------------------------- */
    let hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
    if (!hasExp) {
      for (let i = 1; i <= 5; i++) {
        if (profile[`organization_${i}`] || profile[`organization_title_${i}`]) {
          hasExp = true;
          break;
        }
      }
    }

    /* alert if critical data missing ----------------------------- */
    if (isMissingCritical(profile)) {
      await alertAdmin(
        "[Scraper Alert] Incomplete lead",
        `Rec ID: ${rec.id}\n` +
        `URL   : ${profile.linkedinProfileUrl || profile.profile_url || "unknown"}\n` +
        `Headline present : ${!!profile.headline}\n` +
        `About ≥40 chars  : ${aboutText.length >= 40}\n` +
        `Job info present : ${hasExp}`
      );
    }

    /* skip if About/Summary too short ---------------------------- */
    if (aboutText.length < 40) {
      await base("Leads").update(rec.id, {
        "AI Score"              : 0,
        "Scoring Status"        : "Skipped – Profile Full JSON Too Small",
        "AI Profile Assessment" : "",
        "AI Attribute Breakdown": ""
      });
      continue;                         // don’t send thin profile to GPT
    }

    scorable.push({ rec, profile });
  }

  if (!scorable.length) return;         // nothing left to score in this chunk

  /* ---------- build prompt & user message ----------------------- */
  let prompt = await buildPrompt();
  if (!VERBOSE) {
    /* lean mode footer: ask for numeric subtotals
       so we can recompute the percentage ourselves */
    prompt += `
Return ONLY a valid JSON array.  
Each array item must be an object with this exact shape:
{
  "pos": { "A":  0-15, "B":0-15, … "K":0-20 },
  "neg": { "N1":0-10, "N2":0-10, … "N5":0-10 },
  "ready": false
}
No markdown, no prose, no extra keys.`;        /* end footer */
  }

  const slimmed = scorable.map(({ profile }) => slimLead(profile));
  const userMsg = JSON.stringify({ leads: slimmed });

  /* ---------- GPT call ------------------------------------------ */
  const maxOut = Math.min(4096, CHUNK_SIZE * (VERBOSE ? 350 : 120));
  const resp   = await gptWithTimeout([
    { role: "system", content: prompt },
    {
      role   : "user",
      content: VERBOSE
        ? "Return an array of results in the same order:\n" + userMsg
        : "Return the subtotals only, in order:\n"          + userMsg
    }
  ], maxOut);

  const raw = resp.data.choices[0].message.content || "";

  /* ---------- resilient parse + re-ask -------------------------- */
  const cleaned = raw               // remove ```json fences if present
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let output;
  try {
    output = JSON.parse(cleaned);
    if (!Array.isArray(output)) output = [output];   // wrap single obj
  } catch (parseErr) {
    console.warn("⛑  Initial parse failed – firing re-ask");
    const retry = await openai.createChatCompletion({
      model       : MODEL,
      temperature : 0,
      max_tokens  : maxOut,
      messages    : [
        {
          role   : "system",
          content:
            `You responded with:\n${raw}\n\n` +
            `This is NOT a valid JSON array. Reply with the array only.`
        }
      ]
    });
    const second = retry.data.choices[0].message.content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    output = JSON.parse(second);
    if (!Array.isArray(output)) output = [output];
  }

  /* ---------- length mismatch → mini-chunk retry --------------- */
  if (output.length !== scorable.length) {
    console.warn(`⚠️ GPT returned ${output.length} of ${scorable.length}`);
    const retryBucket = [];
    for (let i = 0; i < scorable.length; i++) {
      if (!output[i]) retryBucket.push(scorable[i].rec);
      if (retryBucket.length === 10 ||
          (i === scorable.length - 1 && retryBucket.length)) {
        await enqueue(retryBucket.splice(0, retryBucket.length));
      }
    }
  }

  const { positives, negatives } = await loadAttributes();

  /* ---------- write results back ------------------------------- */
  for (let i = 0; i < output.length; i++) {
    const rec = scorable[i].rec;

    /* -------- LEAN MODE: recompute % locally -------------------- */
    if (!VERBOSE) {
      const item = output[i] || {};

      /* 1. Sanity-check structure */
      if (typeof item !== "object" || !item.pos || !item.neg) {
        console.warn(`Lean-mode parse error on lead ${rec.id}`);
        await base("Leads").update(rec.id, { "Scoring Status": "Failed" });
        continue;
      }

      /* 2. Recompute percentage using our own maths */
      const { percentage } = computeFinalScore(
        item.pos, positives,
        item.neg, negatives,
        item.ready, []
      );
      const finalPct = Math.round(percentage * 100) / 100;

      /* 3. Write AI Score only */
      await base("Leads").update(rec.id, {
        "AI Score"       : finalPct,
        "Scoring Status" : "Scored",
        "Date Scored"    : new Date().toISOString().split("T")[0]
      });
      continue;                              // skip verbose block
    }

    /* -------- VERBOSE MODE parsing ------------------------------ */
    const rawObj = JSON.stringify(output[i] || {});
    let gpt;
    try { gpt = callGptScoring(rawObj); }
    catch (err) {
      console.warn(`⚠️ Lead ${rec.id} – parser error: ${err.message}`);
      await base("Leads").update(rec.id, { "Scoring Status": "Failed" });
      continue;
    }

    const { percentage, rawScore: earned, denominator: max } =
      computeFinalScore(
        gpt.positive_scores, positives,
        gpt.negative_scores, negatives,
        gpt.contact_readiness, gpt.unscored_attributes
      );

    const finalPct = Math.round(percentage * 100) / 100;

    const breakdown = buildAttributeBreakdown(
      gpt.positive_scores, positives,
      gpt.negative_scores, negatives,
      gpt.unscored_attributes, earned, max,
      gpt.attribute_reasoning, false, null
    );

    await base("Leads").update(rec.id, {
      "AI Score"              : finalPct,
      "AI Profile Assessment" : gpt.aiProfileAssessment,
      "AI Attribute Breakdown": breakdown,
      "Scoring Status"        : "Scored",
      "Date Scored"           : new Date().toISOString().split("T")[0],
      "AI_Excluded"           : (gpt.ai_excluded || "No") === "Yes",
      "Exclude Details"       : gpt.exclude_details
    });
  }
}

/* ---------- public endpoint ------------------------------------ */
async function run(req, res) {
  try {
    const limit  = Number(req?.query?.limit) || 1000;
    const leads  = await fetchLeads(limit);
    if (!leads.length) {
      res?.json?.({ ok: true, message: "No leads to score" });
      return;
    }

    const chunks = [];
    for (let i = 0; i < leads.length; i += CHUNK_SIZE)
      chunks.push(leads.slice(i, i + CHUNK_SIZE));

    console.log(`Queued ${leads.length} leads in ${chunks.length} chunk(s) of ${CHUNK_SIZE} (verbose=${VERBOSE})`);
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