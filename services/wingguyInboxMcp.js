/**
 * "Go through my inbox" - Guy's Gmail inbox, sorted in chat and cleared on his yes.
 *
 * The problem it solves (Guy, 2 Nov 2026): he no longer writes emails - he starts them in Claude -
 * and wanted the other direction too. Twenty or thirty emails sit in the inbox; Claude should say
 * "there's one from your accountant asking for this", explain his own system's reports in plain
 * English, and offer to archive the rest. Same day, a memory tidy-up email told him Steve's call
 * was not on the calendar - true at 8:37am, done 24 minutes later - so a to-do read back from an
 * email is never passed on without checking it live first. That is written into the description.
 *
 * The tool fetches and acts; the chat's Claude does the judging (three piles: needs you / noted /
 * clear). Nothing is archived unless Guy has said yes in the chat, and every archive can be undone
 * with restore. Archive = take the INBOX label off; nothing is ever deleted.
 *
 * Guy only: it runs on the server's own Gmail login (GMAIL_REFRESH_TOKEN, guyralphwilson@gmail.com,
 * gmail.modify), so it answers for the coach tenant alone. A client's connector gets a refusal.
 *
 * One definition, BOTH transports (same pattern as machineClipboardMcp):
 *   - the SDK server (services/mcpRecallServer.js -> /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js -> /mcp/:token, Claude Code)
 */

const { z } = require('zod');
// NOTE: googleapis / clientService are required LAZILY inside executors - clientService's Airtable
// config crashes at module load when env vars are absent (local test runs).

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const MAX_LIST = 50;
const EXCERPT_CHARS = 600;
const READ_CHARS = 6000;

// Senders that are Guy's own system: their reports are snapshots, so their to-dos get a live check.
const OWN_SYSTEM = [/@knowaguy\.com\.au$/i, /@mg\.knowaguy\.com\.au$/i, /@australiansidehustles\.com\.au$/i];
const GUY_ADDRESS = 'guyralphwilson@gmail.com';

function isCoach(tenant) {
  return tenant === TENANT;
}

function gmailClient() {
  const { google } = require('googleapis');
  const { getGmailOAuthClient } = require('./gmailApiService');
  return google.gmail({ version: 'v1', auth: getGmailOAuthClient() });
}

// ---------------------------------------------------------------------------
// Message text helpers (pure - tested in tests/wingguy-inbox.test.js)
// ---------------------------------------------------------------------------

function header(msg, name) {
  const h = ((msg.payload && msg.payload.headers) || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decode(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

/** The readable body of one message: text/plain if there is one, else the HTML made plain. */
function bodyText(payload) {
  let plain = '';
  let html = '';
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body && p.body.data && !plain) plain = decode(p.body.data);
    else if (p.mimeType === 'text/html' && p.body && p.body.data && !html) html = decode(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return plain || (html ? htmlToText(html) : '');
}

/** Drop the quoted thread below a reply and the usual footer noise, then squash the whitespace. */
function cleanBody(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^On .{5,200} wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From: .+/.test(line.trim()) && out.length > 3) break;
    if (/^>/.test(line.trim())) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\[cid:[^\]]*\]/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function senderAddress(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

function attachmentNames(payload) {
  const names = [];
  const walk = (p) => {
    if (!p) return;
    if (p.filename && !/^image\d*\.(png|gif|jpe?g)$/i.test(p.filename)) names.push(p.filename);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return names;
}

/** What Claude should know about who sent it, before reading a word. */
function senderTags(from, to, clientsByEmail) {
  const addr = senderAddress(from);
  const tags = [];
  if (OWN_SYSTEM.some((re) => re.test(addr))) tags.push('a report from your own system - a snapshot, check its to-dos live');
  else if (addr === GUY_ADDRESS && String(to || '').toLowerCase().includes(GUY_ADDRESS)) tags.push('sent by you to yourself - a note or a system report; check its to-dos live');
  else if (addr === GUY_ADDRESS) tags.push(`your own email to ${to || 'someone'} - the latest word is yours, nobody has replied since`);
  const client = clientsByEmail && clientsByEmail.get(addr);
  if (client) tags.push(`from your client ${client}`);
  return tags;
}

function brisbaneTime(ms) {
  return new Date(Number(ms)).toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

async function coachedClientsByEmail(tenant) {
  const map = new Map();
  try {
    const all = await require('./clientService').getAllClients();
    for (const c of all || []) {
      if (c.coach !== tenant && c.clientId !== tenant) continue;
      if (c.clientId === tenant) continue;
      for (const e of String(c.clientEmailAddress || '').split(/[,;\s]+/)) if (e.includes('@')) map.set(e.toLowerCase(), c.clientName);
    }
  } catch (_e) { /* tags are a nicety - the list still works without them */ }
  return map;
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function runList(args, tenant) {
  const gmail = gmailClient();
  const max = Math.min(Number(args.max) || MAX_LIST, MAX_LIST);
  const { data } = await gmail.users.threads.list({ userId: 'me', q: 'in:inbox', maxResults: max });
  const threads = data.threads || [];
  if (!threads.length) return { text: 'Your inbox is empty.' };

  const clients = await coachedClientsByEmail(tenant);
  const items = [];
  // A few at a time - Gmail rate-limits a burst of thread reads.
  for (let i = 0; i < threads.length; i += 8) {
    const batch = await Promise.all(threads.slice(i, i + 8).map((t) =>
      gmail.users.threads.get({ userId: 'me', id: t.id, format: 'full' }).then((r) => r.data).catch(() => null)));
    items.push(...batch);
  }

  const lines = [`${threads.length} email thread(s) in your inbox${data.nextPageToken ? ` (the newest ${max} - there are more)` : ''}, newest first. Times are Brisbane.`, ''];
  items.forEach((t, n) => {
    if (!t) return;
    const msgs = t.messages || [];
    const last = msgs[msgs.length - 1];
    const first = msgs[0];
    const from = header(last, 'From');
    const unread = msgs.some((m) => (m.labelIds || []).includes('UNREAD'));
    const atts = attachmentNames(last.payload);
    const tags = senderTags(from, header(last, 'To'), clients);
    let text = cleanBody(bodyText(last.payload)) || last.snippet || '';
    if (text.length > EXCERPT_CHARS) text = `${text.slice(0, EXCERPT_CHARS)}... (more - read it with action=read)`;
    lines.push(`[${n + 1}] thread_id=${t.id} | ${brisbaneTime(last.internalDate)} | ${from}${unread ? ' | UNREAD' : ''}${msgs.length > 1 ? ` | ${msgs.length} messages` : ''}`);
    lines.push(`Subject: ${header(first, 'Subject') || '(no subject)'}`);
    if (tags.length) lines.push(`About the sender: ${tags.join('; ')}`);
    if (atts.length) lines.push(`Attachments: ${atts.join(', ')}`);
    lines.push(`Text: ${text.replace(/\n/g, ' / ')}`);
    lines.push('');
  });
  return { text: lines.join('\n') };
}

async function runRead(args) {
  const id = String(args.thread_id || '').trim();
  if (!id) return { text: 'Which email? Pass its thread_id from the list.', isError: true };
  const gmail = gmailClient();
  const { data } = await gmail.users.threads.get({ userId: 'me', id, format: 'full' });
  const out = [`Subject: ${header((data.messages || [])[0] || {}, 'Subject') || '(no subject)'}`, ''];
  for (const m of data.messages || []) {
    let text = cleanBody(bodyText(m.payload));
    if (text.length > READ_CHARS) text = `${text.slice(0, READ_CHARS)}... (cut)`;
    const atts = attachmentNames(m.payload);
    out.push(`--- ${brisbaneTime(m.internalDate)} | From: ${header(m, 'From')} | To: ${header(m, 'To')}${header(m, 'Cc') ? ` | Cc: ${header(m, 'Cc')}` : ''}`);
    if (atts.length) out.push(`Attachments: ${atts.join(', ')}`);
    out.push(text, '');
  }
  return { text: out.join('\n') };
}

/** archive = take INBOX off; restore = put it back. Reports each by subject so Guy sees what moved. */
async function runMove(args, archive) {
  const ids = [...new Set((Array.isArray(args.thread_ids) ? args.thread_ids : [args.thread_ids]).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return { text: 'Which emails? Pass thread_ids from the list.', isError: true };
  const gmail = gmailClient();
  const done = [];
  const failed = [];
  for (const id of ids) {
    try {
      const { data } = await gmail.users.threads.modify({
        userId: 'me', id, requestBody: archive ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] },
      });
      const msg = (data.messages || [])[0];
      let subject = msg ? header(msg, 'Subject') : '';
      if (!subject) {
        const meta = await gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject'] }).catch(() => null);
        subject = meta ? header((meta.data.messages || [])[0] || {}, 'Subject') : '';
      }
      done.push(`- ${subject || '(no subject)'} (thread_id=${id})`);
    } catch (e) {
      failed.push(`- thread_id=${id}: ${e.message}`);
    }
  }
  const verb = archive ? 'Archived' : 'Put back in the inbox';
  const lines = [];
  if (done.length) lines.push(`${verb} ${done.length}:`, ...done);
  if (failed.length) lines.push(`Couldn't ${archive ? 'archive' : 'restore'} ${failed.length}:`, ...failed);
  if (archive && done.length) lines.push('', 'Nothing was deleted - they are in All Mail. To undo, action=restore with the same thread_ids.');
  return { text: lines.join('\n'), ...(done.length ? {} : { isError: true }) };
}

async function runInbox(args = {}, tenant = TENANT) {
  if (!isCoach(tenant)) return { text: "This is Guy's own inbox - not available here.", isError: true };
  const action = args.action || 'list';
  try {
    if (action === 'list') return await runList(args, tenant);
    if (action === 'read') return await runRead(args);
    if (action === 'archive') return await runMove(args, true);
    if (action === 'restore') return await runMove(args, false);
    return { text: `Unknown action "${action}". Use list, read, archive or restore.`, isError: true };
  } catch (e) {
    return { text: `Couldn't reach your Gmail: ${e.message}`, isError: true };
  }
}

const TOOL_DEFS = [
  {
    name: 'wingguy_inbox',
    description:
      "Guy's own Gmail inbox, gone through in chat - \"go through my inbox\", \"what's in my inbox?\", \"clear my inbox\", \"anything I need to deal with?\". Guy no longer reads his email one by one: you read it for him, tell him in plain English what matters, and clear the rest on his yes.\n\n" +
      'HOW TO RUN IT: action=list gives every inbox thread (sender, subject, time, who the sender is to him, attachments, the text). Sort them into three piles and show Guy:\n' +
      '1. NEEDS YOU - one line on what it is, one line on what he has to do (and any deadline). Put the most urgent first.\n' +
      '2. NOTED - useful but no action: one line each on the useful bit.\n' +
      "3. CLEAR - nothing he needs: one short line each.\n" +
      'Number every email across the piles so he can answer "yes", "clear all except 4" or "archive 2 and 7". Then ask once whether to archive NOTED and CLEAR.\n\n' +
      'CHECK BEFORE YOU PASS IT ON: an email is a snapshot from when it was sent. Before you tell Guy any to-do from an email - especially a report from his own system - check it live with the other Wingguy tools (calendar: wingguy_list_events; a client: wingguy_get_client / wingguy_lead_history; campaigns: wingguy_campaigns). If it is already done, say "already done" and put it in NOTED. On 2 Nov a tidy-up email said Steve\'s call was not on the calendar; the invite had gone 24 minutes after it was sent.\n\n' +
      "His own system's reports (Monday campaign numbers, Wingguy Learning gaps, memory tidy-up, the morning brief and the like) are written in system language - turn each into the few things he actually has to do, in his words, and drop the rest.\n\n" +
      'ARCHIVING: only the thread_ids Guy has said yes to in this chat - never on your own judgement, never "while you were at it". Archive takes it out of the inbox and nothing is deleted; action=restore puts it back. Tell him what was archived.\n\n' +
      'action=read with a thread_id gives the whole thread, when you need more than the excerpt to explain it. Plain English, what a thing means before what it is called, " - " not an em dash.',
    zodSchema: {
      action: z.enum(['list', 'read', 'archive', 'restore']).optional().describe('list (default) | read | archive | restore'),
      thread_id: z.string().optional().describe('read: the thread_id from the list'),
      thread_ids: z.array(z.string()).optional().describe('archive / restore: the thread_ids Guy said yes to'),
      max: z.number().optional().describe('list: how many threads, newest first (default and most 50)'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'archive', 'restore'], description: 'list (default) | read | archive | restore' },
        thread_id: { type: 'string', description: 'read: the thread_id from the list' },
        thread_ids: { type: 'array', items: { type: 'string' }, description: 'archive / restore: the thread_ids Guy said yes to' },
        max: { type: 'number', description: 'list: how many threads, newest first (default and most 50)' },
      },
    },
    run: runInbox,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as machineClipboardMcp)
// ---------------------------------------------------------------------------

function registerWingguyInboxTools(server, tenant = TENANT) {
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

module.exports = {
  registerWingguyInboxTools, legacyToolList, legacyToolCall, TOOL_DEFS, runInbox,
  _test: { cleanBody, bodyText, senderTags, senderAddress, attachmentNames },
};
