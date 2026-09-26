/**
 * The CV-tally hook guard - cvTallyHook() catches drafts that hook on a years-of-experience count.
 *
 * Johnidy Ong, 26 Sep 2026, the third strike: his posts were in the profile block, posts-first was
 * in the rulebook (profile-hook-craft v4) AND a HOOK CHECK sat right under the posts - and the draft
 * still opened on "20+ years architecting enterprise-scale systems across banking, government and
 * telco", a near-verbatim clone of the frac rule's About-hook worked example. Instructions lose to
 * examples; the opener guard (Daniela, 15 Sep) proved the move that wins is a refusal at the
 * propose_message chokepoint. The guard fires only when recentPosts are in hand, and at most once
 * per turn (a visible bad draft beats a stuck one) - that wiring lives in runWingguyChatTurn; what
 * is pinned here is the detector the refusal hangs on.
 *
 * Run: node tests/wingguy-hook-guard.test.js
 */
const assert = require('assert');
const { cvTallyHook } = require('../services/wingguyChat');

// The actual Johnidy retry draft - the case that got through three times.
assert.strictEqual(cvTallyHook(
  "Glad that landed, Johnidy.\n\nSomeone who's spent 20+ years architecting enterprise-scale systems across banking, government and telco - and backed that up by co-founding and advising ventures of your own - is easy to recommend, because people know exactly what they're getting."
), '20+ years');
console.log('  ✓ catches the Johnidy draft ("20+ years")');

assert.strictEqual(cvTallyHook(
  'Someone with two decades of quiet influence across the sector is easy to recommend.'
), 'decades');
console.log('  ✓ catches "decades"');

// A post-built hook passes - this is the draft the guard exists to produce.
assert.strictEqual(cvTallyHook(
  "Great, Johnidy - your post about big programs never starting with all the answers, just the right people in the room, is pretty much the whole idea behind what I'm building."
), null);
console.log('  ✓ a post-built hook passes');

// Real figures quoted exactly are NOT a years tally (the Alix worked example).
assert.strictEqual(cvTallyHook(
  'Hi Alix,\nThanks for connecting.\nBuilding a 26-person commercial org from scratch and holding 120%+ NRR is easy to recommend because the result speaks before you have to.'
), null);
console.log('  ✓ non-years figures (26-person, 120%+ NRR) pass');

// Only the HOOK is judged: a years mention deep in the message (past the hook) is not the hook.
assert.strictEqual(cvTallyHook(
  'Hi Sam,\n' +
  'Your post on hiring by process, not chance, is exactly the thinking that makes someone easy to recommend.\n' +
  'The network is a simple idea: fractional professionals who refer each other rather than waving their own flag.\n' +
  'A mate of mine spent 20 years learning that the hard way, as he puts it.\n' +
  'Worth a quick Zoom in the next couple of weeks?'
), null);
console.log('  ✓ years past the hook window are left alone');

// Empty / no draft.
assert.strictEqual(cvTallyHook(''), null);
assert.strictEqual(cvTallyHook(null), null);
console.log('  ✓ empty input is null');

console.log('\nALL PASS');
