/**
 * Outbound Email Score (OES) — "Zoom readiness" 0–10 from LinkedIn-style raw profile text.
 *
 * The scoring rubric is hardcoded below (tune by editing this file). The model applies the
 * rubric to free-form profile JSON/text; we parse structured JSON back and clamp to 0–10 integer.
 */

require('dotenv').config();
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { vertexAIClient } = require('../config/geminiClient');
const { createLogger } = require('../utils/contextLogger');
const { repairAndParseJson } = require('../utils/jsonRepair');

const logger = createLogger({
  runId: 'OES',
  clientId: 'SYSTEM',
  operation: 'outbound_email_score',
});

const OES_MODEL = process.env.OES_GEMINI_MODEL_ID || process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
const OES_TIMEOUT_MS = Math.min(Math.max(parseInt(process.env.OES_TIMEOUT_MS, 10) || 90000, 15000), 180000);
const MAX_RAW_CHARS = Math.min(Math.max(parseInt(process.env.OES_MAX_RAW_CHARS, 10) || 48000, 8000), 100000);

/** Same knobs as batchScorer: total attempts (not “retries after first”). */
const OES_429_RETRY_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.OES_429_RETRY_ATTEMPTS || process.env.GEMINI_429_RETRY_ATTEMPTS || '3', 10)
);
const OES_429_INITIAL_BACKOFF_MS = Math.max(
  1000,
  parseInt(process.env.OES_429_INITIAL_BACKOFF_MS || process.env.GEMINI_429_INITIAL_BACKOFF_MS || '5000', 10)
);

function isRetryableVertexRateLimitError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit')
  );
}

/** Full rubric (hardcoded — change here when methodology changes). */
function buildOesSystemInstruction() {
  return `You are scoring LinkedIn profiles for "Zoom Readiness" based on likelihood that the person is:
- 40+ and experienced
- In a "next chapter" or inflection point
- Open to building something beyond their current role
- Likely to value collaboration, advocacy, and network-based opportunities
- Curious about AI, change, or future opportunities
- Not fully satisfied but not explicitly stating it

IMPORTANT:
- Do NOT score based on prestige or job title alone
- Prioritise signals of movement, curiosity, and transition
- You are detecting "people about to change", not "successful people"

---

SCORING LOGIC:

1. INFLECTION / NEXT CHAPTER SIGNALS (0–4 points) [MOST IMPORTANT]

+4 if strong signals such as:
- "advisor", "consulting", "fractional"
- "portfolio career", "non-executive", "board"
- "independent", "building", "exploring"
- "helping organisations navigate change"

+2–3 if moderate signals:
- Long tenure (8–15+ years at same company)
- Senior but static role
- Mentions transformation, strategy, or change without clear action

+1 if weak signal:
- Generic senior corporate language

+0 if none

---

2. COLLABORATION / ADVOCACY SIGNALS (0–3 points)

+3 if strong:
- "collaboration", "partnerships", "ecosystem"
- "connecting people", "community", "network"
- "advocacy", "mentoring", "building relationships"

+2 if moderate:
- "stakeholder engagement", "cross-functional", "leadership"

+1 if weak:
- implied but not explicit

+0 if none

---

3. FUTURE / AI / CHANGE AWARENESS (0–2 points)

+2 if strong:
- "AI", "automation", "future of work", "disruption", "innovation"

+1 if moderate:
- "digital transformation", "change", "strategy"

+0 if none

---

4. EXPRESSION / INDEPENDENCE (0–2 points)

+2 if strong:
- first-person voice, opinions, philosophy
- narrative tone ("I believe", "I help", etc.)

+1 if moderate:
- some personality but still structured

+0 if purely corporate / job titles only

---

5. SENIORITY (0–2 points) [LOW WEIGHT]

+2 if:
- Director, Head, GM, VP, C-level, Partner, Principal

+1 if:
- Manager, Lead, Senior specialist

+0 if:
- junior or unclear

---

NEGATIVE SIGNALS (subtract):

-2 if:
- purely corporate identity (only titles, no narrative, no signals of movement)

-2 if:
- purely technical / execution role with no people or strategy layer

-1 if:
- highly transactional or career-climbing language only

---

FINAL SCORE:

Sum all categories, subtract negatives

Then:
- Cap minimum at 0
- Cap maximum at 10

---

CLASSIFICATION:

9–10 → "Pod Builder Potential"
7–8 → "High Priority"
5–6 → "Medium"
<5 → "Low Priority"

---

Respond with ONLY valid JSON (no markdown), exactly this shape:
{
  "zoom_readiness_score": <integer 0-10>,
  "score_breakdown": {
    "inflection": <number>,
    "collaboration": <number>,
    "future_awareness": <number>,
    "expression": <number>,
    "seniority": <number>,
    "negative_adjustment": <number>
  },
  "classification": "<string>"
}`;
}

/**
 * First top-level `{ ... }` with string-aware brace matching (avoids greedy-regex mistakes).
 */
function sliceFirstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripMarkdownCodeFence(text) {
  let t = text.trim().replace(/^\uFEFF/, '');
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return t;
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = stripMarkdownCodeFence(text);

  const tryObject = (parsed) => {
    if (parsed == null) return null;
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      return parsed[0];
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  };

  const tryParse = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    try {
      return tryObject(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  let obj = tryParse(trimmed);
  if (obj) return obj;

  const balanced = sliceFirstBalancedObject(trimmed);
  if (balanced) {
    obj = tryParse(balanced);
    if (obj) return obj;
    const repaired = repairAndParseJson(balanced);
    if (repaired.success) {
      obj = tryObject(repaired.data);
      if (obj) return obj;
    }
  }

  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    obj = tryParse(m[0]);
    if (obj) return obj;
    const repaired2 = repairAndParseJson(m[0]);
    if (repaired2.success) {
      obj = tryObject(repaired2.data);
      if (obj) return obj;
    }
  }

  return null;
}

function normalizeScorePayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  let n =
    parsed.zoom_readiness_score != null
      ? parsed.zoom_readiness_score
      : parsed.score != null
        ? parsed.score
        : parsed.readiness_score;
  if (typeof n !== 'number' || Number.isNaN(n)) {
    const asInt = parseInt(String(parsed.zoom_readiness_score), 10);
    if (Number.isNaN(asInt)) return null;
    n = asInt;
  }
  n = Math.round(n);
  n = Math.max(0, Math.min(10, n));
  return {
    zoom_readiness_score: n,
    score_breakdown: parsed.score_breakdown || {},
    classification: String(parsed.classification || '').trim() || 'Unknown',
  };
}

/**
 * Turn Airtable Raw Profile Data (JSON string or text) into one string for the model.
 */
function rawProfileDataToText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const s = String(raw).trim();
  if (!s) return '';
  try {
    const o = JSON.parse(s);
    return typeof o === 'string' ? o : JSON.stringify(o);
  } catch {
    return s;
  }
}

/**
 * @returns {Promise<{ ok: true, score: number, classification: string, breakdown: object } | { ok: false, error: string }>}
 */
async function scoreRawProfileForOes(rawProfileText) {
  const text = rawProfileDataToText(rawProfileText);
  if (!text) {
    return { ok: false, error: 'Empty raw profile' };
  }

  const truncated = text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
  const truncatedNote =
    text.length > MAX_RAW_CHARS
      ? `\n\n[Input truncated to ${MAX_RAW_CHARS} characters for processing.]`
      : '';

  if (!vertexAIClient) {
    return { ok: false, error: 'Vertex/Gemini not configured (GCP_PROJECT_ID, GCP_LOCATION, credentials)' };
  }

  try {
    const model = vertexAIClient.getGenerativeModel({
      model: OES_MODEL,
      systemInstruction: { parts: [{ text: buildOesSystemInstruction() }] },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 1024,
      },
    });

    const userPrompt = `Score this profile (raw_profile). Apply the rubric exactly.

raw_profile:
${truncated}${truncatedNote}`;

    const requestPayload = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    };

    let result = null;
    let lastCallError = null;
    for (let attempt = 1; attempt <= OES_429_RETRY_ATTEMPTS; attempt++) {
      try {
        const callPromise = model.generateContent(requestPayload);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('OES scoring timed out')), OES_TIMEOUT_MS);
        });
        result = await Promise.race([callPromise, timeoutPromise]);
        lastCallError = null;
        break;
      } catch (e) {
        lastCallError = e;
        if (attempt < OES_429_RETRY_ATTEMPTS && isRetryableVertexRateLimitError(e)) {
          const backoffMs = OES_429_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.warn('[OES] Vertex rate limit, backing off and retrying', {
            attempt,
            maxAttempts: OES_429_RETRY_ATTEMPTS,
            backoffMs,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
        } else {
          break;
        }
      }
    }

    if (lastCallError) {
      logger.error('[OES] scoreRawProfileForOes failed', { error: lastCallError.message });
      return { ok: false, error: lastCallError.message || String(lastCallError) };
    }

    const candidate = result?.response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const responseText = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('');
    if (!responseText.trim()) {
      return { ok: false, error: 'Model returned no text' };
    }

    const parsed = extractJsonObject(responseText);
    const norm = normalizeScorePayload(parsed);
    if (!norm) {
      logger.warn('[OES] Unparseable model output', { snippet: responseText.slice(0, 200) });
      return { ok: false, error: 'Could not parse model JSON' };
    }

    return {
      ok: true,
      score: norm.zoom_readiness_score,
      classification: norm.classification,
      breakdown: norm.score_breakdown,
    };
  } catch (e) {
    logger.error('[OES] scoreRawProfileForOes failed', { error: e.message });
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = {
  scoreRawProfileForOes,
  rawProfileDataToText,
  buildOesSystemInstruction,
  MAX_RAW_CHARS,
  OES_MODEL,
};
