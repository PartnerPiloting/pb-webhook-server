/**
 * Corporate Captives weekend outreach — selection + template (dry-run preview, future send).
 * Spec: docs/corporate-captives-outreach-spec.md
 */
const { DateTime } = require("luxon");
const { buildSearchBlob } = require("./oesRuleScorer.js");
const { vertexAIClient } = require("../config/geminiClient.js");

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
  minOutboundScore: "Min Outbound Email Score",
  minDaysSinceLeadAdded: "Min Days Since Lead Added",
  location: "Location",
  personalLinePrompt: "Personal Line Prompt",
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
function applyOutreachBodyTemplate(bodyHtml, firstName, bookingUrl, personalLine) {
  let s = applyTemplate(bodyHtml, firstName);
  const subst = bookingUrl || MISSING_BOOKING_LINK_HTML;
  s = s.split("{{GuestBookingLink}}").join(subst);
  if (personalLine != null) {
    s = s.split("{{PersonalLine}}").join(String(personalLine));
  }
  return s;
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
/**
 * Derive IANA timezone from a free-text location string using substring matching.
 * Same approach as linkedin-messaging-followup-next/lib/timezoneFromLocation.js.
 */
function tzFromLeadLocation(location) {
  if (!location || typeof location !== "string") return "";
  const loc = location.toLowerCase();

  if (loc.includes("melbourne") || loc.includes("victoria") || loc.includes("geelong") || loc.includes("ballarat") || loc.includes("dandenong") || loc.includes("bendigo")) return "Australia/Melbourne";
  if (loc.includes("sydney") || loc.includes("canberra") || loc.includes("nsw") || loc.includes("new south wales") || loc.includes("wollongong") || loc.includes("newcastle")) return "Australia/Sydney";
  if (loc.includes("brisbane") || loc.includes("queensland") || loc.includes("gold coast") || loc.includes("sunshine coast") || loc.includes("cairns") || loc.includes("townsville")) return "Australia/Brisbane";
  if (loc.includes("perth") || loc.includes("western australia")) return "Australia/Perth";
  if (loc.includes("adelaide") || loc.includes("south australia")) return "Australia/Adelaide";
  if (loc.includes("darwin") || loc.includes("northern territory")) return "Australia/Darwin";
  if (loc.includes("hobart") || loc.includes("tasmania") || loc.includes("launceston")) return "Australia/Hobart";
  if (loc.includes("auckland") || loc.includes("new zealand") || loc.includes("wellington")) return "Pacific/Auckland";
  if (loc.includes("singapore")) return "Asia/Singapore";
  if (loc.includes("hong kong")) return "Asia/Hong_Kong";
  if (loc.includes("london") || loc.includes("england")) return "Europe/London";
  return "";
}

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
    const rawLocation = record.get(F.location) || record.get("Location") || "";
    const leadTz = tzFromLeadLocation(rawLocation);
    const fallbackRaw =
      process.env.GUEST_BOOKING_DEFAULT_GUEST_TZ ||
      process.env.GUEST_BOOKING_HOST_TIMEZONE ||
      "Australia/Brisbane";
    const guestTz = leadTz || normalizeTimezoneInput(String(fallbackRaw).trim()) || fallbackRaw;
    console.log(`[CC-OUTREACH-TZ] email=${e} location="${rawLocation}" leadTz="${leadTz}" guestTz="${guestTz}"`);
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

const CC_PERSONAL_LINE_MODEL =
  process.env.CC_PERSONAL_LINE_MODEL || "gemini-2.5-flash";
const PERSONAL_LINE_TIMEOUT_MS = 30000;
const PERSONAL_LINE_MAX_ATTEMPTS = 2;
const PERSONAL_LINE_FALLBACK = "what you're building";

const DEFAULT_PERSONAL_LINE_PROMPT = `From this LinkedIn profile data, find ONE thing that suggests this person values collaboration, helping others succeed, or building through relationships rather than just transactions.

Look at their About/summary section first for statements about advocating for others, lifting people up, creating value through networks, or believing in reciprocity. If nothing explicit, look for clues — mentoring, community building, championing teams, or language that suggests openness over self-promotion. If nothing collaborative, fall back to what they're building or their boldest career move.

Write a short phrase (10-25 words) that completes the sentence "After seeing your profile — [YOUR PHRASE HERE] — I thought I just had to reach out."

GOOD examples:
- your mission to advance the global AI workforce by connecting the right people, not just filling roles
- the way you champion your team's growth at Oracle, not just the numbers
- your belief that the best business outcomes come from genuinely helping others succeed
- building Gradstack from scratch to solve a problem you saw firsthand

BAD (too generic):
- your impressive career
- your great experience in sales
- your leadership skills

RULES:
- Australian spelling
- No quotes around the phrase
- No full stop at the end
- Don't start with "I" or "Your" — start with a lowercase word (e.g. "your", "the way", "building")
- Don't echo their job title back at them — find something deeper
- Return ONLY the phrase, nothing else`;

async function warmUpGeminiFlash(logger) {
  if (!vertexAIClient) return;
  try {
    if (logger) logger.info("[PERSONAL-LINE] Warming up Gemini Flash...");
    const model = vertexAIClient.getGenerativeModel({ model: CC_PERSONAL_LINE_MODEL });
    const warmupPromise = model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("warmup timed out")), PERSONAL_LINE_TIMEOUT_MS)
    );
    await Promise.race([warmupPromise, timeoutPromise]);
    await new Promise((r) => setTimeout(r, 2000));
    if (logger) logger.info("[PERSONAL-LINE] Warmup complete");
  } catch (err) {
    if (logger) logger.warn(`[PERSONAL-LINE] Warmup failed (non-fatal): ${err.message}`);
  }
}

async function generatePersonalLine(rawProfileStr, promptTemplate, logger) {
  if (!vertexAIClient) {
    if (logger) logger.warn("[PERSONAL-LINE] Gemini not initialised, skipping lead");
    return null;
  }

  const profileText =
    typeof rawProfileStr === "string"
      ? rawProfileStr.slice(0, 12000)
      : JSON.stringify(rawProfileStr || {}).slice(0, 12000);

  if (!profileText || profileText.length < 20) {
    if (logger) logger.info("[PERSONAL-LINE] Profile data too short, skipping lead");
    return null;
  }

  const prompt = (promptTemplate || DEFAULT_PERSONAL_LINE_PROMPT).trim();
  const userMessage = `${prompt}\n\n---\nLEAD PROFILE DATA:\n${profileText}\n---`;
  const model = vertexAIClient.getGenerativeModel({ model: CC_PERSONAL_LINE_MODEL });

  for (let attempt = 1; attempt <= PERSONAL_LINE_MAX_ATTEMPTS; attempt++) {
    try {
      const callPromise = model.generateContent({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Personal line generation timed out")), PERSONAL_LINE_TIMEOUT_MS)
      );
      const result = await Promise.race([callPromise, timeoutPromise]);
      const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || typeof text !== "string") {
        if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: AI returned no content`);
        continue;
      }
      let cleaned = text.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "").trim();
      if (cleaned.length < 5 || cleaned.length > 300) {
        if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: unexpected length (${cleaned.length})`);
        continue;
      }
      return cleaned;
    } catch (err) {
      if (logger) logger.error(`[PERSONAL-LINE] attempt ${attempt}: ${err.message}`);
      if (attempt < PERSONAL_LINE_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  if (logger) logger.warn("[PERSONAL-LINE] All attempts failed, skipping lead");
  return null;
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

/** Airtable record `createdTime` → calendar day in Brisbane. */
function getLeadCreatedDayBrisbane(record) {
  const raw = record && record._rawJson && record._rawJson.createdTime;
  if (!raw) return null;
  const dt = DateTime.fromISO(String(raw), { zone: "utc" })
    .setZone("Australia/Brisbane")
    .startOf("day");
  return dt.isValid ? dt : null;
}

/**
 * @param {Object} settingsFields — row from Outbound Email Settings
 * @returns {{ minOutboundScoreFloor: number | null, minDaysSinceCreated: number | null }}
 */
function eligibilityOptionsFromSettingsFields(settingsFields) {
  const minS = numOrNull(settingsFields[F.minOutboundScore]);
  const minD = numOrNull(settingsFields[F.minDaysSinceLeadAdded]);
  return {
    minOutboundScoreFloor: Number.isFinite(minS) ? minS : null,
    minDaysSinceCreated:
      Number.isFinite(minD) && minD >= 0 ? minD : null,
  };
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

function maxCandidateRecordsToFetch() {
  const n = parseInt(process.env.CC_OUTREACH_MAX_CANDIDATES || "2500", 10);
  if (!Number.isFinite(n) || n < 50) return 2500;
  return Math.min(n, 10000);
}

/**
 * Fetch leads that might qualify (narrow Airtable filter); full rules applied in JS.
 * Capped and score-sorted so large bases don’t time out the HTTP request on Render.
 */
async function fetchScoredLeadCandidates(base) {
  const records = [];
  const formula = [
    `{${F.scoringStatus}}="Scored"`,
    `{${F.sentAt}}=BLANK()`,
    `LEN(TRIM({${F.email}}))>3`,
  ].join(",");

  const cap = maxCandidateRecordsToFetch();

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
        // Many Guy bases use "LinkedIn Profile URL" only; omit "LinkedIn URL" to avoid Airtable UNKNOWN_FIELD.
        F.linkedInProfileUrl,
        F.location,
      ],
      sort: [{ field: F.score, direction: "desc" }],
      maxRecords: cap,
    })
    .eachPage((page, next) => {
      page.forEach((r) => records.push(r));
      next();
    });

  return records;
}

/**
 * @param {import('airtable').Record} record
 * @param {{ minOutboundScoreFloor?: number | null, minDaysSinceCreated?: number | null }} options
 *   minOutboundScoreFloor: when set, require score **strictly greater** than this (e.g. 7 → 8+).
 *   minDaysSinceCreated: when set, require Airtable created day at least N Brisbane calendar days before today.
 */
function leadPassesFilters(record, options = {}) {
  const minOutboundScoreFloor =
    options.minOutboundScoreFloor != null && Number.isFinite(options.minOutboundScoreFloor)
      ? options.minOutboundScoreFloor
      : null;
  const minDaysSinceCreated =
    options.minDaysSinceCreated != null &&
    Number.isFinite(options.minDaysSinceCreated) &&
    options.minDaysSinceCreated >= 0
      ? options.minDaysSinceCreated
      : null;

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

  if (minOutboundScoreFloor !== null && !(score > minOutboundScoreFloor)) {
    return {
      ok: false,
      reason: `Outbound Email Score not above ${minOutboundScoreFloor}`,
    };
  }

  const ds = parseDateScoredBrisbane(record.get(F.dateScored));
  if (!ds) {
    return { ok: false, reason: "Date Scored missing" };
  }

  if (minDaysSinceCreated !== null) {
    const createdDay = getLeadCreatedDayBrisbane(record);
    if (!createdDay) {
      return { ok: false, reason: "Lead created time unknown" };
    }
    const todayBrisbane = DateTime.now().setZone("Australia/Brisbane").startOf("day");
    const oldestOkCreated = todayBrisbane.minus({ days: minDaysSinceCreated });
    if (createdDay > oldestOkCreated) {
      return {
        ok: false,
        reason: `Lead created within last ${minDaysSinceCreated} days`,
      };
    }
  }

  return { ok: true, reason: "" };
}

function buildSortedEligible(records, eligibilityOptions) {
  const eligible = [];
  const rejected = [];
  for (const r of records) {
    const check = leadPassesFilters(r, eligibilityOptions);
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
 * @param {Object} [logger] — optional contextLogger
 */
async function buildPreviewRows(eligibleRecords, settings, maxShow, logger) {
  const slice = eligibleRecords.slice(0, Math.max(0, maxShow));
  const promptTemplate = trimSetting(settings.fields, F.personalLinePrompt) || "";

  const needsPersonalLine = slice.length > 0 && [
    pickBodyTemplate(settings.fields, "owner"),
    pickBodyTemplate(settings.fields, "employee"),
    trimSetting(settings.fields, F.body),
  ].some((tpl) => tpl.includes("{{PersonalLine}}"));

  if (needsPersonalLine) {
    await warmUpGeminiFlash(logger);
  }

  const rows = [];
  let skippedNoPersonalLine = 0;
  for (const rec of slice) {
    const firstName = String(rec.get(F.firstName) || "").trim();
    const variant = inferOutreachBodyVariant(rec.get(F.rawProfile));
    const bodyTemplate = pickBodyTemplate(settings.fields, variant);
    const subject = pickRandomSubject(settings.fields);
    const bookingUrl = mintGuestBookingUrlForLead(rec);

    let personalLine = null;
    if (needsPersonalLine) {
      personalLine = await generatePersonalLine(
        rec.get(F.rawProfile),
        promptTemplate,
        logger
      );
      if (personalLine == null) {
        skippedNoPersonalLine++;
        if (logger) logger.warn(`[PERSONAL-LINE] Skipping ${rec.get(F.email)}: AI could not generate a line`);
        continue;
      }
      if (logger) logger.info(`[PERSONAL-LINE] ${rec.get(F.email)}: "${personalLine}"`);
    }

    const html = applyOutreachBodyTemplate(bodyTemplate, firstName, bookingUrl, personalLine);
    rows.push({
      recordId: rec.id,
      to: String(rec.get(F.email) || "").trim(),
      subject,
      html,
      outboundScore: numOrNull(rec.get(F.score)),
      variant,
      guestBookingLinkOk: Boolean(bookingUrl),
      personalLine,
    });
  }
  if (skippedNoPersonalLine > 0 && logger) {
    logger.warn(`[PERSONAL-LINE] ${skippedNoPersonalLine} lead(s) skipped — no personal line generated`);
  }
  return rows;
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
  const eligibilityOptions = eligibilityOptionsFromSettingsFields(settingsFields);

  const candidates = await fetchScoredLeadCandidates(base);
  const { eligible, rejected } = buildSortedEligible(candidates, eligibilityOptions);

  const maxFromSettings = numOrNull(settingsFields[F.maxSends]);
  const maxSends =
    maxFromSettings != null && maxFromSettings >= 0
      ? maxFromSettings
      : 0;

  const effectiveMax =
    limitOverride != null && limitOverride >= 0
      ? limitOverride
      : maxSends;

  const previewRows = await buildPreviewRows(eligible, { fields: settingsFields }, effectiveMax);

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
  parts.push(
    `Airtable fetch cap (sorted by score desc): <b>${maxCandidateRecordsToFetch()}</b> · Loaded: <b>${candidates.length}</b><br>`
  );
  parts.push(`Scored candidates (pre-filter): <b>${candidates.length}</b> · Eligible after rules: <b>${eligible.length}</b><br>`);
  const minScoreLbl =
    eligibilityOptions.minOutboundScoreFloor != null
      ? `must be &gt; ${escapeHtml(String(eligibilityOptions.minOutboundScoreFloor))}`
      : escapeHtml("(no minimum — not 0/blank only)");
  const minDaysLbl =
    eligibilityOptions.minDaysSinceCreated != null
      ? escapeHtml(String(eligibilityOptions.minDaysSinceCreated))
      : escapeHtml("(no minimum age)");
  parts.push(
    `Brisbane today: <b>${todayBrisbane.toISODate()}</b> · <b>Date Scored</b> required · Outbound Email Score ${minScoreLbl} · Min days since Airtable <b>created</b>: <b>${minDaysLbl}</b><br>`
  );
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
    if (row.personalLine) {
      parts.push(`<div class='chrome'><strong>Personal Line (AI):</strong> <em>${escapeHtml(row.personalLine)}</em></div>`);
    }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Min seconds from settings + random 0..jitter cap (seconds), both from env override on jitter cap. */
function jitterWaitMs(settingsFields) {
  const minSecRaw = numOrNull(settingsFields[F.minDelay]);
  const floorSec = minSecRaw != null && minSecRaw >= 0 ? minSecRaw : 90;
  const capSec = parseInt(
    process.env.CC_OUTREACH_JITTER_MAX_SECONDS || String(floorSec),
    10
  );
  const jitterSec = Number.isFinite(capSec) && capSec >= 0 ? capSec : floorSec;
  return floorSec * 1000 + Math.floor(Math.random() * (jitterSec * 1000 + 1));
}

/**
 * Send batch outreach via Gmail; stamps Outbound Email Sent At on success.
 * Respects Outbound Email Enabled + Dry Run from settings.
 */
async function runCorporateCaptivesSendRun(options = {}) {
  const { createLogger } = require("../utils/contextLogger.js");
  const { sendHtmlEmail, moveSentToLabel } = require("./gmailApiService.js");
  const CC_OUTREACH_LABEL = process.env.CC_OUTREACH_GMAIL_LABEL || "CC Outreach";

  const clientId = (options.clientId && String(options.clientId).trim()) || "Guy-Wilson";
  const limitOverride =
    options.limitOverride != null && options.limitOverride !== ""
      ? parseInt(String(options.limitOverride).trim(), 10)
      : null;

  const logger = createLogger({
    runId: `CC-SEND-${Date.now()}`,
    clientId,
    operation: "corporate_captives_send",
  });

  const { getClientBase } = require("../config/airtableClient.js");
  const base = await getClientBase(clientId);

  const { fields: settingsFields } = await fetchOutboundEmailSettings(base);

  const enabled = String(settingsFields[F.enabled] || "").toLowerCase() === "yes";
  if (!enabled) {
    logger.info("Skip: Outbound Email Enabled is not Yes");
    return { ok: true, ran: false, reason: "outbound_email_disabled" };
  }

  const dryRun = String(settingsFields[F.dryRun] || "").toLowerCase() === "yes";
  if (dryRun) {
    logger.info("Skip: Dry Run is Yes");
    return { ok: true, ran: false, reason: "dry_run_yes" };
  }

  const eligibilityOptions = eligibilityOptionsFromSettingsFields(settingsFields);
  const candidates = await fetchScoredLeadCandidates(base);
  const { eligible, rejected } = buildSortedEligible(candidates, eligibilityOptions);

  const maxFromSettings = numOrNull(settingsFields[F.maxSends]);
  const maxSends =
    maxFromSettings != null && maxFromSettings >= 0 ? maxFromSettings : 0;

  const effectiveMax =
    limitOverride != null && !Number.isNaN(limitOverride) && limitOverride >= 0
      ? limitOverride
      : maxSends;

  if (effectiveMax <= 0) {
    return {
      ok: true,
      ran: false,
      reason: "max_sends_zero",
      eligibleCount: eligible.length,
      rejectedCount: rejected.length,
    };
  }

  const rows = await buildPreviewRows(eligible, { fields: settingsFields }, effectiveMax, logger);
  if (rows.length === 0) {
    return {
      ok: true,
      ran: false,
      reason: "no_rows_to_send",
      eligibleCount: eligible.length,
      rejectedCount: rejected.length,
    };
  }

  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0) {
      const ms = jitterWaitMs(settingsFields);
      logger.info(`Sleep ${ms}ms before next send`);
      await sleep(ms);
    }

    if (!row.guestBookingLinkOk) {
      logger.warn(`Skip ${row.to}: guest booking link not generated`);
      results.push({
        recordId: row.recordId,
        to: row.to,
        ok: false,
        error: "guest_booking_link_missing",
      });
      continue;
    }

    try {
      const sendResult = await sendHtmlEmail({
        to: row.to,
        subject: row.subject,
        html: row.html,
      });
      if (sendResult && sendResult.id) {
        await moveSentToLabel(sendResult.id, CC_OUTREACH_LABEL);
      }
      await base(LEADS_TABLE).update([
        {
          id: row.recordId,
          fields: { [F.sentAt]: new Date().toISOString() },
        },
      ]);
      logger.info(`Sent OK ${row.to} record=${row.recordId}`);
      results.push({ recordId: row.recordId, to: row.to, ok: true });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      logger.error(`Send failed ${row.to}: ${msg}`);
      results.push({ recordId: row.recordId, to: row.to, ok: false, error: msg });
    }
  }

  return {
    ok: true,
    ran: true,
    clientId,
    attempted: rows.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    eligibleCount: eligible.length,
    rejectedCount: rejected.length,
  };
}

module.exports = {
  buildDryRunPreviewHtml,
  runCorporateCaptivesSendRun,
  fetchOutboundEmailSettings,
  fetchScoredLeadCandidates,
  buildSortedEligible,
  buildPreviewRows,
  escapeHtml,
  F,
  eligibilityOptionsFromSettingsFields,
  getLeadCreatedDayBrisbane,
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
  generatePersonalLine,
  warmUpGeminiFlash,
};
