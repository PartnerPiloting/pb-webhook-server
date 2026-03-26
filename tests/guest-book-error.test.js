/**
 * Ensures booking errors never degrade to the bare string "Error".
 *   node tests/guest-book-error.test.js
 */
const assert = require("assert");
const {
  serializeBookError,
  buildGuestBookErrorReport,
} = require("../services/guestBookError.js");

function assertNotBareError(msg, label) {
  const t = String(msg || "").trim();
  assert.notStrictEqual(t, "Error", label || "must not be bare Error");
}

// Google style: top-level message "Error", detail in errors[0]
const google403 = {
  message: "Error",
  response: {
    status: 403,
    statusText: "Forbidden",
    data: {
      error: {
        code: 403,
        message: "Error",
        errors: [
          {
            message: "Insufficient Permission",
            domain: "global",
            reason: "insufficientPermissions",
          },
        ],
      },
    },
  },
};

assert(
  serializeBookError(google403).includes("Insufficient") ||
    serializeBookError(google403).includes("insufficientPermissions"),
  "403 sample"
);
assertNotBareError(serializeBookError(google403), "403");

// Stringified JSON body (some proxies)
const stringBody = {
  message: "Error",
  response: {
    status: 400,
    data: JSON.stringify({
      error: {
        message: "Invalid Value",
        errors: [{ domain: "global", reason: "invalid", message: "Bad" }],
      },
    }),
  },
};
assert(serializeBookError(stringBody).includes("Invalid") || serializeBookError(stringBody).includes("Bad"));
assertNotBareError(serializeBookError(stringBody), "string body");

// Only HTTP status
const bare = { message: "Error", response: { status: 503, statusText: "Service Unavailable" } };
assert(serializeBookError(bare).includes("503"));
assertNotBareError(serializeBookError(bare), "503");

const rep = buildGuestBookErrorReport(google403);
assert(rep.detail.includes("Insufficient") || rep.detail.includes("insufficientPermissions"));
assert(rep.detail.includes("WHAT WENT WRONG"));
assert(rep.detail.includes("RESPONSE BODY"));

console.log("guest-book-error tests: OK");
