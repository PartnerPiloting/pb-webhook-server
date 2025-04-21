/***************************************************************
  LinkedIn → Airtable  (Scoring + 1st‑degree & LH sync)
***************************************************************/
require("dotenv").config();
const express   = require("express");
const { Configuration, OpenAIApi } = require("openai");
const Airtable  = require("airtable");
const fs        = require("fs");          // bookmark file for pull‑runs

/* ------------------------------------------------------------------
   helper: getJsonUrl  (structured checks → regex fallback)
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
   helper: canonicalUrl  – lower‑cases, strips protocol & trailing slash
------------------------------------------------------------------*/
function canonicalUrl(url = "") {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/* ------------------------------------------------------------------
   helper: isAustralian – matches “Greater Sydney Area”, “Brisbane QLD”, etc.
------------------------------------------------------------------*/
function isAustralian(loc = "") {
  return /\b(australia|aus|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|nsw|vic|qld|wa|sa|tas|act|nt)\b/i
    .test(loc);
}

// 1) Toggle debug logs  ──────────────────────────────────────────
const TEST_MODE = process.env.TEST_MODE === "true";
const MIN_SCORE = Number(process.env.MIN_SCORE || 0);
const SAVE_FILTERED_ONLY = process.env.SAVE_FILTERED_ONLY === "true";

const app = express();
app.use(express.json({ limit: "10mb" }));        // ⬅ increased body‑size limit

// Simple health‑check route
app.get("/health", (_req, res) => res.send("ok"));

/* ------------------------------------------------------------------
   2)  OpenAI + Airtable Setup
------------------------------------------------------------------*/
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

// Table that stores dictionary markdown + pass‑mark
const SCORING_TABLE = "tblzphTYVTTQC7zG5";

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
    if (!unscored_attributes.includes(attrID)) baseDenominator += pInfo.maxPoints;
  }

  let rawScore = 0;
  for (const pts of Object.values(positive_scores || {})) rawScore += pts;

  for (const [attrID, pInfo] of Object.entries(dictionaryPositives)) {
    if (pInfo.minQualify > 0) {
      const awarded = positive_scores[attrID] || 0;
      const isUnscored = unscored_attributes.includes(attrID);
      if (isUnscored || awarded < pInfo.minQualify) {
        disqualified = true;
        disqualifyReason = `Min qualification not met for ${attrID} (needed ${pInfo.minQualify}, got ${awarded})`;
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
    if (dictionaryNegatives[negID]?.disqualifying) {
      disqualified = true;
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

  for (const penalty of Object.values(negative_scores || {})) rawScore += penalty;
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
   4)  getScoringData & helpers  (unchanged)
------------------------------------------------------------------*/
async function getScoringData() {
  const records = await base(SCORING_TABLE)
    .select({ maxRecords: 1 })
    .firstPage();
  if (!records.length) throw new Error("Scoring table not found.");

  const record = records[0];
  const md = record.fields["Dictionary Markdown"] || "";
  const passMark = record.fields["Pass Mark"] || 0;

  const truncated = md.replace(/```python[\s\S]*?```/g, "");
  const { positives, negatives } = parseMarkdownTables(truncated);

  return { truncatedInstructions: truncated, passMark, positives, negatives };
}

function parseMarkdownTables(markdown) {
  const positives = {};
  const negatives = {};
  const lines = markdown.split("\n");
  let section = null;

  const posRow =
    /^\|\s*([A-Z])\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|?$/;
  const negRow =
    /^\|\s*([A-Z0-9]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|?$/;

  for (const line of lines) {
    const t = line.trim();
    if (/^#{2,}\s*Positive Attributes/i.test(t)) { section = "pos"; continue; }
    if (/^#{2,}\s*Negative Attributes/i.test(t)) { section = "neg"; continue; }
    if (/^#{2,}/.test(t)) { section = null; continue; }
    if (!section || t.startsWith("|----") || /^\|\s*ID\s*\|/i.test(t)) continue;

    if (section === "pos") {
      const m = t.match(posRow);
      if (!m) continue;
      const [, id, label, maxRaw, minRaw, notes] = m;
      positives[id] = {
        label: label.trim(),
        maxPoints: parseInt(maxRaw.replace(/[^\d]/g, ""), 10) || 0,
        minQualify: parseInt(minRaw.replace(/[^\d]/g, ""), 10) || 0,
        notes: notes.trim(),
      };
    } else {
      const m = t.match(negRow);
      if (!m) continue;
      const [, id, label, penRaw, disqRaw, notes] = m;
      negatives[id] = {
        label: label.trim(),
        penalty: parseInt(penRaw.replace(/[^\-\d]/g, ""), 10) || 0,
        disqualifying: /yes/i.test(disqRaw.trim()),
        notes: notes.trim(),
      };
    }
  }
  return { positives, negatives };
}

/* ------------------------------------------------------------------
   5)  callGptScoring  (unchanged)
------------------------------------------------------------------*/
async function callGptScoring(dictionaryText, lead) {
  const extra = TEST_MODE
    ? "\n- attributeBreakdown (string) describing how each attribute was assigned)"
    : "";

  const sysPrompt = `
You are an AI trained to apply the ASH Candidate Attribute Scoring Framework.

### Framework:
${dictionaryText}

### Rules
- Score positives A–K up to their max.
- Apply negative penalties L1, N1–N5. If disqualifying, final = 0.
- Respect Min‑Qualify.
Return JSON:
- positive_scores, negative_scores
- contact_readiness, unscored_attributes
- aiProfileAssessment, aiScoreReasoning${extra}`.trim();

  const usrPrompt = `Lead:\n${JSON.stringify(lead, null, 2)}`;

  const resp = await openai.createChatCompletion({
    model: "gpt-4o",
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: usrPrompt },
    ],
    temperature: 0.2,
  });

  let out = resp.data.choices[0].message.content.trim();
  const fence = out.match(/```json\s*([\s\S]*?)```/i);
  if (fence) out = fence[1].trim();
  const j = out.match(/\{[\s\S]*\}$/);
  return j ? JSON.parse(j[0]) : {};
}

/* ------------------------------------------------------------------
   6)  buildAttributeBreakdown  (unchanged)
------------------------------------------------------------------*/
function buildAttributeBreakdown(
  positiveScores,
  dictionaryPositives,
  negativeScores,
  dictionaryNegatives,
  unscoredAttrs,
  rawScore,
  denominator,
  disqualified = false,
  disqualifyReason = null
) {
  const lines = [];

  lines.push("**Positive Attributes**:");
  for (const [id, info] of Object.entries(dictionaryPositives)) {
    if (unscoredAttrs.includes(id)) {
      lines.push(`- ${id} (${info.label}): UNRECOGNISED (max ${info.maxPoints})`);
      continue;
    }
    const pts = positiveScores[id] || 0;
    lines.push(`- ${id} (${info.label}): ${pts} / ${info.maxPoints}`);
  }

  lines.push("\n**Negative Attributes**:");
  for (const [id, info] of Object.entries(dictionaryNegatives)) {
    const pen = negativeScores[id] || 0;
    lines.push(`- ${id} (${info.label}): ${pen}`);
  }

  if (TEST_MODE && denominator > 0) {
    const pct = (rawScore / denominator) * 100;
    lines.push(`\nTotal: ${rawScore} / ${denominator} => ${pct.toFixed(2)}%`);
  }
  if (disqualified && disqualifyReason) {
    lines.push(`\n**DISQUALIFIED** – ${disqualifyReason}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------
   7)  upsertLead  (extra fallback + file dump when URL missing)
------------------------------------------------------------------*/
async function upsertLead(
  lead,
  finalScore,
  aiProfileAssessment,
  aiScoreReasoning,
  attributeBreakdown,
  auFlag = null,
  aiExcluded = null,
  excludeDetails = null
) {
  const {
    firstName = "",
    lastName = "",
    linkedinHeadline = "",
    linkedinJobTitle = "",
    linkedinCompanyName = "",
    linkedinDescription = "",
    linkedinProfileUrl = "",
    connectionDegree = "",
    linkedinJobDateRange = "",
    linkedinJobDescription = "",
    linkedinPreviousJobDateRange = "",
    linkedinPreviousJobDescription = "",
    refreshedAt = "",
    profileUrl: fallbackProfileUrl = "",
    linkedinConnectionStatus,
    emailAddress = "",
    phoneNumber = "",
    locationName = "",
    connectionSince,
    ...rest
  } = lead;

  const jobHistory = [
    linkedinJobDateRange || linkedinJobDescription
      ? `Current:\n${linkedinJobDateRange} — ${linkedinJobDescription}`
      : "",
    linkedinPreviousJobDateRange || linkedinPreviousJobDescription
      ? `\nPrevious:\n${linkedinPreviousJobDateRange} — ${linkedinPreviousJobDescription}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let finalUrl = (linkedinProfileUrl || fallbackProfileUrl || "").replace(/\/$/, "");

  /* 🔹 Fallback – synthesise a LinkedIn URL if missing */
  if (!finalUrl) {
    const slug = lead.publicId || lead.publicIdentifier;
    const mid  = lead.memberId || lead.profileId;
    if (slug) {
      finalUrl = `https://www.linkedin.com/in/${slug}/`;
    } else if (mid) {
      finalUrl = `https://www.linkedin.com/profile/view?id=${mid}`;
    }
  }

  /* 🆕 Last‑chance fallback – check inside lead.raw */
  if (!finalUrl && lead.raw) {
    const r = lead.raw;
    if (typeof r.profile_url === "string" && r.profile_url.trim()) {
      finalUrl = r.profile_url.trim().replace(/\/$/, "");
    } else if (r.public_id) {
      finalUrl = `https://www.linkedin.com/in/${r.public_id}/`;
    } else if (r.member_id) {
      finalUrl = `https://www.linkedin.com/profile/view?id=${r.member_id}`;
    }
  }

  /* 🔸 If still no URL, dump debug info and bail */
  if (!finalUrl) {
    console.warn("No profile URL—skipping lead.");
    console.warn("» present keys:", Object.keys(lead));
    console.warn("» identifiers:", {
      profileUrl: linkedinProfileUrl,
      fallbackProfileUrl,
      publicId: lead.publicId || lead.publicIdentifier,
      memberId: lead.memberId || lead.profileId,
    });
    if (TEST_MODE) {
      const snippet = JSON.stringify(lead).slice(0, 800);
      console.warn("» lead snippet:", snippet, snippet.length === 800 ? "...(truncated)" : "");
    }

    /* 📂 Write full skipped lead to disk for post‑mortem */
    try {
      fs.writeFileSync(
        "skipped-lead-" + Date.now() + ".json",
        JSON.stringify(lead, null, 2)
      );
    } catch (e) {
      console.error("Failed to write skipped lead:", e.message);
    }
    return;
  }

  const profileKey = canonicalUrl(finalUrl);

  let connectionStatus = "To Be Sent";
  if (connectionDegree === "1st") connectionStatus = "Connected";
  else if (linkedinConnectionStatus === "Pending") connectionStatus = "Pending";

  const fields = {
    "LinkedIn Profile URL": finalUrl,
    "First Name": firstName,
    "Last Name": lastName,
    Headline: linkedinHeadline || lead.headline || "",
    "Job Title": linkedinJobTitle || "",
    "Company Name": linkedinCompanyName || "",
    About: linkedinDescription || "",
    "Job History": jobHistory,
    "LinkedIn Connection Status": connectionStatus,
    Location: locationName || "",
    "Date Connected": connectionSince
      ? new Date(connectionSince)
      : lead.connectedAt || null,
    Email: emailAddress || lead.email || lead.workEmail || "",
    Phone: phoneNumber || lead.phone || ((lead.phoneNumbers || [])[0]?.value || ""),
    "Refreshed At": refreshedAt ? new Date(refreshedAt) : null,
    "Raw Profile Data": JSON.stringify(rest),
    "AI Profile Assessment": aiProfileAssessment || "",
    "AI Score Reasoning": aiScoreReasoning || "",
    "AI Score": Math.round(finalScore * 100) / 100,
    "AI Attribute Breakdown": attributeBreakdown || "",
  };

  /* ─── new flags ─── */
  if (auFlag !== null)         fields["AU"]          = !!auFlag;
  if (aiExcluded !== null)     fields["AI_Excluded"] = (aiExcluded === "Yes");
  if (excludeDetails !== null) fields["Exclude Details"] = excludeDetails;

  /* ------------------ lookup filter ------------------ */
  const filter = `{Profile Key} = "${profileKey}"`;

  const existing = await base("Leads")
    .select({ filterByFormula: filter, maxRecords: 1 })
    .firstPage();

  if (existing.length) {
    await base("Leads").update(existing[0].id, fields);
    if (TEST_MODE) console.log("🔄 Updated", firstName, lastName);
  } else {
    fields["Source"] =
      connectionDegree === "1st" ? "Existing Connection Added by PB" : "2nd level leads from PB";
    await base("Leads").create(fields);
    if (TEST_MODE) console.log("➕ Created", firstName, lastName);
  }
}

/* ------------------------------------------------------------------
   8)  /api/test-score  (unchanged)
------------------------------------------------------------------*/
app.post("/api/test-score", async (req, res) => {
  try {
    const lead = req.body;
    const { truncatedInstructions, positives, negatives } = await getScoringData();

    const gpt = await callGptScoring(truncatedInstructions, lead);
    const {
      positive_scores = {},
      negative_scores = {},
      contact_readiness = false,
      unscored_attributes = [],
      aiProfileAssessment = "",
      aiScoreReasoning = "",
    } = gpt;

    const { rawScore, denominator, percentage, disqualified, disqualifyReason } =
      computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );

    const breakdown = buildAttributeBreakdown(
      positive_scores,
      positives,
      negative_scores,
      negatives,
      unscored_attributes,
      rawScore,
      denominator,
      disqualified,
      disqualifyReason
    );

    res.json({ finalPct: percentage, breakdown, gptRaw: gpt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================================
   9)  /pb‑pull/connections  — multi‑run, persistent bookmark
==================================================================*/

// ▶︎  Load bookmark at startup (0 if file missing)
let lastRunId = 0;
try {
  lastRunId = parseInt(fs.readFileSync("lastRun.txt", "utf8"), 10) || 0;
} catch {}

app.get("/pb-pull/connections", async (req, res) => {
  try {
    const headers = { "X-Phantombuster-Key-1": process.env.PB_API_KEY };
    const listURL = `https://api.phantombuster.com/api/v1/agent/${process.env.PB_AGENT_ID}/containers?limit=25`;

    // 1️⃣  Get the last 25 successful runs, oldest → newest
    const listResp = await fetch(listURL, { headers });
    const listJson = await listResp.json();
    const runs = (listJson.data || [])
      .filter((r) => r.lastEndStatus === "success")
      .sort((a, b) => Number(a.id) - Number(b.id));

    let total = 0;
    for (const run of runs) {
      if (Number(run.id) <= lastRunId) continue; // already handled

      // 2️⃣  Fetch that run’s structured result (GET)
      const resultResp = await fetch(
        `https://api.phantombuster.com/api/v2/containers/fetch-result-object?id=${run.id}`,
        { headers }
      );
      const resultObj = await resultResp.json();

      const jsonUrl = getJsonUrl(resultObj);
      let conns;

      if (jsonUrl) {
        conns = await (await fetch(jsonUrl)).json();
      } else if (Array.isArray(resultObj.resultObject)) {
        conns = resultObj.resultObject;
      } else if (Array.isArray(resultObj.data?.resultObject)) {
        conns = resultObj.data.resultObject;
      } else if (
        typeof resultObj.resultObject === "string" &&
        resultObj.resultObject.trim().startsWith("[")
      ) {
        conns = JSON.parse(resultObj.resultObject);
      } else if (
        typeof resultObj.data?.resultObject === "string" &&
        resultObj.data.resultObject.trim().startsWith("[")
      ) {
        conns = JSON.parse(resultObj.data.resultObject);
      } else {
        throw new Error("No jsonUrl and no inline resultObject array");
      }

      // Apply ?limit=N during testing to process only the first N profiles
      const testLimit = req.query.limit ? Number(req.query.limit) : null;
      if (testLimit) conns = conns.slice(0, testLimit);

      // 3️⃣  Upsert each profile
      for (const c of conns) {
        await upsertLead(
          {
            ...c,
            connectionDegree: "1st",
            linkedinProfileUrl: (c.profileUrl || "").replace(/\/$/, ""),
          },
          0, "", "", ""
        );
        total++;
      }
      lastRunId = Number(run.id); // advance bookmark
    }

    // 4️⃣  Save bookmark
    fs.writeFileSync("lastRun.txt", String(lastRunId));

    res.json({ message: `Upserted/updated ${total} profiles` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================================
   10)  /pb‑webhook/connections  (1st‑degree import)
==================================================================*/
app.post("/pb-webhook/connections", async (req, res) => {
  try {
    const conns =
      Array.isArray(req.body)
        ? req.body
        : Array.isArray(req.body.resultObject)
        ? req.body.resultObject
        : Array.isArray(req.body.resultObject?.data)
        ? req.body.resultObject.data
        : Array.isArray(req.body.results)
        ? req.body.results
        : [];

    let processed = 0;
    for (const c of conns) {
      await upsertLead(
        {
          ...c,
          connectionDegree: "1st",
          linkedinProfileUrl: (c.profileUrl || "").replace(/\/$/, ""),
        },
        0, "", "", ""
      );
      processed++;
    }

    res.json({ message: `Upserted ${processed} connections` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   11)  /pb‑webhook/scrapeLeads  (unchanged, GPT scoring)
------------------------------------------------------------------*/
app.post("/pb-webhook/scrapeLeads", async (req, res) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [];
    if (!leads.length)
      return res.status(400).json({ error: "Expected an array of profiles" });

    const { truncatedInstructions, passMark, positives, negatives } = await getScoringData();
    let processed = 0;

    for (const lead of leads) {
      const gpt = await callGptScoring(truncatedInstructions, lead);
      const {
        positive_scores = {},
        negative_scores = {},
        contact_readiness = false,
        unscored_attributes = [],
        aiProfileAssessment = "",
        aiScoreReasoning = "",
      } = gpt;

      const {
        rawScore,
        denominator,
        percentage,
        disqualified,
        disqualifyReason,
      } = computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );

      const finalPct = Math.round(percentage * 100) / 100;
      if (finalPct < passMark) continue;

      const breakdown = TEST_MODE
        ? buildAttributeBreakdown(
            positive_scores,
            positives,
            negative_scores,
            negatives,
            unscored_attributes,
            rawScore,
            denominator,
            disqualified,
            disqualifyReason
          )
        : "";

      await upsertLead(lead, finalPct, aiProfileAssessment, aiScoreReasoning, breakdown);
      processed++;
    }

    res.json({ message: `Processed ${processed} leads` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   12)  /lh‑webhook/scrapeLeads  (Linked Helper import + scoring)
------------------------------------------------------------------*/
app.post("/lh-webhook/scrapeLeads", async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    if (!raw.length) return res.status(400).json({ error: "Empty payload" });

    const { truncatedInstructions, positives, negatives } = await getScoringData();

    let processed = 0;

    for (const lh of raw) {
      /* 🔹 NEW — build a reliable LinkedIn URL */
      const rawUrl =
        lh.profileUrl ||
        (lh.publicId
          ? `https://www.linkedin.com/in/${lh.publicId}/`
          : lh.memberId
          ? `https://www.linkedin.com/profile/view?id=${lh.memberId}`
          : "");

      /* ── map to generic lead shape ── */
      const lead = {
        firstName: lh.firstName,
        lastName: lh.lastName,
        headline: lh.headline,
        locationName: lh.locationName,
        linkedinProfileUrl: rawUrl,   // ← use the synthesised link
        email: lh.email || lh.workEmail,
        phone: (lh.phoneNumbers || [])[0]?.value || "",
        raw: lh,
      };

      /* ── GPT score ── */
      const gpt = await callGptScoring(truncatedInstructions, lead);
      const {
        positive_scores = {},
        negative_scores = {},
        contact_readiness = false,
        unscored_attributes = [],
        aiProfileAssessment = "",
        aiScoreReasoning = "",
      } = gpt;

      const { rawScore, denominator, percentage } = computeFinalScore(
        positive_scores,
        positives,
        negative_scores,
        negatives,
        contact_readiness,
        unscored_attributes
      );
      const finalPct = Math.round(percentage * 100) / 100;

      /* ── Filter logic ── */
      const auFlag = isAustralian(lead.locationName || "");
      const passesScore = finalPct >= MIN_SCORE;
      const positiveChat = true; // placeholder until inbox sentiment
      const passesFilters = auFlag && passesScore && positiveChat;

      const aiExcluded = passesFilters ? "No" : "Yes";
      const excludeDetails = passesFilters
        ? ""
        : !auFlag
            ? `Non‑AU location "${lead.locationName || ""}"`
            : `Score ${finalPct} < ${MIN_SCORE}`;

      /* Skip or save? */
      if (!passesFilters && SAVE_FILTERED_ONLY) {
        if (TEST_MODE)
          console.log("SKIP (filters)", lead.linkedinProfileUrl, excludeDetails);
        continue;
      }

      /* Breakdown only during TEST_MODE to save tokens */
      const breakdown = TEST_MODE
        ? buildAttributeBreakdown(
            positive_scores,
            positives,
            negative_scores,
            negatives,
            unscored_attributes,
            rawScore,
            denominator
          )
        : "";

      await upsertLead(
        lead,
        finalPct,
        aiProfileAssessment,
        aiScoreReasoning,
        breakdown,
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
   13)  Start server
------------------------------------------------------------------*/
const port = process.env.PORT || 3000;

console.log(
  `▶︎ Server starting – commit ${process.env.RENDER_GIT_COMMIT || "local"} – ${new Date().toISOString()}`
);

app.listen(port, () => console.log(`Server running on ${port}`));