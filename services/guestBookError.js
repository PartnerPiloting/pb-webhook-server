/**
 * Map Google / gaxios errors to a single user-facing string.
 * Never return the bare string "Error".
 */

function nonGenericApiMessage(s) {
  const t = s == null ? "" : String(s).trim();
  if (!t || t === "Error") return null;
  return t;
}

function normalizeResponseData(raw) {
  if (raw == null) return raw;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }
  return raw;
}

function serializeBookError(err) {
  if (!err) return "Booking failed.";
  const status = err.response?.status;
  const statusText = err.response?.statusText;
  let d = normalizeResponseData(err.response?.data);

  if (typeof d === "string" && d.trim()) {
    const t = d.replace(/\s+/g, " ").trim();
    return t.length > 280 ? t.slice(0, 280) + "…" : t;
  }

  const ge = d?.error;
  if (ge && typeof ge === "object") {
    const e0 = Array.isArray(ge.errors) ? ge.errors[0] : null;
    const parts = [];
    if (e0) {
      if (e0.message && String(e0.message) !== "Error") parts.push(String(e0.message));
      if (e0.reason) parts.push(String(e0.reason));
      if (e0.domain) parts.push(String(e0.domain));
    }
    if (ge.message && String(ge.message) !== "Error") parts.push(String(ge.message));
    const merged = [
      ...new Set(parts.filter(Boolean).map((p) => String(p))),
    ].filter((p) => nonGenericApiMessage(p));
    if (merged.length) {
      const msg = merged.join(" — ");
      return status ? `(${status}) ${msg}` : msg;
    }
    if (ge.message === "Error" && e0?.reason) {
      const msg = [e0.reason, e0.domain].filter(Boolean).join(" · ");
      return status ? `(${status}) ${msg}` : msg;
    }
  }

  if (typeof ge === "string" && ge.trim() && ge !== "Error") return ge;
  {
    const sub = nonGenericApiMessage(d?.error?.errors?.[0]?.message);
    if (sub) return status ? `(${status}) ${sub}` : sub;
  }

  const m = err.message && String(err.message).trim();
  if (m && m !== "Error") return status ? `(${status}) ${m}` : m;

  if (Array.isArray(err.errors) && err.errors[0]?.message) {
    const em = nonGenericApiMessage(err.errors[0].message);
    if (em) return em;
  }
  if (err.cause?.message) return String(err.cause.message);

  try {
    if (d && typeof d === "object") {
      const s = JSON.stringify(d);
      if (s.length > 2 && s.length < 800) return s;
    }
  } catch (_) {}

  if (status) {
    const st = statusText ? ` ${statusText}` : "";
    return `Booking failed (HTTP ${status}${st}). Try again or pick another time.`;
  }
  return "Booking failed. Please try again or pick another time.";
}

/**
 * Long plain-text report for the guest UI (not a band-aid string — full context).
 * @returns {{ summary: string, detail: string }}
 */
function buildGuestBookErrorReport(err) {
  const summary = serializeBookError(err);
  const lines = [];
  lines.push("WHAT WENT WRONG");
  lines.push(summary);
  lines.push("");
  lines.push("TECHNICAL DETAILS");
  if (err?.message && String(err.message).trim()) {
    lines.push(`Exception / library message: ${String(err.message).trim()}`);
  }
  const status = err?.response?.status;
  const statusText = err?.response?.statusText;
  if (status != null || statusText) {
    lines.push(
      `HTTP: ${status != null ? status : "?"} ${statusText || ""}`.trim()
    );
  }
  if (err?.code != null) {
    lines.push(`Request error code (e.g. gaxios): ${String(err.code)}`);
  }
  const d = normalizeResponseData(err?.response?.data);
  if (d != null) {
    lines.push("");
    lines.push("RESPONSE BODY (Google Calendar API or gateway):");
    try {
      const str =
        typeof d === "string" ? d : JSON.stringify(d, null, 2);
      lines.push(
        str.length > 6000
          ? str.slice(0, 6000) + "\n… [truncated at 6000 characters]"
          : str
      );
    } catch (_) {
      lines.push(String(d));
    }
  } else {
    lines.push(
      "(No HTTP response body — failure may be local: timeout, DNS, TLS, or network.)"
    );
  }
  return { summary, detail: lines.join("\n") };
}

/**
 * Validation / config failures before any Google call.
 * @returns {{ summary: string, detail: string }}
 */
function buildGuestBookValidationReport(stage, shortMessage, extra = {}) {
  const lines = [];
  lines.push("WHAT WENT WRONG");
  lines.push(shortMessage);
  lines.push("");
  lines.push("WHERE IT FAILED");
  lines.push(String(stage));
  if (extra && typeof extra === "object" && Object.keys(extra).length) {
    lines.push("");
    lines.push("CONTEXT");
    try {
      lines.push(JSON.stringify(extra, null, 2));
    } catch (_) {
      lines.push(String(extra));
    }
  }
  return { summary: shortMessage, detail: lines.join("\n") };
}

function logGuestBookFailure(err) {
  try {
    const d = normalizeResponseData(err?.response?.data);
    console.error(
      "[guest-book]",
      JSON.stringify(
        {
          errMessage: err?.message,
          status: err?.response?.status,
          statusText: err?.response?.statusText,
          data: d,
        },
        null,
        0
      )
    );
  } catch (_) {
    console.error("[guest-book]", err?.message || err);
  }
}

module.exports = {
  serializeBookError,
  nonGenericApiMessage,
  logGuestBookFailure,
  buildGuestBookErrorReport,
  buildGuestBookValidationReport,
};
