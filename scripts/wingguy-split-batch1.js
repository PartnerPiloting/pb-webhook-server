/**
 * Starter-kit split, BATCH 1 of 5 (Guy's per-batch yes, 2026-08-04): the four instructions that
 * shipped complete example messages or a verbatim pitch. Each is split method-vs-words:
 *
 *   - METHOD → a new FOUNDATION rule (tier standard - centrally improvable, client-overridable),
 *     written in "you/your" register with NO scripted sentences. Voice arrives via {{?...}}
 *     optional slots (engine on main since b58b040b) - blank drops the line, never renders braces.
 *   - The TEMPLATE copy (Guy's wording) is RETIRED - append-only, revertible.
 *   - New voice-slot variables are CATALOGUED ready for the setup page's "In your own words" boxes.
 *
 * Guy's own client-layer copies are untouched and shadow these foundation rules for him.
 *
 *   node scripts/wingguy-split-batch1.js            # dry-run: render-check bodies, list actions
 *   node scripts/wingguy-split-batch1.js --commit   # do it
 */

const store = require('../services/wingguyRulesStore');

const ACTOR = 'script:split-batch-1-2026-08-04';
const COMMIT = process.argv.includes('--commit');
const NOTE = 'Starter-kit split batch 1 (Guy approved 2026-08-04): method half shared here in you/your register; wording arrives per-client via {{?...}} voice slots; the template copy carrying Guy\'s example wording is retired.';

const FOUNDATION = [
  {
    ruleKey: 'post-connection-message',
    context: 'outreach',
    ruleType: 'voice',
    body: `The step-2 "thanks for connecting" message - the earliest natural moment to plant your core idea. Never waste it on a generic thank-you.

Three jobs, in order, kept short:
1. **Acknowledge something specific and true from their profile** - one genuine observation, proof the message could not have been sent to anyone else. One observation only - never stack a second compliment (see message-avoid-list).
2. **Plant the seed of your core idea in one line** - what you are building, framed as an idea worth a conversation, not a pitch. Never explain the model or how it works.
Your framing, once you have set it - used as written or a close natural variant: "{{?core_framing}}"
3. **Close with a question** - your closing instruction governs the wording.

If you have saved your own version of this message, Wingguy stays close to it in structure and register - the reference, not a paste: {{?post_connection_own_message}}`,
  },
  {
    ruleKey: 'advocacy-argument',
    context: 'post-call',
    ruleType: 'voice',
    body: `The advocacy argument - the case for building a network of advocates rather than collecting contacts. Deploy it when the conversation has earned it (typically the second call, once they have shared what they are building) - never in messages, never on a first exchange.

Six beats, in order. The beats are fixed; the sentences are yours - Wingguy composes them fresh in your voice each time, never from a stock script:
1. **Start from what they already know is true** - the best things in their working life came through people who knew them well enough to vouch for them. Get agreement here before anything else. Everyone agrees.
2. **Name the gap** - most networking activity does not build that. Events, connections, posting: it feels productive and produces contacts, not advocates. Pause and let it land.
3. **Draw the distinction** - a contact knows who you are; an advocate actively recommends you to others with their own credibility behind it, unprompted. Completely different things.
4. **Take the blame off them** - it is not lack of effort. The standard way of networking is designed to create reach, and reach does not convert to trust.
5. **Why now** - as AI makes polished individual output something anyone can produce, a trusted person's personal recommendation becomes more valuable, not less. Use only when it fits the person - skip it rather than force it.
6. **Why a system** - advocates are built by deliberate, consistent investment in a small, well-chosen group of aligned people. That does not happen by accident, which is what a systematic approach is for.

Your own version of the argument, once written, is the source of truth for wording - Wingguy stays close to it: {{?advocacy_own_argument}}

Your one-liner, when set - deployed sparingly, with space left after it: "{{?advocacy_one_liner}}"`,
  },
  {
    ruleKey: 'warm-reply-gtm',
    context: 'reply',
    ruleType: 'stage-logic',
    body: `Warm reply from a collaboration-native profile (GTM, partnerships, business development, founders) - move straight to the meeting.

**When:** they replied warmly to a connection message and their background says they already think in partnerships. These people do not need convincing that relationships drive growth - explaining the model would talk past the sale. The message's only job is to signal peer-level intent and make the meeting feel like the natural next step.

Three moves, short:
1. One specific line acknowledging what they are building - their company, their actual move. Real recognition, not flattery.
2. One line of mutual-benefit intent in your framing - the idea that people like them and you open doors for each other. Never a description of any system, network or membership.
Anchored on your framing when set: "{{?core_framing}}"
3. A direct meeting ask with a soft timeframe - your closing instruction governs the wording.

Never: explain the model in the message - name a membership or anything joinable - sales-funnel language.`,
  },
  {
    ruleKey: 'warm-reply-mindset-match',
    context: 'reply',
    ruleType: 'stage-logic',
    body: `Warm reply that asks "what do you do?" or "what line of business are you in?" (often referral-native professionals) - answer the question, plant the idea, and do not dump the model.

**Why it works:** it leads with shared mindset, so the first thing they read is recognition rather than a pitch, and the literal question gets one clean answer.

Four moves:
1. One line of shared mindset - trusted relationships, not cold pitching, are the real currency. In your words, not these.
2. One clean sentence answering the literal question.
Your framing is that sentence, when set: "{{?core_framing}}"
3. One line of recognition - they clearly operate the same way, which is exactly why you reached out.
4. A soft, peer-level close - your closing instruction governs the wording, and it is never a pitch.

Avoid: mechanics, membership or pricing - more than one link, or any link at all unless they asked - generic "I help X with Y" phrasing.`,
  },
];

// Voice slots the setup page will collect (stage 3). Catalogued now so the slots officially exist.
const VARIABLES = [
  ['post_connection_own_message', 'Your own thanks-for-connecting message, if you have a version you love - Wingguy treats it as the reference for structure and register', 'Thanks for connecting - ... Worth a quick Zoom to explore collaboration?'],
  ['advocacy_own_argument', 'The case for advocacy in your own words - written the way you would say it across a table. Wingguy stays close to it when making the argument', 'Think about your best clients - most came through someone who vouched for you...'],
  ['advocacy_one_liner', 'The whole advocacy case in one sentence, if you have one - deployed sparingly', 'Normal networking builds a list...'],
];

(async () => {
  // Render check FIRST, always: with NO variables set, every body must resolve with no braces
  // left and nothing unresolved - that is the promise the {{?}} slots make to a blank new client.
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
  const fKeys = new Set(foundation.filter((r) => r.layer === 'foundation').map((r) => r.rule_key));

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
        changeNote: `Split batch 1: replaced by the foundation method rule of the same key; this copy carried Guy's example wording.`,
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
