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
  /** Long text: one YYYY-MM-DD per line (Brisbane calendar); # starts a comment line */
  blackoutDates: "Outbound Blackout Dates",
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

/** Line is only ASCII/typographic quotes or backticks (Airtable long text often pasted inside "…"). */
function isStandaloneQuoteLine(line) {
  const t = String(line).replace(/\r/g, "").trim();
  if (!t) return false;
  return /^["'`\u201c\u201d\u2018\u2019\u00ab\u00bb]+$/.test(t);
}

/** Drop leading/trailing quote-only lines so sent HTML matches intent. */
function stripSurroundingStandaloneQuoteLines(html) {
  const s = String(html || "").replace(/\r\n/g, "\n");
  const lines = s.split("\n");
  while (lines.length && isStandaloneQuoteLine(lines[0])) lines.shift();
  while (lines.length && isStandaloneQuoteLine(lines[lines.length - 1])) lines.pop();
  return lines.join("\n");
}

/**
 * Airtable long text often stores `href=""url""` (two dquotes on each side). That is invalid HTML;
 * clients may drop the link and leave styled text only.
 */
function fixDoubledQuoteDelimitedAttrs(html) {
  return String(html || "")
    .replace(/\bhref=""([^"]*)""/gi, 'href="$1"')
    .replace(/\bsrc=""([^"]*)""/gi, 'src="$1"');
}

const MISSING_BOOKING_LINK_HTML =
  '<span style="color:#b45309;font-size:0.9em">[Guest booking link not generated — need LinkedIn URL, full name, email, and GUEST_BOOKING_LINK_SECRET]</span>';

/**
 * Hard-coded outreach body for employee/corporate-captive leads.
 * {{FirstName}} and {{IntroLink}} are replaced at send time.
 */
const HARDCODED_EMPLOYEE_BODY = `<p>Hi {{FirstName}},</p>
<p>We connected on LinkedIn – and after looking at your background, I wanted to reach out directly.</p>
<p>Having been in business my whole life, I know the moment when you start quietly asking yourself what's actually next.</p>
<p>Most people at your stage aren't looking to quit and start a business.<br/>They're just aware something needs to shift – and not sure what yet.</p>
<p>If that's where you're at – <a href="{{IntroLink}}">this could be pivotal</a>. Happy to have a chat.</p>
<p>(I know a) Guy</p>`;

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
  s = fixDoubledQuoteDelimitedAttrs(s);
  return stripSurroundingStandaloneQuoteLines(s);
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
    return `${base}/intro?t=${encodeURIComponent(token)}`;
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
 * Rule-based body template: owner vs employee vs default (Email Body) when we can't classify from profile text.
 * @returns {"owner"|"employee"|"default"}
 */
function classifyOutreachBodyVariant(raw) {
  const blob = outreachProfileBlob(raw);
  const b = blob == null ? "" : String(blob).trim();
  if (!b) return "default";
  const isOwner =
    /\b(co[- ]?founder|founder)\b/i.test(b) ||
    /\b(self[- ]employed|sole\s+trader|sole\s+proprietor)\b/i.test(b) ||
    /\bentrepreneur\b/i.test(b) ||
    /\bbusiness\s+owner\b/i.test(b) ||
    /\b(i\s+)?(founded|started)\s+(my\s+)?(own\s+)?(company|business|startup|firm)\b/i.test(b);
  return isOwner ? "owner" : "employee";
}

/** @returns {"owner"|"employee"} — maps default → employee for callers that expect a binary choice */
function inferOutreachBodyVariant(raw) {
  const v = classifyOutreachBodyVariant(raw);
  return v === "default" ? "employee" : v;
}

function trimSetting(fields, airtableName) {
  const v = fields[airtableName];
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Pick HTML body: Employee / Owner columns, or default Email Body when variant is "default" or the chosen column is empty.
 * @param {"owner"|"employee"|"default"} variant
 */
function pickBodyTemplate(settingsFields, variant) {
  const fallback = trimSetting(settingsFields, F.body);
  const ownerB = trimSetting(settingsFields, F.bodyOwner);
  const empB = trimSetting(settingsFields, F.bodyEmployee);
  if (variant === "default") return fallback || empB || ownerB || "";
  if (variant === "owner" && ownerB) return ownerB;
  if (variant === "employee" && empB) return empB;
  return fallback || ownerB || empB || "";
}

const CC_PERSONAL_LINE_MODEL =
  process.env.CC_PERSONAL_LINE_MODEL || "gemini-2.5-flash";
/** Same model as flash by default; override with CC_OUTREACH_CLASSIFY_MODEL on Render. */
const CC_OUTREACH_CLASSIFY_MODEL =
  process.env.CC_OUTREACH_CLASSIFY_MODEL || CC_PERSONAL_LINE_MODEL;
const PERSONAL_LINE_TIMEOUT_MS = 30000;
const PERSONAL_LINE_MAX_ATTEMPTS = 2;
const OUTREACH_CLASSIFY_TIMEOUT_MS = 20000;
const OUTREACH_CLASSIFY_MAX_ATTEMPTS = 2;

const DEFAULT_OUTREACH_CLASSIFY_PROMPT = `You classify LinkedIn profiles for a narrow B2B outreach aimed at experienced professionals who are "corporate captives" — thinking about what's next, not necessarily quitting to start a business.

Decide outreachFit: "send" or "skip".

SEND (outreachFit: "send") when ANY of these apply:
- Their primary role is employee, manager, director, or professional working for an employer.
- They have a side venture, startup, advisory role, or board seat but their main story is still employment or is mixed — include them.
- They previously founded or sold a business but are now primarily in an employed role.
- They are a consultant or contractor working inside client organisations (not "my own firm is my product").
- Profile is thin or ambiguous — prefer "send".

SKIP (outreachFit: "skip") only when:
- Running their own company is clearly their main occupation and primary income (full-time founder/CEO of their own firm, sole operator living off self-employment).
- Self-employed / sole trader as the dominant identity with no meaningful corporate anchor.
- Principal of their own practice where the practice is their sole focus and they are not also anchored in a corporate role.

When uncertain, prefer "send".`;

const OUTREACH_CLASSIFY_JSON_SUFFIX = `---
OUTPUT (mandatory). Respond with ONLY valid JSON. No markdown fences. No other text.
{"outreachFit":"send"}

outreachFit must be exactly "send" or "skip" (see rules above).`;

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
- Follow the OUTPUT FORMAT below (JSON with personalLine + variant)`;

/** Appended after your Airtable prompt. Gemini picks which HTML template: employee, owner, or default. */
const CC_PERSONALIZATION_JSON_SUFFIX = `---
OUTPUT (mandatory). Respond with ONLY valid JSON. No markdown fences. No other text.
{"variant":"employee","personalLine":"your phrase here"}

variant must be exactly one of: "employee", "owner", "default"
- "employee" → use the Email Body (Employee) template (e.g. alongside core role, corporate path).
- "owner" → use the Email Body (Owner) template (founder, self-employed, principal of own practice, building their own thing).
- "default" → use the main Email Body template when unclear, thin profile, or neither template fits confidently.

personalLine: 10-25 words; completes: After seeing your profile - [phrase] - I thought it made sense to reach out. Australian spelling. No trailing full stop. Lowercase start.`;

function extractPersonalizationJson(raw) {
  const trimmed = String(raw).trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    /* continue */
  }
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    /* continue */
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      /* continue */
    }
  }
  return null;
}

/**
 * Gemini: send corporate-captives outreach? Includes employees, side ventures alongside a job,
 * former founders now employed; skips full-time owner-operators as primary income.
 * @returns {Promise<{ send: boolean, source: "ai" } | null>} null → caller uses keyword rules
 */
async function classifyOutreachAudienceWithAI(rawProfileStr, logger) {
  if (!vertexAIClient) return null;

  const profileText =
    typeof rawProfileStr === "string"
      ? rawProfileStr.slice(0, 12000)
      : JSON.stringify(rawProfileStr || {}).slice(0, 12000);

  if (!profileText || profileText.length < 20) {
    if (logger) logger.info("[OUTREACH-CLASSIFY] Profile too short for AI, using keyword rules");
    return null;
  }

  const prompt = DEFAULT_OUTREACH_CLASSIFY_PROMPT.trim();
  const userMessage = `${prompt}\n\n${OUTREACH_CLASSIFY_JSON_SUFFIX}\n\n---\nLEAD PROFILE DATA:\n${profileText}\n---`;
  const model = vertexAIClient.getGenerativeModel({ model: CC_OUTREACH_CLASSIFY_MODEL });

  for (let attempt = 1; attempt <= OUTREACH_CLASSIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const callPromise = model.generateContent({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Outreach classify timed out")), OUTREACH_CLASSIFY_TIMEOUT_MS)
      );
      const result = await Promise.race([callPromise, timeoutPromise]);
      const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text || typeof text !== "string") {
        if (logger) logger.warn(`[OUTREACH-CLASSIFY] attempt ${attempt}: no content`);
        continue;
      }
      const parsed = extractPersonalizationJson(text);
      if (parsed && typeof parsed === "object" && parsed.outreachFit != null) {
        const fit = String(parsed.outreachFit).trim().toLowerCase();
        if (fit === "send") return { send: true, source: "ai" };
        if (fit === "skip") return { send: false, source: "ai" };
      }
      if (logger) logger.warn(`[OUTREACH-CLASSIFY] attempt ${attempt}: invalid outreachFit`);
    } catch (err) {
      if (logger) logger.warn(`[OUTREACH-CLASSIFY] attempt ${attempt}: ${err.message}`);
      if (attempt < OUTREACH_CLASSIFY_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  if (logger) logger.warn("[OUTREACH-CLASSIFY] All attempts failed, using keyword rules");
  return null;
}

/** @returns {"owner"|"employee"|"default"|null} */
function normalizeTemplateVariant(v) {
  const s = v == null ? "" : String(v).trim().toLowerCase();
  if (s === "owner" || s === "employee" || s === "default") return s;
  return null;
}

/**
 * One Gemini call: personal line + which Airtable body field to use.
 * @param {"owner"|"employee"|"default"} ruleFallbackVariant — from classifyOutreachBodyVariant if AI omits/invalid JSON
 * @returns {Promise<{ personalLine: string, variant: "owner"|"employee"|"default", variantSource: string } | null>}
 */
async function generatePersonalization(rawProfileStr, promptTemplate, logger, ruleFallbackVariant) {
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
  const userMessage = `${prompt}\n\n${CC_PERSONALIZATION_JSON_SUFFIX}\n\n---\nLEAD PROFILE DATA:\n${profileText}\n---`;
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

      const parsed = extractPersonalizationJson(text);
      if (parsed && typeof parsed === "object" && parsed.personalLine != null) {
        let cleaned = String(parsed.personalLine).trim();
        while (cleaned.length >= 2 && /^["'`\u201c\u201d\u2018\u2019]/.test(cleaned) && /["'`\u201c\u201d\u2018\u2019]$/.test(cleaned)) {
          cleaned = cleaned.slice(1, -1).trim();
        }
        cleaned = cleaned.replace(/\.+$/, "").trim();
        if (cleaned.length < 5 || cleaned.length > 300) {
          if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: personalLine bad length (${cleaned.length})`);
          continue;
        }
        let variant = normalizeTemplateVariant(parsed.variant);
        let variantSource = "ai";
        if (!variant) {
          variant = ruleFallbackVariant;
          variantSource = "rules_fallback";
          if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: invalid variant, using rules (${variant})`);
        }
        return { personalLine: cleaned, variant, variantSource };
      }

      let cleaned = text.trim();
      while (cleaned.length >= 2 && /^["'`\u201c\u201d\u2018\u2019]/.test(cleaned) && /["'`\u201c\u201d\u2018\u2019]$/.test(cleaned)) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      cleaned = cleaned.replace(/\.+$/, "").trim();
      if (cleaned.length >= 5 && cleaned.length <= 300 && !/^\s*\{/.test(cleaned)) {
        if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: plain text reply, variant from rules (${ruleFallbackVariant})`);
        return {
          personalLine: cleaned,
          variant: ruleFallbackVariant,
          variantSource: "plain_text_fallback",
        };
      }

      if (logger) logger.warn(`[PERSONAL-LINE] attempt ${attempt}: could not parse JSON`);
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

function getTodayBrisbaneISODate() {
  return DateTime.now().setZone("Australia/Brisbane").startOf("day").toISODate();
}

/**
 * Parse blackout list from settings. One YYYY-MM-DD per line; blank lines and lines starting with # ignored.
 * @returns {Set<string>} ISO dates (yyyy-MM-dd) in Brisbane calendar sense
 */
function parseOutboundBlackoutDateSet(raw) {
  const set = new Set();
  if (raw == null || raw === "") return set;
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const part = t.split(/\s+/)[0].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) continue;
    const dt = DateTime.fromISO(part, { zone: "Australia/Brisbane" }).startOf("day");
    if (dt.isValid) set.add(dt.toISODate());
  }
  return set;
}

/**
 * @returns {{ blocked: boolean, today: string, dates: string[] }}
 */
function outboundBlackoutStatus(settingsFields) {
  const set = parseOutboundBlackoutDateSet(settingsFields[F.blackoutDates]);
  const today = getTodayBrisbaneISODate();
  return {
    blocked: set.has(today),
    today,
    dates: Array.from(set).sort(),
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

function shuffleArrayCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Random sample from leads that pass Airtable + eligibility filters (pre–buildPreviewRows audience gate).
 * Runs Gemini audience classifier per lead with keyword fallback — for stats / harness only.
 *
 * @param {{ clientId?: string, sampleSize?: number, delayMs?: number, logger?: object }} options
 */
async function runCorporateCaptivesAudienceSample(options = {}) {
  const clientId =
    (options.clientId && String(options.clientId).trim()) || "Guy-Wilson";
  const sampleCap = Math.min(
    500,
    Math.max(1, parseInt(String(options.sampleSize ?? 100), 10) || 100)
  );
  const delayMs = Math.max(
    0,
    parseInt(String(options.delayMs ?? 250), 10) || 0
  );
  const logger = options.logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const { getClientBase } = require("../config/airtableClient.js");
  const base = await getClientBase(clientId);
  const { fields: settingsFields } = await fetchOutboundEmailSettings(base);
  const eligibilityOptions = eligibilityOptionsFromSettingsFields(settingsFields);

  const candidates = await fetchScoredLeadCandidates(base);
  const { eligible, rejected } = buildSortedEligible(candidates, eligibilityOptions);

  if (eligible.length === 0) {
    return {
      ok: true,
      clientId,
      eligiblePoolSize: 0,
      rejectedCount: rejected.length,
      sampleSize: 0,
      send: 0,
      skip: 0,
      aiSend: 0,
      aiSkip: 0,
      rulesFallback: 0,
      sendPercent: null,
      skipPercent: null,
    };
  }

  const pool = shuffleArrayCopy(eligible).slice(0, sampleCap);
  const n = pool.length;

  let send = 0;
  let skip = 0;
  let aiSend = 0;
  let aiSkip = 0;
  let rulesFallback = 0;

  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    const ai = await classifyOutreachAudienceWithAI(rec.get(F.rawProfile), logger);
    if (ai != null) {
      if (ai.send) {
        send++;
        aiSend++;
      } else {
        skip++;
        aiSkip++;
      }
    } else {
      rulesFallback++;
      if (classifyOutreachBodyVariant(rec.get(F.rawProfile)) !== "owner") {
        send++;
      } else {
        skip++;
      }
    }
    if (delayMs > 0 && i < pool.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const sendPct = n ? Math.round((send / n) * 1000) / 10 : 0;
  const skipPct = n ? Math.round((skip / n) * 1000) / 10 : 0;

  return {
    ok: true,
    clientId,
    eligiblePoolSize: eligible.length,
    rejectedCount: rejected.length,
    sampleSize: n,
    send,
    skip,
    aiSend,
    aiSkip,
    rulesFallback,
    sendPercent: sendPct,
    skipPercent: skipPct,
  };
}

/**
 * @param {import('airtable').Record[]} eligibleRecords
 * @param {{ fields: Object }} settings
 * @param {number} maxShow
 * @param {Object} [logger] — optional contextLogger
 */
async function buildPreviewRows(eligibleRecords, settings, maxShow, logger) {
  const slice = eligibleRecords.slice(0, Math.max(0, maxShow));

  if (slice.length > 0 && vertexAIClient) {
    await warmUpGeminiFlash(logger);
  }

  const rows = [];
  let skippedAudience = 0;
  for (const rec of slice) {
    const firstName = String(rec.get(F.firstName) || "").trim();
    const ruleVariant = classifyOutreachBodyVariant(rec.get(F.rawProfile));

    const aiAudience = await classifyOutreachAudienceWithAI(rec.get(F.rawProfile), logger);
    let send;
    let audienceSource;
    if (aiAudience != null) {
      send = aiAudience.send;
      audienceSource = aiAudience.source;
    } else {
      send = ruleVariant !== "owner";
      audienceSource = "rules_fallback";
    }

    if (!send) {
      skippedAudience++;
      if (logger) {
        logger.info(
          `[OUTREACH] Skipping ${rec.get(F.email)}: audience=skip source=${audienceSource} ruleVariant=${ruleVariant}`
        );
      }
      continue;
    }

    const subject = pickRandomSubject(settings.fields);
    const bookingUrl = mintGuestBookingUrlForLead(rec);

    let html = HARDCODED_EMPLOYEE_BODY;
    const name = firstName || "";
    html = html.split("{{FirstName}}").join(name);
    html = html.split("{{IntroLink}}").join(bookingUrl || MISSING_BOOKING_LINK_HTML);

    rows.push({
      recordId: rec.id,
      to: String(rec.get(F.email) || "").trim(),
      subject,
      html,
      outboundScore: numOrNull(rec.get(F.score)),
      variant: "employee",
      ruleVariant,
      variantSource: `hardcoded_employee_${audienceSource}`,
      audienceSource,
      guestBookingLinkOk: Boolean(bookingUrl),
      personalLine: null,
    });
  }
  if (skippedAudience > 0 && logger) {
    logger.info(`[OUTREACH] ${skippedAudience} lead(s) skipped — audience not a fit`);
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
  const blackout = outboundBlackoutStatus(settingsFields);

  const parts = [];
  parts.push("<!DOCTYPE html><html><head><meta charset='utf-8'><title>CC outreach — dry-run preview</title>");
  parts.push("<style>body{font-family:system-ui,sans-serif;margin:16px;background:#f4f4f5;}h1{font-size:1.25rem;}.meta{background:#fff;border:1px solid #ddd;padding:12px;margin-bottom:16px;border-radius:8px;}.card{background:#fff;border:1px solid #ddd;margin-bottom:20px;border-radius:8px;overflow:hidden;}.card h2{margin:0;padding:10px 12px;background:#eee;font-size:0.95rem;}.chrome{padding:10px 12px;font-size:0.85rem;color:#444;border-bottom:1px solid #eee;}.body{padding:12px;}</style></head><body>");
  parts.push("<h1>Corporate Captives — dry-run preview</h1>");
  parts.push("<div class='meta'><strong>No emails were sent.</strong><br>");
  parts.push(`Client: <code>${escapeHtml(clientId)}</code><br>`);
  parts.push(`Outbound Email Enabled: <b>${enabled ? "Yes" : "No"}</b> · Dry Run (setting): <b>${dryRun ? "Yes" : "No"}</b><br>`);
  if (blackout.blocked) {
    parts.push(
      `<strong style="color:#b45309">Blackout:</strong> Brisbane today <b>${escapeHtml(blackout.today)}</b> is in <code>Outbound Blackout Dates</code> — a <em>live</em> send-run would skip; this preview still shows samples.<br>`
    );
  } else if (blackout.dates.length > 0) {
    parts.push(
      `Blackout dates configured (${blackout.dates.length}): <code>${escapeHtml(blackout.dates.slice(0, 12).join(", "))}${blackout.dates.length > 12 ? "…" : ""}</code> · Today not listed.<br>`
    );
  }
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
      `<div class='chrome'>Record <code>${escapeHtml(row.recordId)}</code> · Outbound Email Score: <b>${row.outboundScore}</b> · Template: <b>${escapeHtml(row.variant)}</b> · <small>Audience: <b>${escapeHtml(row.audienceSource || "—")}</b> · ${escapeHtml(row.variantSource || "")} · keyword: ${escapeHtml(row.ruleVariant || "")}</small> · Guest booking link: <b>${row.guestBookingLinkOk ? "yes" : "no"}</b></div>`
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

  const blackout = outboundBlackoutStatus(settingsFields);
  if (blackout.blocked) {
    logger.info(`Skip: Outbound blackout date (Brisbane ${blackout.today})`);
    return {
      ok: true,
      ran: false,
      reason: "blackout_date",
      blackoutDate: blackout.today,
    };
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
  runCorporateCaptivesAudienceSample,
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
  classifyOutreachBodyVariant,
  inferOutreachBodyVariant,
  pickBodyTemplate,
  outreachProfileBlob,
  classifyOutreachAudienceWithAI,
  generatePersonalization,
  warmUpGeminiFlash,
  outboundBlackoutStatus,
  parseOutboundBlackoutDateSet,
  getTodayBrisbaneISODate,
};
