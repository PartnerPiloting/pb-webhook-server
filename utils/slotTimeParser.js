/**
 * Parse slot time string to UTC Date.
 * Handles:
 * - "2025-03-27T05:30:00.000Z" (UTC) -> correct
 * - "2025-03-27T15:30:00" (no TZ) -> interpret as user's local time (server may be UTC)
 *
 * @param {string} isoTime - ISO-like time string
 * @param {string} userTimezone - IANA timezone (e.g. Australia/Brisbane)
 * @returns {Date|null} UTC Date or null
 */
function parseSlotTimeAsUTC(isoTime, userTimezone) {
  const str = String(isoTime || '').trim();
  if (!str) return null;
  if (str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date(str);
  const [, y, m, d, h, min] = match;
  const dateStr = `${y}-${m}-${d}`;
  const offsetMin = getOffsetMinutesForDate(userTimezone, dateStr);
  const localMinutes = parseInt(h, 10) * 60 + parseInt(min, 10);
  const utcMinutes = localMinutes - offsetMin;
  const utcHours = Math.floor(utcMinutes / 60);
  const utcMins = Math.round(((utcMinutes % 60) + 60) % 60);
  let utcDay = parseInt(d, 10);
  if (utcHours < 0) utcDay -= 1;
  if (utcHours >= 24) utcDay += 1;
  return new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, utcDay, ((utcHours % 24) + 24) % 24, utcMins, 0));
}

function getOffsetMinutesForDate(tz, dateStr) {
  const testDate = new Date(dateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(testDate);
  const m = (parts.find(p => p.type === 'timeZoneName')?.value || '').match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
}

module.exports = { parseSlotTimeAsUTC, getOffsetMinutesForDate };
