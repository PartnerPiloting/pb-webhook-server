/**
 * Wingguy onboarding MCP tools — the state-aware in-connector experience.
 *
 * WHY (2026-07-12): onboarding + the "here's what Wingguy unlocks for you" pitch can only live
 * INSIDE the connector, because before it's connected the client's Claude is blank. Three tools:
 *   - wingguy_get_started : STATUS view — what's live for YOU now, your blanks, how to drive it.
 *   - wingguy_vision      : VISION view — the full day-in-the-life once it's all connected, then
 *                           the concrete "here's what we need to do to get you there" (state-aware).
 *   - wingguy_setup_rules : the guided "let's set up my rules" walkthrough — seeds the starter
 *                           rulebook, then walks the client through making it their own, one beat
 *                           at a time (angle, manifesto, targeting, objections, assets, call two).
 * Same door adapts to where each client is. Extends the "lead with the blanks" help idea.
 *
 * One definition, BOTH transports (same pattern as services/wingguyRulesMcp.js):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 *
 * Tenant is threaded in per-request (2nd arg, defaults to the module TENANT = Guy).
 *
 * Reader-facing copy uses " - " (short dash), never em dashes (Guy's house style).
 */

const { z } = require('zod');
const clientService = require('./clientService');
const store = require('./wingguyRulesStore');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// Read the caller's provisioning state once — shared by both tools so they never drift.
async function resolveState(tenant) {
  const coach = await clientService.getClientById(tenant);
  if (!coach) return null;
  let clientRuleCount = 0;
  try {
    const rules = await store.getActiveRules({ tenantId: tenant, layer: 'client' });
    clientRuleCount = Array.isArray(rules) ? rules.length : 0;
  } catch (_e) {
    // store unavailable → treat the rulebook as unseeded rather than fail the whole guide
  }
  return {
    coach,
    name: coach.clientFirstName || coach.clientName || '',
    hasMailbox: !!coach.nylasGrantId,
    hasCalendar: !!coach.calendarProvider,
    hasFathom: !!coach.fathomApiKey,
    hasZoom: !!coach.bookingZoom,
    clientRuleCount,
    rulesSeeded: clientRuleCount > 0,
  };
}

async function runGetStarted(_args = {}, tenant = TENANT) {
  const s = await resolveState(tenant);
  if (!s) {
    return { text: "I couldn't find your Wingguy set-up yet. Check with the person who's onboarding you - your account may not be fully connected." };
  }

  const live = [];
  const blanks = [];

  live.push('- I can see your leads in your own database.');
  live.push('- Ask me to **draft a message** for any lead - try: *"draft a thanks-for-connecting note for [lead name]"*.');
  live.push('- Ask **"show me my rules"** to see (and change) how I write for you.');

  if (s.rulesSeeded) {
    live.push(`- Your rulebook is set up (${s.clientRuleCount} of your own rules) - I draft in your voice.`);
  } else {
    blanks.push('- **Your rulebook is nearly empty** - right now I draft from generic craft, not *your* voice. Say **"let\'s set up my rules"** and we\'ll build them from your real business.');
  }
  if (s.hasMailbox) {
    live.push('- I can create **email drafts** in your own mailbox (links intact, ready for you to read and send).');
  } else {
    blanks.push('- **No mailbox connected yet** - once we link it, I\'ll write your follow-up emails as real drafts you just check and send.');
  }
  if (s.hasCalendar) {
    live.push('- I can check your calendar and **book meetings** with your booking rules applied.');
    if (!s.hasZoom) blanks.push('- **No meeting link on file** - add your Zoom/Meet room so it goes on every invite you send.');
  } else {
    blanks.push('- **No calendar connected yet** - once it\'s wired in, I\'ll book replies straight into your diary, with your hours, buffers and no-double-book rules enforced.');
  }
  if (s.hasFathom) {
    live.push('- I can pull your **meeting transcripts** when you ask.');
  } else {
    blanks.push('- **No meeting-notes source connected yet** - connect it and I\'ll fetch your call transcripts on request.');
  }

  const parts = [];
  parts.push(`**Welcome${s.name ? ', ' + s.name : ''} - here's where Wingguy stands for you.**`);
  parts.push('');
  parts.push('**Live now**');
  parts.push(live.join('\n'));
  if (blanks.length) {
    parts.push('');
    parts.push('**Still to connect - let\'s unlock these**');
    parts.push(blanks.join('\n'));
  }
  parts.push('');
  parts.push('**Why this matters:** this isn\'t a chatbot bolted on the side - it\'s your calendar, inbox, CRM and LinkedIn pulled together under one assistant that works *your* way. That connective layer underneath is the whole point. Guy runs his entire LinkedIn follow-up through this - recently 37 personalised messages to 20 people in the time it used to take him to do five.');
  parts.push('');
  parts.push('Just tell me what you\'d like to do, say **"show me the full picture"** to see what this looks like fully connected, or **"let\'s set up my rules"** to make my drafting sound like you.');

  return { text: parts.join('\n') };
}

async function runVision(_args = {}, tenant = TENANT) {
  const s = await resolveState(tenant);
  const name = s ? s.name : '';

  const parts = [];
  parts.push(`**Welcome${name ? ', ' + name : ''} - here's what Wingguy does for you.**`);
  parts.push('');
  parts.push('I\'m your LinkedIn follow-up, living right here in your Claude. Day to day:');
  parts.push('- **A lead accepts your connection** → I draft the thanks-for-connecting note in your voice, off their real profile.');
  parts.push('- **They reply interested** → I draft your response, and offer real times from your calendar - your hours, never a double-book.');
  parts.push('- **They pick a time** → I book it, invite out, your meeting link on it, reminders set.');
  parts.push('- **After the call** → I pull the transcript and draft the follow-up email in your mailbox, links clean.');
  parts.push('');
  parts.push('All of it on *your* rules - your voice, not a template. Guy runs his whole pipeline this way - 37 personalised messages to 20 people in the time it took him to do five.');
  parts.push('');

  // How it works now (copy/paste) vs the optional next rung (the extension) — Guy's framing 2026-07-13.
  parts.push('**How it works right now:** you copy a lead\'s details across from LinkedIn, paste them to me here in Claude, and I do the rest. Simple - and honestly, just this saves serious time. Guy ran it exactly this way for months.');
  parts.push('');
  parts.push('**When you want to go faster:** there\'s the **Wingguy Chrome extension** - it does all of this *inside* LinkedIn itself, so there\'s no copy-pasting at all. Totally optional - you can happily stay on just Claude and Wingguy, and it\'s great. When you\'re ready, the extension runs either on your own Anthropic key or a simple flat fee - whatever suits you.');
  parts.push('');

  // "Where you and I are" — state-aware setup, folded in as the good part.
  const asks = [];
  if (!s || !s.hasCalendar) asks.push('which **calendar** you use - so I can book straight into it');
  if (!s || !s.hasMailbox) asks.push('which **email client** you\'re on - so I can draft your follow-ups in your own mailbox');
  if (!s || !s.hasFathom) asks.push('whether you use a meeting **note-taker** - the one we plug into is **Fathom**, and the good news is Fathom transcripts are currently free');
  const rulesToDo = (!s || !s.rulesSeeded);

  if (s && asks.length === 0 && !rulesToDo) {
    parts.push('**Where you and I are right now:** you\'re fully connected - everything above is live for you today. Just start using it.');
  } else {
    parts.push('**Where you and I are right now:** you\'re connected and I can see your leads, so we can start today. To open up the full thing there\'s a little setup, and it\'s the good part:');
    const bullets = [];
    asks.forEach((a) => bullets.push('- ' + a));
    if (rulesToDo) bullets.push('- and your **rules** - the great part: you shape every message in plain English, just by telling me, and it keeps getting sharper the more we go.');
    parts.push(bullets.join('\n'));
  }
  parts.push('');
  parts.push('**The honest headline:** the more outreach you\'re doing, the more this hands back - at real volume, we\'re talking hours a day.');
  parts.push('');
  parts.push('**Want to see it?** Copy a lead across from LinkedIn and I\'ll draft their note now - then we\'ll tune it to sound exactly like you. Or say **"let\'s set up my rules"** and we\'ll start there.');

  return { text: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// wingguy_setup_rules — the guided "let's set up my rules" walkthrough.
//
// State machine driven ENTIRELY by the store: each call reads the caller's client layer, works
// out which *-scaffold rules are still unfilled, and hands the ambient Claude the NEXT beat to
// run with the user. No session state — it's naturally resumable across turns and sessions.
//
// Division of labour:
//   - THIS tool does the structural writes only: lazily seeds the client's rulebook from the
//     template on first run (if empty), and auto-retires a scaffold once its filled rule exists.
//   - The AMBIENT Claude does the creative work (generate an angle from their business /
//     interview out their manifesto) and the content write, through the existing propose→commit
//     rules door — human confirms in chat, same as any rule change.
//
// Anti-clone by construction: the beats ship the PEDAGOGY (how to run each one), never Guy's own
// angles/manifesto/targeting. Two clients working their real businesses never come out the same.
// ---------------------------------------------------------------------------

// Each scaffold beat maps a seeded `*-scaffold` placeholder to the filled rule the walkthrough
// produces, plus the door coordinates for that commit. `mode` = generate (draft from their
// business) or interview (draw it out of them — can't be drafted from a profile).
function scaffoldBeat({ id, title, scaffold, fillKey, context, ruleType, mode, what, how }) {
  return {
    id, title, scaffold, fillKey,
    isDone: (ctx) => !ctx.activeKeys.has(scaffold) || ctx.activeKeys.has(fillKey),
    script: (ctx) => {
      const who = ctx.name || 'them';
      const lines = [];
      lines.push(what);
      if (mode === 'interview') {
        lines.push(`Run this as an INTERVIEW, not a draft-from-their-profile — it's their conviction and it only rings true in their own words. ${how}`);
      } else {
        lines.push(`GENERATE this from THEIR real business — never hand them a canned version. ${how}`);
      }
      lines.push(`Anti-clone rule: you may illustrate the SHAPE, but the content must be theirs, pulled from their actual world. If it reads like it could be anyone's, it's not done.`);
      lines.push(`When ${who} are happy: put it through the rules door — propose then commit, layer=client, rule_key="${fillKey}", context=${context}, rule_type=${ruleType} — show them the proposal and get an explicit yes first. I'll retire the "${scaffold}" placeholder automatically once "${fillKey}" is in.`);
      return lines.join('\n');
    },
  };
}

const SETUP_BEATS = [
  {
    id: 'basics',
    title: 'your basics',
    isDone: (ctx) => ctx.unsetRequiredVars.length === 0,
    script: (ctx) => {
      const list = ctx.unsetRequiredVars
        .map((v) => `{{${v.var_key}}}${v.description ? ` (${v.description})` : ''}`)
        .join(', ');
      return [
        `Quick housekeeping first — the fill-in values my rules already reference are still blank: ${list || '(none)'}.`,
        `Ask ${ctx.name || 'them'} for each in plain language (their name/sign-off, timezone, preferred call hours, their meeting/Zoom link, their public LinkedIn URL) and set each with wingguy_variables (set_key / set_value). These are values, not wording — set them directly, no proposal step.`,
      ].join('\n');
    },
  },
  scaffoldBeat({
    id: 'framing-angles', title: 'your angle', scaffold: 'framing-angles-scaffold',
    fillKey: 'framing-angles', context: 'outreach', ruleType: 'voice', mode: 'generate',
    what: '**Your angle** is the one idea you plant on the way in — what you want a new connection to think, before any pitch. The craft that makes one land: take what everyone in their world already does or assumes, and offer the flip side of it.',
    how: 'Ask what the people they target usually do or assume, then flip it into a short one-line angle in their voice. One angle per audience they actually message.',
  }),
  scaffoldBeat({
    id: 'manifesto', title: 'your manifesto', scaffold: 'manifesto-scaffold',
    fillKey: 'manifesto', context: 'follow-up', ruleType: 'voice', mode: 'interview',
    what: '**Your manifesto** is the deeper "why" behind what you\'re building — used only in warm follow-up emails after a real conversation, never in cold outreach, never with a sales close. Posture: "we\'re building this", vision-first, no urgency.',
    how: 'Ask them plainly, marketing voice off: when someone they\'ve worked with succeeds, what did they actually give them that others wouldn\'t? What do they think is broken about how this usually goes? Shape their own words into a short quotable version and a longer line-by-line unpacking.',
  }),
  scaffoldBeat({
    id: 'targeting', title: 'your targeting', scaffold: 'targeting-scaffold',
    fillKey: 'targeting-profile', context: 'outreach', ruleType: 'qualifying', mode: 'generate',
    what: '**Your targeting** is who you\'re actually trying to reach — the signals that make someone a fit and the red flags that rule them out. It steers who I flag and how I qualify.',
    how: 'Draw it from their real best clients: who they are, what makes them ready, what makes them a waste of time. Turn it into a crisp who\'s-in / who\'s-out.',
  }),
  scaffoldBeat({
    id: 'objections', title: 'your objections', scaffold: 'objections-scaffold',
    fillKey: 'objection-handling', context: 'reply', ruleType: 'voice', mode: 'generate',
    what: '**Your objections** — how you want me to handle the pushback you actually get ("not now", "what is this really", "too busy"), answered in your voice, never defensive or salesy.',
    how: 'Ask which objections they hear most and how they like to answer each — capture their real responses, not generic rebuttals.',
  }),
  {
    id: 'assets',
    title: 'your asset library',
    isDone: (ctx) => !ctx.activeKeys.has('asset-library-scaffold') || ctx.activeAssets.length > 0,
    script: (ctx) => [
      '**Your asset library** — the actual links I send out: your booking/Zoom room and public LinkedIn profile (structural, needed), plus any articles, videos or decks you want going into follow-ups (optional — bring your own or skip).',
      `Add each with wingguy_assets (set_key / set_url; URLs go out exactly as stored). A link only goes out once a rule references it, so for any content piece, also tell me where it should appear and we'll add that to the relevant rule. Ask ${ctx.name || 'them'} what they'd like on file.`,
    ].join('\n'),
  },
  scaffoldBeat({
    id: 'call2', title: 'your second call', scaffold: 'call2-scaffold',
    fillKey: 'call2-shift-conversation', context: 'post-call', ruleType: 'stage-logic', mode: 'generate',
    what: '**Your second call** — how the middle conversation runs, the shift from discovery toward a decision. The three-call shape is already pre-loaded; this is call two in your words.',
    how: 'Ask how they like the second conversation to go — what shifts, what they\'re listening for — and shape it into their call-2 playbook.',
  }),
];

// Scaffolds whose filled rule now exists get their placeholder retired (structural cleanup the
// tool owns). Returns the keys it retired.
async function reapFilledScaffolds(tenant, rowByKey, activeKeys) {
  const reaped = [];
  for (const beat of SETUP_BEATS) {
    if (!beat.scaffold || !beat.fillKey) continue;
    if (activeKeys.has(beat.fillKey) && activeKeys.has(beat.scaffold)) {
      const row = rowByKey.get(beat.scaffold);
      try {
        await store.retireRule({
          tenantId: tenant, layer: 'client', ruleKey: beat.scaffold,
          expectedVersion: Number(row.version), createdBy: `mcp:setup:${tenant}`,
          changeNote: `filled → ${beat.fillKey}`,
        });
        activeKeys.delete(beat.scaffold);
        reaped.push(beat.scaffold);
      } catch (_e) { /* version moved or already gone — next call retries */ }
    }
  }
  return reaped;
}

async function runSetupRules(_args = {}, tenant = TENANT) {
  const coach = await clientService.getClientById(tenant);
  if (!coach) {
    return { text: "I couldn't find your Wingguy set-up yet. Check with whoever's onboarding you — your account may not be fully connected." };
  }
  const name = coach.clientFirstName || coach.clientName || '';

  // Read the client's rule layer; lazily seed from template if it's empty (works even before
  // provisioning wires the seed in).
  let clientRules = [];
  try { clientRules = (await store.getActiveRules({ tenantId: tenant, layer: 'client' })) || []; } catch (_e) { /* store down */ }
  let justSeeded = false;
  if (!clientRules.length) {
    try {
      await store.seedClientFromTemplate({ tenantId: tenant, createdBy: `mcp:setup:${tenant}` });
      justSeeded = true;
      clientRules = (await store.getActiveRules({ tenantId: tenant, layer: 'client' })) || [];
    } catch (_e) { /* seed failed — carry on with whatever's there */ }
  }

  const rowByKey = new Map(clientRules.map((r) => [r.rule_key, r]));
  const activeKeys = new Set(clientRules.map((r) => r.rule_key));
  await reapFilledScaffolds(tenant, rowByKey, activeKeys);

  let assets = [];
  try { assets = ((await store.getAssets({ tenantId: tenant })) || []).filter((a) => a.status === 'active'); } catch (_e) { /* ignore */ }
  if (assets.length && activeKeys.has('asset-library-scaffold')) {
    const row = rowByKey.get('asset-library-scaffold');
    try {
      await store.retireRule({
        tenantId: tenant, layer: 'client', ruleKey: 'asset-library-scaffold',
        expectedVersion: Number(row.version), createdBy: `mcp:setup:${tenant}`, changeNote: 'assets added',
      });
      activeKeys.delete('asset-library-scaffold');
    } catch (_e) { /* retry next call */ }
  }

  let vars = [];
  try { vars = (await store.getVariables({ tenantId: tenant })) || []; } catch (_e) { /* ignore */ }
  const unsetRequiredVars = vars.filter((v) => v.required && (v.value == null || String(v.value).trim() === ''));

  const ctx = { activeKeys, activeAssets: assets, unsetRequiredVars, name };
  const done = SETUP_BEATS.filter((b) => b.isDone(ctx));
  const remaining = SETUP_BEATS.filter((b) => !b.isDone(ctx));
  const freshStart = done.length === 0;

  const parts = [];
  parts.push(`**Let's set up your rules${name ? ', ' + name : ''}.**`);
  if (justSeeded) {
    parts.push('', "I've loaded your starting rulebook — the shared craft (how to write well, book, follow up) is already in place. Now we make it *yours*.");
  }
  if (freshStart) {
    parts.push('', 'How this works: you never touch a file or a setting. You tell me in plain English how you want things done, I write it up and show you, and it only sticks once you say yes. Change anything the same way, any time.');
  }
  if (done.length) parts.push('', `**Done so far:** ${done.map((b) => b.title).join(', ')}.`);

  if (!remaining.length) {
    parts.push('', "**That's everything — your rules are set up.** From here the best tuning happens as you work: whenever a draft isn't quite right, just tell me (\"warmer\", \"shorter\", \"I'd say it like this\") and I'll fold it into your rules. Before you go live in earnest, sanity-check that your angle and targeting genuinely sound like *you*, not a generic default.");
    return { text: parts.join('\n') };
  }

  const next = remaining[0];
  parts.push('', `**Still to do:** ${remaining.map((b) => b.title).join(', ')}. Let's do **${next.title}** now.`, '');
  parts.push(next.script(ctx));
  parts.push('', 'Once this one is committed, call wingguy_setup_rules again and I\'ll bring up the next — we go one at a time.');
  return { text: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_get_started',
    description:
      'A SHORT status check of the user\'s own Wingguy set-up: what is already working for them, what is still to connect (their blanks), and how to drive it. Call this when the user asks "am I set up?", "what\'s connected?", "what do I still need to do?", "show me my status", or wants the quick version. For a new user asking the broad "what can I do / what is this" - use wingguy_vision instead. Present the returned text to them directly.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {} },
    run: runGetStarted,
  },
  {
    name: 'wingguy_vision',
    description:
      'The PRIMARY answer for a new or curious user: what Wingguy does for them day to day, how it works right now (copy/paste from LinkedIn into Claude) vs the optional Chrome-extension upgrade (bring-your-own-key or flat fee), then the little bit of setup that opens up the full thing (state-aware), and the hours-saved payoff. Call this whenever the user asks "what can I do with Wingguy?", "what can I do?", "what can you do?", "what is this / how does it work?", "show me the full picture", "what will I be able to do?", says they\'re new, or needs the sell on completing setup. Present the returned text to them directly.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {} },
    run: runVision,
  },
  {
    name: 'wingguy_setup_rules',
    description:
      'The guided "let\'s set up my rules" walkthrough — how a client turns the generic starter rulebook into their own voice. Call this whenever the user says "let\'s set up my rules", "set up my rules", "help me set up", "let\'s do my rules", or asks to personalise/build their rules. It returns the NEXT step of the walkthrough (it tracks progress itself, so just call it again after each step is committed). Do NOT paste the returned text verbatim — ENACT it: run the beat with the user (generate an angle from their business, interview out their manifesto, etc.), then write each agreed rule through the propose→commit rules door. Resumable: safe to call any time to pick up where they left off.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {} },
    run: runSetupRules,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyRulesMcp / wingguyBookingMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register the onboarding tools on an McpServer instance.
 *  `tenant` scopes the guides to the caller's client (per-request; defaults to Guy). */
function registerWingguyGetStartedTools(server, tenant = TENANT) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {}, tenant);
          return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }
}

/** Legacy endpoint (the /mcp path): tools/list entries. */
function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

/** Legacy endpoint: dispatch a tools/call. Returns the result payload, or null if not ours. */
async function legacyToolCall(toolName, args, tenant = TENANT) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

module.exports = { registerWingguyGetStartedTools, legacyToolList, legacyToolCall, TOOL_DEFS };
