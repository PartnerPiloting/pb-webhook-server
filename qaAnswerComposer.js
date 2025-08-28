// Composes a richer structured answer from multiple evidence sources.
// Inputs: question, topicSentence, bm25Segments (array {text, score}), manualSegments (array strings), snapshot (segment or null)
// Returns { answer, used: { facets: {...}, counts: {...} } }

function splitSentences(text) {
  return (text || '')
    .split(/(?<=[.!?])\s+/)
    .map(s=>s.trim())
    .filter(Boolean);
}

function classifySentence(s) {
  const l = s.toLowerCase();
  if (/^(what|this|it) (is|are)\b/.test(l) || /(is|are) used to/.test(l)) return 'definition';
  if (/(allows|helps? you|so you can|lets you|enable|purpose)/.test(l)) return 'purpose';
  if (/(configure|set|choose|select|option|steps?|do this|to use|to enable)/.test(l)) return 'how';
  if (/(avoid|risk|pitfall|should not|don'?t|warning)/.test(l)) return 'pitfall';
  if (/(troubleshoot|issue|problem|fails|error|if .* (not|doesn'?t))/.test(l)) return 'troubleshoot';
  if (/(example|e\.g\.|for instance)/.test(l)) return 'example';
  return 'other';
}

function dedupe(sentences) {
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

function takeMax(arr, n) { return arr.slice(0, n); }

function composeAnswer({ question, topicSentence, bm25Segments = [], manualSegments = [], snapshot = null }) {
  const facets = { definition:[], purpose:[], how:[], pitfall:[], troubleshoot:[], example:[], other:[] };
  const collect = (text, limitPerSeg = 4) => {
    if (!text) return;
    const sents = splitSentences(text).slice(0, limitPerSeg);
    for (const s of sents) {
      const cat = classifySentence(s);
      if (facets[cat].length < 6) facets[cat].push(s);
    }
  };

  bm25Segments.forEach(seg => collect(seg.text, 6));
  manualSegments.forEach(ms => collect(ms, 3));
  collect(topicSentence, 1);
  if (snapshot && snapshot.text) collect(snapshot.text, 3);

  Object.keys(facets).forEach(k => { facets[k] = dedupe(facets[k]); });

  const sections = [];
  const firstDef = facets.definition[0];
  if (firstDef) sections.push(firstDef);
  if (facets.purpose.length) sections.push('Why it matters:\n' + facets.purpose.slice(0,2).join(' '));
  if (facets.how.length) sections.push('How to / Key steps:\n- ' + takeMax(facets.how,5).join('\n- '));
  if (facets.pitfall.length) sections.push('Pitfalls / Gotchas:\n- ' + takeMax(facets.pitfall,4).join('\n- '));
  if (facets.troubleshoot.length) sections.push('Troubleshooting tip:\n' + facets.troubleshoot[0]);
  if (facets.example.length) sections.push('Example:\n' + facets.example[0]);
  if (sections.join('\n\n').length < 180 && facets.other.length) {
    sections.push(takeMax(facets.other,3).join(' '));
  }

  const answer = sections.join('\n\n').trim() || topicSentence || 'No answer available yet.';
  return { answer, used: { facets, counts: Object.fromEntries(Object.entries(facets).map(([k,v])=>[k,v.length])) } };
}

module.exports = { composeAnswer };
