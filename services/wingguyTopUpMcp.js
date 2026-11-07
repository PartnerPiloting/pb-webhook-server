/**
 * wingguy_top_up_campaign - "top up my campaign with this search".
 *
 * WHY (Guy, 5 Nov 2026): the Monday numbers email says "time to top up the search" and clients
 * forget how. Roland asked where to click; Matthew ran out of people twice. Now the client pastes
 * a LinkedIn or Sales Navigator search link here, and Wingguy puts it into their one campaign on
 * their Linked Helper machine (services/lhTopUp.js -> lhTopUpStore -> the machine's agent), makes
 * sure the campaign is running, and emails them when the collect has finished and how many it added.
 *
 * The same tool with NO link answers "what happened to my top-up?" from the latest job on record.
 *
 * ONE DEFINITION, BOTH TRANSPORTS (same pattern as machineClipboardMcp): the SDK server (/mcp2)
 * and the legacy endpoint (/mcp) share TOOL_DEFS. Coach gate as everywhere: with no client named
 * it is the caller's own machine; a coach may name one of their own clients.
 */
const { z } = require('zod');
const store = require('./wingguyRulesStore');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || store.DEFAULT_TENANT).trim();

/** Who is this about? The caller, or (coach only) one of their coached clients. */
async function resolveTarget(query, tenant, verb = 'top up') {
  const clientService = require('./clientService');
  const all = await clientService.getAllClients();
  const self = (all || []).find((c) => c.clientId === tenant);
  const q = String(query || '').trim().toLowerCase();
  const coaches = (all || []).some((c) => c.coach && c.coach === tenant);
  const selfName = self ? String(self.clientName || '').toLowerCase() : '';
  const isSelf = !q || (self && (self.clientId.toLowerCase() === q || selfName === q || (!coaches && selfName.includes(q))));
  if (!coaches || isSelf) {
    if (!self) return { error: `Couldn't find your own client record ("${tenant}").` };
    if (!isSelf) return { error: `You can only ${verb} your own campaign - another person's is not reachable from here. Leave the client out and it goes to yours.` };
    return { client: self, own: true };
  }
  const mine = (all || []).filter((c) => c.coach && c.coach === tenant);
  const exact = mine.filter((c) => (c.clientId && c.clientId.toLowerCase() === q) || (c.clientName && c.clientName.toLowerCase() === q));
  const matches = exact.length ? exact : mine.filter((c) => (c.clientId && c.clientId.toLowerCase().includes(q)) || (c.clientName && c.clientName.toLowerCase().includes(q)));
  if (!matches.length) return { error: `No coached client matched "${query}". Your clients: ${mine.map((c) => `${c.clientName} (${c.clientId})`).join(', ')}.` };
  if (matches.length > 1) return { error: `"${query}" matched several: ${matches.map((c) => `${c.clientName} (${c.clientId})`).join(', ')}. Re-run with the exact client id.` };
  return { client: matches[0], own: false };
}

async function runTopUp(args = {}, tenant = TENANT) {
  const topup = require('./lhTopUp');
  let target;
  try {
    target = await resolveTarget(args.client, tenant);
  } catch (e) {
    return { text: `Couldn't read the client directory: ${e.message}`, isError: true };
  }
  if (target.error) return { text: target.error, isError: true };
  const c = target.client;
  const url = String(args.url || '').trim();

  if (!url) {
    const latest = await require('./lhTopUpStore').latestFor(c.clientId);
    const who = target.own ? '' : `${c.clientName}: `;
    return { text: `${who}${topup.describeJob(latest, { own: target.own })}` };
  }
  const r = await topup.requestTopUp({ client: c, url, campaign: args.campaign, requestedBy: tenant });
  if (!r.ok) return { text: (target.own ? '' : `${c.clientName}: `) + r.text, isError: !r.choose };
  const who = target.own ? '' : `For ${c.clientName}: `;
  return { text: who + r.text };
}

const TOOL_DEFS = [
  {
    name: 'wingguy_top_up_campaign',
    description:
      "Top up a Linked Helper campaign from a search link - the door for \"top up my campaign\", \"here's my new search\", \"add these people to my campaign\", \"my campaign is running low\", \"I'm out of people\", or any LinkedIn / Sales Navigator search link pasted with the idea of getting those people invited. Pass the link as url, exactly as pasted. Wingguy checks it is a people search (LinkedIn search, Sales Navigator search or Sales Navigator lead list) and that it does not include 1st-degree connections, then leaves it for the person's own Linked Helper machine, which puts the search into their campaign as Linked Helper's auto-collect step, makes sure the campaign is running, and reads the search page by page. They are EMAILED when it has finished with how many people were added - so after queueing, tell them that, and tell them the two things to check themselves (the people look right; 2nd or 3rd degree). Call with NO url to answer \"what happened to my top-up?\" / \"did my top-up work?\" - it reports the latest one. Only works for a machine Wingguy looks after; someone running Linked Helper on their own computer is told so. With no client named it is the caller's own campaign; a coach can name one of their own clients (\"top up Roland's campaign with this\"). Never paste a search into Linked Helper by hand, never say it can't be done, never go to Airtable.",
    zodSchema: {
      url: z.string().optional().describe('The search link, exactly as copied from the address bar. Leave out to ask what happened to the latest top-up.'),
      campaign: z.string().optional().describe('Only when they run more than one campaign and named it: the campaign name (or id).'),
      client: z.string().optional().describe("Coaches only: which of your clients' campaigns. Leave out for your own."),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The search link, exactly as copied from the address bar. Leave out to ask what happened to the latest top-up.' },
        campaign: { type: 'string', description: 'Only when they run more than one campaign and named it: the campaign name (or id).' },
        client: { type: 'string', description: "Coaches only: which of your clients' campaigns. Leave out for your own." },
      },
    },
    run: runTopUp,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as machineClipboardMcp)
// ---------------------------------------------------------------------------

function registerWingguyTopUpTools(server, tenant = TENANT) {
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

function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

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

// Stamp every sentence a client is told to type into the description (content/client-phrases.json).
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyTopUpTools, legacyToolList, legacyToolCall, TOOL_DEFS, runTopUp, resolveTarget };
