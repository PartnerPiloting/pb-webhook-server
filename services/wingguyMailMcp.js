/**
 * Wingguy mail MCP tools — the CLEAN-LINK DRAFT DOOR.
 *
 * WHY: composing a Gmail draft through Google's hosted Gmail MCP connector rewrites every hyperlink
 * into a `google.com/url?q=...` redirect at compose time (baked into the stored message), so the
 * coach has to hand-fix every link and recipients hit a "you are leaving Google" interstitial.
 * Creating the draft through the coach's own Nylas grant writes the HTML straight to the provider's
 * API (Gmail/Outlook), which does NOT rewrite links — so hyperlinks land exactly as written.
 *
 * Multi-tenant by construction: the draft is created in the coach's OWN mailbox via their Nylas grant
 * (services/mailProvider.js), the same per-tenant model calendarProvider/wingguyCalendar use. Step-1
 * auth posture: tenant hard-wired to the coach client behind the existing connector token (matches
 * wingguyBookingMcp).
 *
 * One definition, BOTH transports (same pattern as wingguyBookingMcp / wingguyRulesMcp):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 */

const { z } = require('zod');
const mailProvider = require('./mailProvider');
// NOTE: clientService is required LAZILY inside the executor — its Airtable config crashes at module
// load when env vars are absent (local test runs), same reason as wingguyBookingMcp.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// ---------------------------------------------------------------------------
// Executor — returns { text, isError? }
// ---------------------------------------------------------------------------

async function runCreateDraft({ to, subject, html_body, cc, bcc, reply_to } = {}, tenant = TENANT) {
  const recipients = mailProvider.toParticipants(to);
  if (!recipients.length) return { text: 'Error: at least one "to" recipient ({email, name}) is required.', isError: true };
  if (!String(subject || '').trim()) return { text: 'Error: subject is required.', isError: true };
  if (!String(html_body || '').trim()) return { text: 'Error: html_body is required (the draft body, as HTML).', isError: true };

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) before drafting.`, isError: true };
  }

  const result = await mailProvider.createDraft(coach, {
    subject: String(subject).trim(),
    html: html_body,
    to: recipients,
    cc,
    bcc,
    replyTo: reply_to,
  });
  if (!result.ok) return { text: `Draft NOT created. ${result.error}`, isError: true };

  const toStr = recipients.map((r) => r.email).join(', ');
  const bccStr = mailProvider.toParticipants(bcc).map((r) => r.email).join(', ');
  return {
    text:
      `Draft created in ${coach.clientName || tenant}'s mailbox (Nylas). draftId=${result.draftId}\n` +
      `To: ${toStr}${bccStr ? ` · Bcc: ${bccStr}` : ''} · Subject: ${String(subject).trim()}\n` +
      `Hyperlinks are stored verbatim (no google.com/url wrapping) — open the draft, give it a final read, and send. No manual link-fixing needed.`,
  };
}

// ---------------------------------------------------------------------------
// Definition — one source of truth for name/description/schema
// ---------------------------------------------------------------------------

const RECIP_DESC = 'Recipients as objects {email, name}. name is optional but preferred (shows in the To line).';

const TOOL_DEFS = [
  {
    name: 'wingguy_create_draft',
    description:
      'Create an email DRAFT (never sends) in the coach\'s own mailbox with hyperlinks intact. ALWAYS use this instead of the Gmail connector when a draft contains links (LinkedIn profiles, mailto:, etc.) — the Gmail connector rewrites every link into a google.com/url redirect, this does not. html_body is the full HTML body; put real <a href="...">text</a> links in and they are stored exactly as written. Returns a draftId; the coach opens the draft, reads it, and sends it themselves.',
    zodSchema: {
      to: z.array(z.object({ email: z.string(), name: z.string().optional() })).describe(RECIP_DESC),
      subject: z.string().describe('The email subject line.'),
      html_body: z.string().describe('The full email body as HTML. Use real <a href="…">…</a> anchors for links — they land clean (no redirect wrapping).'),
      cc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Cc recipients {email, name}.'),
      bcc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Bcc recipients {email, name} — e.g. the tracking address.'),
      reply_to: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Reply-To {email, name}.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', description: RECIP_DESC, items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        subject: { type: 'string', description: 'The email subject line.' },
        html_body: { type: 'string', description: 'The full email body as HTML. Use real <a href="…">…</a> anchors for links — they land clean (no redirect wrapping).' },
        cc: { type: 'array', description: 'Optional Cc recipients {email, name}.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        bcc: { type: 'array', description: 'Optional Bcc recipients {email, name} — e.g. the tracking address.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        reply_to: { type: 'array', description: 'Optional Reply-To {email, name}.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
      },
      required: ['to', 'subject', 'html_body'],
    },
    run: runCreateDraft,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyBookingMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register all mail tools on an McpServer instance.
 *  `tenant` scopes the draft to the caller's client (per-request; defaults to Guy). */
function registerWingguyMailTools(server, tenant = TENANT) {
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

module.exports = { registerWingguyMailTools, legacyToolList, legacyToolCall, TOOL_DEFS };
