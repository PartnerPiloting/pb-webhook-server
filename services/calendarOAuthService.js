/**
 * Create Google Calendar events using the same OAuth user as Gmail (primary calendar).
 */
const { google } = require("googleapis");
const { getGmailOAuthClient } = require("./gmailApiService.js");

/**
 * Inserts a short test event on the token owner's primary calendar and emails invitees.
 * @param {Object} opts
 * @param {string} opts.attendeeEmail
 * @param {string} [opts.timeZone] default Australia/Brisbane
 */
async function createTestEvent(opts) {
  const { attendeeEmail } = opts;
  if (!attendeeEmail || !String(attendeeEmail).includes("@")) {
    throw new Error("createTestEvent: attendeeEmail required");
  }

  const auth = getGmailOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary: "OAuth calendar test (safe to delete)",
      description: "Created by pb-webhook-server debug-calendar-create-test.",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: [{ email: attendeeEmail.trim() }],
    },
  });

  return {
    id: data.id,
    htmlLink: data.htmlLink,
    start: data.start?.dateTime || data.start?.date,
  };
}

module.exports = { createTestEvent };
