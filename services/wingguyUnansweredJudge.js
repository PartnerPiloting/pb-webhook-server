/**
 * Unanswered-messages triage - decides which of "they spoke last" actually LEFT SOMETHING HANGING.
 *
 * WHY this exists at all (Guy, 2026-09-16): the raw "other person spoke last" list is mostly
 * noise. People sign off. Half the threads end on "thanks", "cheers", "speak soon" - nobody owes
 * anyone anything. Hand a coach four hundred of those and they never open the screen twice. The
 * whole value of the feature is the drop, not the list: turning four hundred into the fifteen
 * that genuinely deserve an answer. Same recommendation-first, drop-biased shape as the follow-up
 * queue, for the same reason.
 *
 * COST DISCIPLINE: the cheap regex pre-filter in the store (closingHeuristic) clears the obvious
 * sign-offs for nothing, so only the ambiguous ones reach the model, in batches. Verdicts are
 * cached against the last message, so a thread is judged ONCE and then never again unless
 * something new arrives in it - which makes the first run a few minutes and every run after it
 * effectively free.
 *
 * SENSITIVE FLAG: the model also marks a message as sensitive when it carries hard news -
 * redundancy, illness, bereavement, a business failing. That is the one failure that would
 * genuinely hurt a coach: a breezy AI-drafted reply to someone's worst week, sent in their name.
 * The screen surfaces those for a human to write personally rather than offering a draft.
 */

const { resolveClientAnthropic, claudeModelId } = require('../config/anthropicClient');
const { closingHeuristic, saveVerdict } = require('./wingguyUnansweredStore');

const MODEL_ID = process.env.CLAUDE_MODEL_ID || claudeModelId;
const NO_THINKING = { type: 'disabled' };
const BATCH = 25;              // threads per model call - keeps each response comfortably parseable
const MAX_PER_RUN = 400;       // safety bound on one triage run; the rest come round next refresh
const SNIPPET = 600;           // chars of the last message sent for judgement

const SYSTEM = [
  'You triage a professional\'s LinkedIn inbox. For each conversation you are given the LAST message,',
  'which was sent TO them by the other person and never answered.',
  '',
  'Decide whether that message genuinely left something hanging - a question, a request, an offer, an',
  'introduction, an opening that deserves a human reply. Be strict. Sign-offs, thanks, acknowledgements,',
  'pleasantries, automated notices, newsletters and anything already resolved do NOT need a reply.',
  'When in doubt, say it does not. A short list people trust beats a long list they ignore.',
  '',
  'Also mark sensitive=true when the message carries hard personal news - redundancy, illness,',
  'bereavement, a business failing - so a person answers it themselves rather than being handed a draft.',
  '',
  'Reply with a JSON array and nothing else. One object per conversation, in the order given:',
  '[{"key":"<the KEY given>","reply":true|false,"sensitive":true|false,"why":"<8 words max>"}]',
].join('\n');

function parseJsonArr(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

/**
 * Judge every unjudged thread in `threads` (as returned by listOpenThreads) for one tenant.
 * Writes verdicts through the store; returns a small summary for the caller to log or surface.
 *
 * Never throws to the caller - a triage failure leaves threads unjudged, which the screen shows
 * as pending. That degrades to "we haven't looked at these yet", which is honest, rather than
 * silently dropping people off a list the coach is trusting.
 */
async function judgeThreads(coachClientId, threads, clientRecord) {
  const pending = (threads || []).filter((t) => !t.verdict).slice(0, MAX_PER_RUN);
  if (!pending.length) return { ok: true, judged: 0, byHeuristic: 0, byModel: 0 };

  // 1. The free pass: obvious sign-offs never reach the model.
  const needsModel = [];
  let byHeuristic = 0;
  for (const t of pending) {
    if (closingHeuristic(t.lastText) === 'no-reply') {
      await saveVerdict(coachClientId, t.threadKey, t.lastMessageKey, 'no-reply', 'sign-off, nothing asked');
      byHeuristic++;
    } else {
      needsModel.push(t);
    }
  }
  if (!needsModel.length) return { ok: true, judged: byHeuristic, byHeuristic, byModel: 0 };

  const { llm, lane, message } = resolveClientAnthropic(clientRecord || { clientId: coachClientId });
  if (!llm) return { ok: false, reason: 'no_anthropic_key', message, judged: byHeuristic, byHeuristic, byModel: 0 };

  let byModel = 0;
  for (let i = 0; i < needsModel.length; i += BATCH) {
    const batch = needsModel.slice(i, i + BATCH);
    const listText = batch
      .map((t) => `KEY: ${t.threadKey}\nFROM: ${t.name || 'unknown'}\nWHEN: ${t.lastAt}\nMESSAGE:\n${String(t.lastText || '').slice(0, SNIPPET)}`)
      .join('\n\n---\n\n');
    try {
      const resp = await llm.messages.create({
        model: MODEL_ID,
        max_tokens: 2000,
        thinking: NO_THINKING,
        system: SYSTEM,
        messages: [{ role: 'user', content: listText }],
      });
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const byKey = new Map(parseJsonArr(text).map((v) => [String(v.key || ''), v]));
      for (const t of batch) {
        const v = byKey.get(t.threadKey);
        if (!v) continue;                               // unjudged, comes round again next refresh
        const verdict = v.reply ? (v.sensitive ? 'reply-sensitive' : 'reply') : 'no-reply';
        await saveVerdict(coachClientId, t.threadKey, t.lastMessageKey, verdict, v.why || '');
        byModel++;
      }
    } catch (e) {
      console.warn(`[unansweredJudge] batch ${i} failed (lane=${lane}): ${e.message}`);
    }
  }
  return { ok: true, judged: byHeuristic + byModel, byHeuristic, byModel, lane };
}

module.exports = { judgeThreads };
