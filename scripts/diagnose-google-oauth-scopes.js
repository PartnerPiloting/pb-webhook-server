/**
 * Local Google OAuth diagnostics (uses .env in project root).
 *
 *   npm run diagnose:oauth
 */
require("dotenv").config();

const {
  runGoogleOAuthDiagnostics,
  REQUIRED_SCOPES,
} = require("../services/googleOAuthDiagnostics.js");

async function main() {
  console.log("Required scopes:\n");
  REQUIRED_SCOPES.forEach((s) => console.log(" ", s));
  console.log("\nRunning checks...\n");

  const result = await runGoogleOAuthDiagnostics();
  for (const step of result.steps) {
    const mark = step.ok === false ? "FAIL" : "OK ";
    console.log(`[${mark}] ${step.name}`);
    const { name, ok, ...rest } = step;
    if (Object.keys(rest).length) {
      console.log(JSON.stringify(rest, null, 2));
    }
    console.log("");
  }
  console.log(
    result.ok
      ? "All checks passed."
      : `FAILED: ${(result.failedStepNames || []).join(", ")}`
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
