/**
 * Wingguy onboarding MCP tools — the state-aware in-connector experience.
 *
 * WHY (2026-07-12): onboarding + the "here's what Wingguy unlocks for you" pitch can only live
 * INSIDE the connector, because before it's connected the client's Claude is blank. Two tools:
 *   - wingguy_get_started : STATUS view — what's live for YOU now, your blanks, how to drive it.
 *   - wingguy_vision      : VISION view — the full day-in-the-life once it's all connected, then
 *                           the concrete "here's what we need to do to get you there" (state-aware).
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
