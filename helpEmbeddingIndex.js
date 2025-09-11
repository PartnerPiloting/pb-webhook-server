// helpEmbeddingIndex.js
// Simple paragraph chunk + embedding index for Help topics (and optional manual segments)
// Focus: minimal, low-maintenance. Rebuilds when checksum of source text changes.

const fs = require('fs');
const path = require('path');

let _state = {
  ready: false,
  building: false,
  chunks: [], // { id, topicId, title, text, embedding?: number[] }
  meta: { checksum: null, embedModel: null, builtAt: null }
};

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'help-embeddings-cache.json');
const DEFAULT_EMBED_MODEL = process.env.HELP_EMBED_MODEL || 'text-embedding-3-small';
const MAX_CHUNKS = parseInt(process.env.HELP_EMBED_MAX_CHUNKS || '1000', 10);
const PARAGRAPH_MIN_LEN = 40; // chars
const PARAGRAPH_MAX_LEN = 1800; // chars; longer paragraphs will be split by sentences

const { htmlToText } = require('./helpHtmlToText');

function splitIntoParagraphs(body) {
  const rawParas = (body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/) // blank line separation
    .map(p => p.trim())
    .filter(p => p.length >= PARAGRAPH_MIN_LEN);
  const chunks = [];
  for (const para of rawParas) {
    if (para.length <= PARAGRAPH_MAX_LEN) {
      chunks.push(para);
    } else {
      // naive sentence split & regroup
      const sentences = para.split(/(?<=[.!?])\s+/);
      let acc = '';
      for (const s of sentences) {
        if ((acc + ' ' + s).length > PARAGRAPH_MAX_LEN && acc) {
          chunks.push(acc.trim());
          acc = s;
        } else {
          acc = acc ? acc + ' ' + s : s;
        }
      }
      if (acc.trim().length >= PARAGRAPH_MIN_LEN) chunks.push(acc.trim());
    }
  }
  return chunks;
}

function computeChecksum(items) {
  // Fast non-cryptographic checksum
  let hash = 0;
  for (const s of items) {
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
  }
  return hash.toString(16);
}

function loadCache(embedModel) {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw.meta && raw.meta.embedModel === embedModel) return raw;
  } catch {}
  return null;
}

function saveCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ chunks: _state.chunks, meta: _state.meta }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[helpEmbeddingIndex] Failed to save cache', e.message);
  }
}

async function buildIndex(helpBase, { openaiClient, includeManual = true } = {}) {
  if (_state.building) {
    while (_state.building) await new Promise(r => setTimeout(r, 50));
    return _state;
  }
  _state.building = true;
  try {
    const rows = [];
    await helpBase('Help').select({ pageSize: 100 }).eachPage((records, next) => { records.forEach(r => rows.push(r)); next(); });
    const paragraphs = [];
    for (const r of rows) {
      const f = r.fields || {};
  let body = (f.monologue_context || f.body || f.content || '').toString();
  // Remove leading heading or standalone first line containing variations like:
  // Monologue — Title, Monologue - Title, Monologue: Title, Monologue (anything)
  // Accept optional markdown heading hashes and leading/trailing spaces.
  body = body.replace(/^(?:#+\s*)?Monologue\s*[–—:-]?\s*[^\n]*\n+/i, '');
  // Also strip if first non-empty line is exactly 'Monologue' (case-insensitive)
  if (/^\s*Monologue\s*$/i.test(body.split(/\r?\n/)[0] || '')) {
    body = body.split(/\r?\n/).slice(1).join('\n');
  }
      const title = (f.title || f.Name || '').toString();
      // If looks like HTML (opening tag) convert to text for embedding so retrieval works
      if (/<[a-z][\s\S]*>/i.test(body) && body.includes('</')) {
        body = htmlToText(body);
      }
      if (!body && !title) continue;
      const paras = splitIntoParagraphs(body).slice(0, 40); // cap per topic
      paras.forEach((p, idx) => {
        paragraphs.push({ topicId: r.id, title, text: p });
      });
      if (paragraphs.length >= MAX_CHUNKS) break;
    }

    // Optional manual segments (already plain text lines)
    if (includeManual) {
      try {
        const { getManualSegments } = require('./helpManualStore');
        const manualSegs = getManualSegments().slice(0, 200); // cap
        manualSegs.forEach((m, i) => {
          if (paragraphs.length < MAX_CHUNKS) paragraphs.push({ topicId: 'manual', title: 'Manual', text: m });
        });
      } catch {}
    }

    const checksum = computeChecksum(paragraphs.map(p => p.text));
    const embedModel = DEFAULT_EMBED_MODEL;
    const cached = loadCache(embedModel);
    if (cached && cached.meta && cached.meta.checksum === checksum) {
      _state = { ready: true, building: false, chunks: cached.chunks, meta: cached.meta };
      return _state;
    }

    if (!openaiClient) throw new Error('OPENAI_CLIENT_MISSING');
    // Batch embeddings
    const chunks = [];
    const BATCH = 80;
    for (let i = 0; i < paragraphs.length; i += BATCH) {
      const batch = paragraphs.slice(i, i + BATCH);
      const resp = await openaiClient.embeddings.create({
        model: embedModel,
        input: batch.map(b => b.text.slice(0, 6000))
      });
      resp.data.forEach((d, j) => {
        const original = batch[j];
        chunks.push({
          id: original.topicId + '::' + (i + j),
            topicId: original.topicId,
            title: original.title,
            text: original.text,
            embedding: d.embedding
        });
      });
    }
    _state.chunks = chunks;
    _state.meta = { checksum, embedModel, builtAt: Date.now(), chunkCount: chunks.length };
    _state.ready = true;
    saveCache();
    return _state;
  } finally {
    _state.building = false;
  }
}

async function ensureIndex(helpBase, { openaiClient } = {}) {
  if (_state.ready) return _state;
  return buildIndex(helpBase, { openaiClient });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { const x = a[i]; const y = b[i]; dot += x * y; na += x * x; nb += y * y; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function search(questionEmbedding, { topK = 8, topicId } = {}) {
  const pool = topicId ? _state.chunks.filter(c => c.topicId === topicId) : _state.chunks;
  // If topicId restricted yields too few, expand with global
  let candidates = pool;
  if (candidates.length < 4) candidates = _state.chunks;
  const scored = candidates.map(c => ({ c, score: cosine(questionEmbedding, c.embedding) }))
    .sort((a,b)=> b.score - a.score)
    .slice(0, topK)
    .filter(o => o.score > 0.15);
  return scored;
}

module.exports = {
  ensureIndex,
  search,
  status: () => ({ ready: _state.ready, building: _state.building, meta: _state.meta, chunks: _state.chunks.length }),
  reset: () => { _state = { ready:false, building:false, chunks:[], meta:{ checksum:null, embedModel:null, builtAt:null } }; }
};
