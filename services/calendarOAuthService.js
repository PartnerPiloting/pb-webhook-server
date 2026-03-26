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

/**
 * @param {Object} opts
 * @param {string} opts.startISO
 * @param {string} opts.endISO
 * @param {string} opts.attendeeEmail
 * @param {string} opts.summary
 * @param {string} opts.description
 * @param {string} [opts.location]
 */
async function createGuestMeeting(opts) {
  const {
    startISO,
    endISO,
    attendeeEmail,
    summary,
    description,
    location,
  } = opts;
  if (!startISO || !endISO || !attendeeEmail || !summary) {
    throw new Error("createGuestMeeting: startISO, endISO, attendeeEmail, summary required");
  }

  const auth = getGmailOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary,
      description: description || "",
      location: location || undefined,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
      attendees: [{ email: String(attendeeEmail).trim() }],
    },
  });

  return {
    id: data.id,
    htmlLink: data.htmlLink,
    start: data.start?.dateTime || data.start?.date,
  };
}

/** Throws if primary calendar has busy overlapping [startISO, endISO]. */
async function assertPrimarySlotFree(startISO, endISO) {
  const auth = getGmailOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const padMs = 60 * 1000;
  const tMin = new Date(new Date(startISO).getTime() - padMs).toISOString();
  const tMax = new Date(new Date(endISO).getTime() + padMs).toISOString();
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: tMin,
      timeMax: tMax,
      items: [{ id: "primary" }],
    },
  });
  const busy = data.calendars?.primary?.busy || [];
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  for (const p of busy) {
    const bs = new Date(p.start).getTime();
    const be = new Date(p.end).getTime();
    if (s < be && e > bs) {
      throw new Error("That time was just taken — please pick another slot.");
    }
  }
}

module.exports = {
  createTestEvent,
  createGuestMeeting,
  assertPrimarySlotFree,
};
