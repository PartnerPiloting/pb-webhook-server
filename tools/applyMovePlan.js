#!/usr/bin/env node
/**
 * Apply move plan produced by tools/classifyDocsDryRun.js --plan
 * - Reads tools/move-plan.json
 * - For each item with action === 'move', creates destination folders and moves the file
 * - Skips any non-existent sources; prints a summary
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const planPath = path.join(ROOT, 'tools', 'move-plan.json');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function moveFile(srcRel, destRel) {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(ROOT, destRel);
  ensureDir(path.dirname(dest));
  fs.renameSync(src, dest);
}

function main() {
  if (!fs.existsSync(planPath)) {
    console.error('Plan not found:', path.relative(ROOT, planPath));
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const toMove = plan.items.filter(i => i.action === 'move');
  const moved = [];
  const skipped = [];

  for (const item of toMove) {
    const src = path.join(ROOT, item.src);
    if (!fs.existsSync(src)) {
      skipped.push({ ...item, reason: 'source missing' });
      continue;
    }
    try {
      moveFile(item.src, item.dest);
      moved.push(item);
    } catch (e) {
      skipped.push({ ...item, reason: e.message });
    }
  }

  console.log(`Moved ${moved.length} files. Skipped ${skipped.length}.`);
  if (moved.length) {
    for (const m of moved) {
      console.log(`MOVE ${m.src} -> ${m.dest}`);
    }
  }
  if (skipped.length) {
    console.warn('Skipped items:');
    for (const s of skipped) console.warn(`SKIP ${s.src}: ${s.reason}`);
  }
}

if (require.main === module) main();
