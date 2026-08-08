/**
 * Capture-control MCP tools — the client's hands on their own transcript store.
 *
 * The client-facing half of the capture policy layer (services/capturePolicyStore.js), promised
 * to Ashley Knowles 2026-08-04: see what is held in the capture window, veto it or take it now,
 * and a delete that ACTUALLY deletes — including the one-action purge of everything.
 *
 * Every executor is tenant-scoped by the connector token (the same per-request tenant every
 * other wingguy_ tool gets). Deletes and vetoes tombstone the provider recording id, so a
 * Granola retry/regenerate or the Fathom poll can never quietly re-file what the client
 * removed — that guarantee is the whole point.
 *
 * One definition, BOTH transports (same pattern as recallImportMcp):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 */

const { z } = require('zod');
// NOTE: store modules are required LAZILY inside executors — clientService's Airtable config
// crashes at module load when env vars are absent (local test runs), same as the other modules.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

const PURGE_PHRASE = 'delete all my recordings';

function fmtWhen(ts) {
  if (!ts) return 'date unknown';
  try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; } catch (_e) { return String(ts); }
}

function minutesUntil(ts) {
  const ms = new Date(ts).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 60000));
}

// ── Executors ───────────────────────────────────────────────────────────────────────────────

/** The one list: what's waiting in the capture window + what's already stored. */
async function runRecordingsList(args = {}, tenant = TENANT) {
  const { listHeldCaptures } = require('./capturePolicyStore');
  const { listMeetingsForCoach } = require('./recallWebhookDb');
  const limit = Number(args.limit) > 0 ? Math.min(Math.round(Number(args.limit)), 100) : 25;

  const [held, stored] = await Promise.all([
    listHeldCaptures(tenant, { limit: 50 }).catch(() => []),
    listMeetingsForCoach(tenant, { limit }),
  ]);

  const lines = [];
  if (held.length) {
    lines.push(`WAITING IN THE CAPTURE WINDOW (${held.length}) - the words have NOT been fetched yet:`);
    for (const h of held) {
      let who = '';
      try {
        const m = JSON.parse(h.matched_leads || '[]');
        if (m.length) who = ` with ${m.map((x) => x.name || x.email).join(', ')}`;
      } catch (_e) { /* leave blank */ }
      lines.push(`  - hold #${h.id}: "${h.title || 'untitled'}"${who} - releases in ~${minutesUntil(h.release_at)} min (${fmtWhen(h.release_at)})${h.last_error ? ` [last attempt failed: ${h.last_error}]` : ''}`);
    }
    lines.push(`  To stop one being taken: veto it by hold number. To take one now: release it by hold number.`);
    lines.push('');
  }
  if (stored.length) {
    lines.push(`STORED MEETINGS (newest ${stored.length}):`);
    for (const m of stored) {
      lines.push(`  - meeting #${m.id}: "${m.title || 'untitled'}" - ${fmtWhen(m.meeting_start || m.created_at)}${m.duration_seconds ? `, ${Math.round(m.duration_seconds / 60)} min` : ''}${m.lead_count ? `, linked to ${m.lead_count} lead(s)` : ''} [${m.source || 'unknown source'}]`);
    }
    lines.push(`  Any of these can be deleted by meeting number - that removes the transcript, its summary and its lead links from the store permanently.`);
  } else {
    lines.push('No stored meetings for this account.');
  }
  if (!held.length && !stored.length) return { text: 'Nothing held and nothing stored for this account.' };
  return { text: lines.join('\n') };
}

/** Veto a held capture: never fetched, and the tombstone makes that permanent. */
async function runRecordingVeto(args = {}, tenant = TENANT) {
  const { vetoHeldCapture } = require('./capturePolicyStore');
  const r = await vetoHeldCapture({ id: args.hold_id, coachClientId: tenant });
  if (!r.ok) return { text: `Couldn't veto: ${r.error}`, isError: true };
  return { text: `Done - "${r.title || 'that capture'}" will NOT be taken. Its words were never fetched, and it's now on the never-again list, so a provider retry can't bring it back.` };
}

/** Release a held capture right now, then run a sweep pass so it files within seconds. */
async function runRecordingRelease(args = {}, tenant = TENANT) {
  const { releaseHeldCaptureNow } = require('./capturePolicyStore');
  const r = await releaseHeldCaptureNow({ id: args.hold_id, coachClientId: tenant });
  if (!r.ok) return { text: `Couldn't release: ${r.error}`, isError: true };
  let filed = null;
  try {
    const { releaseDueCaptures } = require('./captureReleaseSweep');
    filed = await releaseDueCaptures();
  } catch (_e) { /* the scheduled sweep will pick it up within minutes */ }
  const note = filed && filed.released > 0
    ? 'It has been fetched and filed - ask about the meeting in a moment.'
    : 'It will be fetched and filed within the next few minutes.';
  return { text: `Released "${r.title || 'the capture'}" from the holding window. ${note}` };
}

/** Delete one stored meeting - transcript, summary, lead links - and tombstone it. */
async function runRecordingDelete(args = {}, tenant = TENANT) {
  const { deleteMeetingForCoach } = require('./recallWebhookDb');
  const { addTombstone } = require('./capturePolicyStore');
  const r = await deleteMeetingForCoach(args.meeting_id, tenant);
  if (!r.ok) return { text: `Couldn't delete: ${r.error}`, isError: true };
  const d = r.deleted;
  const providerId = d.provider_recording_id || d.fathom_recording_id;
  let tomb = '';
  if (d.source && providerId) {
    const t = await addTombstone({ source: d.source, providerRecordingId: providerId, coachClientId: tenant, reason: 'deleted' });
    tomb = t.ok
      ? " It's also on the never-again list, so the capture system can't re-file it."
      : ` ⚠ BUT the never-again marker failed to save (${t.error}) - the capture system could re-file this meeting from the provider. Tell Guy.`;
  }
  return { text: `Deleted meeting #${d.id} ("${d.title || 'untitled'}") - transcript, summary and lead links are gone from the store.${tomb}` };
}

/** The one-action purge: everything, immediately, tombstoned. */
async function runRecordingsPurge(args = {}, tenant = TENANT) {
  if (String(args.confirm || '').trim().toLowerCase() !== PURGE_PHRASE) {
    return {
      text: `Not run. This permanently deletes EVERY stored meeting for this account - every transcript, summary and lead link - and cannot be undone. If the user really wants that, ask them to confirm, then call again with confirm set to exactly: "${PURGE_PHRASE}"`,
      isError: true,
    };
  }
  const { purgeMeetingsForCoach } = require('./recallWebhookDb');
  const { addTombstone, listHeldCaptures, vetoHeldCapture } = require('./capturePolicyStore');

  // Vetoing the held queue first: a purge means "nothing of mine", including what's pending.
  let vetoed = 0;
  try {
    const held = await listHeldCaptures(tenant, { limit: 100 });
    for (const h of held) {
      const v = await vetoHeldCapture({ id: h.id, coachClientId: tenant, reason: 'purged' });
      if (v.ok) vetoed++;
    }
  } catch (_e) { /* held queue may be empty/unavailable; the meeting purge still runs */ }

  const r = await purgeMeetingsForCoach(tenant);
  if (!r.ok) return { text: `Purge failed: ${r.error}. Nothing further was deleted.`, isError: true };

  let tombOk = 0;
  let tombFail = 0;
  for (const row of r.rows || []) {
    const providerId = row.provider_recording_id || row.fathom_recording_id;
    if (!row.source || !providerId) continue;
    const t = await addTombstone({ source: row.source, providerRecordingId: providerId, coachClientId: tenant, reason: 'purged' });
    if (t.ok) tombOk++; else tombFail++;
  }
  const tombNote = tombFail
    ? ` ⚠ ${tombFail} never-again marker(s) failed to save - those meetings could be re-filed from the provider. Tell Guy.`
    : ' Every one is on the never-again list, so nothing can be quietly re-filed.';
  return { text: `Purged ${r.deleted} stored meeting(s)${vetoed ? ` and vetoed ${vetoed} held capture(s)` : ''} for this account.${tombNote}` };
}

// ── Tool definitions ────────────────────────────────────────────────────────────────────────

const TOOL_DEFS = [
  {
    name: 'wingguy_recordings',
    description:
      'List this client\'s meeting recordings held by Wingguy: anything WAITING in the capture holding window (metadata only - the words have not been fetched yet), and the stored meetings in the transcript store. Use when the client asks what recordings/transcripts Wingguy holds, what is queued for capture, or before deleting/vetoing something. Read-only.',
    zodSchema: {
      limit: z.number().optional().describe('How many stored meetings to list (default 25, max 100).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many stored meetings to list (default 25, max 100).' },
      },
    },
    run: runRecordingsList,
  },
  {
    name: 'wingguy_recording_veto',
    description:
      'Veto a capture that is WAITING in the holding window (get the hold number from wingguy_recordings): its transcript is never fetched, nothing is stored, and the veto is permanent - a provider retry cannot bring it back. Use when the client says "don\'t take that one".',
    zodSchema: {
      hold_id: z.number().describe('The hold number from wingguy_recordings.'),
    },
    jsonSchema: {
      type: 'object',
      properties: { hold_id: { type: 'number', description: 'The hold number from wingguy_recordings.' } },
      required: ['hold_id'],
    },
    run: runRecordingVeto,
  },
  {
    name: 'wingguy_recording_release',
    description:
      'Release a capture from the holding window RIGHT NOW instead of waiting out the client\'s hold period (get the hold number from wingguy_recordings). Use when the client says "take that one now" - typically because they want the follow-up email drafted straight after the call.',
    zodSchema: {
      hold_id: z.number().describe('The hold number from wingguy_recordings.'),
    },
    jsonSchema: {
      type: 'object',
      properties: { hold_id: { type: 'number', description: 'The hold number from wingguy_recordings.' } },
      required: ['hold_id'],
    },
    run: runRecordingRelease,
  },
  {
    name: 'wingguy_recording_delete',
    description:
      'Permanently delete ONE stored meeting from the transcript store - transcript, summary and lead links (get the meeting number from wingguy_recordings). Also puts it on the never-again list so the capture system cannot re-file it. This is destructive and cannot be undone: confirm the specific meeting with the client before calling.',
    zodSchema: {
      meeting_id: z.number().describe('The meeting number from wingguy_recordings.'),
    },
    jsonSchema: {
      type: 'object',
      properties: { meeting_id: { type: 'number', description: 'The meeting number from wingguy_recordings.' } },
      required: ['meeting_id'],
    },
    run: runRecordingDelete,
  },
  {
    name: 'wingguy_recordings_purge',
    description:
      'The nuclear option: permanently delete EVERY stored meeting for this client and veto everything in the holding window, immediately. Cannot be undone. Only for an explicit "delete everything you hold of mine" request - confirm with the client first, then pass their confirmation phrase.',
    zodSchema: {
      confirm: z.string().describe(`Must be exactly "${PURGE_PHRASE}" - only after the client has explicitly confirmed.`),
    },
    jsonSchema: {
      type: 'object',
      properties: { confirm: { type: 'string', description: `Must be exactly "${PURGE_PHRASE}" - only after the client has explicitly confirmed.` } },
      required: ['confirm'],
    },
    run: runRecordingsPurge,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as recallImportMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path). `tenant` scopes every call to the connector's client. */
function registerCaptureControlTools(server, tenant = TENANT) {
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

module.exports = { registerCaptureControlTools, legacyToolList, legacyToolCall, TOOL_DEFS };
