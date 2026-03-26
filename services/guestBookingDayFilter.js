/**
 * Drop weekends and AU public holidays from guest-booking day lists.
 * Holidays use the host timezone’s Australian state when IANA is Australia/*; otherwise weekends only.
 */
const { DateTime } = require("luxon");
const Holidays = require("date-holidays");

/**
 * @param {string} iana
 * @returns {string | null} date-holidays subdivision (lowercase)
 */
function hostTzToAuRegion(iana) {
  const i = (iana || "").toLowerCase();
  if (!i.startsWith("australia/")) return null;
  if (i.includes("sydney") || i.includes("lord_howe") || i.includes("broken_hill"))
    return "nsw";
  if (i.includes("melbourne")) return "vic";
  if (i.includes("brisbane") || i.includes("lindeman")) return "qld";
  if (i.includes("adelaide")) return "sa";
  if (i.includes("perth")) return "wa";
  if (i.includes("darwin")) return "nt";
  if (i.includes("hobart")) return "tas";
  if (i.includes("canberra")) return "act";
  if (i.includes("eucla")) return "wa";
  return null;
}

function getHolidayChecker(hostTz) {
  if (!hostTz || !String(hostTz).startsWith("Australia/")) return null;
  const region = hostTzToAuRegion(hostTz);
  if (region) return new Holidays("AU", region);
  return new Holidays("AU");
}

function isWeekendDate(dateStr, hostTz) {
  const d = DateTime.fromISO(`${dateStr}T12:00:00`, { zone: hostTz });
  return d.weekday >= 6;
}

function isPublicHoliday(dateStr, hd) {
  if (!hd) return false;
  const h = hd.isHoliday(dateStr);
  return Array.isArray(h) && h.length > 0;
}

/**
 * @param {Array<{ date: string, day: string, freeSlots: Array }>} days
 * @param {string} hostTz
 */
function filterGuestBookingDays(days, hostTz) {
  const hd = getHolidayChecker(hostTz);
  return days.filter((day) => {
    if (isWeekendDate(day.date, hostTz)) return false;
    if (isPublicHoliday(day.date, hd)) return false;
    return true;
  });
}

module.exports = {
  filterGuestBookingDays,
  hostTzToAuRegion,
};
