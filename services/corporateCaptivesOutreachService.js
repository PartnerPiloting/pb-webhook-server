/**
 * Corporate Captives weekend outreach — selection + template (dry-run preview, future send).
 * Spec: docs/corporate-captives-outreach-spec.md
 */
const { DateTime } = require("luxon");
const { buildSearchBlob } = require("./oesRuleScorer.js");

/** Override on Render if your base uses a different table name (e.g. `Outbound Email`). */
const SETTINGS_TABLE =
  process.env.CC_OUTREACH_SETTINGS_TABLE || "Outbound Email Settings";
const LEADS_TABLE = "Leads";

const F = {
  email: "Email",
  firstName: "First Name",
  notes: "Notes",
  scoringStatus: "Scoring Status",
  dateScored: "Date Scored",
  score: "Outbound Email Score",
  sentAt: "Outbound Email Sent At",
  subject1: "Email Subject 1",
  subject2: "Email Subject 2",
  subject3: "Email Subject 3",
  body: "Email Body",
  bodyOwner: "Email Body (Owner)",
  bodyEmployee: "Email Body (Employee)",
  rawProfile: "Raw Profile Data",
  lastName: "Last Name",
  linkedInUrl: "LinkedIn URL",
  linkedInProfileUrl: "LinkedIn Profile URL",
  maxSends: "Max Sends Per Run",
  dryRun: "Dry Run",
  enabled: "Outbound Email Enabled",
  minDelay: "Min Seconds Between Sends",
};

const ALLOWED_SCORING = new Set(["Scored"]);

function notesEffectivelyEmpty(raw) {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim();
  if (s.length === 0) return true;
  return s === ".";
}

function emailLooksValid(email) {
  if (!email || typeof email !== "string") return false;
  const t = email.trim();
  if (!t.includes("@") || t.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickRandomSubject(settings) {
  const pool = [settings[F.subject1], settings[F.subject2], settings[F.subject3]]
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter(Boolean);
  if (pool.length === 0) return "(no subject configured)";
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyTemplate(bodyHtml, firstName) {
  const name = firstName == null ? "" : String(firstName).trim();
  return String(bodyHtml || "").split("{{FirstName}}").join(name);
}

const MISSING_BOOKING_LINK_HTML =
  '<span style="color:#b45309;font-size:0.9em">[Guest booking link not generated — need LinkedIn URL, full name, email, and GUEST_BOOKING_LINK_SECRET]</span>';

/**
 * After {{FirstName}}, replaces {{GuestBookingLink}} with a signed URL or a visible preview stub.
 */
function applyOutreachBodyTemplate(bodyHtml, firstName, bookingUrl) {
  let s = applyTemplate(bodyHtml, firstName);
  const subst = bookingUrl || MISSING_BOOKING_LINK_HTML;
  return s.split("{{GuestBookingLink}}").join(subst);
}

function buildLeadFullNameForBooking(record) {
  const first = String(record.get(F.firstName) || "").trim();
  const last = String(record.get(F.lastName) || "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || first || "";
}

function getLeadLinkedInUrl(record) {
  const primary = record.get(F.linkedInUrl);
  if (primary && String(primary).trim()) return String(primary).trim();
  const fallback = record.get(F.linkedInProfileUrl);
  if (fallback && String(fallback).trim()) return String(fallback).trim();
  return "";
}

/**
 * Same signing as scripts/guest-booking-mint-link.js. Returns null if anything missing or signing fails.
 */
function mintGuestBookingUrlForLead(record) {
  const e = String(record.get(F.email) || "").trim();
  const li = getLeadLinkedInUrl(record);
  const n = buildLeadFullNameForBooking(record);
  if (!emailLooksValid(e) || !li || !n) return null;
  let signGuestBookingToken;
  try {
    ({
      signGuestBookingToken,
      guestBookingTokenExpiryUnix,
    } = require("./guestBookingToken.js"));
    const exp = guestBookingTokenExpiryUnix();
    const token = signGuestBookingToken({ n, li, e, exp });
    const base = (
      process.env.GUEST_BOOKING_PUBLIC_BASE || "https://pb-webhook-server.onrender.com"
    ).replace(/\/$/, "");
    const { normalizeTimezoneInput } = require("./guestTimezoneAliases.js");
    const rawTz =
      process.env.GUEST_BOOKING_DEFAULT_GUEST_TZ ||
      process.env.GUEST_BOOKING_HOST_TIMEZONE ||
      "Australia/Brisbane";
    const guestTz = normalizeTimezoneInput(String(rawTz).trim()) || rawTz;
    return `${base}/guest-book?t=${encodeURIComponent(token)}&guestTz=${encodeURIComponent(guestTz)}`;
  } catch {
    return null;
  }
}

function parseProfileObjectForBlob(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Same text blob OES uses, for lightweight owner vs employee routing. */
function outreachProfileBlob(raw) {
  const obj = parseProfileObjectForBlob(raw);
  let textFromRaw = "";
  if (typeof raw === "string") textFromRaw = raw;
  else if (obj) {
    try {
      textFromRaw = JSON.stringify(obj);
    } catch {
      textFromRaw = "";
    }
  }
  return buildSearchBlob(obj, textFromRaw);
}

/**
 * Rule-based: "owner" if raw profile reads like primary business owner / founder;
 * otherwise "employee" (incl. side ventures, corporate roles, unknown).
 * @returns {"owner"|"employee"}
 */
function inferOutreachBodyVariant(raw) {
  const blob = outreachProfileBlob(raw);
  if (!blob || !String(blob).trim()) return "employee";
  const isOwner =
    /\b(co[- ]?founder|founder)\b/i.test(blob) ||
    /\b(self[- ]employed|sole\s+trader|sole\s+proprietor)\b/i.test(blob) ||
    /\bentrepreneur\b/i.test(blob) ||
    /\bbusiness\s+owner\b/i.test(blob) ||
    /\b(i\s+)?(founded|started)\s+(my\s+)?(own\s+)?(company|business|startup|firm)\b/i.test(
      blob
    );
  return isOwner ? "owner" : "employee";
}

function trimSetting(fields, airtableName) {
  const v = fields[airtableName];
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Pick HTML body: variant-specific column if set, else legacy Email Body.
 */
function pickBodyTemplate(settingsFields, variant) {
  const fallback = trimSetting(settingsFields, F.body);
  const ownerB = trimSetting(settingsFields, F.bodyOwner);
  const empB = trimSetting(settingsFields, F.bodyEmployee);
  if (variant === "owner" && ownerB) return ownerB;
  if (variant === "employee" && empB) return empB;
  return fallback || ownerB || empB || "";
}

function parseDateScoredBrisbane(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) {
    return DateTime.fromJSDate(val, { zone: "Australia/Brisbane" }).startOf("day");
  }
  const s = String(val);
  const dt = DateTime.fromISO(s, { zone: "Australia/Brisbane" });
  if (dt.isValid) return dt.startOf("day");
  const d2 = DateTime.fromFormat(s, "dd/MM/yyyy", { zone: "Australia/Brisbane" });
  if (d2.isValid) return d2.startOf("day");
  return null;
}

/**
 * Load first row of settings table (`CC_OUTREACH_SETTINGS_TABLE` or default) as plain object.
 */
async function fetchOutboundEmailSettings(base) {
  const rows = await base(SETTINGS_TABLE)
    .select({ maxRecords: 1 })
    .firstPage();
  if (!rows.length) {
    throw new Error(`No rows in ${SETTINGS_TABLE}`);
  }
  const rec = rows[0];
  const o = {};
  for (const k of Object.values(F)) {
    o[k] = rec.get(k);
  }
  return { recordId: rec.id, fields: o };
}

/**
 * Fetch leads that might qualify (narrow Airtable filter); full rules applied in JS.
 */
async function fetchScoredLeadCandidates(base) {
  const records = [];
  const formula = [
    `{${F.scoringStatus}}="Scored"`,
    `{${F.sentAt}}=BLANK()`,
    `LEN(TRIM({${F.email}}))>3`,
  ].join(",");

  await base(LEADS_TABLE)
    .select({
      filterByFormula: `AND(${formula})`,
      fields: [
        F.email,
        F.firstName,
        F.notes,
        F.scoringStatus,
        F.dateScored,
        F.score,
        F.sentAt,
        F.rawProfile,
        F.lastName,
        F.linkedInUrl,
        F.linkedInProfileUrl,
      ],
    })
    .eachPage((page, next) => {
      page.forEach((r) => records.push(r));
      next();
    });

  return records;
}

function leadPassesFilters(record, cutoffDay) {
  const status = record.get(F.scoringStatus);
  const statusStr = status == null ? "" : String(status).trim();

  if (!ALLOWED_SCORING.has(statusStr)) {
    return { ok: false, reason: `Scoring Status not allowed: ${statusStr || "(empty)"}` };
  }

  if (!notesEffectivelyEmpty(record.get(F.notes))) {
    return { ok: false, reason: "Notes not empty" };
  }

  const email = record.get(F.email);
  if (!emailLooksValid(email)) {
    return { ok: false, reason: "Email missing or invalid" };
  }

  const fn = record.get(F.firstName);
  if (fn == null || !String(fn).trim()) {
    return { ok: false, reason: "First Name missing" };
  }

  const score = numOrNull(record.get(F.score));
  if (score === null) {
    return { ok: false, reason: "Outbound Email Score blank" };
  }
  if (score === 0) {
    return { ok: false, reason: "Outbound Email Score is 0 (opt-out)" };
  }

  const ds = parseDateScoredBrisbane(record.get(F.dateScored));
  if (!ds) {
    return { ok: false, reason: "Date Scored missing" };
  }
  if (ds > cutoffDay) {
    return { ok: false, reason: "Date Scored within 60 days" };
  }

  return { ok: true, reason: "" };
}

function buildSortedEligible(records, cutoffDay) {
  const eligible = [];
  const rejected = [];
  for (const r of records) {
    const check = leadPassesFilters(r, cutoffDay);
    if (check.ok) {
      eligible.push(r);
    } else {
      rejected.push({ id: r.id, reason: check.reason });
    }
  }
  eligible.sort((a, b) => {
    const sa = numOrNull(a.get(F.score)) ?? -Infinity;
    const sb = numOrNull(b.get(F.score)) ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return String(a.id).localeCompare(String(b.id));
  });
  return { eligible, rejected };
}

/**
 * @param {import('airtable').Record[]} eligibleRecords
 * @param {{ fields: Object }} settings
 * @param {number} maxShow
 */
function buildPreviewRows(eligibleRecords, settings, maxShow) {
  const slice = eligibleRecords.slice(0, Math.max(0, maxShow));
  return slice.map((rec) => {
    const firstName = String(rec.get(F.firstName) || "").trim();
    const variant = inferOutreachBodyVariant(rec.get(F.rawProfile));
    const bodyTemplate = pickBodyTemplate(settings.fields, variant);
    const subject = pickRandomSubject(settings.fields);
    const bookingUrl = mintGuestBookingUrlForLead(rec);
    const html = applyOutreachBodyTemplate(bodyTemplate, firstName, bookingUrl);
    return {
      recordId: rec.id,
      to: String(rec.get(F.email) || "").trim(),
      subject,
      html,
      outboundScore: numOrNull(rec.get(F.score)),
      variant,
      guestBookingLinkOk: Boolean(bookingUrl),
    };
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Full HTML page for browser preview (dry run — no sends).
 */
async function buildDryRunPreviewHtml(options = {}) {
  const clientId = options.clientId || "Guy-Wilson";
  const limitOverride =
    options.limitOverride != null ? parseInt(options.limitOverride, 10) : null;

  const { getClientBase } = require("../config/airtableClient");
  const base = await getClientBase(clientId);

  const { fields: settingsFields } = await fetchOutboundEmailSettings(base);

  const todayBrisbane = DateTime.now().setZone("Australia/Brisbane").startOf("day");
  const cutoffDay = todayBrisbane.minus({ days: 60 });

  const candidates = await fetchScoredLeadCandidates(base);
  const { eligible, rejected } = buildSortedEligible(candidates, cutoffDay);

  const maxFromSettings = numOrNull(settingsFields[F.maxSends]);
  const maxSends =
    maxFromSettings != null && maxFromSettings >= 0
      ? maxFromSettings
      : 0;

  const effectiveMax =
    limitOverride != null && limitOverride >= 0
      ? limitOverride
      : maxSends;

  const previewRows = buildPreviewRows(eligible, { fields: settingsFields }, effectiveMax);

  const dryRun = String(settingsFields[F.dryRun] || "").toLowerCase() === "yes";
  const enabled = String(settingsFields[F.enabled] || "").toLowerCase() === "yes";

  const parts = [];
  parts.push("<!DOCTYPE html><html><head><meta charset='utf-8'><title>CC outreach — dry-run preview</title>");
  parts.push("<style>body{font-family:system-ui,sans-serif;margin:16px;background:#f4f4f5;}h1{font-size:1.25rem;}.meta{background:#fff;border:1px solid #ddd;padding:12px;margin-bottom:16px;border-radius:8px;}.card{background:#fff;border:1px solid #ddd;margin-bottom:20px;border-radius:8px;overflow:hidden;}.card h2{margin:0;padding:10px 12px;background:#eee;font-size:0.95rem;}.chrome{padding:10px 12px;font-size:0.85rem;color:#444;border-bottom:1px solid #eee;}.body{padding:12px;}</style></head><body>");
  parts.push("<h1>Corporate Captives — dry-run preview</h1>");
  parts.push("<div class='meta'><strong>No emails were sent.</strong><br>");
  parts.push(`Client: <code>${escapeHtml(clientId)}</code><br>`);
  parts.push(`Outbound Email Enabled: <b>${enabled ? "Yes" : "No"}</b> · Dry Run (setting): <b>${dryRun ? "Yes" : "No"}</b><br>`);
  parts.push(`Max Sends Per Run (Airtable): <b>${maxSends}</b> · Showing up to: <b>${effectiveMax}</b><br>`);
  parts.push(`Scored candidates (pre-filter): <b>${candidates.length}</b> · Eligible after rules: <b>${eligible.length}</b><br>`);
  parts.push(`Brisbane today: <b>${todayBrisbane.toISODate()}</b> · Date Scored must be on/before: <b>${cutoffDay.toISODate()}</b> (60-day rule)<br>`);
  parts.push(
    `Use <code>{{GuestBookingLink}}</code> in email HTML to insert a signed <code>/guest-book</code> URL (or an orange note in preview if something is missing).</div>`
  );

  if (previewRows.length === 0) {
    parts.push("<p><strong>No rows to preview.</strong> Raise Max Sends Per Run or fix filters.</p>");
  }

  for (const row of previewRows) {
    parts.push("<div class='card'>");
    parts.push(`<h2>${escapeHtml(row.to)}</h2>`);
    parts.push(
      `<div class='chrome'>Record <code>${escapeHtml(row.recordId)}</code> · Outbound Email Score: <b>${row.outboundScore}</b> · Body variant: <b>${escapeHtml(row.variant)}</b> · Guest booking link: <b>${row.guestBookingLinkOk ? "yes" : "no"}</b></div>`
    );
    parts.push(`<div class='chrome'><strong>Subject:</strong> ${escapeHtml(row.subject)}</div>`);
    parts.push("<div class='body'>");
    parts.push(row.html);
    parts.push("</div></div>");
  }

  parts.push(
    `<p style="color:#666;font-size:0.9rem;">Rejected after rules: <b>${rejected.length}</b> (details in server logs only).</p>`
  );

  parts.push("</body></html>");
  return parts.join("");
}

module.exports = {
  buildDryRunPreviewHtml,
  fetchOutboundEmailSettings,
  fetchScoredLeadCandidates,
  buildSortedEligible,
  buildPreviewRows,
  escapeHtml,
  F,
  notesEffectivelyEmpty,
  leadPassesFilters,
  applyTemplate,
  applyOutreachBodyTemplate,
  mintGuestBookingUrlForLead,
  getLeadLinkedInUrl,
  buildLeadFullNameForBooking,
  pickRandomSubject,
  parseDateScoredBrisbane,
  emailLooksValid,
  numOrNull,
  inferOutreachBodyVariant,
  pickBodyTemplate,
  outreachProfileBlob,
};
