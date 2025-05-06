/* ===================================================================
   singleScorer.js – ONE-OFF GPT scorer used by /score-lead
   -------------------------------------------------------------------
   • Builds the system prompt
   • Calls GPT-4o with temperature 0  (deterministic)
   • Logs per-section token usage (system vs lead) and raw GPT reply
=================================================================== */
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");
const { buildPrompt, slimLead }    = require("./promptBuilder");

/* tiktoken – optional lightweight encoder for accurate counts
   (npm i @dqbd/tiktoken --save) */
let encode;
try {
  // eslint-disable-next-line node/no-missing-require
  const { encoding_for_model } = require("@dqbd/tiktoken");
  encode = encoding_for_model("gpt-4o-mini");
} catch {
  console.warn("tiktoken not installed — per-section token counts disabled");
}

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

const MODEL       = "gpt-4o";
const TEMPERATURE = 0;   // deterministic

async function scoreLeadNow(fullLead = {}) {
  /* 1️⃣  Build system prompt + trim profile */
  const sysPrompt = await buildPrompt();
  const userLead  = slimLead(fullLead);

  /* Optional exact token split ----------------------------------- */
  let sysTokens = null;
  let leadTokens = null;
  if (encode) {
    try {
      sysTokens  = encode.encode(sysPrompt).length;
      leadTokens = encode.encode(JSON.stringify(userLead)).length;
    } catch {}
  }

  /* 2️⃣  Call GPT-4o --------------------------------------------- */
  const completion = await openai.createChatCompletion({
    model: MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user",   content: `Lead:\n${JSON.stringify(userLead, null, 2)}` }
    ],
  });

  const rawText = completion.data.choices?.[0]?.message?.content || "";

  /* === LOG TOKEN USAGE ========================================= */
  const u = completion.data.usage || {};
  console.log(
    "TOKENS single lead – system:",
    sysTokens ?? "?", "lead:",
    leadTokens ?? "?", "prompt:",
    u.prompt_tokens ?? "?", "completion:",
    u.completion_tokens ?? "?", "total:",
    u.total_tokens ?? "?"
  );

  /* === DEBUG OUTPUT ============================================ */
  console.log("DBG-RAW-GPT\n", rawText);
  /* ============================================================= */

  return rawText;   // JSON; parsed downstream
}

module.exports = { scoreLeadNow };