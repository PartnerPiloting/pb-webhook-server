/**
 * Free/busy + slot grid for the OAuth user's primary calendar (same account as Gmail).
 */
const { google } = require("googleapis");
const { getGmailOAuthClient } = require("./gmailApiService.js");

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

/**
 * @param {string[]} dates YYYY-MM-DD
 * @param {number} startHour
 * @param {number} endHour
 * @param {string} timezone IANA
 * @returns {Promise<{ days: Array<{date, day, freeSlots}>, error?: string }>}
 */
async function getOAuthPrimaryBatchAvailability(
  dates,
  startHour = 9,
  endHour = 17,
  timezone = "Australia/Brisbane"
) {
  if (!dates || dates.length === 0) {
    return { days: [], error: "No dates" };
  }

  const auth = getGmailOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const offsetMinutes = getTimezoneOffsetMinutes(timezone, dates[0]);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const rangeStart = new Date(`${firstDate}T00:00:00Z`);
  rangeStart.setMinutes(rangeStart.getMinutes() - offsetMinutes);
  const rangeEnd = new Date(`${lastDate}T23:59:59Z`);
  rangeEnd.setMinutes(rangeEnd.getMinutes() - offsetMinutes);

  let allBusyPeriods;
  try {
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
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

  const days = dates.map((date) => {
    const dateObj = new Date(`${date}T12:00:00Z`);
    const dayLabel = dateObj.toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timezone,
    });

    const dayStart = new Date(`${date}T${String(startHour).padStart(2, "0")}:00:00Z`);
    dayStart.setMinutes(dayStart.getMinutes() - offsetMinutes);
    const dayEnd = new Date(`${date}T${String(endHour).padStart(2, "0")}:00:00Z`);
    dayEnd.setMinutes(dayEnd.getMinutes() - offsetMinutes);

    const dayBusy = allBusyPeriods.filter((period) => {
      const busyStart = new Date(period.start);
      const busyEnd = new Date(period.end);
      return busyStart < dayEnd && busyEnd > dayStart;
    });

    const freeSlots = [];
    const slotDuration = 30 * 60 * 1000;
    let current = new Date(dayStart);

    while (current.getTime() + slotDuration <= dayEnd.getTime()) {
      const slotEnd = new Date(current.getTime() + slotDuration);
      const isBusy = dayBusy.some((period) => {
        const busyStart = new Date(period.start);
        const busyEnd = new Date(period.end);
        return current < busyEnd && slotEnd > busyStart;
      });
      if (!isBusy) {
        freeSlots.push({
          time: current.toISOString(),
          display: current.toLocaleTimeString("en-AU", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: timezone,
          }),
        });
      }
      current = slotEnd;
    }

    return { date, day: dayLabel, freeSlots };
  });

  return { days };
}

module.exports = {
  getOAuthPrimaryBatchAvailability,
  getTimezoneOffsetMinutes,
};
