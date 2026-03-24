/**
 * One-off test: send a plain-text email via Gmail API (uses same env as production).
 *
 *   npm run gmail:send-test
 *
 * Recipient is fixed below; override with GMAIL_TEST_TO if needed.
 */
require("dotenv").config();

const { sendTextEmail } = require("../services/gmailApiService.js");

const TO = process.env.GMAIL_TEST_TO || "taniaadelewilson@gmail.com";

async function main() {
  const result = await sendTextEmail({
    to: TO,
    subject: "test",
    text: "test",
  });
  console.log("Sent OK:", result);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
