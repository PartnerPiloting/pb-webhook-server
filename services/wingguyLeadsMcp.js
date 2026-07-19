/**
 * Wingguy leads MCP tool — the CRM CREATE DOOR for the claude.ai connector.
 *
 * WHY: the chat agent (services/wingguyChat.js) already has a `create_lead` tool for the "I just
 * accepted a connection who isn't in my CRM yet" moment, but the claude.ai Wingguy connector never
 * got the matching tool — so when the connector says "this person isn't in the CRM" there was no way
 * to save them from there (Guy, 2026-07-20, on a lead the connector couldn't file). This exposes the
 * SAME narrow write — services/wingguyLeads.createLead — over the connector.
 *
 * Deliberately SHAPED, not free-form: it writes only the intake fields and dedups FIRST (LinkedIn slug,
 * then first+last name), so a person already in the base is handed back rather than duplicated, and a
 * fresh create lands the way live inflow does (Connected, Date Connected stamped) — slotting into the
 * pipeline instead of becoming an orphan the scoring/FUP logic never sees. Contact-info enrichment
 * (phone/email from LinkedIn) is the browser extension's job and does NOT happen here — the connector
 * has no LinkedIn tab to read — so email/phone are filed only if the caller already has them.
 *
 * One definition, BOTH transports (same pattern as wingguyMailMcp / wingguyBookingMcp / wingguyRulesMcp):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 */

const { z } = require('zod');
// NOTE: clientService + wingguyLeads are required LAZILY inside the executor — clientService's Airtable
// config crashes at module load when env vars are absent (local test runs), same reason as wingguyMailMcp.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// Resolve the caller's CRM (Airtable Leads) base from their clientId, then run the shaped create.
// Returns { text, isError } for the transport to wrap.
async function runCreateLead(args = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const wingguyLeads = require('./wingguyLeads');

  const first = String(args.first_name || '').trim();
  const last = String(args.last_name || '').trim();
  const url = String(args.linkedin_url || '').trim();
  if (!first && !last && !url) {
    return { text: 'Error: give at least a name or a LinkedIn URL to create a lead.', isError: true };
  }

  const client = await clientService.getClientById(tenant);
  const airtableBaseId = client && client.airtableBaseId;
  if (!airtableBaseId) {
    return { text: "Error: no CRM base is configured for this coach, so a lead can't be created.", isError: true };
  }

  const r = await wingguyLeads.createLead(airtableBaseId, {
    firstName: first,
    lastName: last,
    linkedinUrl: url,
    email: String(args.email || '').trim(),
    phone: String(args.phone || '').trim(),
    notes: String(args.notes || '').trim(),
  });

  if (!r || !r.ok) {
    return { text: `Error: ${(r && r.error) || 'the lead could not be created.'}`, isError: true };
  }

  const who = `${r.fields ? `${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim() : ''}`
    || r.name || [first, last].filter(Boolean).join(' ') || url || 'the lead';

  // Already in the base: dedup hit — report it as a match, not a create (no duplicate was made).
  if (r.exists) {
    return { text: `Already in the CRM${r.name ? ` — ${r.name}` : ''} (record ${r.leadRecordId}). No duplicate created; use their existing record to book or update them.` };
  }

  const bits = [];
  if (r.fields && r.fields['LinkedIn Profile URL']) bits.push(`LinkedIn ${r.fields['LinkedIn Profile URL']}`);
  if (r.fields && r.fields['Email']) bits.push(`email ${r.fields['Email']}`);
  if (r.fields && r.fields['Phone']) bits.push(`phone ${r.fields['Phone']}`);
  const detail = bits.length ? ` (${bits.join(', ')})` : '';
  return {
    text: `Created ${who} in the CRM${detail} — filed Connected and dated today, so they enter the pipeline. Record ${r.leadRecordId}. `
      + `Phone/email from LinkedIn aren't pulled from here (that's the browser extension's job) — file an email later if one surfaces.`,
  };
}

// ---------------------------------------------------------------------------
// Tool definition (one shape, both transports)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_create_lead',
    description:
      'Create a NEW lead in the coach\'s CRM (Airtable) for someone who ISN\'T there yet — use it when a person the coach is dealing with has no CRM record (e.g. a new connection). It files them the way inbound leads land: Connected, dated today, so they slot into the pipeline. Pass whatever you know — at MINIMUM a name or the LinkedIn URL. Don\'t block on email: LinkedIn rarely shows one, so create the record now and file the email later. SAFE to call even if unsure they\'re new — it dedupes on the LinkedIn profile first (then first+last name), so it won\'t make a duplicate; it hands back the existing record instead. Note: unlike the browser extension, this does NOT auto-read their LinkedIn contact info, so only pass email/phone you already have.',
    zodSchema: {
      first_name: z.string().optional().describe('The lead\'s first name.'),
      last_name: z.string().optional().describe('The lead\'s last name.'),
      linkedin_url: z.string().optional().describe('The lead\'s LinkedIn profile URL (linkedin.com/in/...) — the strongest dedup key; include it whenever the profile is known.'),
      email: z.string().optional().describe('The lead\'s email, ONLY if you already have one (e.g. from a thread). Omit if you don\'t — don\'t guess.'),
      phone: z.string().optional().describe('The lead\'s phone, ONLY if you already have one. Omit otherwise.'),
      notes: z.string().optional().describe('Optional short context for the record (e.g. how they came in).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'The lead\'s first name.' },
        last_name: { type: 'string', description: 'The lead\'s last name.' },
        linkedin_url: { type: 'string', description: 'The lead\'s LinkedIn profile URL (linkedin.com/in/...) — the strongest dedup key; include it whenever the profile is known.' },
        email: { type: 'string', description: 'The lead\'s email, ONLY if you already have one (e.g. from a thread). Omit if you don\'t — don\'t guess.' },
        phone: { type: 'string', description: 'The lead\'s phone, ONLY if you already have one. Omit otherwise.' },
        notes: { type: 'string', description: 'Optional short context for the record (e.g. how they came in).' },
      },
      required: [],
    },
    run: runCreateLead,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyMailMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register the leads tools on an McpServer instance.
 *  `tenant` scopes the create to the caller's client (per-request; defaults to Guy). */
function registerWingguyLeadsTools(server, tenant = TENANT) {
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

module.exports = { registerWingguyLeadsTools, legacyToolList, legacyToolCall, TOOL_DEFS, runCreateLead };
