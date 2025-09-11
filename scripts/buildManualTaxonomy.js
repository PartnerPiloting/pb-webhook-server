#!/usr/bin/env node
// Basic taxonomy builder: reads manuals/linked-helper.txt and extracts candidate action phrases.
// Writes/updates manualTaxonomy.json (merging existing items, preserving manual edits).

const fs = require('fs');
const path = require('path');
const TAX_PATH = path.join(__dirname, '..', 'manualTaxonomy.json');
const MANUAL_PATH = path.join(__dirname, '..', 'manuals', 'linked-helper.txt');

function loadExisting() {
  try { return JSON.parse(fs.readFileSync(TAX_PATH,'utf8')); } catch { return { version:1, generatedAt:null, items:[] }; }
}

function tokenizeLines(text) {
  return text.split(/\n+/).map(l => l.trim()).filter(Boolean);
}

function isActionLine(line) {
  if (/^\s*[-*\d]/.test(line)) return true;
  if (/^(Open|Set|Add|Save|Restart|Configure|Choose|Enable|Disable|Adjust|Verify|Check|Launch|Start|Stop|Pause|Resume|Review|Update|Create|Select|Schedule|Change)\b/.test(line)) return true;
  return false;
}

function slug(phrase) {
  return phrase.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
}

function normalize(line) {
  return line.replace(/^[-*\d).>\s]+/, '').replace(/[.;:]+$/,'').trim();
}

function main() {
  if (!fs.existsSync(MANUAL_PATH)) {
    console.error('Manual file missing at', MANUAL_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(MANUAL_PATH,'utf8');
  const lines = tokenizeLines(raw);
  const existing = loadExisting();
  const existingMap = new Map(existing.items.map(it => [it.phrase.toLowerCase(), it]));
  const added = [];
  for (const line of lines) {
    if (!isActionLine(line)) continue;
    const norm = normalize(line);
    if (norm.length < 4) continue;
    const key = norm.toLowerCase();
    if (!existingMap.has(key)) {
      const item = { id: slug(norm), phrase: norm };
      existingMap.set(key, item); added.push(item);
    }
  }
  const merged = Array.from(existingMap.values()).sort((a,b)=> a.phrase.localeCompare(b.phrase));
  const out = { version: (existing.version||1), generatedAt: new Date().toISOString(), items: merged };
  fs.writeFileSync(TAX_PATH, JSON.stringify(out, null, 2));
  console.log(`[taxonomy] Updated. Total items: ${merged.length}. Added: ${added.length}.`);
  if (added.length) {
    console.log('New sample:', added.slice(0,5));
  }
}

main();
