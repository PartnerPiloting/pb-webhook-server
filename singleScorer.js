/* ===================================================================
   singleScorer.js – ONE-OFF GPT scorer used by /score-lead
   -------------------------------------------------------------------
   • Builds the same prompt the batch job uses
   • Calls GPT-4o synchronously and returns raw text
   • DEBUG: prints the entire GPT reply so we can copy it
=================================================================== */
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");
const { buildPrompt, slimLead }    = require("./promptBuilder");

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

const MODEL = "gpt-4o";

async function scoreLeadNow(fullLead = {}) {
  /* 1️⃣  Build the system prompt + slimmed-down lead  */
  const sysPrompt = await buildPrompt();
  const userLead  = slimLead(fullLead);

  /* 2️⃣  Call GPT-4o */
  const completion = await openai.createChatCompletion({
    model: MODEL,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user",   content: `Lead:\n${JSON.stringify(userLead, null, 2)}` }
    ],
  });

  /* 3️⃣  DEBUG – print exactly what GPT sends back */
  console.log("RAW-GPT\n", completion.data.choices?.[0]?.message?.content);

  /* 4️⃣  Return raw text so index.js can parse it */
  return completion.data.choices?.[0]?.message?.content || "";
}

module.exports = { scoreLeadNow };