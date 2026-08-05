/**
 * Starter-kit split, BATCH 3 of the sweep (Guy's yes, 2026-08-05): the working set - pre-call
 * research, call conduct, the signal patterns, and the follow-up email after call 1. Same shape as
 * batches 1-2: method → foundation standard in you/your register, template copy retired. ZERO new
 * voice slots this batch - the personal pieces already have homes (manifesto scaffold, batch-1
 * advocacy boxes, batch-2 inversion phrasing).
 *
 * Render-check nuance new to this batch: followup-email-structure legitimately carries the
 * REQUIRED {{signoff}} placeholder. Required variables are SUPPOSED to stay as loud braces when
 * unset (that is the hygiene signal), so the check pins unresolved-per-body exactly rather than
 * demanding none.
 *
 *   node scripts/wingguy-split-batch3.js            # dry-run + render checks
 *   node scripts/wingguy-split-batch3.js --commit
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:split-batch-3-2026-08-05';
const COMMIT = process.argv.includes('--commit');
const NOTE = 'Starter-kit split batch 3 (Guy approved 2026-08-05): method half shared in you/your register; Guy\'s scripted lines removed (intro-promise wording, steering scripts, "march of AI" example); the template copy is retired.';

const FOUNDATION = [
  {
    ruleKey: 'pre-call-research',
    context: 'booking',
    ruleType: 'stage-logic',
    expectedUnresolved: [],
    body: `Pre-call research - mandatory for anyone with a previous interaction.

**Emails and links sent:** search email history for everything sent to this person; for each email show subject, date, and list EVERY link included explicitly (never just "links were sent"). If a record says a draft was created but not confirmed sent, verify it actually went.

**Read the latest call transcript through the network-building lens** (mandatory whenever one exists - never work from a chat summary or memory of the call). Mine it for the strongest argument why THIS person would benefit from building their network:
- **Channel concentration** - "all my clients have come from my network". Strongest possible signal: the proposition becomes "expand what already works", not "try something new"
- **Cold channel failure** - frustration with outreach, cold email, content, ads ("a lot of effort for what payoff")
- **Trust gap** - wants ongoing revenue but strangers do not trust them yet
- **Non-commodity offering** - high-trust work where buyers will not commit without a personal recommendation
- **Time and budget constraints** - solo operators, life stage requiring reliable income
- **Underutilised network** - good relationships, no system converting them into referral flow
- **Expressed desire for warm intros** - they already named it
The strongest signal becomes the centrepiece of the brief - quote it directly. If no signal exists, that is information too: plan to elicit it on the call.

**Also determine before the call:** what they SAY they are doing versus what they are likely ACTUALLY doing (building instead of selling? stuck? avoiding risk?) - who in your network might be useful to them (think about it BEFORE the call; a specific introduction offer lands better than a vague one) - likely gaps (no distribution, no conversations, over-focus on product, networking activity without advocacy).`,
  },
  {
    ruleKey: 'call-conduct',
    context: 'booking',
    ruleType: 'stage-logic',
    expectedUnresolved: [],
    body: `Your role in the call: lead with generosity (offer first, ask second) - guide thinking, do not lecture - ask questions that reveal gaps - simple analogies when useful - keep control of direction without being forceful.

**Steering, by situation:**
- If they are building → shift to conversations and validation: ask who the handful of people are who, if they truly understood what has been built, would open the right doors
- If they are stuck → small, immediate actions
- If they are scattered → simplify to one clear direction
- If networking but getting nowhere → the contacts-versus-advocates distinction, in your words - it reframes frustration as a design problem, not a personal failure
- If just launched → acknowledge the achievement genuinely, then the network question
- If the inversion lands and they say "that's me" → slow down, ask them to describe it in their own words, do not jump to the system

**Avoid:** over-explaining the system - closing too early - giving a full strategy - letting it drift - skipping the introduction offer because nothing obvious comes to mind (ask anyway) - rushing past the pause after the inversion question.

**End-of-call outcome - aim for one of:** book the next call - agree a simple next step - a clear decision (yes / no / not now). Always: make the introduction by email if you offered one - reference the inversion moment in the follow-up email if it landed.

**Mental model:** lead with generosity - ask the inversion question and get out of the way - start with a thin line (a conversation) - no heavy commitments early - build progressively on feedback.`,
  },
  {
    ruleKey: 'call-signals-patterns',
    context: 'booking',
    ruleType: 'qualifying',
    expectedUnresolved: [],
    body: `Key signals to assess on the call: financial position (can they invest, runway, stability) - readiness for change - openness versus defensiveness - energy and urgency - network strength, and whether it is producing advocates or just contacts - do they think in introductions or transactions - do they light up at the inversion question or look blank.

**Common patterns to watch for:**
- **Builder trap** - wants to finish the product before talking to market; believes better product = success. The two-way frame still applies: who needs to know what they have built?
- **Overthinking** - wants perfect clarity before acting; avoids simple next steps.
- **Low urgency** - interested but not moving; comfortable.
- **Active networker, no advocates** - attends events, collects connections, posts - but cannot name three people actively referring them right now. Confuses activity with results. This is the opening for the contacts-versus-advocates distinction, made in your own words: what they are doing produces contacts; what they need are advocates, and those are built differently.
- **Just launched, needs traction** - the build is done, now asking how to get it in front of the right people. The network is the next lever, and the question to plant is who will recommend them now that it is built. Often a strong existing network is sitting underutilised - that is the entry point.`,
  },
  {
    ruleKey: 'followup-email-structure',
    context: 'post-call',
    ruleType: 'voice',
    expectedUnresolved: ['signoff'],
    body: `The follow-up email after call 1. The call introduced the two-way idea; this email DEEPENS it. It is not a content-delivery email - it is a MIRROR. The goal: they read it, think of people they know who fit the description, then stop and think "actually, that's me". That recognition is the penny drop - after it, they read everything else (including the links) through a different lens. Links are good, but the manifesto comes first; without it the links are just content.

**Structure (non-negotiable order):**
1. **Introduction promise FIRST.** If you offered an introduction on the call, name the person and commit to a timeframe, plainly and warmly - in your words, never buried. If none was offered, a softer line: you are thinking about who in your network would be useful to them and will be in touch when someone comes to mind. Either way, lead with generosity.
2. **One personalised sentence from the call** - something specific they said or a moment that landed. One line; do not summarise the call.
3. **Your manifesto (the centrepiece).** Before the links, never cut, softened or buried. Default to the short quotable form; use the longer form when the call warrants it. For neutral or guarded calls, lead with the personalised line and go straight to the links rather than forcing it.
4. **The links** - default TWO. Add a third or fourth only when the call clearly warrants it. More links = more homework; two that land cleanly beat five that get skimmed.
5. **Warm close** - short, genuine, anticipating the next call. Sign-off always {{signoff}}.

**Personalise from the transcript:** what they are building (sentence 2) - obstacles they named - the energy of the call (warmer → personality is fine; analytical → trim) - the specific introduction offered (use the name) - any "almost penny drop" moments, acknowledged lightly.

**What not to do:** do not summarise the whole call - do not explain the system in the email (the links do that) - do not send pricing material too early (it closes thinking) - do not move the manifesto to the end - do not skip a promised introduction; credibility depends on following through.

**Tonal craft:** concreteness in introduction offers - a named person or a real number beats "I'll keep an ear out". Macro framing as motivator, at most one line, and only for trend-thinkers. Soften declarative claims to aspirational - EXCEPT the manifesto, which is deliberately declarative. Habit framing over goal framing - habits feel ambient, goals feel like work.`,
  },
];

(async () => {
  let bad = 0;
  for (const f of FOUNDATION) {
    const r = store.resolveRuleBody(f.body, {}, {});
    const optionalLeak = /\{\{\s*\?/.test(r.text);
    const unresolvedOk = JSON.stringify([...r.unresolved].sort()) === JSON.stringify([...f.expectedUnresolved].sort());
    if (optionalLeak || !unresolvedOk) {
      bad++;
      console.error(`RENDER CHECK FAILED ${f.ruleKey}: optionalLeak=${optionalLeak} unresolved=[${r.unresolved}] expected=[${f.expectedUnresolved}]`);
    } else {
      console.log(`render-check ok ${f.ruleKey} (unresolved as designed: [${f.expectedUnresolved}])`);
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
        changeNote: 'Split batch 3: replaced by the foundation method rule of the same key.',
        via: 'internal',
      });
    }
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
