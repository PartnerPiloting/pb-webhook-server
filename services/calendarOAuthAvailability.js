/**
 * Free/busy + slot grid for the OAuth user's primary calendar (same account as Gmail).
 * Uses Luxon for correct DST and host vs guest timezones.
 */
const { google } = require("googleapis");
const { DateTime } = require("luxon");
const { getGmailOAuthClient } = require("./gmailApiService.js");

/** @param {string} tz */
function isValidIanaTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  return DateTime.now().setZone(tz.trim()).isValid;
}

/**
 * @param {string[]} dates YYYY-MM-DD (calendar days in host TZ)
 * @param {object} opts
 * @param {string} opts.hostTz IANA — Guy's calendar / working hours
 * @param {string} opts.guestTz IANA — display + guest-side window
 * @param {number} [opts.hostStartMinutes] default 9:30
 * @param {number} [opts.hostEndMinutes] slot end must be <= this (default 16:00)
 * @param {number} [opts.guestStartMinutes] default 9:00
 * @param {number} [opts.guestEndMinutes] slot end must be <= this (default 17:00)
 * @returns {Promise<{ days: Array<{date, day, freeSlots}>, error?: string }>}
 */
async function getOAuthPrimaryBatchAvailability(dates, opts) {
  const hostTz = opts?.hostTz;
  const guestTz = opts?.guestTz || hostTz;
  if (!hostTz || !dates || dates.length === 0) {
    return { days: [], error: "No dates or hostTz" };
  }

  const hostStartMinutes = opts?.hostStartMinutes ?? 9 * 60 + 30;
  const hostEndMinutes = opts?.hostEndMinutes ?? 16 * 60;
  const guestStartMinutes = opts?.guestStartMinutes ?? 9 * 60;
  const guestEndMinutes = opts?.guestEndMinutes ?? 17 * 60;

  const auth = getGmailOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const rangeStart = DateTime.fromISO(`${firstDate}T00:00:00`, {
    zone: hostTz,
  }).toUTC();
  const rangeEnd = DateTime.fromISO(`${lastDate}T23:59:59`, {
    zone: hostTz,
  }).toUTC();

  let allBusyPeriods;
  try {
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: rangeStart.toISO(),
        timeMax: rangeEnd.toISO(),
        items: [{ id: "primary" }],
      },
    });
    const cal = data.calendars?.primary;
    if (cal?.errors?.length) {
      return { days: [], error: cal.errors[0]?.reason || "freebusy error" };
    }
    allBusyPeriods = cal?.busy || [];
  } catch (e) {
    return { days: [], error: e.message || String(e) };
  }

  const slotDurationMs = 30 * 60 * 1000;

  const days = dates.map((date) => {
    const hostDayStart = DateTime.fromISO(`${date}T00:00:00`, { zone: hostTz });
    const hostOpen = hostDayStart.plus({ minutes: hostStartMinutes });
    const hostClose = hostDayStart.plus({ minutes: hostEndMinutes });

    const dayBusy = allBusyPeriods.filter((period) => {
      const busyStart = DateTime.fromISO(period.start);
      const busyEnd = DateTime.fromISO(period.end);
      return busyStart < hostClose && busyEnd > hostOpen;
    });

    const freeSlots = [];
    let current = hostOpen;
    while (current.plus({ milliseconds: slotDurationMs }) <= hostClose) {
      const slotEnd = current.plus({ milliseconds: slotDurationMs });
      const isBusy = dayBusy.some((period) => {
        const busyStart = DateTime.fromISO(period.start);
        const busyEnd = DateTime.fromISO(period.end);
        return current < busyEnd && slotEnd > busyStart;
      });
      if (!isBusy) {
        const gStart = current.setZone(guestTz);
        const gEnd = slotEnd.setZone(guestTz);
        const gStartMin = gStart.hour * 60 + gStart.minute;
        const gEndMin = gEnd.hour * 60 + gEnd.minute;
        const crossesGuestMidnight = gStart.day !== gEnd.day;
        const guestOk =
          !crossesGuestMidnight &&
          gStartMin >= guestStartMinutes &&
          gEndMin <= guestEndMinutes;

        if (guestOk) {
          freeSlots.push({
            time: current.toUTC().toISO(),
            display: gStart.toFormat("h:mm a"),
          });
        }
      }
      current = current.plus({ milliseconds: slotDurationMs });
    }

    const labelDt = DateTime.fromISO(`${date}T12:00:00`, { zone: hostTz }).setZone(
      guestTz
    );
    const dayLabel = labelDt.toFormat("ccc, d LLL");

    return { date, day: dayLabel, freeSlots };
  });

  return { days };
}

/**
 * @deprecated Legacy offset helper — kept for any external requires
 */
function getTimezoneOffsetMinutes(tz, dateStr) {
  const testDate = new Date(`${dateStr}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(testDate);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
  const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 10 * 60;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] || "0", 10);
  return sign * (hours * 60 + minutes);
}

module.exports = {
  getOAuthPrimaryBatchAvailability,
  getTimezoneOffsetMinutes,
  isValidIanaTimezone,
};
