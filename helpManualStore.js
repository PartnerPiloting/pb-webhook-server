// Lightweight manual store + keyword search for Linked Helper / AI manuals
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'api' });

// Looks for an environment override (LH_MANUAL_PATH) or a local manuals/linked-helper.txt file.
// Falls back to a stub if no file present so the system keeps working.
const fs = require('fs');
const path = require('path');

let manualRaw = '';
let segments = [];

function loadManual() {
  try {
    const envPath = process.env.LH_MANUAL_PATH;
    const defaultPath = path.join(__dirname, 'manuals', 'linked-helper.txt');
    let chosen = null;
    if (envPath && fs.existsSync(envPath)) chosen = envPath; else if (fs.existsSync(defaultPath)) chosen = defaultPath;
    if (chosen) {
      manualRaw = fs.readFileSync(chosen, 'utf8');
    } else {
      manualRaw = `Launcher Pad vs Instance\n\nLauncher Pad: The small control application you start first. It manages licenses, updates, and lets you launch an Instance.\nInstance: The main operational window that actually runs campaigns, throttling, message sequences, and profile visits.\n\nTypical Workflow:\n1. Open Launcher Pad (dark blue icon) – confirm license & version.\n2. Launch your Instance (aqua icon appears) – configure / monitor campaigns.\n3. Leave the Instance running for automation to continue.\n\nIf automation stops unexpectedly: Check if the Instance window is still open; if only the Launcher Pad is open, restart the Instance.\n\nSafety: Keep daily limits conservative at first; the Instance enforces timing, NOT the Launcher Pad.\n`;
    }
    // Split into reasonably sized segments (paragraph blocks). Remove empty.
    segments = manualRaw.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
  } catch (e) {
    logger.error('[helpManualStore] Failed to load manual', e.message);
    segments = []; manualRaw='';
  }
}

loadManual();

function searchManual(questionWords, limit = 3) {
  if (!segments.length) return [];
  const results = [];
  const uniqWords = Array.from(new Set(questionWords));
  segments.forEach(seg => {
    const lower = seg.toLowerCase();
    let score = 0;
    uniqWords.forEach(w => { if (w.length>3 && lower.includes(w)) score++; });
    if (score > 0) results.push({ seg, score });
  });
  results.sort((a,b)=> b.score - a.score);
  return results.slice(0, limit).map(r=>r.seg);
}

function reloadManual() { loadManual(); return segments.length; }

module.exports = { getManualSegments: () => segments, searchManual, reloadManual };
