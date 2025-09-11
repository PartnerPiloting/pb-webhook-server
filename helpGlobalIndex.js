// helpGlobalIndex.js
// Lightweight in-memory inverted index over all Help topics for global lexical retrieval.
// Strategy: build on first use (or when forced) and reuse until TTL expires.

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _indexBuiltAt = 0;
let _docs = []; // { id, title, body, tokens: string[], termFreq: Map }
let _inverted = new Map(); // term -> Map(docId -> tf)
let _docLengths = new Map();
let _avgDocLen = 0;
let _building = false;

function _tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);
}

function _ensureNotBuilding() {
  if (_building) throw new Error('GLOBAL_INDEX_BUILD_IN_PROGRESS');
}

async function ensureIndex(helpBase, opts = {}) {
  const now = Date.now();
  const force = opts.force === true;
  const ttl = opts.ttlMs || DEFAULT_TTL_MS;
  if (!force && _docs.length && (now - _indexBuiltAt) < ttl) {
    return { reused: true, docCount: _docs.length, ageMs: now - _indexBuiltAt };
  }
  if (_building) {
    // Simple wait loop
    while (_building) {
      await new Promise(r => setTimeout(r, 50));
    }
    return { reused: true, docCount: _docs.length, waited: true };
  }
  _building = true;
  try {
    const start = Date.now();
    const rows = [];
    await helpBase('Help').select({ pageSize: 100 }).eachPage((records, next) => {
      records.forEach(r => rows.push(r));
      next();
    });
    _docs = [];
    _inverted = new Map();
    _docLengths = new Map();
    let totalLen = 0;

    for (const r of rows) {
      const f = r.fields || {};
      const body = (f.monologue_context || f.body || f.content || '').toString();
      const title = (f.title || f.Name || '').toString();
      if (!body && !title) continue;
      const tokens = _tokenize(title + ' ' + body.slice(0, 8000));
      if (!tokens.length) continue;
      const tf = new Map();
      tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
      const doc = { id: r.id, title, body, tokens, termFreq: tf };
      _docs.push(doc);
      _docLengths.set(doc.id, tokens.length);
      totalLen += tokens.length;
      // inverted population
      tf.forEach((count, term) => {
        let posting = _inverted.get(term);
        if (!posting) { posting = new Map(); _inverted.set(term, posting); }
        posting.set(doc.id, count);
      });
    }
    _avgDocLen = _docs.length ? totalLen / _docs.length : 0;
    _indexBuiltAt = Date.now();
    return { reused: false, docCount: _docs.length, buildMs: _indexBuiltAt - start };
  } finally {
    _building = false;
  }
}

function status() {
  return {
    docs: _docs.length,
    avgDocLen: _avgDocLen,
    ageMs: _docs.length ? Date.now() - _indexBuiltAt : null,
    building: _building
  };
}

// Simple BM25-ish scoring
function searchGlobalHelp(queryTerms, opts = {}) {
  const uniqueTerms = Array.from(new Set(queryTerms.map(t => t.toLowerCase())));
  const k1 = 1.5;
  const b = 0.75;
  const N = _docs.length || 1;
  const scores = new Map();
  for (const term of uniqueTerms) {
    const posting = _inverted.get(term);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    posting.forEach((tf, docId) => {
      const docLen = _docLengths.get(docId) || 1;
      const denom = tf + k1 * (1 - b + b * (docLen / (_avgDocLen || 1)));
      const termScore = idf * ((tf * (k1 + 1)) / denom);
      scores.set(docId, (scores.get(docId) || 0) + termScore);
    });
  }
  const results = Array.from(scores.entries())
    .map(([docId, score]) => ({ docId, score }))
    .sort((a,b)=> b.score - a.score)
    .slice(0, opts.topK || 8)
    .map(r => {
      const doc = _docs.find(d => d.id === r.docId);
      return { ...r, title: doc?.title || '', body: doc?.body || '' };
    });
  return results;
}

module.exports = {
  ensureIndex,
  searchGlobalHelp,
  status
};
