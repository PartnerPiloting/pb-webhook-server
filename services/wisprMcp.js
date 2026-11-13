/**
 * wingguy_name_recording - the answer door for "who was this call with?" (13 Nov 2026).
 *
 * A Wispr recording that was on nobody's calendar reaches the store with no name on it
 * (services/wisprFeedService.js stores it unlinked and flags it). The transcript tools then ask the
 * client ONE question; this tool is where the answer goes: file the recording under the person
 * they name, or "skip it" so Wingguy never asks again. Nothing is ever filed on a guess.
 *
 * Only registered for tenants the Wispr feed is switched on for (WISPR_FEED_TENANTS) - everyone
 * else's Claude never sees it.
 *
 * One definition, BOTH transports (same pattern as captureControlMcp).
 */

const { z } = require('zod');
// NOTE: the feed service is required LAZILY inside the executor (it reaches clientService, whose
// Airtable config needs env vars that local test runs do not have).

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

async function runNameRecording(args = {}, tenant = TENANT) {
  const cfg = require('./wisprConfig');
  if (!cfg.feedEnabledFor(tenant)) return { text: 'Collecting Wispr recordings is not switched on for this account.', isError: true };
  const feed = require('./wisprFeedService');
  const r = await feed.nameRecording(tenant, {
    meetingId: args.meeting_id,
    leadEmail: args.lead_email,
    leadName: args.lead_name,
    skip: args.skip === true,
  });
  return { text: r.text, ...(r.ok ? {} : { isError: true }) };
}

const DESCRIPTION =
  'Put a name to a Wispr recording Wingguy could not identify - a call that was not on the calendar, so nobody knows who it was with. '
  + 'Use it when a transcript tool answers with "who was this call with?", or when the client says who an unnamed call was with. '
  + 'Call it with nothing to see which recordings are waiting (start time, length and a best guess). '
  + 'Call it with meeting_id and lead_name or lead_email to file that recording under that person - ask the client first; never file it on the guess. '
  + 'Call it with meeting_id and skip true when the client says "skip it" - the transcript is kept but Wingguy stops asking.';

const TOOL_DEFS = [
  {
    name: 'wingguy_name_recording',
    description: DESCRIPTION,
    zodSchema: {
      meeting_id: z.union([z.number(), z.string()]).optional().describe('The meeting number of the unnamed recording (#1234). Omit to list what is waiting.'),
      lead_name: z.string().optional().describe('The full name of the person the call was with, as the client said it.'),
      lead_email: z.string().optional().describe('That person\'s email, if known - more exact than a name.'),
      skip: z.boolean().optional().describe('true when the client says to skip it: keep the transcript, stop asking.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        meeting_id: { type: ['number', 'string'], description: 'The meeting number of the unnamed recording (#1234). Omit to list what is waiting.' },
        lead_name: { type: 'string', description: 'The full name of the person the call was with, as the client said it.' },
        lead_email: { type: 'string', description: 'That person\'s email, if known - more exact than a name.' },
        skip: { type: 'boolean', description: 'true when the client says to skip it: keep the transcript, stop asking.' },
      },
    },
    run: runNameRecording,
  },
];

/** SDK server (the /mcp2 path). Registered ONLY when the feed is switched on for this tenant. */
function registerWisprTools(server, tenant = TENANT) {
  if (!require('./wisprConfig').feedEnabledFor(tenant)) return;
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

/** Legacy endpoint (the /mcp path, which is always Guy): tools/list entries. */
function legacyToolList(tenant = TENANT) {
  if (!require('./wisprConfig').feedEnabledFor(tenant)) return [];
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

// Sentences clients are told to type (content/client-phrases.json) are stamped into the descriptions.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWisprTools, legacyToolList, legacyToolCall, TOOL_DEFS, runNameRecording };
