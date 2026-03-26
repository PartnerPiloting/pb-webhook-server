/**
 * Signed payload for public guest booking links (Guy-only).
 * Env: GUEST_BOOKING_LINK_SECRET (min 16 chars).
 */
const crypto = require("crypto");

function getSecret() {
  const s = process.env.GUEST_BOOKING_LINK_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error("GUEST_BOOKING_LINK_SECRET missing or too short (need 16+ chars)");
  }
  return s;
}

/**
 * @param {Object} payload
 * @param {string} payload.n lead full name
 * @param {string} payload.li LinkedIn profile URL (canonical from Airtable)
 * @param {string} payload.e marketing / on-file email
 * @param {number} payload.exp Unix seconds (required)
 */
function signGuestBookingToken(payload) {
  const body = JSON.stringify(payload);
  const h = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  const b = Buffer.from(body, "utf8").toString("base64url");
  return `${b}.${h}`;
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
function verifyGuestBookingToken(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "missing token" };
  }
  const dot = token.indexOf(".");
  if (dot < 1) {
    return { ok: false, error: "invalid format" };
  }
  const b = token.slice(0, dot);
  const h = token.slice(dot + 1);
  let body;
  try {
    body = Buffer.from(b, "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "invalid encoding" };
  }
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  if (!timingSafeEqualStr(h, expected)) {
    return { ok: false, error: "bad signature" };
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) {
    return { ok: false, error: "expired" };
  }
  if (!payload.n || !payload.li || !payload.e) {
    return { ok: false, error: "invalid payload" };
  }
  return { ok: true, payload };
}

module.exports = {
  signGuestBookingToken,
  verifyGuestBookingToken,
};
