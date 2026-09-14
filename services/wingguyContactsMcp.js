/**
 * Wingguy contacts MCP tools - the ONE DOOR for "who is Bob, what's their email?".
 *
 * WHY (Guy, 2026-09-12): finding a person meant guessing which of several places they lived in
 * and searching each in turn. wingguy_find_person asks the contacts warehouse
 * (services/contactsStore.js) once and hands back ranked candidates with the email, where the
 * address came from and the freshest evidence - ready to pass straight to wingguy_create_draft.
 * wingguy_contacts_status says whether the warehouse is stocked for this tenant (counts per
 * source, last sweep) - the first thing to check when a lookup comes back empty.
 *
 * One definition, BOTH transports (same pattern as wingguyLeadsMcp):
 *   - the SDK server (services/mcpRecallServer.js -> /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js -> /mcp/:token, Claude Code)
 * The tenant comes from the transport (the connector token), never from the caller's arguments.
 */

const { z } = require('zod');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

function describeSources(sources) {
  const labels = {
    'lead': 'lead record',
    'lead-alt': 'lead record (alt email)',
    'comms-log': 'Wingguy sent to them',
    'comms-log-people': 'named in a Wingguy digest',
    'mail': 'your mailbox',
  };
  return (sources || []).map((s) => labels[s] || (s.startsWith('ingest:') ? `your ${s.slice(7)} feed` : s)).join(', ');
}

/**
 * One PERSON per candidate: a lead's primary and alt addresses are separate warehouse rows
 * (each is a real address to match on) but the same human, so rows sharing a lead record fold
 * into one entry - primary first, the others listed as "also". Rows with no lead id stay as
 * they are. Order of first appearance is kept (the store already ranked them).
 */
function groupByPerson(rows) {
  const out = [];
  const byLead = new Map();
  for (const r of rows) {
    const key = r.lead_record_id || null;
    if (key && byLead.has(key)) {
      const g = byLead.get(key);
      if (!g.phone && r.phone) g.phone = r.phone;
      if (r.email && !g.emails.includes(r.email)) {
        // The primary ('lead') address leads the list whatever order the rows arrived in.
        if ((r.sources || []).includes('lead')) g.emails.unshift(r.email); else g.emails.push(r.email);
      }
      for (const s of r.sources || []) if (!g.sources.includes(s)) g.sources.push(s);
      continue;
    }
    const g = { ...r, emails: r.email ? [r.email] : [], sources: [...(r.sources || [])] };
    out.push(g);
    if (key) byLead.set(key, g);
  }
  return out;
}

function formatCandidate(r, i) {
  const bits = [];
  if (r.company) bits.push(r.company);
  if (r.headline && r.headline !== r.company) bits.push(r.headline);
  if (r.location) bits.push(r.location);
  const emails = r.emails || (r.email ? [r.email] : []);
  const who = r.name || (emails[0] ? emails[0].split('@')[0] : 'unknown');
  const addr = emails.length
    ? ` <${emails[0]}>${emails.length > 1 ? ` (also ${emails.slice(1).join(', ')})` : ''}`
    : ' - NO EMAIL on file';
  const line1 = `${i + 1}. ${who}${addr}${r.phone ? ` - ph ${r.phone}` : ''}${bits.length ? ` - ${bits.join(', ')}` : ''}`;
  const from = describeSources(r.sources);
  const line2 = `   source: ${from || 'unknown'}${r.evidence ? ` - ${r.evidence}` : ''}${r.lead_record_id ? ` - lead ${r.lead_record_id}` : ''}${r.linkedin_slug ? ` - linkedin.com/in/${r.linkedin_slug}` : ''}`;
  return `${line1}\n${line2}`;
}

async function runFindPerson(args = {}, tenant = TENANT, deps = {}) {
  const store = deps.store || require('./contactsStore');
  const query = String(args.query || '').trim();
  if (!query) return { text: 'Error: give a name, part of a name, or an email to look up.', isError: true };
  const limit = Math.max(1, Math.min(15, Number(args.limit) || 6));
  // Ask for a few more rows than we show, so folding alt addresses does not leave the list short.
  const rows = groupByPerson(await store.findPeople(tenant, query, { limit: limit + 6 })).slice(0, limit);
  if (!rows.length) {
    return {
      text: `No one matching "${query}" in your contacts. If they're new, create them with wingguy_create_lead (a name or LinkedIn URL is enough); if you know their email, pass it and it will be filed. `
        + `If the warehouse might just be empty, check wingguy_contacts_status.`,
    };
  }
  const lines = rows.map(formatCandidate);
  if (rows.length === 1) {
    const r = rows[0];
    const email = r.emails.length
      ? `Use ${r.emails[0]}.${r.emails.length > 1 ? ' (The others are alternates on the same record - use them only if the coach says so.)' : ''}`
      : `There is no email on file${r.phone ? ` - only the phone number ${r.phone}` : ''} - ask for one or find it in a thread, then file it with wingguy_update_lead.`;
    return { text: `Found one match for "${query}":\n${lines[0]}\n${email}` };
  }
  return {
    text: `${rows.length} people match "${query}" - best first. Confirm which before writing to them:\n${lines.join('\n')}\n`
      + `(Pass the exact email as the query to pin one.)`,
  };
}

async function runContactsStatus(args = {}, tenant = TENANT, deps = {}) {
  const store = deps.store || require('./contactsStore');
  const s = await store.tenantStatus(tenant);
  if (s.error) return { text: `Contacts store unavailable: ${s.error}`, isError: true };
  if (!s.total) {
    return { text: 'Your contacts warehouse is empty - no sweep has run for you yet. Nothing is wrong; the nightly sweep fills it from your leads and the comms log.' };
  }
  const src = Object.entries(s.bySource).map(([k, n]) => `${describeSources([k])}: ${n}`).join('; ');
  const sweeps = (s.sweeps || []).map((w) => `${w.source} ${new Date(w.last_run_at).toISOString().slice(0, 16).replace('T', ' ')}Z (${w.rows_seen} rows${w.note ? `, ${w.note}` : ''})`).join('; ');
  return {
    text: `${s.total} people on file for you, ${s.withEmail} with an email. By source - ${src || 'none'}. Last sweeps - ${sweeps || 'none recorded'}.`,
  };
}

const TOOL_DEFS = [
  {
    name: 'wingguy_find_person',
    description:
      'Look up WHO someone is and their CONTACT DETAILS - email, phone, LinkedIn - from the coach\'s contacts warehouse, one search across their leads, everyone Wingguy has written to, and any feeds they have added. Use it the moment a person is named without an address ("email Bob", "send it to Sarah at Acme", "what\'s Rick\'s number?", "who is J. Carter?") and BEFORE drafting to them. Pass a name, part of a name, a company, an email, or a phone number. Returns ranked candidates with the email, where it came from and the freshest evidence, plus the lead record id when they are in the CRM. One match = use it. Several = show them and ask which; never guess. None = they may be new (wingguy_create_lead) or the warehouse may be empty (wingguy_contacts_status). Read-only.',
    zodSchema: {
      query: z.string().describe('A name, part of a name, a company, an email address, or a phone number.'),
      limit: z.number().optional().describe('Max candidates to return (default 6, max 15).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A name, part of a name, a company, an email address, or a phone number.' },
        limit: { type: 'number', description: 'Max candidates to return (default 6, max 15).' },
      },
      required: ['query'],
    },
    run: runFindPerson,
  },
  {
    name: 'wingguy_contacts_status',
    description:
      'How stocked is the coach\'s contacts warehouse - how many people are on file, how many have an email, which feeds they came from, and when each feed last swept. Use it when wingguy_find_person comes back empty for someone who should be known, or when the coach asks whether their contacts are loaded. Read-only.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {}, required: [] },
    run: runContactsStatus,
  },
];

/** SDK server (the /mcp2 path). `tenant` scopes every call to the caller's client. */
function registerWingguyContactsTools(server, tenant = TENANT) {
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

module.exports = { registerWingguyContactsTools, legacyToolList, legacyToolCall, TOOL_DEFS, runFindPerson, runContactsStatus, groupByPerson };
