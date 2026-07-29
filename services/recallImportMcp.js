/**
 * Transcript-import MCP tool — the WRITE DOOR into the transcript store from chat.
 *
 * WHY: when the normal capture layer misses a call (Fathom didn't join, the meeting ran on the
 * other side's Zoom, etc.) the transcript often still exists somewhere — Zoom AI Companion,
 * Tactiq, a Teams copy — but until now the only way to file it was the portal's "Import
 * transcript" button on the Recall Review screen (Guy, 2026-07-29, on a Trish Gregory call that
 * Zoom recorded but Fathom missed). This exposes the SAME narrow write —
 * services/recallImportService.importTranscript — over the claude.ai connector, so "here's the
 * transcript from my Zoom call, file it" works from chat.
 *
 * It is a thin wrapper: normalisation, lead-link by email, single-speaker reconstruction and
 * summary generation all live in the service (shared with the portal button). Nothing here may
 * grow behaviour the portal path doesn't have — one import pipeline, two doors.
 *
 * One definition, BOTH transports (same pattern as wingguyLeadsMcp):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 *
 * ⚠ NAMING: "recall" = the source-agnostic transcript STORE, not the Recall.ai service.
 */

const { z } = require('zod');
// NOTE: recallImportService is required LAZILY inside the executor — it pulls in clientService,
// whose Airtable config crashes at module load when env vars are absent (local test runs), same
// reason as wingguyLeadsMcp / wingguyMailMcp.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// Run the shared import pipeline and phrase the outcome for the chat surface.
// Returns { text, isError } for the transport to wrap.
async function runImportTranscript(args = {}, tenant = TENANT) {
  const { importTranscript } = require('./recallImportService');

  const r = await importTranscript({
    title: String(args.title || '').trim(),
    source: String(args.source || 'other').trim(),
    transcriptText: String(args.transcript_text || ''),
    meetingStart: args.meeting_start ? String(args.meeting_start).trim() : undefined,
    durationSeconds: Number.isFinite(args.duration_minutes) ? Math.round(args.duration_minutes * 60) : undefined,
    leadEmail: String(args.lead_email || '').trim(),
    coachClientId: tenant,
  });

  if (!r.ok) {
    return { text: `Import failed: ${r.error}. Nothing was saved.`, isError: true };
  }

  const lines = [`Transcript filed in the store as meeting #${r.meetingId}.`];

  if (r.leadLinked) {
    lines.push(`Linked to lead ${r.linkedLeadName} — recall_latest_transcript will now find it under their email.`);
  } else if (r.leadWarning) {
    // Not linked = not retrievable per-lead. Say it loudly; a silent save here becomes
    // "the transcript vanished" the next time someone asks for this person's latest call.
    lines.push(`⚠ NOT linked to a lead: ${r.leadWarning} Link it on the Recall Review screen, or re-check the email and tell me to try again.`);
  } else {
    lines.push('⚠ No lead email was given, so the transcript is NOT linked to anyone — recall_latest_transcript cannot find it by person until it is linked on the Recall Review screen.');
  }

  if (r.reconstructionStatus === 'pending') {
    lines.push('The transcript came in without reliable speaker labels, so a speaker reconstruction is awaiting confirmation on the Recall Review screen — the summary will be generated once speakers are confirmed there.');
  } else if (r.summary) {
    lines.push('A meeting summary was generated and is available on the review screen.');
  }

  return { text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Tool definition (one shape, both transports)
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'recall_import_transcript',
    description:
      'File a transcript INTO the transcript store when the normal capture layer missed the call — e.g. the meeting ran on the other side\'s Zoom and only Zoom AI Companion / Tactiq / a manual copy has the text. Paste the FULL transcript text; it becomes a real store meeting (review queue, summary, lead linkage) identical to an auto-captured one. ALWAYS pass lead_email when the call was with a known lead — without it the transcript is saved but cannot be found per-person. Do NOT use this for calls Fathom recorded (those auto-file; check fathom_list_meetings — the "store:" field says if it landed). Do NOT retry after a success reply — that would file a duplicate meeting.',
    zodSchema: {
      title: z.string().describe('Meeting title, e.g. "Guy <> Trish Gregory intro call".'),
      transcript_text: z.string().describe('The full pasted transcript text, verbatim. "Name: text" lines are ideal; timestamps are fine and will be cleaned where recognised.'),
      lead_email: z.string().optional().describe('The lead\'s email (must match their Airtable record) — links the meeting to them so it is retrievable per-person. Strongly encouraged; omit only if the call was with no known lead.'),
      source: z.enum(['tactiq', 'fathom', 'other']).optional().describe('Where the text came from — picks the format normaliser. Use "tactiq" or "fathom" for pastes from those apps; anything else (Zoom AI Companion, Teams, manual notes) is "other" (the default).'),
      meeting_start: z.string().optional().describe('When the meeting happened, ISO 8601 (e.g. 2026-07-29T10:00:00+08:00). Defaults to now — set it for calls filed after the fact so the store timeline is right.'),
      duration_minutes: z.number().optional().describe('Meeting length in minutes, if known.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title, e.g. "Guy <> Trish Gregory intro call".' },
        transcript_text: { type: 'string', description: 'The full pasted transcript text, verbatim. "Name: text" lines are ideal; timestamps are fine and will be cleaned where recognised.' },
        lead_email: { type: 'string', description: 'The lead\'s email (must match their Airtable record) — links the meeting to them so it is retrievable per-person. Strongly encouraged; omit only if the call was with no known lead.' },
        source: { type: 'string', enum: ['tactiq', 'fathom', 'other'], description: 'Where the text came from — picks the format normaliser. Use "tactiq" or "fathom" for pastes from those apps; anything else (Zoom AI Companion, Teams, manual notes) is "other" (the default).' },
        meeting_start: { type: 'string', description: 'When the meeting happened, ISO 8601 (e.g. 2026-07-29T10:00:00+08:00). Defaults to now — set it for calls filed after the fact so the store timeline is right.' },
        duration_minutes: { type: 'number', description: 'Meeting length in minutes, if known.' },
      },
      required: ['title', 'transcript_text'],
    },
    run: runImportTranscript,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyLeadsMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register the import tool on an McpServer instance.
 *  `tenant` scopes the write to the caller's client (per-request; defaults to Guy). */
function registerRecallImportTools(server, tenant = TENANT) {
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

module.exports = { registerRecallImportTools, legacyToolList, legacyToolCall, TOOL_DEFS, runImportTranscript };
