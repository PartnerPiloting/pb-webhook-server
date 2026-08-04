/**
 * Starter-kit split, BATCH 2 of 5 (Guy's yes, 2026-08-05): the conversation set - the four rules
 * governing how the calls run. Same shape as batch 1 (scripts/wingguy-split-batch1.js): method →
 * foundation standard in you/your register, template copy retired, voice slots via {{?...}}.
 * The optional-placeholder engine is already live on prod (b58b040b), so no ordering step.
 *
 * Batch call Guy signed off on explicitly: the inversion question stays in close paraphrase in the
 * method (the question barely works said another way - it IS the mechanic), with the client's own
 * phrasing layered on via {{?canonical_inversion_line}}. The eight "magic phrases" are replaced by
 * their JOBS; a client's own lines accumulate in {{?own_anchor_lines}} (harvested by the edit loop
 * and chat, deliberately NOT a day-one page box - a new client has no lines that land yet).
 *
 *   node scripts/wingguy-split-batch2.js            # dry-run + render checks
 *   node scripts/wingguy-split-batch2.js --commit
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:split-batch-2-2026-08-05';
const COMMIT = process.argv.includes('--commit');
const NOTE = 'Starter-kit split batch 2 (Guy approved 2026-08-05): method half shared in you/your register; scripted call wording removed; client phrasing arrives via {{?...}} voice slots; the template copy carrying Guy\'s scripts is retired.';

const FOUNDATION = [
  {
    ruleKey: 'three-call-structure',
    context: 'post-call',
    ruleType: 'stage-logic',
    body: `The three-call structure. Each call has one job - never mix them. The principle across all three: you are not convincing anyone of something new; you are helping them say out loud what they already believe. Their own words remove their own objection. Ask the question that makes that happen, then get out of the way.

The posture that makes it work: you are sharing something you use yourself, because you needed it - not selling a product built for other people. People can feel the difference.

- **Call 1 - discover.** Find out about them. Ask questions, listen more than you talk. Work out whether what you are doing would genuinely help them, and how. End: book call 2 before hanging up.
- **Call 2 - share and connect.** Tell your own story - the four beats you have written for it - slanted toward what you learned in call 1: their words, their situation, their obstacles. Make the case for advocacy (see advocacy-argument). Demonstrate the principle live with a real introduction by email. End: book call 3 before hanging up.
- **Call 3 - decision.** Revisit what they said in calls 1 and 2, in their words. Hold them to it warmly. Move toward a clear yes, no, or not now.

What not to do: do not teach in the call (share, ask, listen) - do not over-explain before they are curious - do not send links without a follow-up call booked - never let a call end without the next one in the diary - do not mistake enthusiasm for commitment.`,
  },
  {
    ruleKey: 'call1-discovery',
    context: 'post-call',
    ruleType: 'stage-logic',
    body: `Call 1 - the discovery conversation. Open with genuine icebreakers and be curious - a real conversation, not a script or an interview.

**The job:** understand what they are doing, what is blocking them, and where their work actually comes from today. Questions in your own words, of the kind: what they are working on and why - their biggest obstacle right now - what makes them different - where most of their leads come from - who they would love to be introduced to. For someone without a clear venture yet: what they have in mind, and what is driving them toward it.

**What you are listening for:** do they talk about others or only themselves - do they think in introductions or transactions - genuine readiness and capacity - whether the obstacle they name is one a stronger network actually solves - curious and open, or defensive and fixed.

**The close:** if they are worth a second conversation, say so plainly in your own words - you would like to share what you are doing, and you think there could be something in it for them - and book call 2 before hanging up. A booked time, never "sometime next week".`,
  },
  {
    ruleKey: 'call-objectives',
    context: 'booking',
    ruleType: 'stage-logic',
    body: `The objectives of every first call: understand the person rather than impress them - make a genuine introduction offer early - ask the inversion question and let it land - see where they actually are versus what they say - move to a clear next step.

Two moves are non-negotiable in every first call, whoever the person is:
1. **The introduction offer** - early, once you understand what they are working on: ask who they are trying to reach, and whether someone in your network could help. Ask it genuinely; if someone comes to mind, commit on the spot and make the introduction by email after the call. This changes the energy of everything that follows - you are not there to sell, you are there to be useful.
2. **The inversion question** - once they have shared what they are building: ask who they know who would love to have trusted people recommending them, rather than having to recommend themselves. Then stop. Let it land. The pause is the point - do not fill it.
Your phrasing of the inversion, once set - used as asked or a close variant: "{{?canonical_inversion_line}}"

The full mechanic behind both moves is in two-way-mechanic.`,
  },
  {
    ruleKey: 'two-way-mechanic',
    context: 'global',
    ruleType: 'voice',
    body: `The two-way collaboration mechanic - the operating move under every conversation, from first message to third call. It is not a sales technique; it is the system working in real time.

**The core insight:** almost everyone is recommending themselves. It is exhausting, it does not scale, and somewhere in their network are people who feel exactly the same way. The two-way question surfaces this as curiosity, not a pitch - because it is curiosity.

**The two questions that do all the work:**
1. **The offer** - who are they trying to reach, and could someone in your network help? Asked genuinely, never as a technique. If an introduction is possible, make it.
2. **The inversion** - who do they know who would love trusted people recommending them, rather than having to recommend themselves? Then stop. Most people pause. The honest answer is: everyone they know, including them. That pause is the penny dropping - never fill it.
Your phrasing, once set: "{{?canonical_inversion_line}}"

**The "oh, you mean me" moment** - the most important moment in any first conversation. They start naming others, then stop, then: actually, that is me. When it happens: do not rush to explain anything - do not jump to what it costs - reflect it back and let them describe their own problem in their own words.

**Make it real rather than argue it:** the strongest move is always a live introduction - someone they should meet, introduced by email, with your name behind it.

Your own anchor lines - the sentences you find yourself saying that land. Once captured, Wingguy reaches for yours rather than inventing new ones: {{?own_anchor_lines}}

**Avoid:** turning either question into a screening tool - rushing past the pause - offering an introduction and not following through - framing the reciprocal ask as a swap. The reciprocal ask is natural, not transactional: you are always glad to meet people who get this, if anyone comes to mind.`,
  },
];

const VARIABLES = [
  ['own_anchor_lines', 'Your own anchor lines - the sentences you find yourself saying that land. Harvested over time from your real sends and chats, not asked for on day one', 'I always say: a warm intro beats a hundred cold messages'],
];

(async () => {
  let bad = 0;
  for (const f of FOUNDATION) {
    const r = store.resolveRuleBody(f.body, {}, {});
    const braces = /\{\{/.test(r.text);
    if (braces || r.unresolved.length) {
      bad++;
      console.error(`RENDER CHECK FAILED ${f.ruleKey}: braces=${braces} unresolved=[${r.unresolved}]`);
    } else {
      console.log(`render-check ok ${f.ruleKey} (blank client: ${f.body.split('\n').length} lines -> ${r.text.split('\n').length})`);
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
        changeNote: 'Split batch 2: replaced by the foundation method rule of the same key; this copy carried Guy\'s scripted call wording.',
        via: 'internal',
      });
    }
  }

  for (const [key, description, example] of VARIABLES) {
    console.log(`- catalogue variable ${key}`);
    if (COMMIT) await store.setVariable({ tenantId: 'Guy-Wilson', varKey: key, value: null, description, example, actor: ACTOR });
  }

  if (COMMIT) {
    const fAfter = await store.getActiveRules({ layer: 'foundation' });
    const tAfter = await store.getActiveRules({ layer: 'template' });
    console.log(`\nDone. Foundation ${foundation.length} -> ${fAfter.length}, template ${template.length} -> ${tAfter.length}.`);
  } else {
    console.log('\nDry-run only. Re-run with --commit.');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
