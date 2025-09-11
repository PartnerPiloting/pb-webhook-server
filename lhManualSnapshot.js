// MVP Linked Helper manual snapshot loader & simple lexical search
// Purpose: Allow quick experimentation with an offline snapshot file (segments.jsonl)
// without building the full crawler/index pipeline yet.
//
// File format (segments.jsonl): one JSON object per line
// {
//   id: string,              // stable segment id
//   url: string,             // source page URL
//   headingPath: string[],   // array of headings from H1..H3 for context
//   text: string,            // cleaned segment text
//   wordCount: number,       // convenience
//   hash: string             // sha256 or simple hash of text (optional MVP)
// }
//
// Search strategy (MVP):
// 1. Tokenize query terms (already provided as qWords in caller) and segment text.
// 2. Build a very small in-memory inverted index on first load.
// 3. Score = sum over unique query terms of (tf * idf), where
//    tf = raw term frequency in segment, idf = log(1 + N / (1 + df)).
// 4. Return top N segments with score > 0.
//
// This keeps memory & compute trivial (< few ms for small manual) and is
// easily swappable later for a fuller BM25 implementation.

const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, 'manuals', 'lh-snapshot');
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'segments.jsonl');

let __snapshotState = {
  loaded: false,
  segments: [],
  index: new Map(), // term => { df, postings: Map(segmentId => tf) }
  vocabSize: 0,
  lastError: null,
  loadTriedAt: 0
};

function normalizeTerm(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

function buildIndex() {
  const idx = new Map();
  for (const seg of __snapshotState.segments) {
    const counts = new Map();
    const terms = seg.text.split(/[^a-z0-9]+/i).map(normalizeTerm).filter(Boolean);
    for (const term of terms) {
      counts.set(term, (counts.get(term) || 0) + 1);
    }
    for (const [term, tf] of counts.entries()) {
      let entry = idx.get(term);
      if (!entry) { entry = { df: 0, postings: new Map() }; idx.set(term, entry); }
      entry.df += 1;
      entry.postings.set(seg.id, tf);
    }
  }
  __snapshotState.index = idx;
  __snapshotState.vocabSize = idx.size;
}

function loadSnapshotIfNeeded() {
  if (__snapshotState.loaded) return;
  __snapshotState.loadTriedAt = Date.now();
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) {
      __snapshotState.lastError = 'SNAPSHOT_FILE_NOT_FOUND';
      return; // stay unloaded
    }
    const lines = fs.readFileSync(SNAPSHOT_FILE, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const segments = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && obj.id && obj.text) {
          segments.push({
            id: obj.id,
            url: obj.url || null,
            headingPath: Array.isArray(obj.headingPath) ? obj.headingPath : [],
            text: obj.text,
            wordCount: obj.wordCount || obj.text.split(/\s+/).length,
            hash: obj.hash || null
          });
        }
      } catch (e) {
        // Skip malformed lines silently for MVP
      }
    }
    __snapshotState.segments = segments;
    buildIndex();
    __snapshotState.loaded = true;
  } catch (e) {
    __snapshotState.lastError = e.message || String(e);
  }
}

function searchLHSnapshot(queryTerms, limit = 3) {
  loadSnapshotIfNeeded();
  if (!__snapshotState.loaded || !__snapshotState.segments.length) return [];
  const unique = Array.from(new Set(queryTerms.map(normalizeTerm).filter(Boolean)));
  if (!unique.length) return [];
  const N = __snapshotState.segments.length;
  const scores = new Map(); // segmentId => score
  for (const term of unique) {
    const entry = __snapshotState.index.get(term);
    if (!entry) continue;
    const idf = Math.log(1 + N / (1 + entry.df));
    for (const [segId, tf] of entry.postings.entries()) {
      scores.set(segId, (scores.get(segId) || 0) + tf * idf);
    }
  }
  const scored = Array.from(scores.entries())
    .sort((a,b)=> b[1] - a[1])
    .slice(0, limit)
    .map(([segId, score]) => {
      const seg = __snapshotState.segments.find(s => s.id === segId);
      return { ...seg, score };
    });
  return scored;
}

function snapshotStatus() {
  return {
    loaded: __snapshotState.loaded,
    segmentCount: __snapshotState.segments.length,
    vocabSize: __snapshotState.vocabSize,
    lastError: __snapshotState.lastError,
    loadTriedAt: __snapshotState.loadTriedAt
  };
}

module.exports = { searchLHSnapshot, snapshotStatus };
