#!/usr/bin/env node
/**
 * Same logic as GET /admin/corporate-captives-audience-sample on the server.
 *
 *   node scripts/cc-outreach-audience-sample.js
 *   CC_OUTREACH_CLIENT_ID=Guy-Wilson SAMPLE_SIZE=100 node scripts/cc-outreach-audience-sample.js
 *
 * Or open in the browser (after deploy):
 *   https://pb-webhook-server.onrender.com/admin/corporate-captives-audience-sample?secret=YOUR_SECRET&sampleSize=100
 */

require("dotenv").config();

const { runCorporateCaptivesAudienceSample } = require("../services/corporateCaptivesOutreachService.js");

async function main() {
  const clientId = process.env.CC_OUTREACH_CLIENT_ID || "Guy-Wilson";
  const sampleSize = Math.min(500, Math.max(1, parseInt(process.env.SAMPLE_SIZE || "100", 10)));
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

  const out = await runCorporateCaptivesAudienceSample({
    clientId,
    sampleSize,
    delayMs,
    logger,
  });

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
