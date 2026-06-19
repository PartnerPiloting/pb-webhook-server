/**
 * Speaker reconstruction trust layer (single-speaker / no-diarisation paste path).
 *
 * The problem: cross-platform capture tools (Zoom Notes / Tactiq recording a Teams or
 * Meet call as a fallback) export WITHOUT diarisation — every line tagged as the host.
 * Both sides' words are present but who-said-what is unreliable, so the high-stakes lines
 * (intro direction, who-knows-whom, commitments) are silently wrong if stored as-is.
 *
 * The division of labour IS the feature:
 *   - DETECTION   — plain code, no AI. Count distinct speaker labels; <=1 => flagged.
 *                   Runs every import; the *decision* to spend on AI is itself free.
 *   - RECONSTRUCT — Claude (claude-opus-4-8, adaptive thinking, streamed). Rebuilds speakers
 *                   from content (topic anchors + conversational logic), re-derives intro
 *                   direction, and propagates a human correction across the whole mislabelled
 *                   stretch. A reasoning job — NOT the cheap classification Gemini Flash is for.
 *   - CONFIRM     — the human. Ground truth can't be automated; the person in the room is the
 *                   only reliable source for the high-stakes lines (handled in the route layer).
 *
 * Kill-switch: SPEAKER_RECONSTRUCTION_ENABLED (default off). Off => the import path behaves
 * exactly as before (no detection, no reconstruction, no confirm card).
 */

const { getAnthropicClient, isAnthropicConfigured, claudeModelId } = require('../config/anthropicClient');
const { getMeetingById, getParticipantsForMeeting } = require('./recallWebhookDb');
const clientService = require('./clientService');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'speaker_reconstruction');

const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
// Generous output ceiling so a long (90-min) transcript can be re-emitted in full; streamed
// to avoid HTTP timeouts. Env-switchable for tuning.
const RECONSTRUCT_MAX_TOKENS = parseInt(process.env.CLAUDE_RECONSTRUCT_MAX_TOKENS || '32000', 10);
// Opus has a 1M context window; cap defensively so a pathological paste can't blow the request.
const MAX_INPUT_CHARS = 400000;

function isEnabled() {
  return String(process.env.SPEAKER_RECONSTRUCTION_ENABLED || '').toLowerCase() === 'true';
}

/* ------------------------------------------------------------------ */
/* Detection — plain code, no AI                                       */
/* ------------------------------------------------------------------ */

// Mirror of routes/recallWebhookRoutes.js extractSpeakerLabels: the canonical store uses
// "Name: text" lines (and legacy "Participant N |" headers). Kept local so the service has
// no dependency on the route layer.
function extractSpeakerLabels(text) {
  if (!text) return [];
  const labels = new Set();
  const rxPipe = /^(Participant \d+)\s*\|/gm;
  let m;
  while ((m = rxPipe.exec(text)) !== null) labels.add(m[1]);
  const rxColon = /^([A-Za-z(][^:\n]{0,50}):\s/gm;
  while ((m = rxColon.exec(text)) !== null) {
    const lab = m[1].trim();
    if (lab && !lab.startsWith('{') && !lab.startsWith('[')) labels.add(lab);
  }
  return [...labels];
}

/**
 * Detect a single-speaker (un-diarised) transcript. Pure string work — no AI.
 * @returns {{ single: boolean, labels: string[] }}
 */
function detectSingleSpeaker(transcript) {
  const labels = extractSpeakerLabels(String(transcript || ''));
  return { single: labels.length <= 1, labels };
}

/* ------------------------------------------------------------------ */
/* Reconstruction — Claude                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You repair speaker attribution in a business-meeting transcript that arrived from a capture tool with NO speaker diarisation — every line is tagged as one speaker (usually the host) even though both sides spoke. Both sides' words are present; only the attribution is wrong.

Your job: rebuild who said each line using topic anchors and conversational logic (questions vs answers, who owns which facts, names used in address, turn-taking), then re-emit the FULL transcript with correct "Name: utterance" labels — one labelled line per utterance, in original order, wording unchanged.

The things that matter most — get these right above all:
- INTRO DIRECTION: who is introducing whom to whom (e.g. "A is introducing B to C" is NOT the same as "C is introducing B to A"). This is the single most common and most damaging error in un-diarised transcripts.
- WHO-KNOWS-WHOM: recognition lines ("I know her", "we've met", "I'll connect you").
- COMMITMENTS: who agreed to do what.

If a human CORRECTION is supplied, apply it as ground truth and PROPAGATE it across the whole mislabelled stretch — a single mis-attribution is almost always systematic (two speakers swapped throughout a section), so fix every affected line, not just the one mentioned.

Be honest about uncertainty: where the content genuinely can't disambiguate the speaker, make your best guess and say so in the note. You are reconstructing for a human who WAS in the room and will confirm — flag what they should check.

Use ONLY the known participant names provided; do not invent attendees. If a third party is clearly referenced, you may label them by the name used in the transcript.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    transcript: {
      type: 'string',
      description: 'The full re-speakered transcript, one "Name: utterance" line per turn, original order and wording, corrected labels.',
    },
    highStakes: {
      type: 'array',
      description: 'ONLY the high-stakes lines a human should verify — not the whole transcript.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['intro_direction', 'who_knows_whom', 'commitment'] },
          summary: { type: 'string', description: 'Plain-language statement of what was reconstructed, e.g. "Alicia introduced Guy to Bill Lang".' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['category', 'summary', 'confidence'],
        additionalProperties: false,
      },
    },
    note: {
      type: 'string',
      description: 'Short honest note to the human: what was dodgy, what you fixed, what they most need to check.',
    },
  },
  required: ['transcript', 'highStakes', 'note'],
  additionalProperties: false,
};

function parseJsonLoose(raw) {
  const trimmed = String(raw || '').trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const s = trimmed.indexOf('{');
  const e = trimmed.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(trimmed.slice(s, e + 1)); } catch (_) {}
  }
  return null;
}

function normaliseReconstruction(obj) {
  const safe = obj && typeof obj === 'object' ? obj : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    transcript: typeof safe.transcript === 'string' ? safe.transcript.trim() : '',
    highStakes: arr(safe.highStakes).map(h => ({
      category: ['intro_direction', 'who_knows_whom', 'commitment'].includes(h?.category) ? h.category : 'intro_direction',
      summary: typeof h?.summary === 'string' ? h.summary.trim() : '',
      confidence: ['high', 'medium', 'low'].includes(h?.confidence) ? h.confidence : 'medium',
    })).filter(h => h.summary),
    note: typeof safe.note === 'string' ? safe.note.trim() : '',
  };
}

/**
 * Best-effort list of known participant names: the coach plus any verified participant /
 * supplied names. Helps Claude anchor attribution without inventing attendees.
 */
async function gatherKnownNames(meetingId, extra = []) {
  const names = new Set();
  for (const n of extra) { if (n && String(n).trim()) names.add(String(n).trim()); }
  try {
    const coach = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    const coachName = (coach?.clientName || coach?.clientId || '').trim();
    if (coachName) names.add(coachName);
  } catch (_) { /* optional */ }
  try {
    const parts = await getParticipantsForMeeting(meetingId);
    for (const p of parts || []) {
      if (p.verified_name && String(p.verified_name).trim()) names.add(String(p.verified_name).trim());
    }
  } catch (_) { /* optional */ }
  return [...names];
}

/**
 * Reconstruct speakers for a meeting via Claude. Stores the proposal (status -> 'pending')
 * is the caller's job — this returns the normalised reconstruction object.
 *
 * @param {object} opts
 * @param {string|number} opts.meetingId
 * @param {string} [opts.correction]   Free-text human correction to apply + propagate.
 * @param {string[]} [opts.knownNames] Known participant names (else derived best-effort).
 * @param {string} [opts.baseTranscript] Override the transcript to reconstruct from (else the
 *                 proposed version if one exists, else the canonical transcript_text).
 * @returns {Promise<{ok:boolean, reconstruction?:object, error?:string}>}
 */
async function reconstructSpeakers({ meetingId, correction, knownNames, baseTranscript } = {}) {
  if (!isEnabled()) return { ok: false, error: 'speaker reconstruction is disabled' };
  if (!isAnthropicConfigured()) return { ok: false, error: 'Claude not configured (ANTHROPIC_API_KEY unset)' };

  const row = await getMeetingById(meetingId);
  if (!row) return { ok: false, error: 'meeting not found' };

  // Base transcript: an explicit override wins; else build on the current proposal (so a
  // correction refines the latest version), else the canonical original.
  let proposed = null;
  if (row.reconstruction_json) {
    try { proposed = normaliseReconstruction(JSON.parse(row.reconstruction_json)); } catch (_) {}
  }
  let text = (baseTranscript != null ? baseTranscript : (proposed?.transcript || row.transcript_text || '')).trim();
  if (!text) return { ok: false, error: 'no transcript to reconstruct' };
  if (text.length > MAX_INPUT_CHARS) text = text.slice(0, MAX_INPUT_CHARS) + '\n\n[transcript truncated]';

  const names = (Array.isArray(knownNames) && knownNames.length)
    ? knownNames
    : await gatherKnownNames(meetingId, []);

  const parts = [];
  parts.push(`Meeting title: ${row.title || '(untitled)'}`);
  parts.push(`Known participants: ${names.length ? names.join(', ') : '(unknown — infer from content)'}`);
  if (correction && String(correction).trim()) {
    parts.push(`\nHUMAN CORRECTION (apply as ground truth, propagate across the whole mislabelled stretch):\n${String(correction).trim()}`);
  }
  parts.push(`\nTRANSCRIPT TO RECONSTRUCT:\n${text}`);
  const userPrompt = parts.join('\n');

  try {
    const client = getAnthropicClient();
    // Streamed (long transcripts), adaptive thinking + high effort (reasoning job), structured
    // output so we get parseable JSON back.
    const stream = client.messages.stream({
      model: claudeModelId,
      max_tokens: RECONSTRUCT_MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined the request' };
    }
    const textBlock = (message.content || []).find(b => b.type === 'text');
    const parsed = parseJsonLoose(textBlock?.text);
    if (!parsed) return { ok: false, error: 'Claude returned unparseable output' };

    const reconstruction = normaliseReconstruction(parsed);
    if (!reconstruction.transcript) return { ok: false, error: 'reconstruction produced no transcript' };

    log.info(`reconstructed meeting=${meetingId} (${reconstruction.highStakes.length} high-stakes lines, correction=${!!correction})`);
    return { ok: true, reconstruction };
  } catch (e) {
    log.warn(`reconstruction failed for meeting=${meetingId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  isEnabled,
  detectSingleSpeaker,
  reconstructSpeakers,
  normaliseReconstruction,
};
