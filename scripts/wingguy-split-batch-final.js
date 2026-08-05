/**
 * Starter-kit split, FINAL BATCH (Guy's yes, 2026-08-06): the last five template rules move to
 * foundation, and the flagged shared rule gets its two fixes. This CLOSES the stage-2 sweep begun
 * with the 2026-08-04 template audit: every client-facing instruction is now genuinely shared
 * method or a scaffold for the client's own words.
 *
 * The network-context-principle edit is a foundation v1→v2 COMMIT (not a new rule): its body
 * claimed "Why this is locked" while its tier is standard (the text lied about itself), and it
 * carried Guy's "not in the room" phrasing. Guy chose: stays STANDARD, wording fixed. Tier is
 * sticky through commitRule, so the edit cannot quietly change it.
 *
 *   node scripts/wingguy-split-batch-final.js            # dry-run + render checks
 *   node scripts/wingguy-split-batch-final.js --commit
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:split-batch-final-2026-08-06';
const COMMIT = process.argv.includes('--commit');
const NOTE = 'Starter-kit split final batch (Guy approved 2026-08-06): last five moved to shared method in you/your register; near-verbatim where already generic; quoted specimen lines converted to described moves.';

const FOUNDATION = [
  {
    ruleKey: 'staying-in-touch-ladder',
    context: 'global',
    ruleType: 'stage-logic',
    expectedUnresolved: [],
    body: `How to give a good conversation a real reason to continue. The principle is locked in reason-to-meet-again: goodwill with nothing attached to it decays. This is the ladder - three ways to attach something, in order of what you can honestly deliver right now.

**Use the highest rung you can make good on - not the highest rung available.** The offer has to be true when you make it.

**Rung 1 - the day you start. Anyone can do this honestly.** The two-way offer: ask who they are trying to reach at the moment, and say you will keep an eye out. It costs no expertise, it is true the second you say it, and it puts a specific name into the space between you - now there is something to come back with. Follow through, even if the answer later is that you are still looking. Pair it with a hand-off when they show interest in how you are going about your networking: one honest personal line in your own words, then the asset, then recommend the conversation rather than the product - and close the loop by asking again who they are trying to reach. Who the hand-off points to, and which page, is set in your own asset rules.

**Rung 2 - once you have actually done it a few times.** Offer to show them how you are going about networking differently. This is sharing an experiment, not teaching a system - which is why it is easy to say without feeling like a fraud. It becomes true as soon as you have run the play yourself a handful of times.

**Rung 3 - once you can point to a real result.** The full offer: take them through building the network properly, as an ongoing thing - and say plainly what you get out of it: they will be out there building deliberately, they will come across people who are right for you, and as you work through it together you learn what they need, so you can send more people their way.

**The gate on rung 3 is capability, not time served.** Offer it once you have actually done this yourself and can point to something real - an introduction you made, a conversation that came from it. Six weeks in with two introductions made: ready. Six months in having done nothing: not ready, and the calendar does not change that. Until then, rung 1 does the same job honestly. The first time you make a genuine introduction off your own bat, that is the signal this rung has opened up.

**Write all of these in your own words.** The shapes above are anchors, not scripts - a borrowed sentence is audible.`,
  },
  {
    ruleKey: 'core-framing-inversion',
    context: 'global',
    ruleType: 'voice',
    expectedUnresolved: [],
    body: `The core framing behind every conversation - the penny-drop:

Most people think growing a business means networking harder - more events, more posts, more putting yourself out there. That's the misconception. The goal isn't to be a better solo networker; it's to stop being solo at all - to have a team of people building the network with you.

The unlock is the inversion: most people recommend themselves; the ones growing fastest have trusted people recommending them.
Your canonical line, once set: "{{?canonical_inversion_line}}"

This framing is yours to reword - put it in your own language. How far to push it in writing is not: that is governed by messages-plant-the-seed - the shift lands in conversation, not on the page.`,
  },
  {
    ruleKey: 'live-introduction-demo',
    context: 'post-call',
    ruleType: 'stage-logic',
    expectedUnresolved: [],
    body: `The live demonstration - non-negotiable. Every second call should include a REAL introduction. Not a promise to introduce - an actual introduction, made by email, personally, with your credibility behind it.

**The sequence:**
1. Make the introduction offer in call 1
2. Make the actual introduction by email after call 1
3. In call 2, ask whether they connected - and let the moment make the point: that was the system working, and there could be several people doing that for them. In your words, never a rehearsed line.

The introduction is the proof of concept. Everything else is explanation.`,
  },
  {
    ruleKey: 'message-success-criteria',
    context: 'outreach',
    ruleType: 'stage-logic',
    expectedUnresolved: ['call_platform'],
    body: `**Success criteria. A good message:** gets a reply - moves towards a {{call_platform}} - plants the seed of the two-way idea - filters in people who feel the inversion.

**A bad message:** feels long - gives too much away - leads to endless messaging - could have been sent by anyone.`,
  },
  {
    ruleKey: 'outreach-core-objective',
    context: 'outreach',
    ruleType: 'stage-logic',
    expectedUnresolved: ['call_platform'],
    body: `**Core objective of every outreach message:** plant the seed of the two-way collaboration idea early - move the conversation towards a quick {{call_platform}} - do not give detailed advice in messages - use messages to assess and advance, not solve.`,
  },
];

// The flagged shared rule: foundation v1 -> v2, two fixes, tier untouched (standard).
const NCP_EDIT = {
  ruleKey: 'network-context-principle',
  context: 'global',
  ruleType: 'voice',
  expectedVersion: 1,
  changeNote: 'Final-batch fix (Guy approved 2026-08-06, keep STANDARD): "Why this is locked" header was false - the tier is standard - now "Why this matters so much"; "putting their name forward when they are not in the room" (Guy\'s signature phrasing) -> "actively putting their name forward, unprompted".',
  body: `The passive-vs-deliberate network distinction - critical principle. Most senior people already HAVE a network, but it is passive: people know them, respect them, think of them occasionally. What's different - and what's on offer - is building one DELIBERATELY, with people who are actively backing each other, not just hoping to be remembered. When writing to someone in this situation, always draw the distinction between having a network and proactively building one. The passive network exists. The deliberate one compounds. That is the difference worth naming.

**Why this matters so much.** Getting it wrong is not a style miss, it is an insult: telling an experienced, well-regarded professional that you can help them build a network reads as though nobody looked at who they are, and it loses the reply outright. Acknowledge what they have already built, then name what is actually missing - whether anyone is actively putting their name forward, unprompted.

Pairs with profile-hook-craft: that rule forces you to read and interpret who the person actually is; this one says what to do with that reading.`,
};

(async () => {
  let bad = 0;
  for (const f of [...FOUNDATION, { ...NCP_EDIT, expectedUnresolved: [] }]) {
    const r = store.resolveRuleBody(f.body, {}, {});
    const optionalLeak = /\{\{\s*\?/.test(r.text);
    const unresolvedOk = JSON.stringify([...r.unresolved].sort()) === JSON.stringify([...f.expectedUnresolved].sort());
    if (optionalLeak || !unresolvedOk) {
      bad++;
      console.error(`RENDER CHECK FAILED ${f.ruleKey}: optionalLeak=${optionalLeak} unresolved=[${r.unresolved}] expected=[${f.expectedUnresolved}]`);
    } else {
      console.log(`render-check ok ${f.ruleKey}`);
    }
  }
  if (bad) { console.error('\nNot committing - fix the bodies.'); process.exit(1); }

  const template = await store.getActiveRules({ layer: 'template' });
  const tByKey = new Map(template.filter((r) => !r.campaign).map((r) => [r.rule_key, r]));
  const foundation = await store.getActiveRules({ layer: 'foundation' });
  const fKeys = new Set(foundation.map((r) => r.rule_key));

  for (const f of FOUNDATION) {
    if (fKeys.has(f.ruleKey)) { console.error(`STOP: foundation already has "${f.ruleKey}"`); process.exit(1); }
    const t = tByKey.get(f.ruleKey);
    console.log(`- ${f.ruleKey}: commit foundation v1 (standard)${t ? ` + retire template v${t.version}` : ' (no template copy?!)'}`);
    if (!COMMIT) continue;
    await store.commitRule({
      layer: 'foundation', ruleKey: f.ruleKey, context: f.context, ruleType: f.ruleType,
      body: f.body, changeNote: NOTE, createdBy: ACTOR, expectedVersion: 0, via: 'internal',
    });
    if (t) {
      await store.retireRule({
        layer: 'template', ruleKey: f.ruleKey, createdBy: ACTOR, expectedVersion: t.version,
        changeNote: 'Split final batch: replaced by the foundation method rule of the same key.',
        via: 'internal',
      });
    }
  }

  console.log(`- ${NCP_EDIT.ruleKey}: foundation v${NCP_EDIT.expectedVersion} -> v${NCP_EDIT.expectedVersion + 1} (two fixes, tier stays standard)`);
  if (COMMIT) {
    await store.commitRule({
      layer: 'foundation', ruleKey: NCP_EDIT.ruleKey, context: NCP_EDIT.context, ruleType: NCP_EDIT.ruleType,
      body: NCP_EDIT.body, changeNote: NCP_EDIT.changeNote, createdBy: ACTOR,
      expectedVersion: NCP_EDIT.expectedVersion, via: 'internal',
    });
  }

  if (COMMIT) {
    const fAfter = await store.getActiveRules({ layer: 'foundation' });
    const tAfter = await store.getActiveRules({ layer: 'template' });
    console.log(`\nDone. Foundation ${foundation.length} -> ${fAfter.length}, template ${template.length} -> ${tAfter.length}. The stage-2 sweep is CLOSED.`);
  } else {
    console.log('\nDry-run only. Re-run with --commit.');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
