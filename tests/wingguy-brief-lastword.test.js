/**
 * linkedInLastWord (services/wingguyFollowupBrief.js, Guy 2026-09-26 - the Owen Senior morning):
 * whose message ends the LinkedIn block in a lead's Notes, mechanically, so the triage is told
 * the last word outright instead of inferring it from date lines. Contracts:
 *   1. The newest line's sender decides: lead's first name prefix = 'them', anything else = 'you'.
 *   2. The date comes back ISO (Notes lines are DD-MM-YY, newest first).
 *   3. No LinkedIn block, or an unparseable newest line -> null.
 *
 * Pure. Synthetic content only. Run: node tests/wingguy-brief-lastword.test.js
 */
const assert = require('assert');
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const { linkedInLastWord } = require('../services/wingguyFollowupBrief');

const NOTES = `Some CRM narrative up top.

=== LINKEDIN MESSAGES ===
09-09-26 3:44 PM - Guy Wilson - Good to hear from you. Worth a quick Zoom in the next couple of weeks?
02-09-26 3:08 PM - Owen Senior - Sounds good Thanks Guy
02-09-26 3:07 PM - Guy Wilson - Hi Owen, I'm building a network of Fractional Professionals.`;

console.log('linkedInLastWord()');

check('coach sent the newest line -> you, ISO date', () => {
  assert.deepStrictEqual(linkedInLastWord(NOTES, 'Owen'), { dir: 'you', dateIso: '2026-09-09' });
});

check('lead sent the newest line -> them', () => {
  const notes = NOTES.replace('Guy Wilson - Good to hear', 'Owen Senior - Good to hear');
  assert.deepStrictEqual(linkedInLastWord(notes, 'Owen'), { dir: 'them', dateIso: '2026-09-09' });
});

check('first-name match is case-insensitive and prefix-based (dossier convention)', () => {
  const notes = NOTES.replace('Guy Wilson - Good to hear', 'OWEN SENIOR - Good to hear');
  assert.strictEqual(linkedInLastWord(notes, 'owen').dir, 'them');
});

check('no LinkedIn block -> null', () => {
  assert.strictEqual(linkedInLastWord('just narrative, no block', 'Owen'), null);
  assert.strictEqual(linkedInLastWord('', 'Owen'), null);
});

check('a block whose newest line is not a message line -> null', () => {
  assert.strictEqual(linkedInLastWord('=== LINKEDIN MESSAGES ===\n(sync pending)', 'Owen'), null);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
