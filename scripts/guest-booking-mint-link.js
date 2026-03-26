/**
 * Mint a signed guest booking URL (Guy-only weekend outreach).
 *
 * Requires: GUEST_BOOKING_LINK_SECRET in .env (same as Render)
 *
 *   node scripts/guest-booking-mint-link.js "Jane Smith" "https://www.linkedin.com/in/jane" "jane@company.com"
 *
 * Optional 4th arg: days until expiry (default 90).
 * Optional 5th arg: guest IANA timezone appended as &guestTz= (e.g. Australia/Sydney).
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
const guestTz = (process.argv[6] || "").trim();

if (!name || !li || !email) {
  console.error(
    "Usage: node scripts/guest-booking-mint-link.js \"Full Name\" \"LinkedIn URL\" \"email\" [expiryDays] [guestTz]"
  );
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + days * 86400;
const token = signGuestBookingToken({ n: name, li, e: email, exp });
let url = `${base.replace(/\/$/, "")}/guest-book?t=${encodeURIComponent(token)}`;
if (guestTz) url += `&guestTz=${encodeURIComponent(guestTz)}`;
console.log(url);
