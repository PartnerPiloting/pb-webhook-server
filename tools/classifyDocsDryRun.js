#!/usr/bin/env node
/**
 * Dry-run classifier for documentation files: task vs doc vs ambiguous.
 * - No file moves; emits a Markdown + JSON report to stdout and tools/classify-report.json.
 * - Scans: .md/.mdx, .txt, .html/.htm
 * - Heuristics: filename patterns, headers/titles, presence of "Task", checkboxes, Audience/Owner headers, dates.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isDocFile(file) {
  return /(\.mdx?$|\.txt$|\.html?$)/i.test(file);
}

function readHead(file, maxBytes = 8192) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytes = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytes).toString('utf8');
  } catch (e) {
    return '';
  }
}

function score(file, head) {
  const name = path.basename(file);
  const p = name.toLowerCase();
  let task = 0, doc = 0;

  // Filename signals
  if (/^task-/.test(p)) task += 3;
  if (/\bhotfix\b|\bbacklog\b/.test(p)) task += 2;
  if (/^doc-/.test(p)) doc += 3;
  if (/readme|guide|reference|overview|standard|index|api|quick-reference|troubleshooting|how-to|setup|install/.test(p)) doc += 2;
  if (/archive\/task-list/i.test(file.replace(/\\/g, '/'))) task += 2;

  // Content signals (first 8KB)
  const h = head.toLowerCase();
  if (/^#\s*task[:\s-]/m.test(h)) task += 3;
  if (/\[\s?\]\s|\[x\]\s/.test(h)) task += 1; // checkboxes
  if (/owner\s*:/i.test(head)) doc += 1;
  if (/audience\s*:/i.test(head)) doc += 1;
  if (/^#\s*(doc|documentation|guide|how to|kb)\b/m.test(h)) doc += 2;
  if (/^#\s*(plan|implementation plan)/m.test(h)) doc += 1;
  if (/due\s*date|eta|assignee|acceptance\s*criteria/i.test(head)) task += 2;

  // HTML-specific hints
  if (/\.html?$/i.test(p)) {
    if (/<title>.*?(guide|reference|kb|troubleshooting|how to|overview).*?<\/title>/.test(h)) doc += 2;
    if (/<h1[^>]*>.*?(guide|documentation|kb|overview).*?<\/h1>/.test(h)) doc += 2;
    if (/<input[^>]*type=["']checkbox["']/.test(h)) task += 1;
  }

  // Date pattern in name (YYYY-MM-DD)
  if (/\d{4}-\d{2}-\d{2}/.test(name)) {
    // Neutral, but nudge toward task if not already doc-weighted
    task += 1;
  }

  const label = task === doc ? 'ambiguous' : (task > doc ? 'task' : 'doc');
  const confidence = Math.min(1, Math.abs(task - doc) / 6);
  const signals = { task, doc };
  return { label, confidence, signals };
}

function main() {
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : 20;
  const all = process.argv.includes('--all');
  const plan = process.argv.includes('--plan');

  const files = walk(ROOT).filter(isDocFile);
  // Stable but diverse sample: prefer root-level, docs/, kb/, tasks backups, LinkedIn folder, then others
  const buckets = {
    root: [], docs: [], kb: [], tasks: [], linkedIn: [], other: []
  };
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (!rel.includes('/')) buckets.root.push(f);
    else if (rel.startsWith('docs/')) buckets.docs.push(f);
    else if (rel.startsWith('kb/')) buckets.kb.push(f);
    else if (rel.startsWith('tasks') || rel.includes('tasks_local_backup')) buckets.tasks.push(f);
    else if (rel.toLowerCase().startsWith('linkedin-messaging-followup')) buckets.linkedIn.push(f);
    else buckets.other.push(f);
  }
  const pick = (arr, n) => arr.sort().slice(0, n);
  let sample = [
    ...pick(buckets.root, 4),
    ...pick(buckets.docs, 4),
    ...pick(buckets.kb, 3),
    ...pick(buckets.tasks, 4),
    ...pick(buckets.linkedIn, 3),
    ...pick(buckets.other, 2),
  ];
  if (all) {
    sample = files;
  } else {
    sample = sample.slice(0, limit);
  }

  const results = sample.map(file => {
    const head = readHead(file);
    const res = score(file, head);
    return { file: path.relative(ROOT, file).replace(/\\/g, '/'), ...res };
  });

  const summary = results.reduce((acc, r) => {
    acc[r.label] = (acc[r.label] || 0) + 1;
    return acc;
  }, {});

  // Write JSON artifact for review/automation
  const outDir = path.join(ROOT, 'tools');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const jsonPath = path.join(outDir, 'classify-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ when: new Date().toISOString(), summary, results }, null, 2));

  // Print Markdown table for quick view
  const rows = results.map(r => `| ${r.file} | ${r.label} | ${(r.confidence*100).toFixed(0)}% | task:${r.signals.task} doc:${r.signals.doc} |`).join('\n');
  const md = `# Dry-run classification (${all ? 'full' : 'sample ' + results.length})\n\n| File | Predicted | Confidence | Signals |\n|---|---|---:|---|\n${rows}\n\nTotals: ${Object.entries(summary).map(([k,v])=>`${k}=${v}`).join(', ')}`;
  const mdPath = path.join(outDir, 'classify-report.md');
  fs.writeFileSync(mdPath, md);

  // Optional move plan
  if (plan) {
    const movePlan = [];
    for (const r of (all ? results : results)) {
      const src = r.file;
      const isInTasks = src.startsWith('tasks/') || src.includes('tasks_local_backup');
      const isInKB = src.startsWith('kb/');
      if (isInTasks || isInKB) {
        movePlan.push({ action: 'keep', reason: isInTasks ? 'inside tasks' : 'inside kb', src });
        continue;
      }
      if (r.label === 'doc') {
        const dest = path.posix.join('kb', src); // preserve structure
        movePlan.push({ action: 'move', reason: 'classified as doc outside kb', src, dest });
      } else {
        movePlan.push({ action: 'keep', reason: r.label, src });
      }
    }
    const planJson = path.join(outDir, 'move-plan.json');
    fs.writeFileSync(planJson, JSON.stringify({ when: new Date().toISOString(), totals: summary, items: movePlan }, null, 2));
    const planRows = movePlan.map(p => `| ${p.action} | ${p.src} | ${p.dest || ''} | ${p.reason} |`).join('\n');
    const planMd = `# Proposed move plan (${all ? 'full' : 'sample'})\n\n| Action | Source | Destination | Reason |\n|---|---|---|---|\n${planRows}`;
    const planMdPath = path.join(outDir, 'move-plan.md');
    fs.writeFileSync(planMdPath, planMd);
  }
  if (results.length > 40) {
    console.log(`Dry-run complete: ${results.length} files. Totals: ${Object.entries(summary).map(([k,v])=>`${k}=${v}`).join(', ')}\n- Markdown: ${path.relative(ROOT, mdPath)}\n- JSON: ${path.relative(ROOT, jsonPath)}${plan ? `\n- Move plan (md/json): ${path.relative(ROOT, path.join(outDir,'move-plan.md'))}, ${path.relative(ROOT, path.join(outDir,'move-plan.json'))}` : ''}`);
  } else {
    console.log(md);
  }
}

if (require.main === module) {
  main();
}
