/**
 * Best-effort transcript / body text from stored Krisp JSON (shape varies by event).
 * @param {unknown} payload
 * @returns {string}
 */
function extractKrispDisplayText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const d = payload.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    for (const key of ['raw_content', 'transcript', 'text']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    if (typeof d.content === 'string' && d.content.trim()) return d.content;
    if (d.content && typeof d.content === 'object') {
      try {
        return JSON.stringify(d.content, null, 2);
      } catch (_e) {
        /* fall through */
      }
    }
    for (const sub of ['raw_meeting', 'meeting']) {
      const o = d[sub];
      if (o && typeof o === 'object') {
        if (typeof o.transcript === 'string' && o.transcript.trim()) return o.transcript;
        if (typeof o.summary === 'string' && o.summary.trim()) return o.summary;
      }
    }
    try {
      return JSON.stringify(d, null, 2);
    } catch (_e) {
      return '';
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch (_e) {
    return '';
  }
}

/** Short UI label from Krisp `event` string (e.g. meeting.transcript.completed → completed). */
function krispEventTypeLabel(event) {
  if (!event || typeof event !== 'string') return 'Krisp';
  const parts = event.split('.').filter(Boolean);
  const last = parts[parts.length - 1] || event;
  return last.replace(/_/g, ' ');
}

module.exports = { extractKrispDisplayText, krispEventTypeLabel };
