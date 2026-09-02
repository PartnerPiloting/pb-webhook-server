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
    location: String(args.location || '').trim(),
    introducedBy: String(args.introduced_by || '').trim(),
    notes: String(args.notes || '').trim(),
  });

  if (!r || !r.ok) {
    return { text: `Error: ${(r && r.error) || 'the lead could not be created.'}`, isError: true };
  }

  const who = `${r.fields ? `${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim() : ''}`
    || r.name || [first, last].filter(Boolean).join(' ') || url || 'the lead';

  // PENDING-MEETING RESOLUTION: a meeting recorded BEFORE this person was a lead is parked with
  // their email on it (recall_meetings.pending_leads). Now that their record exists, attach every
  // meeting that was waiting — the moment of creation is exactly when the wait ends. Non-fatal:
  // a store hiccup must never fail the create itself.
  let attachedNote = '';
  const createdEmail = String((r.fields && r.fields['Email']) || args.email || '').trim().toLowerCase();
  if (createdEmail && r.leadRecordId) {
    try {
      const { resolvePendingLeadByEmail } = require('./recallWebhookDb');
      const pr = await resolvePendingLeadByEmail({ email: createdEmail, airtableLeadId: r.leadRecordId, coachClientId: tenant, source: 'lead-created' });
      if (pr.linked && pr.linked.length) {
        attachedNote = ` Also attached ${pr.linked.length} earlier meeting transcript(s) that were waiting on ${createdEmail} — ask about your meetings with them to see it.`;
      }
    } catch (e) {
      // swallow — pending linkage is a bonus, not part of the create contract
    }
  }

  // Already in the base: dedup hit — report it as a match, not a create (no duplicate was made).
  if (r.exists) {
    return { text: `Already in the CRM${r.name ? ` — ${r.name}` : ''} (record ${r.leadRecordId}). No duplicate created; use their existing record to book or update them.${attachedNote}` };
  }

  const bits = [];
  if (r.fields && r.fields['LinkedIn Profile URL']) bits.push(`LinkedIn ${r.fields['LinkedIn Profile URL']}`);
  if (r.fields && r.fields['Email']) bits.push(`email ${r.fields['Email']}`);
  if (r.fields && r.fields['Phone']) bits.push(`phone ${r.fields['Phone']}`);
  if (r.fields && r.fields['Location']) bits.push(`based in ${r.fields['Location']}`);
  const detail = bits.length ? ` (${bits.join(', ')})` : '';
  // No location = no lead timezone. Say so at birth, so the next step is "ask where they are", not
  // "offer times on a guessed clock" (the Paul mis-booking, 2026-09-02).
  const locNote = (r.fields && r.fields['Location'])
    ? ''
    : ' ⚠ NO LOCATION on file — their timezone is unknown, so do NOT offer meeting times yet: ask where they\'re based (or ask whoever introduced them), then save it with wingguy_update_lead.';
  return {
    text: `Created ${who} in the CRM${detail} — filed Connected and dated today, so they enter the pipeline. Record ${r.leadRecordId}.${attachedNote}${locNote} `
      + `Phone/email from LinkedIn aren't pulled from here (that's the browser extension's job) — file an email later if one surfaces.`,
  };
}

// Correct a lead's contact facts (Location / Email / Phone) on their EXISTING record — the update
// companion to runCreateLead (Guy, 2026-08-20, after Dean Hobin's blank location left the booking
// tools guessing his timezone). Finds the lead (LinkedIn slug strongest, then exact email, then
// name substring with disambiguation — same lookup family as wingguy_set_reconnect), then runs the
// shaped write in wingguyLeads.updateLeadFacts. Reports every change old → new so the assistant
// relays it and a wrong write is caught immediately.
async function runUpdateLead(args = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const wingguyLeads = require('./wingguyLeads');

  const lookupEmail = String(args.lead_email || '').trim().toLowerCase();
  const lookupName = String(args.lead_name || '').trim();
  const lookupUrl = String(args.linkedin_url || '').trim();
  if (!lookupEmail && !lookupName && !lookupUrl) {
    return { text: 'Error: give a linkedin_url (surest), lead_email or lead_name to find the lead.', isError: true };
  }
  const loc = String(args.location || '').trim();
  const mail = String(args.email || '').trim();
  const tel = String(args.phone || '').trim();
  if (!loc && !mail && !tel) {
    return { text: 'Error: nothing to update — pass a location, email and/or phone.', isError: true };
  }

  const client = await clientService.getClientById(tenant);
  const airtableBaseId = client && client.airtableBaseId;
  if (!airtableBaseId) {
    return { text: "Error: no CRM base is configured for this coach, so the lead can't be updated.", isError: true };
  }
  const base = clientService.getClientBase(airtableBaseId);
  if (!base) return { text: 'Error: CRM base unavailable.', isError: true };

  // Find the record. LinkedIn slug is the strongest key; email is exact; a name is a substring
  // match over the full name and must be UNIQUE — on multiple hits, hand back the list instead of
  // guessing (never correct the wrong person's record).
  let rec = null;
  if (lookupUrl) rec = await wingguyLeads.findLeadRecord(base, { linkedinUrl: lookupUrl });
  if (!rec && (lookupEmail || lookupName)) {
    const esc = (s) => String(s).replace(/"/g, '\\"');
    const formula = lookupEmail
      ? `LOWER({Email}) = "${esc(lookupEmail)}"`
      : `FIND(LOWER("${esc(lookupName)}"), LOWER({First Name} & " " & {Last Name})) > 0`;
    const matches = await base('Leads').select({
      filterByFormula: formula,
      fields: ['First Name', 'Last Name', 'Email'],
      maxRecords: 10,
    }).all();
    if (matches.length > 1) {
      const list = matches.slice(0, 8).map((r) => `- ${`${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim()}${r.fields['Email'] ? ` <${r.fields['Email']}>` : ''}`).join('\n');
      return { text: `More than one lead matches "${lookupName || lookupEmail}" — tell me which, or pass lead_email / linkedin_url:\n${list}` };
    }
    rec = matches[0] || null;
  }
  if (!rec) {
    const tried = lookupUrl ? `LinkedIn ${lookupUrl}` : (lookupEmail ? `email ${lookupEmail}` : `name "${lookupName}"`);
    return { text: `No lead found matching ${tried}. (Try another identifier — or if they're genuinely not in the CRM, create them with wingguy_create_lead.)`, isError: true };
  }

  const r = await wingguyLeads.updateLeadFacts(airtableBaseId, rec.id, { location: loc, email: mail, phone: tel });
  if (!r || !r.ok) return { text: `Error: ${(r && r.error) || 'the lead could not be updated.'}`, isError: true };

  const who = `${rec.fields['First Name'] || ''} ${rec.fields['Last Name'] || ''}`.trim() || rec.fields['Email'] || rec.id;
  if (!r.changed) return { text: `${who}'s record already has those exact values — nothing changed.` };
  const lines = r.changes.map((c) => `${c.field}: ${c.from ? `"${c.from}"` : '(was empty)'} → "${c.to}"`);
  return {
    text: `Updated ${who} — ${lines.join('; ')}.${r.notes.length ? ` (${r.notes.join('; ')})` : ''} `
      + `Tell the coach exactly what changed, old value included, so a wrong write is caught on the spot.`,
  };
}

// ---------------------------------------------------------------------------
// Tool definition (one shape, both transports)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_create_lead',
    description:
      'Create a NEW lead in the coach\'s CRM (Airtable) for someone who ISN\'T there yet — use it when a person the coach is dealing with has no CRM record: a new connection, OR a THIRD PERSON someone has just introduced the coach to in a thread (an intro on LinkedIn or a cc on an email). Create them BEFORE drafting any reply to them — every downstream step (timezone maths, invites, follow-ups, the dossier) hangs off the record. It files them the way inbound leads land: Connected, dated today, so they slot into the pipeline. Pass whatever you know — at MINIMUM a name or the LinkedIn URL; for an introduction ALSO pass introduced_by (who made the intro) and location if the thread or their profile shows where they\'re based. LOCATION MATTERS: without it their timezone is unknown and NO meeting times may be offered — if nobody has said where they are, ask the coach (or suggest asking the introducer) rather than guessing. Don\'t block on email: LinkedIn rarely shows one, so create the record now and file the email later. SAFE to call even if unsure they\'re new — it dedupes on the LinkedIn profile first (then first+last name), so it won\'t make a duplicate; it hands back the existing record instead. Note: unlike the browser extension, this does NOT auto-read their LinkedIn contact info, so only pass email/phone you already have.',
    zodSchema: {
      first_name: z.string().optional().describe('The lead\'s first name.'),
      last_name: z.string().optional().describe('The lead\'s last name.'),
      linkedin_url: z.string().optional().describe('The lead\'s LinkedIn profile URL (linkedin.com/in/...) — the strongest dedup key; include it whenever the profile is known.'),
      email: z.string().optional().describe('The lead\'s email, ONLY if you already have one (e.g. from a thread). Omit if you don\'t — don\'t guess.'),
      phone: z.string().optional().describe('The lead\'s phone, ONLY if you already have one. Omit otherwise.'),
      location: z.string().optional().describe('Where they\'re based, as specific as known (e.g. "Sydney, New South Wales") — drives the lead-timezone maths for meeting times. Only what the thread, their profile, or the coach actually stated; never a guess.'),
      introduced_by: z.string().optional().describe('For an introduction: the name of the person who introduced them (filed as the first line of Notes).'),
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
        location: { type: 'string', description: 'Where they\'re based, as specific as known (e.g. "Sydney, New South Wales") — drives the lead-timezone maths for meeting times. Only what the thread, their profile, or the coach actually stated; never a guess.' },
        introduced_by: { type: 'string', description: 'For an introduction: the name of the person who introduced them (filed as the first line of Notes).' },
        notes: { type: 'string', description: 'Optional short context for the record (e.g. how they came in).' },
      },
      required: [],
    },
    run: runCreateLead,
  },
  {
    name: 'wingguy_update_lead',
    description:
      'Correct a lead\'s CONTACT FACTS on their existing CRM record — location, email and/or phone — the moment a truer value surfaces ("I\'m based in Sydney", a better email given in a thread, a phone number from a call). Pass ONLY the fields you\'re correcting; each OVERWRITES the record, and the reply reports every change old → new — ALWAYS relay that to the coach so a wrong write is caught on the spot. Never write a guess: only values the lead or coach actually stated. Location matters more than it looks — it drives the lead-timezone maths when offering meeting times. Changing the email is safe: the old primary is automatically preserved under Alt Emails, so replies and invites from it still match. Fields can\'t be blanked from here. Find the lead by linkedin_url (surest), lead_email, or lead_name. This tool is ONLY for these three facts — dates and flags have their own tools (wingguy_set_reconnect, wingguy_cease_followups), and someone not in the CRM yet needs wingguy_create_lead.',
    zodSchema: {
      lead_name: z.string().optional().describe('The lead\'s name (or part of it) — must match exactly one person, or you\'ll get a list to disambiguate.'),
      lead_email: z.string().optional().describe('The lead\'s CURRENT email on record — exact match, the surest lookup after the LinkedIn URL.'),
      linkedin_url: z.string().optional().describe('The lead\'s LinkedIn profile URL (linkedin.com/in/...) — the strongest lookup key.'),
      location: z.string().optional().describe('Their corrected location, as specific as known (e.g. "Sydney, New South Wales" — city + state beats city alone for timezone maths).'),
      email: z.string().optional().describe('Their corrected email — becomes the primary; the old primary is kept under Alt Emails automatically.'),
      phone: z.string().optional().describe('Their corrected phone number.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_name: { type: 'string', description: 'The lead\'s name (or part of it) — must match exactly one person, or you\'ll get a list to disambiguate.' },
        lead_email: { type: 'string', description: 'The lead\'s CURRENT email on record — exact match, the surest lookup after the LinkedIn URL.' },
        linkedin_url: { type: 'string', description: 'The lead\'s LinkedIn profile URL (linkedin.com/in/...) — the strongest lookup key.' },
        location: { type: 'string', description: 'Their corrected location, as specific as known (e.g. "Sydney, New South Wales" — city + state beats city alone for timezone maths).' },
        email: { type: 'string', description: 'Their corrected email — becomes the primary; the old primary is kept under Alt Emails automatically.' },
        phone: { type: 'string', description: 'Their corrected phone number.' },
      },
      required: [],
    },
    run: runUpdateLead,
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

module.exports = { registerWingguyLeadsTools, legacyToolList, legacyToolCall, TOOL_DEFS, runCreateLead, runUpdateLead };
