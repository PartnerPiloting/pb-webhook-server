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
 *   - wingguy_learn       : the CLIENT PLAYBOOK — Guy's explanation of the whole I Know A Guy
 *                           method, served one topic at a time from docs/client-playbook.md.
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
const fs = require('fs');
const path = require('path');
const clientService = require('./clientService');
const store = require('./wingguyRulesStore');
const learning = require('./wingguyLearningStore');

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
  parts.push('Just tell me what you\'d like to do, say **"show me the full picture"** for everything you can ask me, or **"let\'s set up my instructions"** to make my drafting sound like you. Stuck on the how rather than the what? Ask me things like **"who should I be reaching out to?"** - that\'s **Wingguy Learning**, Guy\'s whole method built in.');

  return { text: parts.join('\n') };
}

async function runVision(_args = {}, tenant = TENANT) {
  const s = await resolveState(tenant);
  const name = s ? s.name : '';

  const parts = [];
  parts.push(`**Welcome${name ? ', ' + name : ''} - here's what I can do for you.**`);
  parts.push('');
  parts.push('I\'m your LinkedIn follow-up, and I work in two places: right here in your Claude, and inside LinkedIn itself if you\'re using the Chrome extension.');
  parts.push('');
  parts.push('**Just say any of these:**');
  parts.push('- **"Show me my follow-ups"** - your ranked list of everyone you owe something, drafts already written. Park anyone until a date, or drop them for good.');
  parts.push('- **"Prep me for today\'s meetings"** - your diary for the day, plus everything I know about who you\'re meeting: past calls, emails, what you agreed last time. Guy starts every morning this way.');
  parts.push('- **"Remind me about Sarah"** - instant memory on anyone. Your whole history with them, in one go.');
  parts.push('- **"Draft the follow-up from this morning\'s call"** - I read the transcript and write it in your own mailbox. I never send. That is always you.');
  parts.push('- **"When am I free Thursday?"** / **"Offer him three times"** / **"Book 10am Tuesday"** - real slots with your booking rules already applied, then the invite, your meeting link and the reminders.');
  parts.push('- **"Write his thanks-for-connecting"** - off their real profile, in your voice, never a template.');
  parts.push('- **"Update my instructions"** - change how I write, in plain English. I show you the change before I make it, and it sticks for good.');
  parts.push('');
  parts.push('**And there\'s Wingguy Learning, built in.** I don\'t just do the work - I teach you Guy\'s whole method as you go: who to go after, what to say when someone accepts, why the second meeting is the one that matters, how to hold a steady pace. Ask **"who should I be reaching out to?"** or **"what do I say when they accept?"** and you get his answer in his words, not generic advice off the internet. And it grows - what Guy learns with every client lands in your Wingguy automatically.');
  parts.push('');
  parts.push('All of it on *your* instructions - your voice, not a template. Guy runs his whole pipeline this way - 37 personalised messages to 20 people in the time it took him to do five.');
  parts.push('');

  // How it works now (copy/paste) vs the optional next rung (the extension) — Guy's framing 2026-07-13.
  parts.push('**How it works right now:** you copy a lead\'s details across from LinkedIn, paste them to me here in Claude, and I do the rest. Simple - and honestly, just this saves serious time. Guy ran it exactly this way for months.');
  parts.push('');
  parts.push('**When you want to go faster:** there\'s the **Wingguy Chrome extension** - it does the drafting on the profile itself, so there\'s no copy-pasting at all, and it notices what you actually send so your follow-up list stays right. Totally optional - you can happily stay on just Claude and Wingguy, and it\'s great. When you\'re ready, the extension runs either on your own Anthropic key or a simple flat fee - whatever suits you.');
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
    if (rulesToDo) bullets.push('- and your **instructions** - the great part: you shape every message in plain English, just by telling me, and it keeps getting sharper the more we go.');
    parts.push(bullets.join('\n'));
  }
  parts.push('');
  parts.push('**The honest headline:** the more outreach you\'re doing, the more this hands back - at real volume, we\'re talking hours a day.');
  parts.push('');
  parts.push('**Want to see it?** Copy a lead across from LinkedIn and I\'ll draft their note now - then we\'ll tune it to sound exactly like you. Or say **"let\'s set up my instructions"** and we\'ll start there.');

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
  // The seeding latch that lived here (2026-08-04 to 2026-08-06) is gone - it protected clients
  // from a starter kit we knew was broken, and that kit has since been rewritten. Seeding is
  // automatic again: whatever the kit is on the day they arrive is what they get. The setup page
  // is now the usual trigger; this stays as the chat-side path for anyone who gets here first.
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
  parts.push(`**Let's set up your instructions${name ? ', ' + name : ''}.**`);
  if (justSeeded) {
    parts.push('', "I've loaded your starting instructions - the shared craft (how to write well, book, follow up) is already in place. Now we make it *yours*.");
  }
  if (freshStart) {
    parts.push('', 'How this works: you never touch a file or a setting. You tell me in plain English how you want things done, I write it up and show you, and it only sticks once you say yes. Change anything the same way, any time.');
  }
  if (done.length) parts.push('', `**Done so far:** ${done.map((b) => b.title).join(', ')}.`);

  if (!remaining.length) {
    parts.push('', "**That's everything - your instructions are set up.** From here the best tuning happens as you work: whenever a draft isn't quite right, just tell me (\"warmer\", \"shorter\", \"I'd say it like this\") and I'll fold it into your instructions. Before you go live in earnest, sanity-check that your angle and targeting genuinely sound like *you*, not a generic default.");
    return { text: parts.join('\n') };
  }

  const next = remaining[0];
  parts.push('', `**Still to do:** ${remaining.map((b) => b.title).join(', ')}. Let's do **${next.title}** now.`, '');
  parts.push(next.script(ctx));
  parts.push('', 'Once this one is committed, call wingguy_setup_rules again and I\'ll bring up the next - we go one at a time.');
  return { text: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// wingguy_onboarding_guide — Guy's live-call onboarding script, served from the repo doc.
//
// WHY (2026-07-17): Guy runs onboarding as a three-way session — him on a call with the client,
// a claude.ai chat open beside him. He asks for the overview, reads it out, then "expand step 3"
// as the call reaches it. The doc (docs/wingguy-onboarding-checklist.md) is the single source of
// truth; this tool reads it FROM THE DEPLOYED REPO on every call, so a doc improvement ships with
// the next deploy and there is never a stale copy anywhere.
//
// OWNER-ONLY: the guide contains Guy-side material (talk tracks, "the sell", trap notes), so a
// client tenant calling it gets a polite redirect, not the script.
// ---------------------------------------------------------------------------

const GUIDE_PATH = path.join(__dirname, '..', 'docs', 'wingguy-onboarding-checklist.md');

// Parse the doc into { intro, overview, steps: Map<number, text> } fresh on each call (it's one
// small local file; freshness beats caching here).
function loadOnboardingGuide() {
  const raw = fs.readFileSync(GUIDE_PATH, 'utf8');
  const sections = raw.split(/^## /m); // sections[0] = the intro above the first ## heading
  const guide = { intro: sections[0].trim(), overview: null, steps: new Map() };
  for (const sec of sections.slice(1)) {
    const body = '## ' + sec.trim();
    if (/^## THE OVERVIEW/i.test(body)) guide.overview = body;
    const m = body.match(/^## STEP (\d+) EXPANDED/i);
    if (m) guide.steps.set(Number(m[1]), body);
  }
  return guide;
}

async function runOnboardingGuide(args = {}, tenant = TENANT) {
  if (String(tenant).toLowerCase() !== TENANT.toLowerCase()) {
    return { text: 'This guide is the playbook for the person running your onboarding - it\'s not needed on your side. If you\'re mid-setup, ask "what can I do with Wingguy?" or "am I set up?" instead.' };
  }
  let guide;
  try {
    guide = loadOnboardingGuide();
  } catch (e) {
    return { text: `Couldn't read the onboarding guide (${e.message}).`, isError: true };
  }
  const stepNums = [...guide.steps.keys()].sort((a, b) => a - b);
  const raw = String(args.step == null ? '' : args.step).trim().toLowerCase();
  const m = raw.match(/\d+/);

  if (!raw || raw === 'overview' || !m) {
    return {
      text:
        `${guide.overview || '(overview section not found in the doc)'}\n\n` +
        `---\nThat's the map. Present the relevant part to Guy as-is; when the call reaches a step, ask for it by number ("expand step 3") and read the detail from there. Steps available: ${stepNums.join(', ')}.`,
    };
  }
  const n = Number(m[0]);
  const step = guide.steps.get(n);
  if (!step) {
    return { text: `No step ${n} in the guide - it has steps ${stepNums.join(', ')} (or ask for the overview).`, isError: true };
  }
  return {
    text:
      `${step}\n\n` +
      `---\nRead the "Say to the client" lines out loud as written; "You do" items are Guy's, "The client does" items are theirs. When this step's checks pass, ask for the next one (step ${n + 1 <= stepNums[stepNums.length - 1] ? n + 1 : 'done - that was the last'}).`,
  };
}

// ---------------------------------------------------------------------------
// wingguy_learn — the client playbook, one topic at a time.
//
// WHY (2026-07-30): Wingguy doubles as a TRAINING tool — clients get taught the whole
// I Know A Guy method (the big picture, LH plumbing, searches, scoring, calls) inside
// their own Claude, before most operational features are connected for them. Same
// serve-from-the-deployed-repo pattern as wingguy_onboarding_guide: the doc is the
// single source of truth, read fresh per call, so a content edit ships with the next
// deploy and there is never a stale copy anywhere. CLIENT-FACING (no owner gate).
//
// The doc is Guy speaking in the first person; its intro block above the first ##
// heading carries the serving contract. The tool re-asserts the key contract lines in
// its returned footer, so the ambient Claude follows them even when its pinned tool
// description predates a change.
// ---------------------------------------------------------------------------

const PLAYBOOK_PATH = path.join(__dirname, '..', 'docs', 'client-playbook.md');

// Fresh parse per call (same trade as the onboarding guide: freshness beats caching).
function loadPlaybook() {
  const raw = fs.readFileSync(PLAYBOOK_PATH, 'utf8');
  const sections = raw.split(/^## /m); // sections[0] = the intro / serving contract
  const topics = sections.slice(1).map((sec) => {
    const body = ('## ' + sec).trim();
    const title = body.split('\n')[0].replace(/^##\s*/, '').trim();
    return { title, body };
  });
  return { topics };
}

// "Give me the lot." One topic per call stays the DEFAULT (a client asking one question should
// never get a wall of text), but an explicit ask for the whole playbook is a real request - Guy
// wants clients able to read the method end to end and talk about it consistently. Deliberately
// NOT owner-gated.
// Matched narrowly on purpose: a bare "everything" means the lot, but "the message that decides
// everything" is the thanks-for-connecting topic, so a loose \beverything\b test would hijack it.
const ALL_EXACT = /^(all|everything|all topics|all of it|the lot|the whole lot|the whole thing|whole thing|the whole playbook|whole playbook|full playbook|entire playbook|the whole document|read me everything|show me everything|everything you have)$/i;
const ALL_PHRASE = /\b(all the topics|all topics|whole playbook|entire playbook|full playbook|whole document|entire document)\b/i;
const wantsEverything = (q) => ALL_EXACT.test(q) || ALL_PHRASE.test(q);

// Loose title match: whole-query substring wins outright, else most query words hit.
// Function words are excluded from word-scoring (2026-08-05): "what about angry replies" was
// matching WHAT DO YOU DO on the word "what" alone - a bad serve AND a lost gap signal, since
// the no-match branch is what feeds Guy's list of questions the playbook doesn't cover yet.
// A whole-phrase substring match still beats everything, so "what do you do" stays routable.
const MATCH_STOPWORDS = new Set(['what', 'about', 'your', 'you', 'the', 'and', 'for', 'with', 'that', 'this', 'are', 'can', 'could', 'should', 'would', 'does', 'how', 'why', 'when', 'tell', 'need', 'want', 'know', 'get', 'have', 'has']);
function findPlaybookTopic(topics, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !MATCH_STOPWORDS.has(w));
  let best = null;
  let bestScore = 0;
  for (const t of topics) {
    const title = t.title.toLowerCase();
    let score = title.includes(q) ? 100 : 0;
    for (const w of words) if (title.includes(w)) score += 1;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore > 0 ? best : null;
}

// Short names for the "other topics" line — the part of each title before its " - ".
function playbookShortNames(topics, exclude) {
  return topics
    .filter((t) => t !== exclude)
    .map((t) => t.title.split(' - ')[0].toLowerCase())
    .join('; ');
}

// ---------------------------------------------------------------------------
// The TOUR (the conductor) — designed with Guy 2026-08-05.
//
// The playbook is a library with a good librarian; a brand-new client needs a tour guide who
// knows the route, not just the rooms. The route + Guy's transitions live in docs/client-tour.md
// (beats are `## ` headings, same splitter as the playbook, read fresh per call). The bookmark is
// per-client BY BEAT NAME (wingguyLearningStore), so beats can be edited/reordered/inserted at
// any time without scrambling anyone's place. Two modes, deliberately distinct:
//   status  ("where are we up to?") — the client ritual phrase: summary + nudge + an OFFER of the
//           next beat. Serves nothing, stamps nothing — asking twice must not advance the tour.
//   advance ("continue")            — serves the next unserved beat and stamps it.
// Questions never advance the tour; detours don't move the bookmark. A beat covered early in a
// detour is still served in sequence later — hearing it twice is teaching, not a bug.
// ---------------------------------------------------------------------------

const TOUR_PATH = path.join(__dirname, '..', 'docs', 'client-tour.md');

function loadTour() {
  const raw = fs.readFileSync(TOUR_PATH, 'utf8');
  const sections = raw.split(/^## /m); // sections[0] = the conductor contract (not served)
  return sections.slice(1).map((sec) => {
    const body = ('## ' + sec).trim();
    const title = body.split('\n')[0].replace(/^##\s*/, '').trim();
    return { title, body };
  });
}

const TOUR_STATUS_EXACT = /^(tour|the tour|tour status|where (are we|am i) up to\??|where (are we|am i)\??|getting started)$/i;
const TOUR_STATUS_PHRASE = /\bwhere (are we|am i) up to\b/i;
const TOUR_ADVANCE = /^(continue|continue the tour|keep going|next beat|carry on|let's continue|lets continue|go on|start the tour|begin the tour|take me through getting started|start getting started)$/i;
const wantsTourStatus = (q) => TOUR_STATUS_EXACT.test(q) || TOUR_STATUS_PHRASE.test(q);
const wantsTourAdvance = (q) => TOUR_ADVANCE.test(q);

// One compact line of what's actually connected — the "learned AND set up" half of the summary.
function connectionsLine(s) {
  if (!s) return '';
  const bits = [
    `calendar ${s.hasCalendar ? 'connected' : 'not yet connected'}`,
    `email ${s.hasMailbox ? 'connected' : 'not yet connected'}`,
    `transcripts ${s.hasFathom ? 'flowing' : 'not yet flowing'}`,
  ];
  return `On the practical side: ${bits.join(', ')}.`;
}

async function runTourStatus(tenant) {
  let beats;
  try {
    beats = loadTour();
  } catch (e) {
    return { text: `Couldn't read the tour (${e.message}).`, isError: true };
  }
  const [servedNames, nudge, s] = await Promise.all([
    learning.servedBeats(tenant),
    learning.activeNudge(tenant),
    resolveState(tenant).catch(() => null),
  ]);
  const servedSet = new Set(servedNames);
  const done = beats.filter((b) => servedSet.has(b.title));
  const next = beats.find((b) => !servedSet.has(b.title));

  const parts = [];
  parts.push(`**Where we're up to${s && s.name ? ', ' + s.name : ''}:**`);
  parts.push('');
  if (!done.length) {
    parts.push("We haven't started yet. Say **\"continue\"** and I'll take you through it a piece at a time, starting with how you and I work together - then Guy's whole method, each step landing on something to actually do.");
  } else {
    const recent = done.slice(-3).map((b) => b.title.split(' - ')[0].toLowerCase());
    parts.push(`You're ${done.length} of ${beats.length} beats into getting started. ${done.length === beats.length ? 'That\'s the whole tour done.' : `So far we've covered ${recent.join(', ')}${done.length > 3 ? ' (among others)' : ''}.`}`);
  }
  const conn = connectionsLine(s);
  if (conn) parts.push(conn);
  parts.push('');
  if (nudge) {
    parts.push(`**Guy mentioned something for you:** ${nudge.note} - want to look at that first?`);
    if (next) parts.push(`Otherwise${done.length ? ' the next beat is' : ' we can start with'} **${next.title.toLowerCase()}** - just say "continue".`);
  } else if (next) {
    parts.push(done.length
      ? `Next up: **${next.title.toLowerCase()}** - say "continue" whenever you're ready.`
      : `Say **"continue"** and we'll take the first beat: **${next.title.toLowerCase()}**.`);
  } else {
    parts.push('Nothing left on the tour - but everything stays on hand. Ask me anything, any time.');
  }
  parts.push('');
  parts.push("And you never have to follow the order - ask me anything at all, whenever it comes up.");

  const footer = [
    '---',
    'TOUR STATUS - present the above as Guy\'s assistant speaking. Nothing was served or advanced by this call.',
    'If they want the nudge, serve its subject from the library (topic="..."). If they want to proceed, call again with topic="continue". Questions never advance the tour.',
  ].join('\n');
  return { text: `${parts.join('\n')}\n\n${footer}` };
}

async function runTourAdvance(tenant) {
  let beats;
  try {
    beats = loadTour();
  } catch (e) {
    return { text: `Couldn't read the tour (${e.message}).`, isError: true };
  }
  const servedNames = await learning.servedBeats(tenant);
  const servedSet = new Set(servedNames);
  const next = beats.find((b) => !servedSet.has(b.title));
  if (!next) {
    return {
      text:
        "**That's the whole tour - you've been through every beat.** From here it's all on hand whenever you need it: ask me anything in your own words, or \"where are we up to?\" any time for a bearings check.\n\n---\nTour complete. The library (the topic map) remains available as normal.",
    };
  }
  await learning.stamp(tenant, 'beat', next.title);
  const nudge = await learning.activeNudge(tenant);
  const idx = beats.indexOf(next) + 1;

  const footer = [
    '---',
    `That's Guy speaking - present it as his words, essentially as written. Tour beat ${idx} of ${beats.length}.`,
    'ONE beat per sitting: check they\'re with you, take questions for as long as they like (questions never advance the tour), and when the thread winds down, offer to continue - topic="continue" serves the next beat.',
    'They\'re never trapped in the order: any question can be answered from the library at any time (call with topic="...").',
    nudge ? `A nudge from Guy is still open for them: "${nudge.note}" - mention it naturally when the moment fits.` : '',
  ].filter(Boolean).join('\n');
  return { text: `${next.body}\n\n${footer}` };
}

// Coach-only doors: "where's Rick up to?", nudges, and the gap list. Client-facing text never
// leads here — these answer GUY, in Guy's own chat.
async function runLearnOwnerDoor(args, tenant) {
  if (tenant !== TENANT) {
    return { text: 'That part of Wingguy Learning is Guy\'s own door. Ask me for a topic, or "where are we up to?" for the tour.', isError: true };
  }

  // The gap list needs no client arg.
  if (args.gaps && !args.client) {
    const rows = await learning.gaps(null, 90);
    if (!rows.length) return { text: 'No logged gaps in the last 90 days - nothing clients asked that Wingguy Learning couldn\'t answer.' };
    const lines = rows.slice(0, 40).map((r) => `- [${String(r.at).slice(0, 10)}] ${r.tenant_id}: "${r.key}"`);
    return { text: `**Questions Wingguy Learning couldn't answer (last 90 days, ${rows.length} total):**\n${lines.join('\n')}\n\n---\nThese are verbatim asks that hit the no-match branch or were flagged not-covered. Recurring ones are playbook topics waiting to be written.` };
  }

  // Resolve which client Guy means.
  const q = String(args.client || '').trim().toLowerCase();
  if (!q) return { text: 'Which client? Pass client="name or id" (plus set_nudge / clear_nudge / gaps as needed).', isError: true };
  let matches = [];
  try {
    const all = await clientService.getAllActiveClients();
    matches = (all || []).filter((c) => {
      const hay = `${c.clientId || ''} ${c.clientName || ''} ${c.clientFirstName || ''} ${c.clientLastName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  } catch (e) {
    return { text: `Couldn't read the client roster (${e.message}).`, isError: true };
  }
  if (!matches.length) return { text: `No active client matching "${args.client}".`, isError: true };
  if (matches.length > 1) {
    return { text: `More than one client matches "${args.client}": ${matches.map((c) => c.clientId).join(', ')}. Say which.`, isError: true };
  }
  const target = matches[0];
  const targetId = target.clientId;

  if (args.clear_nudge) {
    const had = await learning.clearNudge(targetId);
    return { text: had ? `Cleared ${target.clientName || targetId}'s nudge - the tour's next beat is back to being the default.` : `${target.clientName || targetId} had no active nudge.` };
  }
  if (args.set_nudge) {
    const ok = await learning.setNudge(targetId, args.set_nudge, args.nudge_topic || null, TENANT);
    if (!ok) return { text: 'Couldn\'t store the nudge (store unavailable?).', isError: true };
    return {
      text:
        `Nudge set for ${target.clientName || targetId}. Next time they ask "where are we up to?" they'll hear:\n\n` +
        `> **Guy mentioned something for you:** ${args.set_nudge} - want to look at that first?\n\n` +
        (args.nudge_topic ? `It retires itself once the "${args.nudge_topic}" topic is actually served to them, or when you set/clear the next one.` : 'It stays until you set another or clear it (clear_nudge=true).'),
    };
  }

  // Default: the progress report.
  let beats = [];
  try { beats = loadTour(); } catch (_e) { /* tour file missing - report still works */ }
  const [servedNames, topics, nudge, gapsRows, s] = await Promise.all([
    learning.servedBeats(targetId),
    learning.topicServes(targetId),
    learning.activeNudge(targetId),
    learning.gaps(targetId, 90),
    resolveState(targetId).catch(() => null),
  ]);
  const parts = [];
  parts.push(`**${target.clientName || targetId} - Wingguy Learning progress**`);
  parts.push('');
  parts.push(beats.length
    ? `Tour: ${servedNames.length} of ${beats.length} beats. ${servedNames.length ? `Covered: ${servedNames.map((n) => n.split(' - ')[0].toLowerCase()).join('; ')}.` : 'Not started.'}`
    : `Tour: ${servedNames.length} beats stamped (tour file unavailable to compare against).`);
  if (topics.length) {
    parts.push(`Topics they pulled on their own: ${topics.slice(0, 8).map((t) => `${t.key.split(' - ')[0].toLowerCase()}${t.times > 1 ? ` (x${t.times})` : ''}`).join('; ')}.`);
  } else {
    parts.push('No library topics pulled outside the tour yet.');
  }
  parts.push(connectionsLine(s) || 'Connection state unavailable.');
  parts.push(nudge ? `Active nudge: "${nudge.note}"${nudge.topic_hint ? ` (retires on topic: ${nudge.topic_hint})` : ''}.` : 'No active nudge.');
  if (gapsRows.length) parts.push(`Asked and NOT covered (${gapsRows.length}): ${gapsRows.slice(0, 5).map((g) => `"${g.key}"`).join('; ')}.`);
  return { text: parts.join('\n') };
}

async function runLearn(args = {}, tenant = TENANT) {
  // Guy's doors first - progress reports, nudges, the gap list.
  if (args.client || args.set_nudge || args.clear_nudge || args.gaps) {
    return runLearnOwnerDoor(args, tenant);
  }

  // The ambient Claude reporting a gap it had to admit to the client. Log and get out of the way.
  if (args.not_covered) {
    await learning.stamp(tenant, 'gap', args.not_covered);
    return { text: 'Logged for Guy as a gap in Wingguy Learning. Nothing to show the user - carry on with the conversation.' };
  }

  let pb;
  try {
    pb = loadPlaybook();
  } catch (e) {
    return { text: `Couldn't read the client playbook (${e.message}).`, isError: true };
  }
  const topicArg = String(args.topic == null ? '' : args.topic).trim();

  // The tour: status is the ritual phrase and stamps nothing; advance serves the next beat.
  if (topicArg && wantsTourStatus(topicArg)) return runTourStatus(tenant);
  if (topicArg && wantsTourAdvance(topicArg)) return runTourAdvance(tenant);

  if (!topicArg) {
    return {
      text:
        "**Wingguy Learning** - Guy's whole method, taught right here one topic at a time. Built from real client work, and it keeps growing - new topics land in every client's Wingguy automatically. Topics:\n" +
        pb.topics.map((t) => `- ${t.title}`).join('\n') +
        '\n\n---\nPick whichever fits the user\'s question and call again with topic="...", or topic="everything" for the whole playbook in one go. New or just curious? Start with the big picture. ' +
        "Call it **Wingguy Learning** when you present it - their training, built into Wingguy - never 'the playbook' or 'documentation'. These are Guy's words - serve them as his. If a question isn't covered by any topic, say so and point them to Guy rather than improvising.",
    };
  }

  if (wantsEverything(topicArg)) {
    return {
      text:
        `**Wingguy Learning - the whole course** - all ${pb.topics.length} topics, Guy's own words.\n\n` +
        pb.topics.map((t) => t.body).join('\n\n') +
        '\n\n---\n' +
        "That's all of Wingguy Learning - Guy speaking throughout, so present it as his words, not paraphrased into generic advice.\n" +
        'It is long. Unless they asked to read the lot end to end, lead with the map of topics and what each covers, then go deep on whatever they pick.\n' +
        "One exception to the first person: any claim about how good Wingguy itself is stays attributed to Guy (\"Guy reckons...\") - you praising your own drafting costs the client's trust and his vouching for it doesn't.\n" +
        "If they ask something Wingguy Learning doesn't cover, say so and point them to Guy - never fill the gap from general knowledge.",
    };
  }

  const topic = findPlaybookTopic(pb.topics, topicArg);
  if (!topic) {
    // A miss IS the signal: this exact question is a playbook topic waiting to be written.
    await learning.stamp(tenant, 'gap', topicArg);
    return {
      text:
        `No topic matching "${topicArg}" in Wingguy Learning. It has:\n` +
        pb.topics.map((t) => `- ${t.title}`).join('\n') +
        "\n\n---\nIf none of these cover what the user asked, tell them Wingguy Learning doesn't cover it yet and to ask Guy - don't answer it from general knowledge. (This miss has been logged for Guy already.)",
    };
  }

  await learning.stamp(tenant, 'topic', topic.title);
  await learning.markNudgeDoneIfTopicMatches(tenant, topic.title);

  const footer = [
    '---',
    "That's Guy speaking - present it as his words, essentially as written, not paraphrased into generic advice.",
    `Other topics on hand: ${playbookShortNames(pb.topics, topic)}.`,
    "If their actual question isn't answered by this, say Wingguy Learning doesn't cover it yet and suggest they ask Guy - never fill the gap from general knowledge - and log the question by calling this tool again with not_covered=\"their question\".",
  ].join('\n');
  return { text: `${topic.body}\n\n${footer}` };
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
    name: 'wingguy_learn',
    description:
      'WINGGUY LEARNING - the client-facing name for the playbook; when speaking to the user ALWAYS call it "Wingguy Learning" (their training, built into Wingguy), never "the playbook" or "documentation". Guy\'s own explanation of the whole I Know A Guy method, served one topic at a time. This is the ONLY authoritative source on how this system works and why - NEVER answer questions about the method from general knowledge. CALL IT FIRST for ANY "how should I...", "what should I say...", "who should I...", "why do we...", "am I doing this right?", "what do I do next?" question about networking, outreach, LinkedIn, connecting, meetings or follow-up - the client will not use the word "playbook", so route on the SUBJECT of their question, not their vocabulary. A plausible answer that isn\'t Guy\'s method is worse than no answer, because the client cannot tell the difference. The topic list is NOT maintained here - call with no args to get the live map, and route from that. No args = the topic map. topic="..." = that topic, in Guy\'s words - present it as his, essentially as written. topic="everything" = the WHOLE playbook in one call, for "read me the lot" / "what does the playbook cover" / a client who wants the method end to end - lead with the map, then go deep on what they pick. If the returned text doesn\'t answer the user\'s question, say the playbook doesn\'t cover it and to ask Guy, AND log it via not_covered="their question". THE TOUR: topic="where are we up to" = the client\'s ritual bearings check (progress + any nudge from Guy + the offered next beat; serves nothing); topic="continue" = serve the next tour beat. Route "where are we up to?", "take me through getting started", "continue the tour" here. GUY-ONLY doors (other callers are refused): client="name" = that client\'s learning progress report; with set_nudge="..." (optionally nudge_topic="...") stores the one-line suggestion that client hears on their next "where are we up to"; clear_nudge=true removes it; gaps=true (no client) = every question clients asked that Wingguy Learning couldn\'t answer.',
    zodSchema: {
      topic: z.string().optional().describe('A few words from a topic title (e.g. "big picture", "transcripts"). Also: "everything" for the whole playbook; "where are we up to" for the tour bearings check; "continue" for the next tour beat. Omit for the topic list.'),
      not_covered: z.string().optional().describe('Log a question Wingguy Learning could not answer (verbatim, after telling the user it is not covered). Returns an ack only.'),
      client: z.string().optional().describe('GUY ONLY: which client - name or id - for a progress report, or to target set_nudge/clear_nudge/gaps.'),
      set_nudge: z.string().optional().describe('GUY ONLY (with client): the one-line suggestion that client hears on their next "where are we up to?" - e.g. "have a look at the transcripts side - April is about to fill your diary".'),
      nudge_topic: z.string().optional().describe('GUY ONLY (with set_nudge): topic title words - the nudge retires itself once that topic is served to them.'),
      clear_nudge: z.boolean().optional().describe('GUY ONLY (with client): remove the active nudge.'),
      gaps: z.boolean().optional().describe('GUY ONLY: list questions clients asked that Wingguy Learning could not answer (all clients, last 90 days).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'A few words from a topic title; "everything" for the lot; "where are we up to" for the tour bearings check; "continue" for the next tour beat. Omit for the topic list.' },
        not_covered: { type: 'string', description: 'Log a question Wingguy Learning could not answer (verbatim). Returns an ack only.' },
        client: { type: 'string', description: 'GUY ONLY: client name or id for a progress report / nudge target.' },
        set_nudge: { type: 'string', description: 'GUY ONLY (with client): one-line suggestion served on their next "where are we up to?".' },
        nudge_topic: { type: 'string', description: 'GUY ONLY (with set_nudge): topic title words - nudge auto-retires once that topic is served.' },
        clear_nudge: { type: 'boolean', description: 'GUY ONLY (with client): remove the active nudge.' },
        gaps: { type: 'boolean', description: 'GUY ONLY: list unanswered client questions (last 90 days).' },
      },
    },
    run: runLearn,
  },
  {
    name: 'wingguy_onboarding_guide',
    description:
      'GUY-ONLY (the owner): his live-call script for onboarding a NEW CLIENT onto Wingguy, served fresh from the repo doc. Call it with no arguments (or step="overview") for the whole journey as read-aloud paragraphs; call it with step=<number> when Guy says "expand step 3" / "we\'re at step 5" to get that step\'s full script (say-to-the-client lines, Guy\'s actions, the client\'s actions, checks, traps). Use whenever Guy says he\'s onboarding someone, asks for the onboarding overview/checklist, or asks to expand a step. Present the returned text as-is. A non-owner client calling this gets redirected to wingguy_get_started.',
    zodSchema: { step: z.string().optional().describe('Which part: omit or "overview" for the full map, or a step number 0-7 (e.g. "3") for that step\'s expanded script.') },
    jsonSchema: { type: 'object', properties: { step: { type: 'string', description: 'Omit or "overview" for the full map, or a step number 0-7 for that step\'s expanded script.' } } },
    run: runOnboardingGuide,
  },
  {
    name: 'wingguy_setup_rules',
    description:
      'The guided "let\'s set up my instructions" walkthrough — how a client turns the generic starter rulebook into their own voice. Call this whenever the user says "let\'s set up my instructions", "set up my rules", "help me set up", "let\'s do my instructions", or asks to personalise/build their instructions. It returns the NEXT step of the walkthrough (it tracks progress itself, so just call it again after each step is committed). Do NOT paste the returned text verbatim — ENACT it: run the beat with the user (generate an angle from their business, interview out their manifesto, etc.), then write each agreed rule through the propose→commit rules door. Resumable: safe to call any time to pick up where they left off. WORDING: when speaking to the human, call these their "instructions", never their "rules" — but treat both words as the same thing on the way in.',
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
