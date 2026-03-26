/**
 * Mint a signed guest booking URL (Guy-only weekend outreach).
 *
 * Requires: GUEST_BOOKING_LINK_SECRET in .env (same as Render)
 *
 *   node scripts/guest-booking-mint-link.js "Jane Smith" "https://www.linkedin.com/in/jane" "jane@company.com"
 *
 * Optional 4th argument: days until expiry (default 90).
 * Optional 5th argument: guest IANA timezone for &guestTz= (default Australia/Sydney).
 *   Only IANA IDs work (e.g. Australia/Sydney). Plain text like "NSW" or "Greater Sydney"
 *   is not valid — use Australia/Sydney for Eastern NSW / Sydney.
 */
require("dotenv").config();
const { signGuestBookingToken } = require("../services/guestBookingToken.js");

const base =
  process.env.GUEST_BOOKING_PUBLIC_BASE ||
  "https://pb-webhook-server.onrender.com";

const name = process.argv[2];
const li = process.argv[3];
const email = process.argv[4];
const days = parseInt(process.argv[5] || "90", 10) || 90;
const guestTzRaw = process.argv[6];
const guestTz =
  guestTzRaw !== undefined && String(guestTzRaw).trim() !== ""
    ? String(guestTzRaw).trim()
    : "Australia/Sydney";

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
