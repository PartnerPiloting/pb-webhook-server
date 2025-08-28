// Phase 2 Action Extractor & Coverage
// Heuristic extraction of actionable phrases (bullets, numbered steps, imperatives)
// Provides: extractActionsFromBlocks(sources), loadTaxonomy(), coverage(foundActions)

const fs = require('fs');
const path = require('path');

let _taxonomy = null; let _taxonomyMtime = 0; let _taxonomyPath = path.join(__dirname, 'manualTaxonomy.json');

function loadTaxonomy(force = false) {
  try {
    const st = fs.statSync(_taxonomyPath);
    if (force || !_taxonomy || st.mtimeMs !== _taxonomyMtime) {
      _taxonomy = JSON.parse(fs.readFileSync(_taxonomyPath, 'utf8'));
      _taxonomyMtime = st.mtimeMs;
    }
  } catch (e) {
    if (!_taxonomy) _taxonomy = { version: 0, generatedAt: null, items: [] };
  }
  return _taxonomy;
}

function normalizeAction(text) {
  return text
    .trim()
    .replace(/^[-*\d)+.>\s]+/,'') // remove leading bullet markers
    .replace(/\s+/g,' ')
    .replace(/[.;:\s]+$/,'')
    .trim();
}

// Very lightweight verb detection (imperative) list
const VERB_START = /^(open|set|add|save|restart|configure|choose|enable|disable|adjust|verify|check|launch|start|stop|pause|resume|review|update|create|select|schedule|change)\b/i;

function extractCandidatesFromText(txt) {
  const lines = txt.split(/\n+/).slice(0,80); // safety cap per block
  const out = [];
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bulletLike = /^\s*[-*\d]/.test(line);
    const imperative = VERB_START.test(line);
    if (bulletLike || imperative) {
      const norm = normalizeAction(line);
      if (norm.length > 3 && /[a-z]/i.test(norm)) out.push(norm);
    }
  }
  return out;
}

function extractActionsFromBlocks(sources) {
  const seen = new Set();
  const actions = [];
  sources.forEach(src => {
    const baseText = src.fullText || src.snippet || src.text || '';
    const cands = extractCandidatesFromText(baseText);
    cands.forEach(c => {
      const key = c.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({ phrase: c, sourceId: src.id });
      }
    });
  });
  return actions;
}

function computeCoverage(foundActions) {
  const tax = loadTaxonomy();
  const taxMap = new Map();
  (tax.items||[]).forEach(it => taxMap.set(it.phrase.toLowerCase(), it));
  let matched = []; let missing = [];
  if (taxMap.size) {
    // Attempt fuzzy fallback: direct lower-case equality.
    const foundLower = new Set(foundActions.map(a => a.phrase.toLowerCase()));
    taxMap.forEach((val, key) => {
      if (foundLower.has(key)) matched.push(val); else missing.push(val);
    });
  }
  return {
    taxonomyItems: taxMap.size,
    matched: matched.length,
    missing: missing.length,
    coveragePct: taxMap.size ? +( (matched.length / taxMap.size) * 100 ).toFixed(1) : null,
    missingItems: missing.slice(0,15).map(m => m.phrase),
    taxonomyGeneratedAt: tax.generatedAt || null
  };
}

module.exports = { loadTaxonomy, extractActionsFromBlocks, computeCoverage };
// Helper: return taxonomy items filtered by category
function getTaxonomyCategoryItems(category) {
  const tax = loadTaxonomy();
  if (!category) return (tax.items||[]);
  return (tax.items||[]).filter(it => it.category === category);
}

module.exports.getTaxonomyCategoryItems = getTaxonomyCategoryItems;
