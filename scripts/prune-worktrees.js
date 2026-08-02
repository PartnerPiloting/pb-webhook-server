#!/usr/bin/env node
/**
 * prune-worktrees.js - clear out leftover git worktree registrations.
 *
 * WHY: sessions create temp worktrees under the scratchpad for a clean copy of main. On Windows the
 * metadata under .git/worktrees/<name> is flagged read-only, so `git worktree remove` and
 * `git worktree prune` both fail with "Permission denied" - quietly, in the middle of other output.
 * Registrations then accumulate for months (39 of them by 2026-08-02). This does what prune would
 * have done, clearing the read-only flag first.
 *
 * Staleness test is git's own: an entry is stale when the .git file it points at no longer exists.
 * Live worktrees are therefore excluded structurally, not by name matching. Entries carrying a
 * `locked` file are always left alone.
 *
 *   node scripts/prune-worktrees.js            # list what is stale, change nothing
 *   node scripts/prune-worktrees.js --delete   # delete the stale ones
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DELETE = process.argv.includes('--delete');

function gitCommonDir() {
  const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return out;
}

function classify(dir) {
  const entryName = path.basename(dir);
  if (fs.existsSync(path.join(dir, 'locked'))) return { entryName, state: 'locked' };

  const gitdirFile = path.join(dir, 'gitdir');
  if (!fs.existsSync(gitdirFile)) return { entryName, state: 'stale', why: 'no gitdir file' };

  const target = fs.readFileSync(gitdirFile, 'utf8').trim();
  if (!target) return { entryName, state: 'stale', why: 'empty gitdir file' };
  if (!fs.existsSync(target)) return { entryName, state: 'stale', why: 'worktree gone', target };

  return { entryName, state: 'live', target };
}

// Windows won't unlink read-only files; clear the flag on the way down.
function forceRemove(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) forceRemove(full);
    else {
      try { fs.chmodSync(full, 0o666); } catch { /* best effort */ }
      fs.unlinkSync(full);
    }
  }
  try { fs.chmodSync(dir, 0o777); } catch { /* best effort */ }
  fs.rmdirSync(dir);
}

function main() {
  const worktreesDir = path.join(gitCommonDir(), 'worktrees');
  if (!fs.existsSync(worktreesDir)) {
    console.log('No .git/worktrees directory - nothing to prune.');
    return;
  }

  const entries = fs
    .readdirSync(worktreesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => classify(path.join(worktreesDir, e.name)));

  const live = entries.filter((e) => e.state === 'live');
  const locked = entries.filter((e) => e.state === 'locked');
  const stale = entries.filter((e) => e.state === 'stale');

  console.log(`Keeping ${live.length} live: ${live.map((e) => e.entryName).join(', ') || '(none)'}`);
  if (locked.length) console.log(`Keeping ${locked.length} locked: ${locked.map((e) => e.entryName).join(', ')}`);

  if (!stale.length) {
    console.log('No stale registrations. Nothing to do.');
    return;
  }

  console.log(`\n${stale.length} stale:`);
  for (const e of stale) console.log(`  ${e.entryName} (${e.why})`);

  if (!DELETE) {
    console.log('\nNothing deleted. Re-run with --delete to remove them.');
    return;
  }

  let deleted = 0;
  const failed = [];
  for (const e of stale) {
    try {
      forceRemove(path.join(worktreesDir, e.entryName));
      deleted++;
    } catch (err) {
      failed.push(`${e.entryName}: ${err.message}`);
    }
  }

  console.log(`\nDeleted ${deleted} of ${stale.length}.`);
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main();
