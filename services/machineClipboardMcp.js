/**
 * "Put this on my Linked Helper machine's clipboard" - the tool end of services/machineClipboardStore.js.
 *
 * The problem it solves, in the client's words (Rick Wong, 17 Sep 2026): "You've got to fix that
 * ability to cut and paste." You can copy a LinkedIn search URL on your own laptop and then find
 * there is no way to get it into Linked Helper on the machine, because the remote desktop
 * connection bridges onto one always-on screen rather than opening a session of its own, and the
 * clipboard only travels on a session of its own. Nothing is misconfigured and no setting fixes it.
 *
 * So instead of carrying the clipboard across the connection, the text is left on the server and
 * the machine's own agent collects it and puts it on its clipboard. The person looking at the
 * screen presses Ctrl+V. Nothing is installed on anybody's laptop.
 *
 * TWO CALLERS, ONE TOOL:
 *   - a CLIENT sends to their own machine (no argument needed - it is their machine)
 *   - a COACH sends to one of THEIR clients' machines, by passing that client
 * The coach gate is the same one wingguy_get_client uses: only clients whose Coach is the caller
 * are reachable, so there is no path from one tenant to another tenant's screen. That matters
 * more than usual here - the LH webhook crossed tenants once already, and a clipboard carries
 * passwords.
 *
 * One definition, BOTH transports (same pattern as captureControlMcp):
 *   - the SDK server (services/mcpRecallServer.js -> /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js -> /mcp/:token, Claude Code)
 */

const { z } = require('zod');
// NOTE: store modules are required LAZILY inside executors - clientService's Airtable config
// crashes at module load when env vars are absent (local test runs), same as the other modules.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

/**
 * Work out whose machine this is going to. No `client` means the caller's own. A `client` means
 * the caller is a coach reaching one of their own - anyone else is invisible.
 * Returns { clientId, clientName } or { error }.
 */
async function resolveTarget(query, tenant) {
  const clientService = require('./clientService');
  const q = String(query || '').trim();

  if (!q) {
    let me = null;
    try { me = await clientService.getClientById(tenant); } catch (_e) { /* handled below */ }
    if (!me) return { error: `Couldn't find your own record ("${tenant}").` };
    return { clientId: me.clientId, clientName: me.clientName || me.clientId, own: true };
  }

  let all;
  try {
    all = await clientService.getAllClients();
  } catch (e) {
    return { error: `Couldn't read the client directory: ${e.message}` };
  }
  // Coach gate: only the clients this caller coaches are ever reachable.
  const mine = (all || []).filter((c) => c.coach && c.coach === tenant);
  if (!mine.length) {
    return { error: `You can only send to your own machine - "${tenant}" doesn't coach anyone. Leave the client out and it goes to yours.` };
  }
  const needle = q.toLowerCase();
  const exact = mine.filter((c) =>
    (c.clientId && c.clientId.toLowerCase() === needle) || (c.clientName && c.clientName.toLowerCase() === needle));
  const matches = exact.length ? exact : mine.filter((c) =>
    (c.clientId && c.clientId.toLowerCase().includes(needle)) || (c.clientName && c.clientName.toLowerCase().includes(needle)));

  if (!matches.length) {
    const names = mine.map((c) => `${c.clientName} (${c.clientId})`).join(', ');
    return { error: `No client of yours matched "${q}". Yours: ${names}.` };
  }
  if (matches.length > 1) {
    const names = matches.map((c) => `${c.clientName} (${c.clientId})`).join(', ');
    return { error: `"${q}" matched several: ${names}. Re-run with the exact client id.` };
  }
  return { clientId: matches[0].clientId, clientName: matches[0].clientName || matches[0].clientId, record: matches[0] };
}

/** Human-readable "is that machine even awake?" - so a silent non-delivery is never a mystery. */
function freshnessNote(record) {
  const seen = record?.machineLastSeen;
  if (!seen) return ' Note: that machine has never reported in, so it may not collect this.';
  const mins = Math.round((Date.now() - new Date(seen).getTime()) / 60000);
  if (mins > 15) {
    return ` Note: that machine was last heard from ${mins} minutes ago, so it may be off - check before relying on this.`;
  }
  return '';
}

async function runSendToMachine(args = {}, tenant = TENANT) {
  const { putForMachine, TTL_MINUTES } = require('./machineClipboardStore');

  const target = await resolveTarget(args.client, tenant);
  if (target.error) return { text: target.error, isError: true };

  let result;
  try {
    result = await putForMachine(target.clientId, args.text, tenant);
  } catch (e) {
    return { text: `Couldn't leave that for the machine: ${e.message}`, isError: true };
  }

  const whose = target.own ? 'your Linked Helper machine' : `${target.clientName}'s Linked Helper machine`;
  const stale = target.own ? '' : freshnessNote(target.record);
  return {
    text:
      `Done - ${result.chars} characters are waiting for ${whose}.\n\n`
      + 'It lands on that machine\'s clipboard within a couple of seconds if someone is connected to '
      + 'the screen right now, or on its next check-in if not. Then press Ctrl+V on the machine.\n\n'
      + `It replaces anything already waiting, and it expires after ${TTL_MINUTES} minutes if nobody collects it.`
      + stale,
  };
}

// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_send_to_machine',
    description:
      "Put text on the clipboard of a Linked Helper machine, so it can be pasted there. Use this whenever someone has something on their own computer - a LinkedIn search URL, a line of settings, a message - that they need INSIDE the Linked Helper machine, because copy and paste does not cross that remote desktop connection. The text lands on the machine's clipboard within seconds while someone is connected to its screen; they then press Ctrl+V as normal. With no client named it goes to your own machine; a coach can name one of their own clients to send to theirs. It replaces anything already waiting, and expires if nobody collects it.",
    zodSchema: {
      text: z.string().describe('The exact text to place on the machine\'s clipboard - pasted verbatim, so send it exactly as it should arrive.'),
      client: z.string().optional().describe('Coaches only: which of your clients\' machines to send to (name or client id). Leave out to send to your own machine.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The exact text to place on the machine\'s clipboard - pasted verbatim.' },
        client: { type: 'string', description: 'Coaches only: which of your clients\' machines to send to. Leave out for your own.' },
      },
      required: ['text'],
    },
    run: runSendToMachine,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as captureControlMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path). `tenant` scopes every call to the connector's client. */
function registerMachineClipboardTools(server, tenant = TENANT) {
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

module.exports = { registerMachineClipboardTools, legacyToolList, legacyToolCall, TOOL_DEFS };
