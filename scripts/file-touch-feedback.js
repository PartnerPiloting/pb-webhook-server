#!/usr/bin/env node
// scripts/file-touch-feedback.js
//
// Files Guy's "why not" feedback from the Monday screen into the homes that live in git
// (docs/CLIENT-TOUCH-PLANNER.md "Tuning by approval"):
//
//   body   -> content/one-pagers/IMPROVEMENTS.md, under that piece's section (a **Waiting** item)
//   choice -> docs/CLIENT-TOUCH-PLANNER.md, under "Rules from the Monday screen"
//
// The other two homes (person -> the client's Touch Note; openings -> the opening instructions)
// are applied by the server the moment Guy says them, so they never appear here.
//
// Dry run by default: shows what it would write. --apply writes the files and marks each item
// filed in Postgres. Run it on the laptop from a clean worktree at origin/main, then review the
// diff and push (the files ship to clients on deploy, so Guy sees the wording first).
//
//   node scripts/file-touch-feedback.js            # dry run
//   node scripts/file-touch-feedback.js --apply

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('../services/clientTouchPlanStore');

const APPLY = process.argv.includes('--apply');
const IMPROVEMENTS = path.join(__dirname, '..', 'content', 'one-pagers', 'IMPROVEMENTS.md');
const DESIGN = path.join(__dirname, '..', 'docs', 'CLIENT-TOUCH-PLANNER.md');
const RULES_HEADING = '## Rules from the Monday screen';

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
const dateWords = (d) => new Date(d || Date.now()).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pure: add a Waiting item under the piece's "### slug" section, or a new section under Existing pieces. */
function addImprovement(md, slug, words, when, who = 'Guy') {
  const item = `- *${dateWords(when)}, ${who} (Monday screen):* ${words} **Waiting**`;
  const lines = md.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^###\\s+${slug}\\b`).test(l));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^##/.test(lines[end])) end++;
    // insert before trailing blank lines of the section
    let at = end;
    while (at > start + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, item);
    return lines.join('\n');
  }
  const existing = lines.findIndex((l) => /^## Existing pieces/.test(l));
  const section = ['', `### ${slug || '(unknown piece)'}`, '', item, ''];
  if (existing >= 0) { lines.splice(existing + 1, 0, ...section); return lines.join('\n'); }
  return `${md.replace(/\s+$/, '')}\n${section.join('\n')}\n`;
}

/** Pure: add a rule line under the design doc's Monday-screen rules heading (created at the end if missing). */
function addRule(md, words, when, clientName = '') {
  const line = `- *${dateWords(when)}, Guy${clientName ? ` (about ${clientName})` : ''}:* ${words}`;
  if (md.includes(RULES_HEADING)) {
    const lines = md.split('\n');
    const h = lines.findIndex((l) => l.trim() === RULES_HEADING);
    let end = h + 1;
    while (end < lines.length && !/^## /.test(lines[end])) end++;
    let at = end;
    while (at > h + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, line);
    return lines.join('\n');
  }
  return `${md.replace(/\s+$/, '')}\n\n${RULES_HEADING}\n\nEach line is a "why not" Guy gave on the Monday screen about the CHOICE of email (filed by\nscripts/file-touch-feedback.js). Whoever changes the picker reads these first and turns them into rules.\n\n${line}\n`;
}

async function main() {
  const items = await store.unfiledFeedback();
  const mine = items.filter((i) => i.home === 'body' || i.home === 'choice');
  if (!mine.length) { console.log('Nothing waiting to be filed.'); return; }
  let improvements = fs.readFileSync(IMPROVEMENTS, 'utf8');
  let design = fs.readFileSync(DESIGN, 'utf8');
  const clients = await require('../services/clientService').getAllClients().catch(() => []);
  const nameOf = (id) => (clients.find((c) => c.clientId === id) || {}).clientName || id || '';
  for (const it of mine) {
    const when = it.created_at;
    if (it.home === 'body') {
      improvements = addImprovement(improvements, it.piece_key, it.words, when);
      console.log(`body   -> IMPROVEMENTS.md under ${it.piece_key || '(unknown piece)'}: ${it.words}`);
    } else {
      design = addRule(design, it.words, when, it.client_id ? nameOf(it.client_id) : '');
      console.log(`choice -> CLIENT-TOUCH-PLANNER.md: ${it.words}`);
    }
  }
  if (!APPLY) { console.log(`\nDry run - ${mine.length} item(s). Re-run with --apply to write the files and mark them filed.`); return; }
  fs.writeFileSync(IMPROVEMENTS, improvements);
  fs.writeFileSync(DESIGN, design);
  for (const it of mine) await store.markFiled(it.id, it.home === 'body' ? `IMPROVEMENTS.md ${day()}` : `CLIENT-TOUCH-PLANNER.md ${day()}`);
  console.log(`\nWritten. ${mine.length} item(s) marked filed. Review the diff, then commit and push.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { addImprovement, addRule, RULES_HEADING };
