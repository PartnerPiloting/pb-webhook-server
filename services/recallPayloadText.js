/**
 * Parse Recall real-time webhook envelopes.
 * @see https://docs.recall.ai/docs/real-time-event-payloads
 */

function recallEventType(body) {
  return typeof body?.event === 'string' ? body.event : '';
}

function extractRecallIds(body) {
  const d = body?.data;
  return {
    botId: d?.bot?.id != null ? String(d.bot.id) : null,
    recordingId: d?.recording?.id != null ? String(d.recording.id) : null,
  };
}

function innerRecallData(body) {
  return body?.data?.data;
}

function titleFromRecallPayload(body) {
  const meta = body?.data?.bot?.metadata;
  if (meta && typeof meta === 'object') {
    if (typeof meta.meeting_title === 'string' && meta.meeting_title.trim()) return meta.meeting_title.trim();
    if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  }
  return null;
}

function formatRelSeconds(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Join Recall word array into plain text (provider sends per-word tokens). */
function wordsToText(words) {
  if (!Array.isArray(words)) return '';
  return words.map((w) => (w && typeof w.text === 'string' ? w.text : '')).join('');
}

function utteranceBounds(words) {
  if (!Array.isArray(words) || words.length === 0) {
    return { startRel: null, endRel: null };
  }
  const w0 = words[0];
  const w1 = words[words.length - 1];
  const startRel = w0?.start_timestamp?.relative != null ? Number(w0.start_timestamp.relative) : null;
  let endRel = w1?.end_timestamp?.relative != null ? Number(w1.end_timestamp.relative) : null;
  if (!Number.isFinite(endRel) && Number.isFinite(startRel)) endRel = startRel;
  return { startRel, endRel };
}

/**
 * Build transcript chunk: "Participant {id} | mm:ss\n{text}\n\n"
 */
function formatRecallUtteranceBlock(participant, words) {
  const pid = participant?.id;
  if (pid == null || !Number.isFinite(Number(pid))) return '';
  const label = `Participant ${Number(pid)}`;
  const { startRel, endRel } = utteranceBounds(words);
  const line1 = `${label} | ${formatRelSeconds(startRel != null ? startRel : 0)}`;
  const text = wordsToText(words).trim();
  if (!text) return '';
  return `${line1}\n${text}\n\n`;
}

module.exports = {
  recallEventType,
  extractRecallIds,
  innerRecallData,
  titleFromRecallPayload,
  formatRelSeconds,
  wordsToText,
  utteranceBounds,
  formatRecallUtteranceBlock,
};
