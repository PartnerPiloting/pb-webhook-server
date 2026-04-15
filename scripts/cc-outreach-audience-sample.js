#!/usr/bin/env node
/**
 * Random sample of leads that already pass Airtable + eligibility filters (same as production
 * before the Gemini audience step). For each sampled lead, runs classifyOutreachAudienceWithAI
 * (Gemini) with keyword fallback when Vertex is unavailable or profile is too short.
 *
 * Prints how many of the sample would be SEND (employee / side venture / ex-founder employed)
 * vs SKIP (full-time owner-operator).
 *
 * Usage (same env as the live server: Airtable, client config, GCP for Gemini):
 *   node scripts/cc-outreach-audience-sample.js
 *   CC_OUTREACH_CLIENT_ID=Guy-Wilson SAMPLE_SIZE=100 node scripts/cc-outreach-audience-sample.js
 *
 * Optional:
 *   SAMPLE_SIZE=100   (default 100, max 500)
 *   CC_OUTREACH_SAMPLE_DELAY_MS=250   pause between Gemini calls
 *   VERBOSE=1   log classifier warnings
 */

require("dotenv").config();

const { getClientBase } = require("../config/airtableClient");
const {
  fetchOutboundEmailSettings,
  fetchScoredLeadCandidates,
  buildSortedEligible,
  eligibilityOptionsFromSettingsFields,
  classifyOutreachAudienceWithAI,
  classifyOutreachBodyVariant,
  F,
} = require("../services/corporateCaptivesOutreachService.js");

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const clientId = process.env.CC_OUTREACH_CLIENT_ID || "Guy-Wilson";
  const sampleCap = Math.min(500, Math.max(1, parseInt(process.env.SAMPLE_SIZE || "100", 10)));
  const delayMs = Math.max(0, parseInt(process.env.CC_OUTREACH_SAMPLE_DELAY_MS || "250", 10));
  const verbose = String(process.env.VERBOSE || "").toLowerCase() === "1";

  const logger = verbose
    ? {
        info: (...a) => console.log("[info]", ...a),
        warn: (...a) => console.warn("[warn]", ...a),
        error: (...a) => console.error("[err]", ...a),
      }
    : {
        info: () => {},
        warn: () => {},
        error: () => {},
      };

  const base = await getClientBase(clientId);
  const { fields: settingsFields } = await fetchOutboundEmailSettings(base);
  const eligibilityOptions = eligibilityOptionsFromSettingsFields(settingsFields);

  const candidates = await fetchScoredLeadCandidates(base);
  const { eligible, rejected } = buildSortedEligible(candidates, eligibilityOptions);

  console.log(`Client: ${clientId}`);
  console.log(`Eligible pool (after Airtable query + leadPassesFilters): ${eligible.length}`);
  console.log(`Rejected by filters: ${rejected.length}`);

  if (eligible.length === 0) {
    console.log("Nothing to sample.");
    process.exit(0);
  }

  const pool = shuffleInPlace([...eligible]).slice(0, sampleCap);
  const n = pool.length;

  let send = 0;
  let skip = 0;
  let aiSend = 0;
  let aiSkip = 0;
  let rulesFallback = 0;

  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    const ai = await classifyOutreachAudienceWithAI(rec.get(F.rawProfile), logger);
    let wouldSend;
    if (ai != null) {
      wouldSend = ai.send;
      if (ai.send) aiSend++;
      else aiSkip++;
    } else {
      rulesFallback++;
      wouldSend = classifyOutreachBodyVariant(rec.get(F.rawProfile)) !== "owner";
    }
    if (wouldSend) send++;
    else skip++;

    if ((i + 1) % 25 === 0 || i === pool.length - 1) {
      console.log(`Progress ${i + 1}/${n}`);
    }
    if (delayMs > 0 && i < pool.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const pct = (x) => (n ? ((x / n) * 100).toFixed(1) : "0.0");

  console.log("\n--- Audience gate (same logic as production) ---");
  console.log(`Random sample size: ${n}`);
  console.log(`Would SEND (fit employee / side venture / ex-founder employed, etc.): ${send} (${pct(send)}%)`);
  console.log(`Would SKIP (full-time owner focus): ${skip} (${pct(skip)}%)`);
  console.log(`—`);
  console.log(`Gemini decided (in this sample): ${aiSend + aiSkip} total — send ${aiSend}, skip ${aiSkip}`);
  console.log(`Keyword fallback (no Gemini or short profile): ${rulesFallback}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
