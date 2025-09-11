// Lightweight BM25 index loader & search for Linked Helper manual segments.
// Reads segments.jsonl and index.json (if present) OR builds index on the fly.
// Public API: loadIndexIfNeeded(), searchBM25(queryTerms, opts), status(), rebuildIndex().

const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, 'manuals', 'lh-snapshot');
const SEGMENTS_FILE = path.join(SNAPSHOT_DIR, 'segments.jsonl');
const INDEX_FILE = path.join(SNAPSHOT_DIR, 'index.json');

let __state = {
  loaded: false,
  segments: [], // {id,text,url,headingPath,wordCount,pos}
  index: new Map(), // term => { df, postings: Map(idx => tf) }
  avgDocLen: 0,
  vocabSize: 0,
  lastBuiltAt: 0,
  lastError: null
};

function tokenize(str) {
  return str.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && w.length > 1);
}

function buildIndex() {
  const idx = new Map();
  let totalLen = 0;
  __state.segments.forEach((seg, i) => {
    const counts = new Map();
    const terms = tokenize(seg.text);
    totalLen += terms.length;
    for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
    for (const [t, tf] of counts.entries()) {
      let entry = idx.get(t);
      if (!entry) { entry = { df: 0, postings: new Map() }; idx.set(t, entry); }
      entry.df += 1;
      entry.postings.set(i, tf);
    }
  });
  __state.index = idx;
  __state.avgDocLen = __state.segments.length ? (totalLen / __state.segments.length) : 0;
  __state.vocabSize = idx.size;
  __state.lastBuiltAt = Date.now();
}

function serializeIndex() {
  try {
    const plain = {};
    for (const [term, entry] of __state.index.entries()) {
      plain[term] = { df: entry.df, postings: Array.from(entry.postings.entries()) };
    }
    fs.writeFileSync(INDEX_FILE, JSON.stringify({
      builtAt: __state.lastBuiltAt,
      avgDocLen: __state.avgDocLen,
      segments: __state.segments.length,
      vocab: __state.vocabSize,
      index: plain
    }));
  } catch (e) {
    // ignore write failures silently in MVP
  }
}

function loadSegments() {
  if (!fs.existsSync(SEGMENTS_FILE)) {
    __state.lastError = 'segments.jsonl missing';
    return;
  }
  const lines = fs.readFileSync(SEGMENTS_FILE, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const segs = [];
  let pos = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.id && obj.text) {
        segs.push({
          id: obj.id,
          url: obj.url || null,
          headingPath: Array.isArray(obj.headingPath) ? obj.headingPath : [],
            text: obj.text,
            wordCount: obj.wordCount || obj.text.split(/\s+/).length,
            pos: pos++
        });
      }
    } catch { /* skip malformed */ }
  }
  __state.segments = segs;
}

function tryLoadPrebuiltIndex() {
  if (!fs.existsSync(INDEX_FILE)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE,'utf8'));
    if (!raw.index) return false;
    const map = new Map();
    for (const term of Object.keys(raw.index)) {
      const ent = raw.index[term];
      const postings = new Map(ent.postings);
      map.set(term, { df: ent.df, postings });
    }
    __state.index = map;
    __state.avgDocLen = raw.avgDocLen || 0;
    __state.vocabSize = raw.vocab || map.size;
    __state.lastBuiltAt = raw.builtAt || Date.now();
    return true;
  } catch (e) {
    __state.lastError = e.message;
    return false;
  }
}

function loadIndexIfNeeded(force = false) {
  if (!force && __state.loaded) return;
  __state.lastError = null;
  loadSegments();
  if (!tryLoadPrebuiltIndex()) {
    buildIndex();
    serializeIndex();
  }
  __state.loaded = true;
}

function bm25Score(queryTerms, options = {}) {
  const { k1 = 1.2, b = 0.75, topK = 8 } = options;
  loadIndexIfNeeded();
  if (!__state.segments.length) return [];
  const unique = Array.from(new Set(queryTerms.map(t => t.toLowerCase()).filter(Boolean)));
  if (!unique.length) return [];
  const N = __state.segments.length;
  const scores = new Map();
  for (const term of unique) {
    const entry = __state.index.get(term);
    if (!entry) continue;
    const df = entry.df;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [segIdx, tf] of entry.postings.entries()) {
      const seg = __state.segments[segIdx];
      const dl = seg.wordCount || seg.text.split(/\s+/).length;
      const denom = tf + k1 * (1 - b + b * (dl / (__state.avgDocLen || 1)));
      const part = idf * (tf * (k1 + 1)) / (denom || 1);
      scores.set(segIdx, (scores.get(segIdx) || 0) + part);
    }
  }
  return Array.from(scores.entries())
    .sort((a,b)=> b[1]-a[1])
    .slice(0, topK)
    .map(([segIdx, score]) => ({ score, ...__state.segments[segIdx] }));
}

function status() {
  return {
    loaded: __state.loaded,
    segmentCount: __state.segments.length,
    vocabSize: __state.vocabSize,
    avgDocLen: __state.avgDocLen,
    lastBuiltAt: __state.lastBuiltAt,
    lastError: __state.lastError
  };
}

function rebuildIndex() {
  __state.loaded = false;
  loadIndexIfNeeded(true);
  return status();
}

module.exports = { loadIndexIfNeeded, searchBM25: bm25Score, status, rebuildIndex };
