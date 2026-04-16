/**
 * Weekly CC outreach digest: emails sent (rolling 7d) + guest bookings completed since last run.
 * Reads/writes Outbound Email Settings {Last Weekly Digest At} via first row of settings table.
 * Uses Airtable REST (same env pattern as guest booking), not the default singleton base client.
 */
const { DateTime } = require("luxon");
const { fetchHostClientProfile } = require("./guestBookingEventBuilder.js");
const {
  fetchOutboundEmailSettings,
  F,
} = require("./corporateCaptivesOutreachService.js");
const { AIRTABLE_LEAD_FIELDS } = require("./guestBookingAirtable.js");
const { sendTextEmail } = require("./gmailApiService.js");

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;

const SETTINGS_TABLE =
  process.env.CC_OUTREACH_SETTINGS_TABLE || "Outbound Email Settings";
const LEADS_TABLE = "Leads";
const BOOKING_DONE = AIRTABLE_LEAD_FIELDS.guestBookingCompletedAt;

function escapeFormulaString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

function toIsoCutoff(dt) {
  return dt.toUTC().toISO();
}

function formatLeadLine(fields, primaryTsField) {
  const name = (fields[F.firstName] && String(fields[F.firstName]).trim()) || "(no first name)";
  const em =
    (fields[F.email] && String(fields[F.email]).trim()) || "";
  const li = [fields[F.linkedInProfileUrl], fields[F.linkedInUrl]]
    .map((x) => (x ? String(x).trim() : ""))
    .find(Boolean);
  const ts = fields[primaryTsField];
  const tsStr = ts != null && ts !== "" ? String(ts).slice(0, 19) : "";
  const bits = [name, em, li && li.slice(0, 80)].filter(Boolean);
  return `  — ${bits.join(" · ")}${tsStr ? ` @ ${tsStr}` : ""}`;
}

async function listLeadsByFormula(baseId, filterByFormula, fieldNames) {
  if (!AIRTABLE_KEY) throw new Error("AIRTABLE_API_KEY not set");
  const records = [];
  let offset = "";
  const fieldsQ = fieldNames
    .map((f) => `fields[]=${encodeURIComponent(f)}`)
    .join("&");
  do {
    const q = new URLSearchParams({
      filterByFormula,
      pageSize: "100",
    });
    if (offset) q.set("offset", offset);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      LEADS_TABLE
    )}?${fieldsQ}&${q.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Airtable list Leads ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const r of data.records || []) {
      records.push(r);
    }
    offset = data.offset || "";
  } while (offset);
  return records;
}

async function patchSettingsFields(baseId, recordId, fieldsPatch) {
  if (!AIRTABLE_KEY) throw new Error("AIRTABLE_API_KEY not set");
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    SETTINGS_TABLE
  )}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: fieldsPatch }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Airtable patch settings ${res.status}: ${t.slice(0, 300)}`);
  }
}

/**
 * Load settings row via existing helper (Airtable.js + client base from clientId).
 * @param {import('airtable').Base} airtableBase
 */
async function loadSettingsViaService(airtableBase) {
  return fetchOutboundEmailSettings(airtableBase);
}

/**
 * @param {Object} opts
 * @param {string} [opts.clientId] default Guy-Wilson
 * @param {boolean} [opts.dryRun] if true, skip send + watermark patch
 * @returns {Promise<Object>}
 */
async function runCcWeeklyDigest(opts = {}) {
  const clientId = (opts.clientId && String(opts.clientId).trim()) || "Guy-Wilson";
  const dryRun = opts.dryRun === true;

  if (!AIRTABLE_KEY) {
    throw new Error("AIRTABLE_API_KEY not set");
  }

  const host = await fetchHostClientProfile(clientId);
  if (!host.airtableBaseId) {
    throw new Error("No Airtable base ID for host client");
  }

  const baseId = host.airtableBaseId;
  const { createBaseInstance } = require("../config/airtableClient.js");
  const airtableBase = createBaseInstance(baseId);
  const { recordId: settingsRecordId, fields: settingsFields } =
    await loadSettingsViaService(airtableBase);

  const nowBrisbane = DateTime.now().setZone("Australia/Brisbane");
  const sevenDaysAgoIso = toIsoCutoff(nowBrisbane.minus({ days: 7 }));

  const lastDigestRaw = settingsFields[F.lastWeeklyDigestAt];
  let bookingWatermarkIso = sevenDaysAgoIso;
  if (lastDigestRaw != null && String(lastDigestRaw).trim() !== "") {
    const d =
      lastDigestRaw instanceof Date
        ? lastDigestRaw
        : new Date(String(lastDigestRaw));
    if (!Number.isNaN(d.getTime())) {
      bookingWatermarkIso = d.toISOString();
    }
  }

  const sentFormula = `AND(NOT({${F.sentAt}} = BLANK()), IS_AFTER({${F.sentAt}}, '${escapeFormulaString(sevenDaysAgoIso)}'))`;
  const bookingFormula = `AND(NOT({${BOOKING_DONE}} = BLANK()), IS_AFTER({${BOOKING_DONE}}, '${escapeFormulaString(bookingWatermarkIso)}'))`;

  const commonLeadFields = [
    F.firstName,
    F.email,
    F.linkedInUrl,
    F.linkedInProfileUrl,
    F.sentAt,
    BOOKING_DONE,
  ];

  const sentRecords = await listLeadsByFormula(baseId, sentFormula, commonLeadFields);
  const bookingRecords = await listLeadsByFormula(
    baseId,
    bookingFormula,
    commonLeadFields
  );

  const digestRanAtIso = new Date().toISOString();
  const headerBrisbane = nowBrisbane.toFormat("ccc d LLL yyyy, HH:mm");

  const lines = [];
  lines.push(`CC outreach — weekly digest`);
  lines.push(`Generated (Brisbane): ${headerBrisbane}`);
  lines.push(`Client: ${host.clientId || clientId}`);
  lines.push(`Rolling sends window: last 7 days (since ${sevenDaysAgoIso})`);
  lines.push(
    `Guest bookings window: since last digest watermark (${bookingWatermarkIso}) — or last 7 days if never run`
  );
  lines.push("");
  lines.push(`Outbound emails sent (last 7 days): ${sentRecords.length}`);
  if (sentRecords.length === 0) {
    lines.push("  (none)");
  } else {
    for (const r of sentRecords) {
      lines.push(formatLeadLine(r.fields, F.sentAt));
    }
  }
  lines.push("");
  lines.push(`Guest bookings completed (since watermark): ${bookingRecords.length}`);
  if (bookingRecords.length === 0) {
    lines.push("  (none)");
  } else {
    for (const r of bookingRecords) {
      lines.push(formatLeadLine(r.fields, BOOKING_DONE));
    }
  }
  lines.push("");
  lines.push("— Automated summary from pb-webhook-server.");

  const textBody = lines.join("\n");
  const to =
    (process.env.CC_WEEKLY_DIGEST_EMAIL || "").trim() ||
    process.env.GMAIL_FROM_EMAIL ||
    "guyralphwilson@gmail.com";

  let emailResult = { skipped: dryRun };
  if (!dryRun) {
    await sendTextEmail({
      to,
      subject: `CC weekly digest · sends ${sentRecords.length} · bookings ${bookingRecords.length}`,
      text: textBody,
    });
    emailResult = { sent: true, to };

    await patchSettingsFields(baseId, settingsRecordId, {
      [F.lastWeeklyDigestAt]: digestRanAtIso,
    });
  }

  return {
    ok: true,
    dryRun,
    clientId: host.clientId || clientId,
    digestRanAt: digestRanAtIso,
    windows: {
      sendsSince: sevenDaysAgoIso,
      bookingsSince: bookingWatermarkIso,
    },
    counts: {
      sendsLast7Days: sentRecords.length,
      bookingsSinceWatermark: bookingRecords.length,
    },
    email: emailResult,
    settingsRecordId,
  };
}

module.exports = { runCcWeeklyDigest };
