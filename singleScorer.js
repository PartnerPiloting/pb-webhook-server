/* ===================================================================
   singleScorer.js – ONE-OFF GPT scorer used by /score-lead
   -------------------------------------------------------------------
   • Builds the prompt
   • Calls GPT-4o with temperature 0 (deterministic test)
   • DEBUG: prints temperature, full prompt, and raw GPT reply
=================================================================== */
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");
const { buildPrompt, slimLead }    = require("./promptBuilder");

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

const MODEL = "gpt-4o";

async function scoreLeadNow(fullLead = {}) {
  /* 1️⃣ Build prompt + slimmed profile */
  const sysPrompt = await buildPrompt();
  const userLead  = slimLead(fullLead);

  /* 2️⃣ Call GPT-4o – deterministic temperature */
  const completion = await openai.createChatCompletion({
    model: MODEL,
    temperature: 0,                // ← lock randomness
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user",   content: `Lead:\n${JSON.stringify(userLead, null, 2)}` }
    ],
  });

  const rawText = completion.data.choices?.[0]?.message?.content || "";

  /* === DEEP DEBUG ================================================= */
  // Show the temperature actually used (0 if set, "default" if omitted)
  console.log("DBG-TEMP", completion.config.data.temperature ?? "default");
  console.log("DBG-PROMPT\n", sysPrompt);    // full instructions
  console.log("DBG-RAW-GPT\n", rawText);     // raw JSON reply
  /* ================================================================= */

  return rawText;   // downstream parser will handle it
}

module.exports = { scoreLeadNow };