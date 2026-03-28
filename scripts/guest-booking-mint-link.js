/**
 * Mint a signed guest booking URL (Guy-only weekend outreach).
 *
 * Requires: GUEST_BOOKING_LINK_SECRET in .env (same as Render)
 *
 *   node scripts/guest-booking-mint-link.js "Jane Smith" "https://www.linkedin.com/in/jane" "jane@company.com"
 *
 * Optional 4th argument: days until expiry (default 90).
 * Optional 5th argument: guest timezone (IANA or alias: Sydney, NSW, Vic, …).
 *
 * Default guest tz when 5th arg omitted: GUEST_BOOKING_HOST_TIMEZONE, else Australia/Brisbane
 * (same fallback as Master Clients Timezone on the server). Set GUEST_BOOKING_HOST_TIMEZONE in .env
 * to match your Airtable "Timezone" field (e.g. Australia/Sydney).
 */
require("dotenv").config();
const {
  signGuestBookingToken,
  getGuestBookingLinkExpiryDays,
} = require("../services/guestBookingToken.js");
const {
  normalizeTimezoneInput,
} = require("../services/guestTimezoneAliases.js");

const base =
  process.env.GUEST_BOOKING_PUBLIC_BASE ||
  "https://pb-webhook-server.onrender.com";

const name = process.argv[2];
const li = process.argv[3];
const email = process.argv[4];
const daysArg = process.argv[5];
const days =
  daysArg !== undefined && String(daysArg).trim() !== ""
    ? parseInt(daysArg, 10) || getGuestBookingLinkExpiryDays()
    : getGuestBookingLinkExpiryDays();
const guestTzArg = process.argv[6];

const defaultMintTz =
  process.env.GUEST_BOOKING_HOST_TIMEZONE || "Australia/Brisbane";

let guestTz;
if (guestTzArg !== undefined && String(guestTzArg).trim() !== "") {
  const typed = String(guestTzArg).trim();
  guestTz = normalizeTimezoneInput(typed) || defaultMintTz;
} else {
  guestTz = defaultMintTz;
}

if (!name || !li || !email) {
  console.error(
    "Usage: node scripts/guest-booking-mint-link.js \"Full Name\" \"LinkedIn URL\" \"email\" [expiryDays] [guestTz]"
  );
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + days * 86400;
const token = signGuestBookingToken({ n: name, li, e: email, exp });
const url = `${base.replace(/\/$/, "")}/guest-book?t=${encodeURIComponent(
  token
)}&guestTz=${encodeURIComponent(guestTz)}`;
console.log(url);
