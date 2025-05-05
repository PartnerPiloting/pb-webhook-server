/* ===================================================================
   singleScorer.js – ONE-OFF GPT scorer used by /score-lead
   -------------------------------------------------------------------
   • Builds the system prompt
   • Calls GPT-4o with temperature 0   (deterministic)
   • DEBUG: prints temperature, full prompt, and raw GPT reply
=================================================================== */
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");
const { buildPrompt, slimLead }    = require("./promptBuilder");

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

const MODEL        = "gpt-4o";
const TEMPERATURE  = 0;            // ← hard-coded, deterministic

async function scoreLeadNow(fullLead = {}) {
  /* 1️⃣  Build prompt + slimmed profile */
  const sysPrompt = await buildPrompt();
  const userLead  = slimLead(fullLead);

  /* 2️⃣  Call GPT-4o */
  const completion = await openai.createChatCompletion({
    model: MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user",   content: `Lead:\n${JSON.stringify(userLead, null, 2)}` }
    ],
  });

  const rawText = completion.data.choices?.[0]?.message?.content || "";

  /* === DEBUG OUTPUT ============================================= */
  console.log("DBG-TEMP", TEMPERATURE);      // should print 0 every run
  console.log("DBG-PROMPT\n", sysPrompt);    // full instructions sent
  console.log("DBG-RAW-GPT\n", rawText);     // raw JSON reply
  /* =============================================================== */

  return rawText;   // downstream parser handles JSON
}

module.exports = { scoreLeadNow };