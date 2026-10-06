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
 *
 * ALSO HERE (29 Sep 2026): wingguy_open_machine - "open my Linked Helper machine". It hands over
 * the web link that opens the machine in a browser (services/machineBrowserLink.js). Same two
 * callers, same coach gate, so it lives beside the clipboard tool rather than in a file of its own.
 * Claude cannot show the screen in the chat - the tool's whole job is the link and what to expect.
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
    return { clientId: me.clientId, clientName: me.clientName || me.clientId, own: true, record: me };
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

/** The same "is it awake?" check as freshnessNote, worded for someone about to open the screen. */
function machineAwakeNote(record) {
  const seen = record?.machineLastSeen;
  if (!seen) return ' Note: that machine has never reported in, so the link may open onto nothing.';
  const mins = Math.round((Date.now() - new Date(seen).getTime()) / 60000);
  if (mins > 15) return ` Note: that machine was last heard from ${mins} minutes ago, so it may be off.`;
  return '';
}

async function runOpenMachine(args = {}, tenant = TENANT) {
  const target = await resolveTarget(args.client, tenant);
  if (target.error) return { text: target.error, isError: true };

  const link = target.record && target.record.machineLink;
  const whose = target.own ? 'your Linked Helper machine' : `${target.clientName}'s Linked Helper machine`;
  if (!link) {
    // No link is not the same as no machine - say which, and never invent an address.
    const built = !!(target.record && target.record.machineLastSeen);
    return {
      text: built
        ? `There is no web link for ${whose} yet - it is still opened with the "Linked Helper machine" icon on the desktop. Guy is the one who switches the web link on.`
        : `There is no Linked Helper machine on record for ${target.own ? 'you' : target.clientName} yet. Guy sets that up - ask him.`,
    };
  }
  return {
    text:
      `Here is the link to ${whose}:\n\n${link}\n\n`
      + 'Give the person this link exactly as it is, as a clickable link. It opens in any web browser - nothing to install.\n\n'
      + 'What happens when they click it:\n'
      + '1. A sign-in page asks for their email address. They use the one Guy has on file for them.\n'
      + '2. A six-digit code arrives in that inbox within a minute (check junk if not). They type it in.\n'
      + '3. The machine\'s desktop opens in the browser tab, with Linked Helper on it.\n\n'
      + 'It remembers them on that browser for about a month, so most days it opens straight to the desktop. '
      + 'If the sign-in page says the email is not allowed, or no code arrives, that is one for Guy - he controls who is on the list. '
      + 'You cannot see or show the machine\'s screen in this chat; the link is the way in.'
      + (target.own ? '' : machineAwakeNote(target.record)),
  };
}

// ---------------------------------------------------------------------------
// "OPEN MY PORTAL" (6 Oct 2026). Guy McPhee asked his Claude for his Wingguy portal on a call and
// it said it didn't have it. The connector is reached with the client's own Portal Token, and the
// portal link is that same token - so handing it back to its own caller gives away nothing the
// caller does not already hold. Same coach gate as the machine link for "open Rick's portal".

const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || 'https://pb-webhook-server.vercel.app').replace(/\/$/, '');

async function runOpenPortal(args = {}, tenant = TENANT) {
  const target = await resolveTarget(args.client, tenant);
  if (target.error) return { text: target.error, isError: true };

  const token = target.record && target.record.portalToken;
  const whose = target.own ? 'your Wingguy portal' : `${target.clientName}'s Wingguy portal`;
  if (!token) {
    return { text: `There is no portal link on record for ${target.own ? 'you' : target.clientName} yet. Guy sets that up - ask him.` };
  }
  return {
    text:
      `Here is the link to ${whose}:\n\n${PORTAL_BASE_URL}/?token=${encodeURIComponent(token)}\n\n`
      + 'Give the person this link exactly as it is, as a clickable link. It opens in any web browser - no password, the link itself is the key. '
      + 'Suggest they bookmark it so they never have to ask again.\n\n'
      + 'This link is personal - anyone who has it can get into the portal - so they should not share it or post it anywhere.',
  };
}

// ---------------------------------------------------------------------------
// A FILE ONTO THE MACHINE (30 Sep 2026). A chat can hand over text, never a file - so the person
// gives a share link and the machine fetches the file itself. Why, and which links: see
// services/machineFileLink.js. Guy's ask, the night the web link went live: a client should be
// able to move their old Linked Helper across without him in the middle of it.

const mb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The Linked Helper account the machine is signed in to, as the machine last reported it - or
 * null. A machine nobody has signed in to yet reports a placeholder (000000, 1), which is not an
 * account and must never be compared against one.
 */
function machineAccount(record) {
  const fields = (record && record.rawRecord && record.rawRecord._rawJson && record.rawRecord._rawJson.fields) || {};
  const id = String(fields['LH Account ID'] || '').trim();
  return /^\d{4,}$/.test(id) && !/^0+$/.test(id) ? id : null;
}

/** What happened to the last file, in words for the person who sent it. */
function fileStatusText(row, whose, target) {
  if (!row) return `Nothing has been sent to ${whose} in the last few days.`;
  const d = row.detail || {};
  if (row.status === 'arrived') {
    const what = d.kind === 'linked-helper-export'
      ? `a genuine Linked Helper export${d.account ? ` for account ${d.account}` : ''}${d.version ? ` (made by version ${d.version})` : ''}`
      : (d.kind === 'csv' ? 'a CSV file' : 'a file');
    const where = d.folder || 'the Downloads folder';
    let next = `It is in ${where} on the machine.`;
    if (d.kind === 'linked-helper-export') {
      const mine = machineAccount(target.record);
      next += (mine && d.account && mine !== String(d.account))
        ? ` Note: the machine is signed in to account ${mine}, and this export is for ${d.account} - it will NOT be brought in. Check it is the right export.`
        : ' If nobody has signed in to Linked Helper on the machine yet, it is brought in automatically a few minutes after they sign in to Linked Helper and LinkedIn. If the machine is already set up and running, nothing is overwritten - tell Guy if this export is meant to replace what is there.';
    }
    return `It arrived on ${whose}: "${d.name || 'the file'}", ${d.bytes ? mb(d.bytes) : 'size unknown'} - ${what}. ${next}`;
  }
  if (row.status === 'failed') {
    return `The file did NOT arrive on ${whose}. The machine said: ${d.error || 'no reason given'}.\n\n`
      + 'The usual cause is a link that needs a sign-in. In OneDrive, Google Drive or Dropbox, set the link so that ANYONE WITH THE LINK can view it, copy the new link, and send that. Some company accounts do not allow that - a personal Google Drive or Dropbox works.';
  }
  if (row.status === 'fetching') return `${whose[0].toUpperCase()}${whose.slice(1)} has picked the link up and is fetching the file now. A big export can take a few minutes - ask again shortly.`;
  if (row.gave_up) return `The link was never collected - ${whose} did not check in within the hour, so it is probably switched off or not reporting. Tell Guy.`;
  return `The link is waiting for ${whose} to collect it. That takes a few seconds if its screen is open in a browser tab, and up to five minutes if not.`;
}

async function runSendFile(args = {}, tenant = TENANT) {
  const store = require('./machineFileStore');
  const { resolveShareLink } = require('./machineFileLink');

  const target = await resolveTarget(args.client, tenant);
  if (target.error) return { text: target.error, isError: true };
  const whose = target.own ? 'your Linked Helper machine' : `${target.clientName}'s Linked Helper machine`;

  const url = String(args.url || '').trim();
  if (!url) {
    const row = await store.statusForMachine(target.clientId);
    return { text: fileStatusText(row, whose, target) };
  }

  if (!(target.record && target.record.machineLastSeen)) {
    return { text: `There is no Linked Helper machine on record for ${target.own ? 'you' : target.clientName} yet, so there is nowhere to send a file. Guy sets the machine up - ask him.` };
  }

  let link;
  try {
    link = resolveShareLink(url);
  } catch (e) {
    if (e.refused) return { text: e.message };
    throw e;
  }
  try {
    await store.putForMachine(target.clientId, link, tenant);
  } catch (e) {
    return { text: `Couldn't leave that for the machine: ${e.message}`, isError: true };
  }
  return {
    text:
      `Done - ${whose} has been given the ${link.service} link and will fetch the file itself.\n\n`
      + 'It collects the link within a few seconds if its screen is open in a browser tab, or within five minutes if not. '
      + 'The file is saved to the Downloads folder on the machine. It is only saved - nothing is opened or run.\n\n'
      + 'IMPORTANT: this is queued, not delivered. Call this tool again WITHOUT a url in a minute or two to find out whether it arrived, and tell the person what it says - '
      + 'a link that needs a sign-in fetches a web page instead of the file, and only the machine can find that out. '
      + 'For it to work the link must be set so that anyone with the link can view it.\n\n'
      + 'Only Linked Helper exports (.lhd2) and CSV files are kept. This replaces any link sent earlier that has not been collected.'
      + machineAwakeNote(target.record),
  };
}

// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'wingguy_send_file_to_machine',
    description:
      "Put a FILE onto a Linked Helper machine, from a share link. Use this whenever someone wants to get a file from their own computer onto the machine - most often the export of their old Linked Helper (a .lhd2 file) when they are moving across, or a CSV list: 'put this file on my machine', 'send my Linked Helper export to my machine', 'here is the link to my backup', 'get this onto my VPS'. You cannot receive a file in a chat, so the person puts the file in OneDrive, Google Drive or Dropbox, shares it so ANYONE WITH THE LINK can view it, and pastes that link here; the machine then fetches the file itself and saves it to its Downloads folder. Pass the link as url. Call it with NO url to find out what happened to the last file sent - 'did my file arrive?' - and always do that a minute or two after sending, because sending only queues it. Only links from OneDrive, Google Drive and Dropbox are accepted, and only .lhd2 and .csv files are kept; nothing is ever opened or run. With no client named it is the caller's own machine; a coach can name one of their own clients.",
    zodSchema: {
      url: z.string().optional().describe('The share link to the file, exactly as copied from OneDrive, Google Drive or Dropbox. Leave out to ask what happened to the last file sent.'),
      client: z.string().optional().describe('Coaches only: which of your clients\' machines (name or client id). Leave out for your own machine.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The share link to the file, exactly as copied. Leave out to ask what happened to the last file sent.' },
        client: { type: 'string', description: 'Coaches only: which of your clients\' machines. Leave out for your own.' },
      },
    },
    run: runSendFile,
  },
  {
    name: 'wingguy_open_machine',
    description:
      "Get the web link that opens a Linked Helper machine in a browser. Use this whenever someone says 'open my Linked Helper machine', 'open my machine', 'open my VPS', 'open my server', 'open Linked Helper', 'how do I get into my machine', 'I need to look at Linked Helper', 'where is the link to my machine', or otherwise wants to see or work on the always-on computer that runs their Linked Helper - they may call it their machine, their VPS, their server or their Linked Helper box, and a coach may ask for a client's by name ('open Roland's machine'). It returns their own personal link and what to expect when they click it (their email, then a one-time code, then the desktop). Never guess or build this address yourself, and never answer from memory - each client's link is their own. With no client named it is the caller's own machine; a coach can name one of their own clients.",
    zodSchema: {
      client: z.string().optional().describe('Coaches only: which of your clients\' machines (name or client id). Leave out for your own machine.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Coaches only: which of your clients\' machines. Leave out for your own.' },
      },
    },
    run: runOpenMachine,
  },
  {
    name: 'wingguy_open_portal',
    description:
      "Get the web link to someone's Wingguy portal - the website where they work their leads (Thanks for Connecting, New Leads, Follow-Ups, Settings, My Wingguy). Use this whenever someone says 'open my portal', 'open Wingguy', 'where is my portal', 'what's the link to my portal', 'take me to my leads', 'open my Wingguy page', 'I've lost my portal link', or otherwise wants to get into the Wingguy website - and a coach may ask for a client's by name ('open Roland's portal'). This is NOT the Linked Helper machine (that is wingguy_open_machine). It returns their own personal link. Never guess or build this address yourself, and never answer from memory - each person's link is their own. With no client named it is the caller's own portal; a coach can name one of their own clients.",
    zodSchema: {
      client: z.string().optional().describe('Coaches only: which of your clients\' portals (name or client id). Leave out for your own.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Coaches only: which of your clients\' portals. Leave out for your own.' },
      },
    },
    run: runOpenPortal,
  },
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

// Stamp every sentence a client is told to type into the description of the tool that answers it
// (content/client-phrases.json). Must run before export - see utils/clientPhrases.js for the why.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerMachineClipboardTools, legacyToolList, legacyToolCall, TOOL_DEFS, runOpenMachine, runOpenPortal };
