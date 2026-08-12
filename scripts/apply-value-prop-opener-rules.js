// One-off (2026-08-12, Guy approved in-session): openers pitch the CLIENT's own value
// proposition, never the platform's networking method as if it were their business.
// From Julian's pilot call — his drafts said "I work with people to build a network that's
// actively recommending them", which is Guy's business, not Julian's.
//
// Four writes, all through the store's own door (versioned, history-stamped):
//   1. foundation outreach-core-objective v1→v2 — the seed = YOUR core idea ({{?core_framing}});
//      the two-way idea moves to the connector line and is never presented as your business.
//   2. NEW template your-value-proposition — openers introduce you via {{?core_framing}}.
//   3. NEW template connector-line — the "keen to connect you" default, one line, changeable.
//   4. seedClientFromTemplate for Julian-Davis — stamps the two new rules into his set
//      (future clients get them automatically at onboarding seeding).
//
// Idempotent: each write checks the live version first and skips if already applied.
// Run on prod via a Render one-off job: node scripts/apply-value-prop-opener-rules.js

const store = require('../services/wingguyRulesStore');

const ACTOR = 'Guy-Wilson';           // platform owner — required for shared-layer writes
const CREATED_BY = 'claude-code (Guy approved in-session 2026-08-12)';

const CORE_OBJECTIVE_V2 = `**Core objective of every outreach message:** plant the seed of YOUR core idea early - your own value proposition, said the way you say it: "{{?core_framing}}" - move the conversation towards a quick {{call_platform}} - do not give detailed advice in messages - use messages to assess and advance, not solve.

The two-way collaboration idea is planted as your CONNECTOR LINE - a one-sentence offer to open doors (your \`connector-line\` instruction has the wording) - never as a description of your own business. What you do comes from your value proposition; the two-way idea is how you relate, not what you sell. (Unless network-building literally is your business, in which case the two coincide.)`;

const VALUE_PROP_BODY = `How you introduce what you do - in openers and anywhere a message needs to say who you are.

Your one-line answer, from setup ("When someone asks what you do, what is your answer?"): "{{?core_framing}}"

- Paraphrase it naturally to fit the message - never recite it word-for-word every time.
- Never present networking, collaboration or "building a network" as your business - that is how you relate to people, not what you sell. Your connector line (its own instruction) carries that idea.
- If the line above is blank, keep the draft's self-description minimal rather than inventing one, and mention in your notes to the coach that their setup answer is missing.`;

const CONNECTOR_LINE_BODY = `The connector line - the two-way seed, planted as a gesture. One sentence, its own paragraph, an offer rather than a pitch.

Default wording - use it as written or a close natural variant:
"I'm speaking with capable people all the time, and I'm always keen to connect the right ones - so I may be able to open a door or two for you."

- At most once per thread - never repeat it in a follow-up.
- This line is yours: change the wording or drop it entirely by saying so.`;

async function amendFoundationCoreObjective() {
  const existing = await store.getRule({ layer: 'foundation', ruleKey: 'outreach-core-objective' });
  const live = existing && existing.active;
  if (!live) throw new Error('foundation outreach-core-objective not found — refusing to create rather than amend');
  if (/connector-line/i.test(live.body)) { console.log('1. foundation outreach-core-objective: already amended (v' + live.version + ') — skipped'); return; }
  const r = await store.commitRule({
    layer: 'foundation', ruleKey: 'outreach-core-objective', context: 'outreach', ruleType: 'stage-logic',
    tier: 'standard', body: CORE_OBJECTIVE_V2, expectedVersion: Number(live.version),
    changeNote: 'Seed = the client\'s own core framing; two-way idea moves to the connector line, never presented as their business (Julian pilot call finding)',
    createdBy: CREATED_BY, actorTenantId: ACTOR, via: 'door',
  });
  console.log('1. foundation outreach-core-objective → v' + r.version);
}

async function addTemplateRule(ruleKey, body, changeNote) {
  const existing = await store.getRule({ layer: 'template', ruleKey });
  if (existing && existing.active) { console.log('   template ' + ruleKey + ': already exists (v' + existing.active.version + ') — skipped'); return; }
  const r = await store.commitRule({
    layer: 'template', ruleKey, context: 'outreach', ruleType: 'voice',
    body, expectedVersion: 0, changeNote, createdBy: CREATED_BY, actorTenantId: ACTOR, via: 'door',
  });
  console.log('   template ' + ruleKey + ' → v' + r.version);
}

async function main() {
  await amendFoundationCoreObjective();
  console.log('2/3. new template rules:');
  await addTemplateRule('your-value-proposition', VALUE_PROP_BODY, 'Openers introduce the client via their own setup-page core framing');
  await addTemplateRule('connector-line', CONNECTOR_LINE_BODY, 'The two-way seed as a changeable one-line default');
  const dry = await store.seedClientFromTemplate({ tenantId: 'Julian-Davis', createdBy: 'system:seed (retrofit 2026-08-12)', dryRun: true });
  console.log('4. Julian retrofit dry-run:', JSON.stringify(dry));
  const seeded = await store.seedClientFromTemplate({ tenantId: 'Julian-Davis', createdBy: 'system:seed (retrofit 2026-08-12)' });
  console.log('   Julian retrofit applied:', JSON.stringify(seeded));
  // Render check: Julian's outreach rulebook must resolve his core_framing with no unresolved tokens.
  const rendered = await store.renderRulesBlock({ tenantId: 'Julian-Davis', contexts: ['outreach'] });
  console.log('VERIFY unresolved tokens:', JSON.stringify(rendered.unresolved || []));
  console.log('VERIFY xAPI framing present:', /xAPI/.test(rendered.text));
  console.log('VERIFY connector default present:', /open a door or two/.test(rendered.text));
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
