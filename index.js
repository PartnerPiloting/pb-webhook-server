/***************************************************************
  LinkedIn → Airtable  (Scoring + 1st-degree sync)
  --------------------------------------------------------------
  • /lh-webhook/upsertLeadOnly sets:
        - LinkedIn Connection Status = "Candidate"
        - Scoring Status            = "To Be Scored"
  • upsertLead() defaults new 2nd-degree contacts to "Candidate",
    writes Scoring Status, and now also sets
        Status = "In Process"
***************************************************************/
require("dotenv").config();
const express    = require("express");
const { Configuration, OpenAIApi } = require("openai");
const Airtable   = require("airtable");
const fs         = require("fs");
const fetch      = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { buildPrompt }   = require("./promptBuilder");
const { loadAttributes } = require("./attributeLoader");        // dynamic dicts
const { callGptScoring } = require("./callGptScoring");         // GPT scorer
const { buildAttributeBreakdown } = require("./breakdown");     // shared breakdown
const { scoreLeadNow } = require("./singleScorer");             // single-lead scorer

const mountPointerApi = require("./pointerApi");
const mountLatestLead = require("./latestLeadApi");
const mountUpdateLead = require("./updateLeadApi");
const mountQueue      = require("./queueDispatcher");
const batchScorer     = require("./batchScorer");               // batch scorer

/* ------------------------------------------------------------------
   helper: getJsonUrl
------------------------------------------------------------------*/
function getJsonUrl(obj = {}) {
  return (
    obj?.data?.output?.jsonUrl ||
    obj?.data?.resultObject?.jsonUrl ||
    obj?.data?.resultObject?.output?.jsonUrl ||
    obj?.output?.jsonUrl ||
    obj?.resultObject?.jsonUrl ||
    (() => {
      const m = JSON.stringify(obj).match(/https?:\/\/[^"'\s]+\/result\.json/i);
      return m ? m[0] : null;
    })()
  );
}

/* ------------------------------------------------------------------
   helper: canonicalUrl
------------------------------------------------------------------*/
function canonicalUrl(url = "") {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
}

/* ------------------------------------------------------------------
   helper: isAustralian
------------------------------------------------------------------*/
function isAustralian(loc = "") {
  return /\b(australia|aus|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|nsw|vic|qld|wa|sa|tas|act|nt)\b/i
    .test(loc);
}

/* ------------------------------------------------------------------
   helper: safeDate
------------------------------------------------------------------*/
function safeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d;
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(d)) {
    const iso = d.replace(/\./g, "-");
    return new Date(iso + "T00:00:00Z");
  }
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
}

/* ------------------------------------------------------------------
   helper: getLastTwoOrgs
------------------------------------------------------------------*/
function getLastTwoOrgs(lh = {}) {
  const out = [];
  for (let i = 1; i <= 2; i++) {
    const org   = lh[`organization_${i}`];
    const title = lh[`organization_title_${i}`];
    const sr    = lh[`organization_start_${i}`];
    const er    = lh[`organization_end_${i}`];
    if (!org && !title) continue;
    const range = sr || er ? `(${sr || "?"} – ${er || "Present"})` : "";
    out.push(`${title || "Unknown Role"} at ${org || "Unknown"} ${range}`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------
   1)  Globals & Express
------------------------------------------------------------------*/
const TEST_MODE          = process.env.TEST_MODE === "true";
const MIN_SCORE          = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";

const app = express();
app.use(express.json({ limit: "10mb" }));

/* mount miscellaneous sub-APIs */
require("./promptApi")(app);
require("./recordApi")(app);
require("./scoreApi")(app);
mountQueue(app);

/* ------------------------------------------------------------------
   1.5)  health check + manual batch route
------------------------------------------------------------------*/
app.get("/health", (_req, res) => res.send("ok"));

/* ---------------------------------------------------------------
   MANUAL TRIGGER  –  /run-batch-score?limit=10
----------------------------------------------------------------- */
app.get("/run-batch-score", async (req, res) => {
  const limit = Number(req.query.limit) || 500;
  console.log(`▶︎ /run-batch-score hit – limit ${limit}`);

  batchScorer.run(limit)
    .then(() => console.log(`Batch scoring (limit ${limit}) complete`))
    .catch(err => console.error("batchScorer error:", err));

  res.send(`Batch scoring for up to ${limit} leads has started.`);
});

/* ------------------------------------------------------------------
   ONE-OFF LEAD SCORER  –  /score-lead?recordId=recXXXXXXXX
------------------------------------------------------------------*/
app.get("/score-lead", async (req, res) => {
  try {
    const id = req.query.recordId;
    if (!id) return res.status(400).json({ error: "recordId query param required" });

    const record   = await base("Leads").find(id);
    const fullLead = JSON.parse(record.get("Profile Full JSON") || "{}");

    // shared singleScorer + GPT
    const raw = await scoreLeadNow(fullLead);
    const gpt = await callGptScoring(raw);

    const { positives, negatives } = await loadAttributes();

    const {
      positive_scores     = {},
      negative_scores     = {},
      contact_readiness   = false,
      unscored_attributes = [],
      aiProfileAssessment = "",
      attribute_reasoning = {},
    } = gpt;

    /* -------- compute rawScore (pos – neg) -------- */
    const rawScore =
      Object.values(positive_scores || {}).reduce((s, v) => s + v, 0) +
      Object.values(negative_scores || {}).reduce((s, v) => {
        const n = typeof v === "number" ? v : v?.score ?? 0;
        return s + n;
      }, 0);

    let finalPct = gpt.finalPct;
    if (finalPct === undefined) {
      const { percentage } = computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );
      finalPct = Math.round(percentage * 100) / 100;
    }

    const breakdown = buildAttributeBreakdown(
      positive_scores,
      positives,
      negative_scores,
      negatives,
      unscored_attributes,
      rawScore,               // real numerator
      0,
      attribute_reasoning,
      false,
      null
    );

    await base("Leads").update(id, {
      "AI Score"              : finalPct,
      "AI Profile Assessment" : aiProfileAssessment,
      "AI Attribute Breakdown": breakdown,
      "Scoring Status"        : "Scored",
      "Date Scored"           : new Date().toISOString().split("T")[0],
    });

    res.json({ id, finalPct, aiProfileAssessment, breakdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   2)  OpenAI + Airtable setup
------------------------------------------------------------------*/
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai        = new OpenAIApi(configuration);

Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

/* ------------------------------------------------------------------
   2.5)  Pointer + latest-lead routes
------------------------------------------------------------------*/
const GPT_CHAT_URL = process.env.GPT_CHAT_URL;
if (!GPT_CHAT_URL) throw new Error("Missing GPT_CHAT_URL env var");

mountPointerApi(app, base, GPT_CHAT_URL);
mountLatestLead(app, base);
mountUpdateLead(app, base);

/* ------------------------------------------------------------------
   3)  computeFinalScore  (unchanged)
------------------------------------------------------------------*/
function computeFinalScore(
  positive_scores,
  dictionaryPositives,
  negative_scores,
  dictionaryNegatives,
  contact_readiness = false,
  unscored_attributes = []
) {
  let disqualified = false;
  let disqualifyReason = null;

  if (
    dictionaryPositives["I"] &&
    !unscored_attributes.includes("I") &&
    !("I" in positive_scores)
  ) {
    positive_scores["I"] = 0;
  }

  let baseDenominator = 0;
  for (const [attrID, pInfo] of Object.entries(dictionaryPositives)) {
    if (!unscored_attributes.includes(attrID))
      baseDenominator += pInfo.maxPoints;
  }

  let rawScore = 0;
  for (const pts of Object.values(positive_scores || {})) rawScore += pts;

  for (const [attrID, pInfo] of Object.entries(dictionaryPositives)) {
    if (pInfo.minQualify > 0) {
      const awarded    = positive_scores[attrID] || 0;
      const isUnscored = unscored_attributes.includes(attrID);
      if (isUnscored || awarded < pInfo.minQualify) {
        disqualified     = true;
        disqualifyReason =
          `Min qualification not met for ${attrID} (needed ${pInfo.minQualify}, got ${awarded})`;
        return {
          rawScore: 0,
          denominator: baseDenominator,
          percentage: 0,
          disqualified,
          disqualifyReason,
        };
      }
    }
  }

  for (const [negID, penalty] of Object.entries(negative_scores || {})) {
    if (dictionaryNegatives[negID]?.disqualifying && penalty !== 0) {
      disqualified     = true;
      disqualifyReason = `Disqualifying negative attribute ${negID} triggered`;
      return {
        rawScore: 0,
        denominator: baseDenominator,
        percentage: 0,
        disqualified,
        disqualifyReason,
      };
    }
  }

  for (const pen of Object.values(negative_scores || {})) rawScore += pen;
  if (rawScore < 0) rawScore = 0;

  const percentage =
    baseDenominator === 0 ? 0 : (rawScore / baseDenominator) * 100;

  return {
    rawScore,
    denominator: baseDenominator,
    percentage,
    disqualified,
    disqualifyReason,
  };
}

/* ------------------------------------------------------------------
   4)  getScoringData & helpers  (legacy parser – retained for safety)
------------------------------------------------------------------*/
async function getScoringData() {
  const md = await buildPrompt();
  const passMark = 0;

  const truncated = md.replace(/```python[\s\S]*?```/g, "");
  const { positives, negatives } = parseMarkdownTables(truncated);

  return {
    truncatedInstructions: truncated,
    passMark,
    positives,
    negatives,
  };
}

function parseMarkdownTables(markdown) {
  const positives = {};
  const negatives = {};
  const lines     = markdown.split("\n");
  let section     = null;
  const posRow =
    /^\|\s*([A-Z])\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|?$/;
  const negRow =
    /^\|\s*([A-Z0-9]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|?$/;

  for (const line of lines) {
    const t = line.trim();
    if (/^#{2,}\s*Positive Attributes/i.test(t)) { section = "pos"; continue; }
    if (/^#{2,}\s*Negative Attributes/i.test(t)) { section = "neg"; continue; }
    if (/^#{2,}/.test(t))                       { section = null;  continue; }
    if (!section || t.startsWith("|----") || /^\|\s*ID\s*\|/i.test(t)) continue;

    if (section === "pos") {
      const m = t.match(posRow);
      if (!m) continue;
      const [, id, label, maxRaw, minRaw, notes] = m;
      positives[id] = {
        label:      label.trim(),
        maxPoints:  parseInt(maxRaw.replace(/[^\d]/g, ""), 10) || 0,
        minQualify: parseInt(minRaw.replace(/[^\d]/g, ""), 10) || 0,
        notes:      notes.trim(),
      };
    } else {
      const m = t.match(negRow);
      if (!m) continue;
      const [, id, label, penRaw, disqRaw, notes] = m;
      negatives[id] = {
        label:        label.trim(),
        penalty:      parseInt(penRaw.replace(/[^\-\d]/g, ""), 10) || 0,
        disqualifying:/yes/i.test(disqRaw.trim()),
        notes:        notes.trim(),
      };
    }
  }
  return { positives, negatives };
}

/* ------------------------------------------------------------------
   5)  upsertLead  (AI fields written only if argument ≠ null)
------------------------------------------------------------------*/
async function upsertLead(
  lead,
  finalScore          = null,
  aiProfileAssessment = null,
  attributeReasoning  = null,
  attributeBreakdown  = null,
  auFlag              = null,
  aiExcluded          = null,
  excludeDetails      = null
) {
  const {
    firstName = "",
    lastName  = "",
    headline: lhHeadline = "",

    linkedinHeadline = "",
    linkedinJobTitle = "",
    linkedinCompanyName = "",
    linkedinDescription = "",

    linkedinProfileUrl = "",
    connectionDegree   = "",

    linkedinJobDateRange          = "",
    linkedinJobDescription        = "",
    linkedinPreviousJobDateRange  = "",
    linkedinPreviousJobDescription= "",

    refreshedAt = "",
    profileUrl: fallbackProfileUrl = "",
    linkedinConnectionStatus,

    emailAddress = "",
    phoneNumber  = "",
    locationName = "",
    connectionSince,

    scoringStatus = undefined,

    ...rest
  } = lead;

  let jobHistory = [
    linkedinJobDateRange
      ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}`
      : "",
    linkedinPreviousJobDateRange
      ? `Previous:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}`
      : "",
  ].filter(Boolean).join("\n");

  if (!jobHistory && lead.raw) {
    const hist = getLastTwoOrgs(lead.raw);
    if (hist) jobHistory = hist;
  }

  let finalUrl = (linkedinProfileUrl || fallbackProfileUrl || "").replace(/\/$/, "");
  if (!finalUrl) {
    const slug = lead.publicId || lead.publicIdentifier;
    const mid  = lead.memberId || lead.profileId;
    if      (slug) finalUrl = `https://www.linkedin.com/in/${slug}/`;
    else if (mid)  finalUrl = `https://www.linkedin.com/profile/view?id=${mid}`;
  }
  if (!finalUrl && lead.raw) {
    const r = lead.raw;
    if      (typeof r.profile_url === "string" && r.profile_url.trim()) finalUrl = r.profile_url.trim().replace(/\/$/, "");
    else if (r.public_id)  finalUrl = `https://www.linkedin.com/in/${r.public_id}/`;
    else if (r.member_id)  finalUrl = `https://www.linkedin.com/profile/view?id=${r.member_id}`;
  }
  if (!finalUrl) return;

  const profileKey = canonicalUrl(finalUrl);

  let connectionStatus = "Candidate";
  if      (connectionDegree === "1st")                 connectionStatus = "Connected";
  else if (linkedinConnectionStatus === "Pending")     connectionStatus = "Pending";

  const slim = {
    firstName,
    lastName,
    headline   : lhHeadline || linkedinHeadline,
    summary    : linkedinDescription || "",
    locationName,
    experience : Array.isArray(lead.raw?.experience)
                   ? lead.raw.experience.slice(0, 2)
                   : undefined,
  };

  const fields = {
    "LinkedIn Profile URL"      : finalUrl,
    "First Name"                : firstName,
    "Last Name"                 : lastName,
    Headline                    : linkedinHeadline || lhHeadline,
    "Job Title"                 : linkedinJobTitle,
    "Company Name"              : linkedinCompanyName,
    About                       : linkedinDescription || "",
    "Job History"               : jobHistory,
    "LinkedIn Connection Status": connectionStatus,
    Status                      : "In Process",
    "Scoring Status"            : scoringStatus,
    Location                    : locationName || "",
    "Date Connected"            : safeDate(connectionSince) || safeDate(lead.connectedAt) || null,
    Email                       : emailAddress || lead.email || lead.workEmail || "",
    Phone                       : phoneNumber || lead.phone || (lead.phoneNumbers || [])[0]?.value || "",
    "Refreshed At"              : refreshedAt ? new Date(refreshedAt) : null,
    "Profile Full JSON"         : JSON.stringify(slim),
    "Raw Profile Data"          : JSON.stringify(rest),
  };

  if (finalScore          !== null) fields["AI Score"]              = Math.round(finalScore * 100) / 100;
  if (aiProfileAssessment !== null) fields["AI Profile Assessment"] = String(aiProfileAssessment || "");
  if (attributeBreakdown  !== null) fields["AI Attribute Breakdown"] = attributeBreakdown;
  if (auFlag              !== null) fields["AU"]                    = !!auFlag;
  if (aiExcluded          !== null) fields["AI_Excluded"]           = aiExcluded === "Yes";
  if (excludeDetails      !== null) fields["Exclude Details"]       = excludeDetails;

  const filter = `{Profile Key} = "${profileKey}"`;
  const existing = await base("Leads")
    .select({ filterByFormula: filter, maxRecords: 1 })
    .firstPage();

  if (existing.length) {
    await base("Leads").update(existing[0].id, fields);
  } else {
    fields["Source"] =
      connectionDegree === "1st"
        ? "Existing Connection Added by PB"
        : "SalesNav + LH Scrape";
    await base("Leads").create(fields);
  }
}   // ← END upsertLead

/* ------------------------------------------------------------------
   6)  /api/test-score  (returns JSON for a single lead payload)
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
  try {
    const lead = req.body;

    const sysPrompt                = await buildPrompt();
    const { positives, negatives } = await loadAttributes();

    const gpt = await callGptScoring(sysPrompt, lead);
    console.log("GPT finalPct:", gpt.finalPct);

    const {
      positive_scores     = {},
      negative_scores     = {},
      contact_readiness   = false,
      unscored_attributes = [],
      aiProfileAssessment = "",
      attribute_reasoning = {},
    } = gpt;

    /* -------- compute rawScore (pos – neg) -------- */
    const rawScore =
      Object.values(positive_scores || {}).reduce((s, v) => s + v, 0) +
      Object.values(negative_scores || {}).reduce((s, v) => {
        const n = typeof v === "number" ? v : v?.score ?? 0;
        return s + n;
      }, 0);

    const { percentage } = computeFinalScore(
      positive_scores,
      positives,
      negative_scores,
      negatives,
      contact_readiness,
      unscored_attributes
    );
    const finalPct = Math.round(percentage * 100) / 100;

    const breakdown = buildAttributeBreakdown(
      positive_scores,
      positives,
      negative_scores,
      negatives,
      unscored_attributes,
      rawScore,
      0,
      attribute_reasoning,
      false,
      null
    );

    res.json({ finalPct, breakdown, assessment: aiProfileAssessment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   7)  /pb-webhook/scrapeLeads  –  Phantombuster array
------------------------------------------------------------------*/
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [];
    const { positives, negatives } = await loadAttributes();
    const passMark = 0;
    let processed = 0;

    for (const lead of leads) {
      const sysPrompt = await buildPrompt();
      const gpt       = await callGptScoring(sysPrompt, lead);
      console.log("GPT finalPct:", gpt.finalPct);

      const {
        positive_scores     = {},
        negative_scores     = {},
        contact_readiness   = false,
        unscored_attributes = [],
        aiProfileAssessment = "",
        attribute_reasoning = {},
      } = gpt;

      if (gpt.contact_readiness)
        positive_scores.I = positives?.I?.maxPoints || 3;

      /* -------- compute rawScore (pos – neg) -------- */
      const rawScore =
        Object.values(positive_scores || {}).reduce((s, v) => s + v, 0) +
        Object.values(negative_scores || {}).reduce((s, v) => {
          const n = typeof v === "number" ? v : v?.score ?? 0;
          return s + n;
        }, 0);

      const { percentage } = computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );
      const finalPct = Math.round(percentage * 100) / 100;
      if (finalPct < passMark) continue;

      await upsertLead(
        lead,
        finalPct,
        aiProfileAssessment,
        attribute_reasoning,
        buildAttributeBreakdown(
          positive_scores,
          positives,
          negative_scores,
          negatives,
          unscored_attributes,
          rawScore,
          0,
          attribute_reasoning,
          false,
          null
        )
      );
      processed++;
    }

    res.json({ message: `Processed ${processed} leads` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
   8)  /lh-webhook/upsertLeadOnly
================================================================ */
app.post("/lh-webhook/upsertLeadOnly", async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    let processed = 0;

    for (const lh of raw) {
      const rawUrl =
        lh.profileUrl ||
        (lh.publicId
          ? `https://www.linkedin.com/in/${lh.publicId}/`
          : lh.memberId
          ? `https://www.linkedin.com/profile/view?id=${lh.memberId}`
          : "");

      const exp      = Array.isArray(lh.experience) ? lh.experience : [];
      const current  = exp[0] || {};
      const previous = exp[1] || {};

      const numericDist =
        (typeof lh.distance === "string" && lh.distance.endsWith("_1")) ||
        (typeof lh.member_distance === "string" &&
          lh.member_distance.endsWith("_1"))
          ? 1
          : lh.distance;

      const lead = {
        firstName: lh.firstName || lh.first_name || "",
        lastName : lh.lastName  || lh.last_name  || "",
        headline : lh.headline  || "",
        locationName:
          lh.locationName || lh.location_name || lh.location || "",
        phone:
          (lh.phoneNumbers || [])[0]?.value ||
          lh.phone_1 ||
          lh.phone_2 ||
          "",
        email: lh.email || lh.workEmail || "",
        linkedinProfileUrl: rawUrl,
        linkedinJobTitle:
          lh.headline ||
          lh.occupation ||
          lh.position ||
          current.title ||
          "",
        linkedinCompanyName:
          lh.companyName ||
          (lh.company ? lh.company.name : "") ||
          current.company ||
          lh.organization_1 ||
          "",
        linkedinDescription: lh.summary || lh.bio || "",
        linkedinJobDateRange: current.dateRange || current.dates || "",
        linkedinJobDescription: current.description || "",
        linkedinPreviousJobDateRange: previous.dateRange || previous.dates || "",
        linkedinPreviousJobDescription: previous.description || "",
        connectionDegree:
          lh.connectionDegree ||
          (lh.degree === 1 || numericDist === 1 ? "1st" : ""),
        connectionSince:
          lh.connectionDate ||
          lh.connected_at_iso ||
          lh.connected_at ||
          lh.invited_date_iso ||
          null,
        raw: lh,
        scoringStatus: "To Be Scored",
      };

      await upsertLead(lead);
      processed++;
    }

    res.json({ message: `Upserted ${processed} LH profiles` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   9)  /lh-webhook/scrapeLeads  –  Linked Helper array
------------------------------------------------------------------*/
app.post("/lh-webhook/scrapeLeads", async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    const { positives, negatives } = await loadAttributes();
    let processed = 0;

    for (const lh of raw) {
      const rawUrl =
        lh.profileUrl ||
        (lh.publicId
          ? `https://www.linkedin.com/in/${lh.publicId}/`
          : lh.memberId
          ? `https://www.linkedin.com/profile/view?id=${lh.memberId}`
          : "");

      const exp      = Array.isArray(lh.experience) ? lh.experience : [];
      const current  = exp[0] || {};
      const previous = exp[1] || {};

      const numericDist =
        (typeof lh.distance === "string" && lh.distance.endsWith("_1")) ||
        (typeof lh.member_distance === "string" &&
          lh.member_distance.endsWith("_1"))
          ? 1
          : lh.distance;

      const lead = {
        firstName: lh.firstName || lh.first_name || "",
        lastName : lh.lastName  || lh.last_name  || "",
        headline : lh.headline  || "",
        locationName:
          lh.locationName || lh.location_name || lh.location || "",
        phone:
          (lh.phoneNumbers || [])[0]?.value ||
          lh.phone_1 ||
          lh.phone_2 ||
          "",
        email: lh.email || lh.workEmail || "",
        linkedinProfileUrl: rawUrl,
        linkedinJobTitle:
          lh.headline ||
          lh.occupation ||
          lh.position ||
          current.title ||
          "",
        linkedinCompanyName:
          lh.companyName ||
          (lh.company ? lh.company.name : "") ||
          current.company ||
          lh.organization_1 ||
          "",
        linkedinDescription: lh.summary || lh.bio || "",
        linkedinJobDateRange: current.dateRange || current.dates || "",
        linkedinJobDescription: current.description || "",
        linkedinPreviousJobDateRange: previous.dateRange || previous.dates || "",
        linkedinPreviousJobDescription: previous.description || "",
        connectionDegree:
          lh.connectionDegree ||
          (lh.degree === 1 || numericDist === 1 ? "1st" : ""),
        connectionSince:
          lh.connectionDate ||
          lh.connected_at_iso ||
          lh.connected_at ||
          lh.invited_date_iso ||
          null,
        raw: lh,
      };

      const sysPrompt = await buildPrompt();
      const gpt       = await callGptScoring(sysPrompt, lead);
      console.log("GPT finalPct:", gpt.finalPct);

      const {
        positive_scores     = {},
        negative_scores     = {},
        contact_readiness   = false,
        unscored_attributes = [],
        aiProfileAssessment = "",
        attribute_reasoning = {},
      } = gpt;

      if (gpt.contact_readiness)
        positive_scores.I = positives?.I?.maxPoints || 3;

      /* -------- compute rawScore (pos – neg) -------- */
      const rawScore =
        Object.values(positive_scores || {}).reduce((s, v) => s + v, 0) +
        Object.values(negative_scores || {}).reduce((s, v) => {
          const n = typeof v === "number" ? v : v?.score ?? 0;
          return s + n;
        }, 0);

      const { percentage } = computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );
      const finalPct = Math.round(percentage * 100) / 100;

      const auFlag        = isAustralian(lead.locationName || "");
      const passesScore   = finalPct >= MIN_SCORE;
      const positiveChat  = true;
      const passesFilters = auFlag && passesScore && positiveChat;

      const aiExcluded = passesFilters ? "No" : "Yes";
      const excludeDetails = passesFilters
        ? ""
        : !auFlag
        ? `Non-AU location "${lead.locationName || ""}"`
        : `Score ${finalPct} < ${MIN_SCORE}`;

      if (!passesFilters && SAVE_FILTERED_ONLY) continue;

      await upsertLead(
        lead,
        finalPct,
        aiProfileAssessment,
        attribute_reasoning,
        buildAttributeBreakdown(
          positive_scores,
          positives,
          negative_scores,
          negatives,
          unscored_attributes,
          rawScore,
          0,
          attribute_reasoning,
          false,
          null
        ),
        auFlag,
        aiExcluded,
        excludeDetails
      );
      processed++;
    }

    res.json({ message: `Processed ${processed} LH profiles` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   10)  /pb-pull/connections
------------------------------------------------------------------*/
let lastRunId = 0;
try {
  lastRunId = parseInt(fs.readFileSync("lastRun.txt", "utf8"), 10) || 0;
} catch {}
app.get("/pb-pull/connections", async (req, res) => {
  try {
    const headers = { "X-Phantombuster-Key-1": process.env.PB_API_KEY };
    const listURL = `https://api.phantombuster.com/api/v1/agent/${process.env.PB_AGENT_ID}/containers?limit=25`;

    const listResp = await fetch(listURL, { headers });
    const listJson = await listResp.json();
    const runs = (listJson.data || [])
      .filter((r) => r.lastEndStatus === "success")
      .sort((a, b) => Number(a.id) - Number(b.id));

    let total = 0;
    for (const run of runs) {
      if (Number(run.id) <= lastRunId) continue;

      const resultResp = await fetch(
        `https://api.phantombuster.com/api/v2/containers/fetch-result-object?id=${run.id}`,
        { headers }
      );
      const resultObj = await resultResp.json();

      const jsonUrl = getJsonUrl(resultObj);
      let conns;
      if (jsonUrl) conns = await (await fetch(jsonUrl)).json();
      else if (Array.isArray(resultObj.resultObject))
        conns = resultObj.resultObject;
      else if (Array.isArray(resultObj.data?.resultObject))
        conns = resultObj.data.resultObject;
      else throw new Error("No jsonUrl and no inline resultObject array");

      const testLimit = req.query.limit ? Number(req.query.limit) : null;
      if (testLimit) conns = conns.slice(0, testLimit);

      for (const c of conns) {
        await upsertLead(
          {
            ...c,
            connectionDegree: "1st",
            linkedinProfileUrl: (c.profileUrl || "").replace(/\/$/, ""),
          },
          0,
          "",
          "",
          ""
        );
        total++;
      }
      lastRunId = Number(run.id);
    }

    fs.writeFileSync("lastRun.txt", String(lastRunId));
    res.json({ message: `Upserted/updated ${total} profiles` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   10.5)  DEBUG – return GPT URL
------------------------------------------------------------------*/
app.get("/debug-gpt", (_req, res) => res.send(process.env.GPT_CHAT_URL));

/* ------------------------------------------------------------------
   11)  Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;
console.log(
  `▶︎ Server starting – commit ${process.env.RENDER_GIT_COMMIT || "local"} – ${new Date().toISOString()}`
);
app.listen(port, () => console.log(`Server running on ${port}`));