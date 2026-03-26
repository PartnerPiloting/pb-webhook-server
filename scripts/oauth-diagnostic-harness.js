/**
 * Re-run Google OAuth diagnostics until all steps pass or max attempts.
 * Use after updating GCP scopes / Render GMAIL_REFRESH_TOKEN to confirm propagation.
 *
 *   npm run diagnose:oauth:harness
 *   node scripts/oauth-diagnostic-harness.js --attempts 12 --interval 10000
 */
require("dotenv").config();

const {
  runGoogleOAuthDiagnostics,
  REQUIRED_SCOPES,
} = require("../services/googleOAuthDiagnostics.js");

function parseArgs() {
  const argv = process.argv.slice(2);
  let attempts = 30;
  let intervalMs = 5000;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--attempts" && argv[i + 1]) {
      attempts = Math.max(1, parseInt(argv[++i], 10) || attempts);
    } else if (argv[i] === "--interval" && argv[i + 1]) {
      intervalMs = Math.max(1000, parseInt(argv[++i], 10) || intervalMs);
    }
  }
  return { attempts, intervalMs };
}

function summarizeFailure(result) {
  const names = result.failedStepNames || [];
  const tokenStep = result.steps?.find((s) => s.name === "tokeninfo_scopes");
  const fb = result.steps?.find((s) => s.name === "calendar_freebusy_query");
  const parts = [`failed: ${names.join(", ") || "unknown"}`];
  if (tokenStep?.missingScopes?.length) {
    parts.push(`missingScopes: ${tokenStep.missingScopes.join(" | ")}`);
  }
  if (fb && !fb.ok && fb.error) {
    parts.push(`freebusy: ${fb.error}`);
  }
  return parts.join(" — ");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { attempts, intervalMs } = parseArgs();
  console.log("Required scopes:");
  REQUIRED_SCOPES.forEach((s) => console.log(" ", s));
  console.log(
    `\nHarness: up to ${attempts} attempt(s), ${intervalMs}ms between runs.\n`
  );

  for (let n = 1; n <= attempts; n++) {
    const result = await runGoogleOAuthDiagnostics();
    const stamp = new Date().toISOString();
    if (result.ok) {
      console.log(`[${stamp}] attempt ${n}/${attempts}: ALL OK`);
      process.exit(0);
    }
    console.log(
      `[${stamp}] attempt ${n}/${attempts}: ${summarizeFailure(result)}`
    );
    if (n < attempts) {
      await sleep(intervalMs);
    }
  }

  console.error("\nHarness exhausted: fix missingScopes / token / redeploy, then re-run.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
