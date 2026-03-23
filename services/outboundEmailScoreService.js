/**
 * Outbound Email Score (OES) — "Zoom readiness" 0–10 from LinkedIn-style raw profile JSON/text.
 *
 * Default: rule-based scorer (services/oesRuleScorer.js) aligned with the rubric below.
 * Set OES_USE_AI=true or pass options.oesMode === 'ai' to use Vertex Gemini instead.
 */

require('dotenv').config();
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { vertexAIClient } = require('../config/geminiClient');
const { createLogger } = require('../utils/contextLogger');
const { repairAndParseJson } = require('../utils/jsonRepair');
const { scoreRawProfileForOesRules } = require('./oesRuleScorer');

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
  parseInt(process.env.OES_429_RETRY_ATTEMPTS || process.env.GEMINI_429_RETRY_ATTEMPTS || '5', 10)
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

/** Rules unless OES_USE_AI=1 or options.oesMode === 'ai'. */
function shouldUseOesAi(options = {}) {
  if (options.oesMode === 'ai') return true;
  if (options.oesMode === 'rules') return false;
  return process.env.OES_USE_AI === 'true' || process.env.OES_USE_AI === '1';
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
function sliceBalancedObjectFrom(text, start) {
  if (start < 0 || start >= text.length || text[start] !== '{') return null;
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

function sliceFirstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  return sliceBalancedObjectFrom(text, start);
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

  const trySlice = (slice) => {
    if (!slice) return null;
    let obj = tryParse(slice);
    if (obj) return obj;
    const repaired = repairAndParseJson(slice);
    if (repaired.success) {
      obj = tryObject(repaired.data);
      if (obj) return obj;
    }
    return null;
  };

  // Prefer object that contains our keys (avoids false `{` from model prose / thinking).
  const keyPatterns = [/"zoom_readiness_score"\s*:/g, /"score_breakdown"\s*:/g];
  for (const keyRegex of keyPatterns) {
    keyRegex.lastIndex = 0;
    let match;
    while ((match = keyRegex.exec(trimmed)) !== null) {
      const braceStart = trimmed.lastIndexOf('{', match.index);
      if (braceStart >= 0) {
        const balanced = sliceBalancedObjectFrom(trimmed, braceStart);
        const obj = trySlice(balanced);
        if (obj) return obj;
      }
    }
  }

  let obj = tryParse(trimmed);
  if (obj) return obj;

  const balanced = sliceFirstBalancedObject(trimmed);
  const fromBalanced = trySlice(balanced);
  if (fromBalanced) return fromBalanced;

  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    const fromGreedy = trySlice(m[0]);
    if (fromGreedy) return fromGreedy;
  }

  return null;
}

function normalizeScorePayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw =
    parsed.zoom_readiness_score ??
    parsed.score ??
    parsed.readiness_score ??
    parsed.zoomReadinessScore;
  if (raw === null || raw === undefined || raw === '') return null;
  const cleaned = String(raw).trim().replace(/,/g, '');
  const nFloat = Number(cleaned);
  if (!Number.isFinite(nFloat)) return null;
  let n = Math.round(nFloat);
  n = Math.max(0, Math.min(10, n));
  let breakdown = parsed.score_breakdown;
  if (breakdown != null && typeof breakdown !== 'object') breakdown = {};
  if (breakdown == null) breakdown = {};
  return {
    zoom_readiness_score: n,
    score_breakdown: breakdown,
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
 * @param {object} [options]
 * @param {number} [options.timeoutMs] per Gemini attempt (clamped 15s–180s)
 * @param {number} [options.max429Attempts] total Vertex attempts on 429 backoff (min 1, max 10)
 * @returns {Promise<{ ok: true, score: number, classification: string, breakdown: object } | { ok: false, error: string }>}
 */
async function scoreRawProfileForOes(rawProfileText, options = {}) {
  const text = rawProfileDataToText(rawProfileText);
  if (!text || !String(text).trim()) {
    return { ok: false, error: 'Empty raw profile' };
  }

  if (!shouldUseOesAi(options)) {
    const r = scoreRawProfileForOesRules(rawProfileText);
    if (!r.ok) return r;
    return {
      ok: true,
      score: r.score,
      classification: r.classification,
      breakdown: r.breakdown,
    };
  }

  const truncated = text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
  const truncatedNote =
    text.length > MAX_RAW_CHARS
      ? `\n\n[Input truncated to ${MAX_RAW_CHARS} characters for processing.]`
      : '';

  if (!vertexAIClient) {
    logger.warn('[OES] AI requested but Vertex not configured; using rule-based scoring');
    const r = scoreRawProfileForOesRules(rawProfileText);
    if (!r.ok) return r;
    return {
      ok: true,
      score: r.score,
      classification: r.classification,
      breakdown: r.breakdown,
    };
  }

  const callTimeoutMs = Math.min(
    Math.max(parseInt(options.timeoutMs, 10) || OES_TIMEOUT_MS, 15000),
    180000
  );
  const maxAttempts = Math.max(
    1,
    Math.min(parseInt(options.max429Attempts, 10) || OES_429_RETRY_ATTEMPTS, 10)
  );

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
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
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
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const callPromise = model.generateContent(requestPayload);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('OES scoring timed out')), callTimeoutMs);
        });
        result = await Promise.race([callPromise, timeoutPromise]);
        lastCallError = null;
        break;
      } catch (e) {
        lastCallError = e;
        if (attempt < maxAttempts && isRetryableVertexRateLimitError(e)) {
          const backoffMs = OES_429_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.warn('[OES] Vertex rate limit, backing off and retrying', {
            attempt,
            maxAttempts,
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
      .map((p) => {
        if (typeof p?.text === 'string') return p.text;
        if (p?.functionCall?.args && typeof p.functionCall.args === 'object') {
          try {
            return JSON.stringify(p.functionCall.args);
          } catch {
            return '';
          }
        }
        return '';
      })
      .join('');
    if (!responseText.trim()) {
      return { ok: false, error: 'Model returned no text' };
    }

    const parsed = extractJsonObject(responseText);
    const norm = normalizeScorePayload(parsed);
    if (!norm) {
      logger.warn('[OES] Unparseable model output', {
        snippet: responseText.slice(0, 500),
        finishReason: candidate?.finishReason,
      });
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
  scoreRawProfileForOesRules,
  rawProfileDataToText,
  buildOesSystemInstruction,
  shouldUseOesAi,
  extractJsonObject,
  normalizeScorePayload,
  MAX_RAW_CHARS,
  OES_MODEL,
};
