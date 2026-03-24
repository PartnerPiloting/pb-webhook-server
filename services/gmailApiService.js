/**
 * Send email via Gmail API using OAuth refresh token (userId "me" = token owner).
 */
const { google } = require("googleapis");

function getGmailOAuthClient() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error(
      "Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN"
    );
  }
  const oauth2 = new google.auth.OAuth2(id, secret);
  oauth2.setCredentials({ refresh_token: refresh });
  return oauth2;
}

/**
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.text
 * @param {string} [opts.fromName] default Guy Wilson
 * @param {string} [opts.fromEmail] default GMAIL_FROM_EMAIL env or guyralphwilson@gmail.com
 */
async function sendTextEmail(opts) {
  const {
    to,
    subject,
    text,
    fromName = "Guy Wilson",
    fromEmail = process.env.GMAIL_FROM_EMAIL || "guyralphwilson@gmail.com",
  } = opts;

  if (!to || !subject || text === undefined || text === null) {
    throw new Error("sendTextEmail: to, subject, and text are required");
  }

  const auth = getGmailOAuthClient();
  const gmail = google.gmail({ version: "v1", auth });

  const rfc822 = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    String(text),
  ].join("\r\n");

  const raw = Buffer.from(rfc822, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { id: data.id, threadId: data.threadId };
}

module.exports = { sendTextEmail, getGmailOAuthClient };
