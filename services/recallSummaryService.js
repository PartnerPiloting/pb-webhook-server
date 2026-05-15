/**
 * Recall meeting summary — Fathom-style structured recap.
 *
 * Generated from a finished recording's transcript via Gemini. Stored on the
 * recall_meetings row (summary_json) so the review page can show it and the
 * coach can forward it from their own Gmail.
 *
 * Structure (matches the Fathom email the coach uses):
 *   purpose       : 1-2 sentence meeting purpose
 *   keyTakeaways  : string[]  — the headline points
 *   topics        : [{ heading, points: string[] }]
 *   actionItems   : [{ owner, task }]
 *   nextSteps     : string[]
 */

const { vertexAIClient, geminiModelId } = require('../config/geminiClient');
const { getMeetingById, getParticipantsForMeeting, saveMeetingSummary } = require('./recallWebhookDb');
const { createSafeLogger } = require('../utils/loggerHelper');

const log = createSafeLogger('SYSTEM', null, 'recall_summary');

const SUMMARY_MODEL = process.env.RECALL_SUMMARY_MODEL || geminiModelId;
const AI_TIMEOUT_MS = 90 * 1000;

const SYSTEM_PROMPT = `You are an assistant that writes concise, professional post-meeting recaps for a business coach.
You are given a meeting transcript (speaker-labelled). Produce a structured JSON summary.

Rules:
- Be factual. Only state things actually said in the transcript. Do not invent details, numbers, or commitments.
- Write in plain, professional English. No fluff, no marketing tone.
- "purpose": one or two sentences on why this meeting happened.
- "keyTakeaways": the 3-6 most important points, each a single tight sentence.
- "topics": the main discussion areas. Each has a short "heading" and 2-5 "points" (bullet sentences).
- "actionItems": concrete things someone agreed to do. "owner" is the person's name (or "Unknown" if unclear), "task" is the action. Empty array if none.
- "nextSteps": agreed follow-ups / what happens next. Empty array if none.
- If the transcript is too short or empty to summarise, return all fields with empty arrays and purpose "Insufficient transcript to summarise."

Return ONLY valid JSON with exactly these keys: purpose (string), keyTakeaways (string[]), topics ([{heading, points[]}]), actionItems ([{owner, task}]), nextSteps (string[]).`;

function extractJson(raw) {
  const trimmed = String(raw || '').trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  let cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function normaliseSummary(obj) {
  const safe = obj && typeof obj === 'object' ? obj : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    purpose: typeof safe.purpose === 'string' ? safe.purpose.trim() : '',
    keyTakeaways: arr(safe.keyTakeaways).map(x => String(x).trim()).filter(Boolean),
    topics: arr(safe.topics).map(t => ({
      heading: typeof t?.heading === 'string' ? t.heading.trim() : '',
      points: arr(t?.points).map(x => String(x).trim()).filter(Boolean),
    })).filter(t => t.heading || t.points.length),
    actionItems: arr(safe.actionItems).map(a => ({
      owner: typeof a?.owner === 'string' ? a.owner.trim() : 'Unknown',
      task: typeof a?.task === 'string' ? a.task.trim() : '',
    })).filter(a => a.task),
    nextSteps: arr(safe.nextSteps).map(x => String(x).trim()).filter(Boolean),
  };
}

/**
 * Generate (or regenerate) the summary for a meeting and persist it.
 * @returns {Promise<{ok:boolean, summary?:object, meta?:object, error?:string}>}
 */
async function generateMeetingSummary(meetingId, opts = {}) {
  if (!vertexAIClient) return { ok: false, error: 'Gemini client not initialised' };

  const row = await getMeetingById(meetingId);
  if (!row) return { ok: false, error: 'meeting not found' };

  const transcript = (row.transcript_text || '').trim();
  if (!transcript) return { ok: false, error: 'no transcript yet' };

  if (row.summary_json && !opts.force) {
    try {
      return { ok: true, summary: normaliseSummary(JSON.parse(row.summary_json)), meta: buildMeta(row), cached: true };
    } catch (_) { /* fall through and regenerate */ }
  }

  // Replace speaker labels with verified names where we have them, so the summary reads naturally.
  let text = transcript;
  try {
    const parts = await getParticipantsForMeeting(meetingId);
    for (const pp of parts || []) {
      if (pp.verified_name && pp.speaker_label && String(pp.speaker_label).startsWith('Participant ')) {
        const esc = String(pp.speaker_label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(esc, 'g'), pp.verified_name);
      }
    }
  } catch (_) { /* labels are best-effort */ }

  // Cap very long transcripts to keep token use sane (a 2h call is ~30k words).
  const MAX_CHARS = 120000;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n[transcript truncated]';

  try {
    const model = vertexAIClient.getGenerativeModel({
      model: SUMMARY_MODEL,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
      },
    });

    const userPrompt = `Meeting title: ${row.title || '(untitled)'}\n\nTRANSCRIPT:\n${text}`;
    const callPromise = model.generateContent({ contents: [{ role: 'user', parts: [{ text: userPrompt }] }] });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('summary generation timed out')), AI_TIMEOUT_MS));
    const result = await Promise.race([callPromise, timeoutPromise]);

    const partText = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!partText) return { ok: false, error: 'AI returned no content' };

    const parsed = extractJson(partText);
    if (!parsed) return { ok: false, error: 'AI returned unparseable JSON' };

    const summary = normaliseSummary(parsed);
    await saveMeetingSummary(meetingId, summary);
    log.info(`summary generated for meeting=${meetingId} (${summary.keyTakeaways.length} takeaways, ${summary.actionItems.length} actions)`);
    return { ok: true, summary, meta: buildMeta(row) };
  } catch (e) {
    log.warn(`summary generation failed for meeting=${meetingId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function buildMeta(row) {
  return {
    meetingId: row.id,
    title: row.title || `Meeting ${row.id}`,
    durationSeconds: row.duration_seconds || null,
    meetingStart: row.meeting_start || null,
  };
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Plain-text rendering — used for the email body and the Gmail-compose deep link. */
function renderSummaryText(summary, meta) {
  const s = normaliseSummary(summary);
  const L = [];
  L.push(meta?.title || 'Meeting summary');
  if (meta?.durationSeconds) L.push(fmtDuration(meta.durationSeconds));
  L.push('');
  if (s.purpose) { L.push('MEETING PURPOSE'); L.push(s.purpose); L.push(''); }
  if (s.keyTakeaways.length) {
    L.push('KEY TAKEAWAYS');
    s.keyTakeaways.forEach(t => L.push(`- ${t}`));
    L.push('');
  }
  if (s.topics.length) {
    L.push('TOPICS');
    s.topics.forEach(t => {
      L.push(t.heading);
      t.points.forEach(p => L.push(`  - ${p}`));
    });
    L.push('');
  }
  if (s.actionItems.length) {
    L.push('ACTION ITEMS');
    s.actionItems.forEach(a => L.push(`- [${a.owner}] ${a.task}`));
    L.push('');
  }
  if (s.nextSteps.length) {
    L.push('NEXT STEPS');
    s.nextSteps.forEach(n => L.push(`- ${n}`));
    L.push('');
  }
  return L.join('\n').trim();
}

/** HTML rendering — used for the email to the coach. */
function renderSummaryHtml(summary, meta) {
  const s = normaliseSummary(summary);
  const h = [];
  h.push(`<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:680px;color:#111827">`);
  h.push(`<h2 style="margin:0 0 2px">${escapeHtml(meta?.title || 'Meeting summary')}</h2>`);
  if (meta?.durationSeconds) h.push(`<div style="color:#6b7280;font-size:13px;margin-bottom:16px">${escapeHtml(fmtDuration(meta.durationSeconds))}</div>`);
  const section = (title) => h.push(`<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(title)}</h3>`);
  const ul = (items, fmt) => {
    h.push(`<ul style="margin:0 0 4px;padding-left:20px">`);
    items.forEach(i => h.push(`<li style="margin:3px 0">${fmt(i)}</li>`));
    h.push(`</ul>`);
  };
  if (s.purpose) { section('Meeting Purpose'); h.push(`<p style="margin:0">${escapeHtml(s.purpose)}</p>`); }
  if (s.keyTakeaways.length) { section('Key Takeaways'); ul(s.keyTakeaways, t => escapeHtml(t)); }
  if (s.topics.length) {
    section('Topics');
    s.topics.forEach(t => {
      h.push(`<p style="margin:12px 0 2px;font-weight:600">${escapeHtml(t.heading)}</p>`);
      ul(t.points, p => escapeHtml(p));
    });
  }
  if (s.actionItems.length) {
    section('Action Items');
    ul(s.actionItems, a => `<strong>${escapeHtml(a.owner)}:</strong> ${escapeHtml(a.task)}`);
  }
  if (s.nextSteps.length) { section('Next Steps'); ul(s.nextSteps, n => escapeHtml(n)); }
  h.push(`</div>`);
  return h.join('');
}

module.exports = {
  generateMeetingSummary,
  renderSummaryText,
  renderSummaryHtml,
  normaliseSummary,
};
