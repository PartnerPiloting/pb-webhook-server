/**
 * Diarized label detection for Krisp-style transcripts.
 * Supports: "Speaker 1: text", "Speaker 1 | 00:48", and "Name: text" (short prefix).
 */

function extractSpeakerLabels(text) {
  const speakers = new Set();
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const mPipe = line.match(/^(Speaker\s*\d+)\s*\|/i);
    if (mPipe) {
      speakers.add(mPipe[1].replace(/\s+/g, ' ').trim());
      continue;
    }
    const mColon = line.match(/^(Speaker\s*\d+)\s*:\s/i);
    if (mColon) {
      speakers.add(mColon[1].replace(/\s+/g, ' ').trim());
      continue;
    }
    const mName = line.match(/^([^:|]{1,40}):\s/);
    if (mName) {
      const label = mName[1].trim();
      if (!label || label.startsWith('{') || label.startsWith('[')) continue;
      if (/^Speaker\s*\d+$/i.test(label)) continue;
      speakers.add(label);
    }
  }
  return [...speakers].sort((a, b) => {
    const na = a.match(/^Speaker\s*(\d+)$/i);
    const nb = b.match(/^Speaker\s*(\d+)$/i);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return -1;
    if (nb) return 1;
    return a.localeCompare(b);
  });
}

/** First chunk of transcript for this label (for review UI). */
function sampleLinesForSpeaker(text, label, maxLines = 6) {
  const lines = (text || '').split('\n');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`^\\s*${escaped}\\s*(\\||:)`, 'i');
  const nextSpeakerRe = /^\s*Speaker\s*\d+\s*(\||:)/i;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (startRe.test(line)) {
      out.push(line.trim());
      i += 1;
      while (i < lines.length && out.length < maxLines) {
        const L = lines[i];
        if (nextSpeakerRe.test(L)) break;
        if (startRe.test(L)) break;
        out.push(L.trim());
        i += 1;
      }
      break;
    }
    i += 1;
  }
  return out.length ? out : lines.filter((L) => startRe.test(L)).slice(0, maxLines);
}

/** True only when this diarized label has an explicit review role (not unknown). */
function participantResolvesSpeaker(p) {
  if (!p || !p.speaker_label) return false;
  const role = String(p.role || 'unknown').toLowerCase();
  const name = String(p.verified_name || '').trim();
  const lead = p.airtable_lead_id;
  if (role === 'coach') return name.length >= 1;
  if (role === 'client') return !!lead;
  if (role === 'other') return name.length >= 1;
  return false;
}

module.exports = {
  extractSpeakerLabels,
  sampleLinesForSpeaker,
  participantResolvesSpeaker,
};
