/**
 * Map friendly region names to IANA zones (AU-focused). Invalid / unknown → "".
 * "NSW", "Sydney", "Vic" etc. are not valid IANA IDs on their own — we normalize here.
 */
const { DateTime } = require("luxon");

/** Lowercase trimmed key → IANA */
const ALIAS_TO_IANA = {
  sydney: "Australia/Sydney",
  "greater sydney": "Australia/Sydney",
  nsw: "Australia/Sydney",
  "new south wales": "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  vic: "Australia/Melbourne",
  victoria: "Australia/Melbourne",
  brisbane: "Australia/Brisbane",
  qld: "Australia/Brisbane",
  queensland: "Australia/Brisbane",
  adelaide: "Australia/Adelaide",
  sa: "Australia/Adelaide",
  "south australia": "Australia/Adelaide",
  perth: "Australia/Perth",
  wa: "Australia/Perth",
  "western australia": "Australia/Perth",
  hobart: "Australia/Hobart",
  tas: "Australia/Hobart",
  tasmania: "Australia/Hobart",
  darwin: "Australia/Darwin",
  nt: "Australia/Darwin",
  "northern territory": "Australia/Darwin",
  canberra: "Australia/Sydney",
  act: "Australia/Sydney",
  "australian capital territory": "Australia/Sydney",
};

/**
 * @param {string} raw
 * @returns {string} IANA id, or "" if unknown
 */
function normalizeTimezoneInput(raw) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (DateTime.now().setZone(s).isValid) return s;
  const key = s.toLowerCase().replace(/\s+/g, " ").trim();
  return ALIAS_TO_IANA[key] || "";
}

module.exports = { normalizeTimezoneInput, ALIAS_TO_IANA };
