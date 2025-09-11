#!/usr/bin/env node
// One-off builder to (re)generate the BM25 index from segments.jsonl
const { rebuildIndex, status } = require('../lhManualIndex');
rebuildIndex();
console.log('[lhManualIndex] Rebuilt index:', status());
