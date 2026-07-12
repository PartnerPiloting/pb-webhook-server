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
  parts.push(`**${name ? name + ' - ' : ''}here's what a fully-connected Wingguy does for you, every day.**`);
  parts.push('');
  parts.push('**A lead accepts your connection** → I draft the thanks-for-connecting note in your voice, grounded in their actual profile. You glance, tweak, send.');
  parts.push('**They reply interested** → I read the thread, draft your response, and if they want to talk I offer real times from your calendar - your hours, your buffers, never a double-book.');
  parts.push('**They pick a time** → I book it, invite sent, your meeting link on it, reminders set.');
  parts.push('**After the call** → I pull the transcript and draft the follow-up email in your mailbox, links clean, ready to send.');
  parts.push('**All of it** runs on *your* rules - your targeting, your angles, your voice - not a generic template.');
  parts.push('');
  parts.push('**The result:** the whole follow-up engine that used to eat your mornings, handled. Guy runs his entire LinkedIn pipeline this way - 37 personalised messages to 20 people in the time it took him to do five. This is the part nobody else has: not a chatbot, but your calendar, inbox, CRM and LinkedIn wired into one assistant that works your way.');
  parts.push('');

  // "What we need to get you there" — warm, benefit-led, state-aware (Guy's framing 2026-07-13).
  // The setup asks are folded INTO the vision; rules are framed as the best part, not a chore.
  parts.push('**To get you there, there\'s just a little bit of setup - and honestly, the setup is where it gets good.**');

  const asks = [];
  if (!s || !s.hasCalendar) asks.push('**which calendar** you use - so I can offer your real free times and book straight into it');
  if (!s || !s.hasMailbox) asks.push('**which email client** you\'re on - so I can draft your follow-ups right in your own mailbox');
  if (!s || !s.hasFathom) asks.push('whether you use a meeting **note-taker** - you might already have one, but the one we plug into is **Fathom**, and the good news is Fathom transcripts are currently free');
  if (asks.length) {
    parts.push('');
    parts.push('A couple of quick things we\'ll need to know:');
    parts.push(asks.map((a) => `- ${a}`).join('\n'));
  }

  if (!s || !s.rulesSeeded) {
    parts.push('');
    parts.push('And I\'ll help you set up your **rules** - and this is the great part of the whole thing. You shape all your messages with rules, in plain English, just by telling me - no settings screens, no templates to wrestle. You\'ll find over time it just keeps getting better and better, and that\'s where you end up saving hours a day.');
  } else {
    parts.push('');
    parts.push('Your **rules** are already set up - and that\'s the engine of the whole thing. Keep shaping them as you go, in plain English, and I only get better at sounding like you.');
  }

  if (s && asks.length === 0 && s.rulesSeeded) {
    parts.push('');
    parts.push('**And the good news:** you\'re already fully connected - everything above is live for you right now. Just start using it.');
  }

  return { text: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_get_started',
    description:
      'The user\'s Wingguy starting point + status. Returns what is already working for THEM, what is still to connect (their blanks), and how to drive it - tailored to their own account set-up. Call this when the user says "get me started", "what can I do", "what can you do", "help", "am I set up", asks about setup/status, or seems new. Present the returned text to them directly.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {} },
    run: runGetStarted,
  },
  {
    name: 'wingguy_vision',
    description:
      'The full picture of what a fully-connected Wingguy does for the user, every day - the day-in-the-life vision - followed by the concrete steps they still need to get there (state-aware). Call this when the user asks "what will I be able to do?", "show me the full picture", "what\'s this like when it\'s all set up?", "what could this do for me?", or when selling them on completing setup. Present the returned text to them directly.',
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
