/**
 * Bypass the UI: mint a token, POST /api/guest/book with a fixed local time.
 * Use the same GUEST_BOOKING_LINK_SECRET as Render for production calls.
 *
 *   set BASE_URL=https://pb-webhook-server.onrender.com
 *   set GUEST_BOOKING_LINK_SECRET=...
 *   npm run guest-book:harness
 *
 * Optional env:
 *   GUEST_BOOKING_HARNESS_TZ=Australia/Sydney
 *   GUEST_BOOKING_HARNESS_SLOT=2026-03-26T10:30:00   (local wall time in that TZ)
 */
require("dotenv").config();
const fetch = require("node-fetch");
const { DateTime } = require("luxon");
const { signGuestBookingToken } = require("../services/guestBookingToken.js");

const BASE = (process.env.BASE_URL || "https://pb-webhook-server.onrender.com").replace(
  /\/$/,
  ""
);
const guestTz = process.env.GUEST_BOOKING_HARNESS_TZ || "Australia/Sydney";
const localSlot =
  process.env.GUEST_BOOKING_HARNESS_SLOT || "2026-03-26T10:30:00";

const payload = {
  n: "Tania Wilson",
  li: "https://www.linkedin.com/in/tania-wilson-baa050125/",
  e: "taniaadelewilson@gmail.com",
  exp: Math.floor(Date.now() / 1000) + 14 * 86400,
};

async function main() {
  const dt = DateTime.fromISO(localSlot, { zone: guestTz });
  if (!dt.isValid) {
    console.error("Invalid slot:", localSlot, guestTz, dt.invalidReason);
    process.exit(1);
  }
  const startISO = dt.toUTC().toISO();

  let token;
  try {
    token = signGuestBookingToken(payload);
  } catch (e) {
    console.error("Sign token failed:", e.message);
    console.error("Set GUEST_BOOKING_LINK_SECRET (16+ chars, match Render).");
    process.exit(1);
  }

  const url = `${BASE}/api/guest/book`;
  const body = {
    t: token,
    start: startISO,
    attendeeEmail: payload.e,
    guestNotes: "guest-book-harness",
  };

  console.log("POST", url);
  console.log("Local slot:", localSlot, guestTz);
  console.log("start ISO (UTC):", startISO);
  console.log("---");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("HTTP", res.status, res.statusText);
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.log("Non-JSON body:\n", text.slice(0, 800));
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
  if (json.error === "Error") {
    console.log(
      "\n[NOTE] API returned literal 'Error' — server should map Google details; check Render logs for [guest-book]"
    );
  }
  process.exit(json.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
