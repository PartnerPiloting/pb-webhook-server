/**
 * Corporate Captives weekend outreach — selection + template (dry-run preview, future send).
 * Spec: docs/corporate-captives-outreach-spec.md
 */
const { DateTime } = require("luxon");

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
  scoreOrder: "Outbound Email Score Order",
  score: "Outbound Email Score",
  sentAt: "Outbound Email Sent At",
  subject1: "Email Subject 1",
  subject2: "Email Subject 2",
  subject3: "Email Subject 3",
  body: "Email Body",
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
        F.scoreOrder,
        F.score,
        F.sentAt,
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

  const order = numOrNull(record.get(F.scoreOrder));
  if (order === null) {
    return { ok: false, reason: "Outbound Email Score Order blank" };
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
    const oa = numOrNull(a.get(F.scoreOrder)) ?? -Infinity;
    const ob = numOrNull(b.get(F.scoreOrder)) ?? -Infinity;
    return ob - oa;
  });
  return { eligible, rejected };
}

/**
 * @param {import('airtable').Record[]} eligibleRecords
 * @param {{ fields: Object }} settings
 * @param {number} maxShow
 */
function buildPreviewRows(eligibleRecords, settings, maxShow) {
  const bodyTemplate = settings.fields[F.body] || "";
  const slice = eligibleRecords.slice(0, Math.max(0, maxShow));
  return slice.map((rec) => {
    const firstName = String(rec.get(F.firstName) || "").trim();
    const subject = pickRandomSubject(settings.fields);
    const html = applyTemplate(bodyTemplate, firstName);
    return {
      recordId: rec.id,
      to: String(rec.get(F.email) || "").trim(),
      subject,
      html,
      scoreOrder: numOrNull(rec.get(F.scoreOrder)),
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
  parts.push(`Brisbane today: <b>${todayBrisbane.toISODate()}</b> · Date Scored must be on/before: <b>${cutoffDay.toISODate()}</b> (60-day rule)</div>`);

  if (previewRows.length === 0) {
    parts.push("<p><strong>No rows to preview.</strong> Raise Max Sends Per Run or fix filters.</p>");
  }

  for (const row of previewRows) {
    parts.push("<div class='card'>");
    parts.push(`<h2>${escapeHtml(row.to)}</h2>`);
    parts.push(`<div class='chrome'>Record <code>${escapeHtml(row.recordId)}</code> · Outbound Email Score Order: <b>${row.scoreOrder}</b></div>`);
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
  pickRandomSubject,
  parseDateScoredBrisbane,
  emailLooksValid,
  numOrNull,
};
