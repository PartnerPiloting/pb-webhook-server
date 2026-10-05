/**
 * Wingguy Reconnect MCP tool - "set up my reconnect list" from chat (2026-10-05).
 *
 * WHY: setting a client up for Reconnect (docs/RECONNECT-BUILD-PLAN.md, "The client process",
 * steps 3 and 4) is a conversation - who do you want to hear from again? do these scores look
 * right? - and it happens in the client's own Claude chat, in their session with Guy. Until now
 * every step was a job Claude Code ran by hand. One tool, six steps:
 *
 *   status            where this client is up to
 *   sample            score ~30 of their own old conversations with a DRAFT description; saves nothing
 *   save_description  keep the description, once they agree it reads right
 *   read              YES NUMBER ONE - read every waiting conversation (their key, cost shown first)
 *   leads             YES NUMBER TWO - how many people at each cut-off, then bring them in
 *
 * Rules it keeps:
 *   - Nothing spends the client's money or writes to their leads without confirm:true, and the
 *     figures are always shown in the call before.
 *   - It only works once the client's LinkedIn history has started arriving. Connecting LinkedIn is
 *     Guy's step (he sends the link) - this tool never offers a way to do it.
 *   - The read runs behind the call (it takes minutes) and is safe to re-ask about: progress is read
 *     from the store, not from memory, so a server restart loses nothing.
 * One definition, BOTH transports (same pattern as wingguyScoringMcp).
 */

const { z } = require('zod');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const SAMPLE_DEFAULT = 30;
const SAMPLE_MAX = 40;

const ENDING_WORDS = {
  open_question_or_offer: 'left something open', stalled_after_interest: 'keen, then went quiet',
  answered_then_dropped: 'good exchange, then it stopped', not_now: 'not now', closed_politely: 'closed politely',
  declined: 'declined', their_pitch: 'their pitch', moved_to_call_or_email: 'moved to a call or email', other: 'other',
};

const reading = new Set(); // tenants with a read running in this process

async function context(tenant) {
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenant);
  if (!client) return { error: 'No client record was found for this account.' };
  const status = (await require('./linkedinCollect').statusByTenant())[tenant] || null;
  return { client, status, clientService };
}

const NOT_READY = "Their LinkedIn history has not arrived yet, so there is nothing to read. Connecting LinkedIn is a step Guy sets up - he sends a link, and the history starts arriving within a few hours. RELAY: this isn't ready yet; Guy will be in touch (or message him).";

function hasHistory(status) {
  return !!status && Number(status.messages) > 0;
}

async function setMaster(client, fields) {
  const Airtable = require('airtable');
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.MASTER_CLIENTS_BASE_ID);
  await base('Clients').update(client.recordId || client.id, fields);
  try { require('./clientService').clearCache(); } catch (_) { /* next read refreshes it */ }
}

// ---------------------------------------------------------------------------
// Steps - each returns { text, isError? }
// ---------------------------------------------------------------------------

async function stepStatus(tenant) {
  const c = await context(tenant);
  if (c.error) return { text: c.error, isError: true };
  if (!hasHistory(c.status)) return { text: NOT_READY };
  const score = require('./conversationScore');
  const profile = await score.loadProfile(tenant);
  const on = String(c.client.reconnect || '').trim() === 'Yes';
  const s = c.status;
  const lines = [
    `LinkedIn history: ${Number(s.connections).toLocaleString('en-AU')} connections, ${Number(s.conversations).toLocaleString('en-AU')} conversations with messages, back to ${String(s.oldest_msg_at || '').slice(0, 10) || 'unknown'}. ${s.state === 'complete' ? 'The history is complete.' : 'Older history is still arriving each day and is added by itself.'}`,
    profile.who ? `Their saved description: "${profile.who}"` : 'No description saved yet.',
  ];
  if (profile.who) {
    const dry = await score.scoreConversations(tenant, { dryRun: true });
    if (dry.ok) lines.push(`Conversations read so far: ${dry.upToDate} of ${dry.candidates}${dry.toRead ? ` (${dry.toRead} waiting)` : ''}.`);
  }
  lines.push(on ? 'Their Reconnect list is ON - it is on the Follow-Ups screen in their portal.' : 'Their Reconnect list is not switched on yet.');
  lines.push(on
    ? 'Nothing more to set up. New arrivals are read and added each day by themselves.'
    : `NEXT STEP: ${!profile.who ? 'write their description - ask who they want to hear from again, who they do not, and what a good conversation looks like for them; draft a short first-person paragraph; then step "sample" with it.' : 'step "read" (shows the cost, then needs their yes), then step "leads".'}`);
  return { text: lines.join('\n') };
}

async function stepSample(args, tenant) {
  const c = await context(tenant);
  if (c.error) return { text: c.error, isError: true };
  if (!hasHistory(c.status)) return { text: NOT_READY };
  const who = String(args.description || '').trim();
  if (who.length < 60) return { text: 'Pass the draft description (a short first-person paragraph: who they are, who they are looking for, who is not for them). Ask them the questions first - do not invent it.', isError: true };
  const size = Math.max(10, Math.min(SAMPLE_MAX, parseInt(args.size, 10) || SAMPLE_DEFAULT));
  const r = await require('./conversationScore').scoreConversations(tenant, { who, sample: size });
  if (!r.ok) return { text: r.blocked ? `${r.error} RELAY that plainly.` : `The sample could not run: ${r.error}`, isError: true };
  const rows = (r.results || []).map((x) => `${x.warmth}/5 - ${x.name} (${ENDING_WORDS[x.ending] || x.ending}, quiet ${x.quietDays} days): ${x.why}${x.pick_up_on ? ` Pick up on: ${x.pick_up_on}.` : ''}`);
  return { text: [
    `SAMPLE - ${r.read} of their own old conversations scored with the draft description. Nothing was saved. Cost about US$${r.costUsd} on their key.`,
    '', ...rows, '',
    'SHOW them this list (highest first) and ask which scores look WRONG - too high or too low. Adjust the description to fix what they point at and run the sample again. When they say it looks right, call step "save_description" with the final wording. Do not move on while they are unsure: this paragraph decides the quality of their list for months.',
  ].join('\n') };
}

async function stepSave(args, tenant) {
  const c = await context(tenant);
  if (c.error) return { text: c.error, isError: true };
  const who = String(args.description || '').trim();
  if (who.length < 60) return { text: 'Pass the final description to save.', isError: true };
  const score = require('./conversationScore');
  await score.saveWho(tenant, who);
  const dry = await score.scoreConversations(tenant, { dryRun: true });
  const cost = dry.ok ? ` There are ${dry.toRead} conversations to read now, about US$${dry.estimateUsd} on their own Claude key.` : '';
  return { text: `Saved.${cost} Older conversations are still arriving at up to 3,000 a day and will be read as they come in - roughly US$4 for each further 1,000 conversations worth reading. TELL them both figures and ask for their yes to the read. On yes: step "read" with confirm true.` };
}

async function stepRead(args, tenant) {
  const c = await context(tenant);
  if (c.error) return { text: c.error, isError: true };
  if (!hasHistory(c.status)) return { text: NOT_READY };
  const score = require('./conversationScore');
  const dry = await score.scoreConversations(tenant, { dryRun: true });
  if (!dry.ok) return { text: /paragraph/.test(dry.error || '') ? 'No description is saved yet - do steps "sample" and "save_description" first.' : `Could not check: ${dry.error}`, isError: true };
  if (reading.has(tenant)) return { text: `Still reading: ${dry.upToDate} of ${dry.candidates} done, ${dry.toRead} to go. Check again in a couple of minutes with step "read". While it runs, this is a good moment to show them the Follow-Ups screen.` };
  if (!dry.toRead) return { text: `The read is complete: all ${dry.candidates} conversations are scored. NEXT: step "leads" to see how many people would be brought in.` };
  if (args.confirm !== true) return { text: `${dry.toRead} conversations are waiting to be read, about US$${dry.estimateUsd} on their own Claude key, taking roughly ${Math.max(2, Math.round(dry.toRead / 200))} minutes. This is YES NUMBER ONE - ask them plainly, and only on their yes call step "read" again with confirm true.` };
  reading.add(tenant);
  score.scoreConversations(tenant, {})
    .then((r) => console.log(`[reconnect-setup] ${tenant}: read ${r.ok ? `${r.read} for about US$${r.costUsd}` : `FAILED ${r.error}`}`))
    .catch((e) => console.error(`[reconnect-setup] ${tenant}: read failed - ${e.message}`))
    .finally(() => reading.delete(tenant));
  return { text: `Started: reading ${dry.toRead} conversations. It takes roughly ${Math.max(2, Math.round(dry.toRead / 200))} minutes. Check progress with step "read". While it runs, show them the Follow-Ups screen and how a Reconnect row works.` };
}

async function stepLeads(args, tenant) {
  const c = await context(tenant);
  if (c.error) return { text: c.error, isError: true };
  if (!hasHistory(c.status)) return { text: NOT_READY };
  const score = require('./conversationScore');
  const dry = await score.scoreConversations(tenant, { dryRun: true });
  if (!dry.ok) return { text: 'No description is saved yet - do steps "sample" and "save_description" first.', isError: true };
  if (reading.has(tenant) || dry.toRead) return { text: `The read has not finished (${dry.toRead} to go). Finish step "read" first, so the counts are the real ones.` };
  const leads = require('./reconnectLeads');
  if (args.confirm !== true) {
    const [at3, at4] = [await leads.syncReconnectLeads(tenant, { dryRun: true, cutOff: 3 }), await leads.syncReconnectLeads(tenant, { dryRun: true, cutOff: 4 })];
    if (!at3.ok || !at4.ok) return { text: `Could not count: ${at3.error || at4.error}`, isError: true };
    return { text: [
      `Of ${at3.scoredPeople} conversations read, ${at3.alreadyLeads} are with people already in their leads list - those just get their score added.`,
      `People NOT yet in their list who would be brought in:`,
      `  cut-off 3 (everyone scoring 3, 4 or 5): ${at3.toCreate} new leads`,
      `  cut-off 4 (only the 4s and 5s): ${at4.toCreate} new leads`,
      at3.unsure ? `(${at3.unsure} more share a name with someone already in the list and are left alone.)` : '',
      `At 20 a day, ${at4.toCreate + at4.alreadyLeads} people is about ${Math.max(1, Math.round((at4.toCreate + at4.alreadyLeads) / 100))} months of work. This is YES NUMBER TWO: help them choose the cut-off (4 is plenty when the numbers are large), then call step "leads" with confirm true and cut_off 3 or 4. That also switches their Reconnect list on.`,
    ].filter(Boolean).join('\n') };
  }
  const cutOff = parseInt(args.cut_off, 10);
  if (![3, 4, 5].includes(cutOff)) return { text: 'Pass cut_off 3 or 4 - the one they chose.', isError: true };
  await setMaster(c.client, { 'Reconnect Lead Cut-Off': cutOff });
  const done = await leads.syncReconnectLeads(tenant, { dryRun: false, cutOff });
  if (!done.ok) return { text: `Bringing them in failed: ${done.error}. Nothing was switched on.`, isError: true };
  await setMaster(c.client, { Reconnect: 'Yes' });
  return { text: `Done: ${done.created} people added to their leads list and ${done.updated} existing leads given their conversation score. Their Reconnect list is now ON. TELL them: open the Follow-Ups tab in the portal and refresh - under the normal follow-ups there is a Reconnect section with the first 20 people (it can take a minute to appear). Each row says why the person is there and what to pick up on; click the name, open the message thread, type /wg. Older conversations keep arriving and are added by themselves.` };
}

async function runSetup(args = {}, tenant = TENANT) {
  const step = String(args.step || 'status');
  if (step === 'status') return stepStatus(tenant);
  if (step === 'sample') return stepSample(args, tenant);
  if (step === 'save_description') return stepSave(args, tenant);
  if (step === 'read') return stepRead(args, tenant);
  if (step === 'leads') return stepLeads(args, tenant);
  return { text: 'Unknown step. Use status, sample, save_description, read or leads.', isError: true };
}

// ---------------------------------------------------------------------------
// Tool definition (one shape, both transports)
// ---------------------------------------------------------------------------

const DESCRIPTION = 'Set up the client\'s RECONNECT LIST - a daily list of people they already know on LinkedIn whose old conversation is worth picking up again. Use for "set up my reconnect list", "set up reconnect", "where am I up to with reconnect", "who should I reconnect with". ALWAYS start with step "status": it says what is ready and what the next step is, and if it says the history has not arrived, stop and relay that - never suggest a way to connect LinkedIn yourself. THE ORDER: (1) ask who they want to hear from again, who they do NOT, and what a good conversation looks like for them - their words, never invented - and draft a short first-person paragraph; (2) step "sample" with that draft scores about 30 of their own old conversations and saves nothing - show them the list and fix whatever they say is wrong, repeating until it looks right; (3) step "save_description"; (4) step "read" shows the cost on their own Claude key and needs their YES (confirm true) - it then runs for some minutes, re-call it for progress; (5) step "leads" shows how many people would be brought in at cut-off 3 and at cut-off 4 and needs their second YES (confirm true + cut_off) - that also switches the list on. Two yeses, never assumed. Plain English throughout: "description", "conversations", "list" - no internal names.';

const TOOL_DEFS = [
  {
    name: 'wingguy_reconnect_setup',
    description: DESCRIPTION,
    zodSchema: {
      step: z.enum(['status', 'sample', 'save_description', 'read', 'leads']).optional().describe('Which step. Default "status".'),
      description: z.string().optional().describe('The client\'s own description of who they are and who they are looking for - for steps "sample" and "save_description".'),
      size: z.number().optional().describe('Step "sample": how many conversations to score (default 30, max 40).'),
      confirm: z.boolean().optional().describe('Steps "read" and "leads": true ONLY after the human has said yes to the figures the step just showed.'),
      cut_off: z.number().optional().describe('Step "leads" with confirm: 3 (everyone scoring 3 or better) or 4 (only 4s and 5s) - the one they chose.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: ['status', 'sample', 'save_description', 'read', 'leads'], description: 'Which step. Default "status".' },
        description: { type: 'string', description: 'The client\'s own description of who they are and who they are looking for - for steps "sample" and "save_description".' },
        size: { type: 'number', description: 'Step "sample": how many conversations to score (default 30, max 40).' },
        confirm: { type: 'boolean', description: 'Steps "read" and "leads": true ONLY after the human has said yes to the figures the step just showed.' },
        cut_off: { type: 'number', description: 'Step "leads" with confirm: 3 (everyone scoring 3 or better) or 4 (only 4s and 5s) - the one they chose.' },
      },
      required: [],
    },
    run: runSetup,
  },
];

function registerWingguyReconnectTools(server, tenant = TENANT) {
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

require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyReconnectTools, legacyToolList, legacyToolCall, TOOL_DEFS, runSetup, hasHistory };
