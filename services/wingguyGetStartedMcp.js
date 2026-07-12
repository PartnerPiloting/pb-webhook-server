/**
 * Wingguy "get started" MCP tool — the state-aware onboarding / status guide.
 *
 * WHY (2026-07-12): onboarding + the "here's what Wingguy unlocks for you" pitch can only live
 * INSIDE the connector, because before it's connected the client's Claude is blank. This tool
 * reads the CALLER's own provisioning state (their client record + how many rules they've set) and
 * returns a tailored guide: what's already live, what's still to connect (the BLANKS), and how to
 * drive it. Same door adapts to where each client is. Extends the "lead with the blanks" help idea.
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

async function runGetStarted(_args = {}, tenant = TENANT) {
  const coach = await clientService.getClientById(tenant);
  if (!coach) {
    return { text: "I couldn't find your Wingguy set-up yet. Check with the person who's onboarding you - your account may not be fully connected." };
  }
  const name = coach.clientFirstName || coach.clientName || '';

  // Provisioning state (each field is per-client on the master record).
  const hasMailbox = !!coach.nylasGrantId;
  const hasCalendar = !!coach.calendarProvider;
  const hasFathom = !!coach.fathomApiKey;
  const hasZoom = !!coach.bookingZoom;
  let clientRuleCount = 0;
  try {
    const rules = await store.getActiveRules({ tenantId: tenant, layer: 'client' });
    clientRuleCount = Array.isArray(rules) ? rules.length : 0;
  } catch (_e) {
    // store unavailable → treat the rulebook as unseeded rather than fail the whole guide
  }
  const rulesSeeded = clientRuleCount > 0;

  const live = [];
  const blanks = [];

  live.push('- I can see your leads in your own database.');
  live.push('- Ask me to **draft a message** for any lead - try: *"draft a thanks-for-connecting note for [lead name]"*.');
  live.push('- Ask **"show me my rules"** to see (and change) how I write for you.');

  if (rulesSeeded) {
    live.push(`- Your rulebook is set up (${clientRuleCount} of your own rules) - I draft in your voice.`);
  } else {
    blanks.push('- **Your rulebook is nearly empty** - right now I draft from generic craft, not *your* voice. Say **"let\'s set up my rules"** and we\'ll build them from your real business.');
  }

  if (hasMailbox) {
    live.push('- I can create **email drafts** in your own mailbox (links intact, ready for you to read and send).');
  } else {
    blanks.push('- **No mailbox connected yet** - once we link it, I\'ll write your follow-up emails as real drafts you just check and send.');
  }

  if (hasCalendar) {
    live.push('- I can check your calendar and **book meetings** with your booking rules applied.');
    if (!hasZoom) {
      blanks.push('- **No meeting link on file** - add your Zoom/Meet room so it goes on every invite you send.');
    }
  } else {
    blanks.push('- **No calendar connected yet** - once it\'s wired in, I\'ll book replies straight into your diary, with your hours, buffers and no-double-book rules enforced.');
  }

  if (hasFathom) {
    live.push('- I can pull your **meeting transcripts** when you ask.');
  } else {
    blanks.push('- **No meeting-notes source connected yet** - connect it and I\'ll fetch your call transcripts on request.');
  }

  const parts = [];
  parts.push(`**Welcome${name ? ', ' + name : ''} - here's where Wingguy stands for you.**`);
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
  parts.push('Just tell me what you\'d like to do, or say **"let\'s set up my rules"** to make my drafting sound like you.');

  return { text: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// Definition — one source of truth for name/description/schema
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
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyRulesMcp / wingguyBookingMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register the get-started tool on an McpServer instance.
 *  `tenant` scopes the guide to the caller's client (per-request; defaults to Guy). */
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
