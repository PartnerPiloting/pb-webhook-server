/**
 * "Go through my inbox" - the caller's own inbox, sorted in chat and cleared on their yes.
 *
 * The problem it solves (Guy, 2 Nov 2026): he no longer writes emails - he starts them in Claude -
 * and wanted the other direction too. Twenty or thirty emails sit in the inbox; Claude should say
 * "there's one from your accountant asking for this", explain his own system's reports in plain
 * English, and offer to archive the rest. Same day, a memory tidy-up email told him Steve's call
 * was not on the calendar - true at 8:37am, done 24 minutes later - so a to-do read back from an
 * email is never passed on without checking it live first. That is written into the description.
 *
 * The tool fetches and acts; the chat's Claude does the judging (three piles: needs you / noted /
 * clear). Nothing is archived unless the person has said yes in the chat, and every archive can be
 * undone with restore. Archive = out of the inbox; nothing is ever deleted.
 *
 * ONE TOOL, TWO CONNECTIONS (Guy, 2 Nov: "make this work both for Gmail and for Wingguy, so there's
 * no friction"). Whoever asks, it is their own inbox:
 *   - Guy (the coach tenant): the server's direct Gmail login (GMAIL_REFRESH_TOKEN, gmail.modify).
 *     Not Unipile, because Unipile's copy of his folders lagged Gmail on 2 Nov - three sent mails
 *     sat in his Gmail inbox that Unipile still had as SENT only, so they could never be cleared.
 *   - Anyone else: their own mailbox through Wingguy's mail link (services/mailProvider.js,
 *     Unipile). Archive is proven on Google mailboxes. Outlook has its own folder move (10 Nov
 *     2026), switched on per client by INBOX_FOLDER_ARCHIVE_CLIENTS until a real mailbox proves it;
 *     every other mailbox lists and reads, and archive is refused.
 *
 * One definition, BOTH transports (same pattern as machineClipboardMcp):
 *   - the SDK server (services/mcpRecallServer.js -> /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js -> /mcp/:token, Claude Code)
 */

const { z } = require('zod');
// NOTE: googleapis / clientService / mailProvider are required LAZILY - clientService's Airtable
// config crashes at module load when env vars are absent (local test runs).

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const MAX_LIST = 50;
const EXCERPT_CHARS = 600;
const READ_CHARS = 6000;

// Senders that are Guy's own system (Wingguy, knowaguy): their reports are snapshots.
const OWN_SYSTEM = [/@knowaguy\.com\.au$/i, /@mg\.knowaguy\.com\.au$/i, /@australiansidehustles\.com\.au$/i];
const GUY_GMAIL = 'guyralphwilson@gmail.com';

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

/** The readable body of one Gmail message: text/plain if there is one, else the HTML made plain. */
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

/**
 * What Claude should know about who sent it, before reading a word.
 * who = { coach: bool, own: Set of the caller's own addresses, clients: Map email -> name }
 */
function senderTags(from, to, who) {
  const addr = senderAddress(from);
  const own = (who && who.own) || new Set();
  const tags = [];
  const toSelf = [...own].some((a) => String(to || '').toLowerCase().includes(a));
  if (OWN_SYSTEM.some((re) => re.test(addr))) {
    tags.push(who && who.coach ? 'a report from your own system - a snapshot, check its to-dos live' : 'from Guy / Wingguy');
  } else if (own.has(addr) && toSelf) {
    tags.push('sent by you to yourself - a note or a system report; check its to-dos live');
  } else if (own.has(addr)) {
    tags.push(`your own email to ${to || 'someone'} - the latest word is yours, nobody has replied since`);
  }
  const client = who && who.clients && who.clients.get(addr);
  if (client) tags.push(`from your client ${client}`);
  return tags;
}

/**
 * One click to the real email in Gmail's web app. Pass the NEWEST message's id - a thread id is the
 * id of the thread's first message, so it opens an old email. Gmail ids are 16 hex digits, and the web
 * app opens them as they are: #all/<hex id>. NOT thread-f:<the id in decimal> - that is the form
 * Gmail's own connector hands back, and clicked in a browser it opens an empty Gmail (Guy, 4 Nov 2026).
 * An Outlook id is not hex, so it gets no link. `account` picks the right Google login when the
 * browser holds several; without it Gmail opens the first one.
 */
function gmailThreadLink(threadId, account) {
  const id = String(threadId || '');
  if (!/^[0-9a-f]{16}$/i.test(id)) return null;
  const who = account ? `?authuser=${encodeURIComponent(account)}` : '';
  return `https://mail.google.com/mail/${who}#all/${id.toLowerCase()}`;
}

function brisbaneTime(ms) {
  return new Date(Number(ms)).toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function excerpt(text, max) {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max)}... (more - read it with action=read)` : t;
}

// ---------------------------------------------------------------------------
// "You have written since" - the server's own look at sent mail.
//
// Guy, 13 Nov 2026: a Fathom recap of his morning call with Simon Steele was job 6 of 9. Claude said
// "Nothing has gone to him since" and offered to draft a follow-up - he had emailed Simon at 2:44pm.
// The description already told Claude to check the mailbox first (the Kay Ridge rule, 2 Nov); it was
// the second time that rule was not enough. So the check no longer depends on Claude remembering:
// the list itself reads recent sent mail and stamps the fact on the email it belongs to.
// ---------------------------------------------------------------------------

const SENT_LOOKBACK_MS = 14 * 24 * 3600 * 1000;
const SENT_MAX = 80;

/** "Simon Steele <s@x.com>, "Ng, Amy" <a@y.com>, bare@z.com" -> [{ name, email }] */
function parseAddressList(raw) {
  const out = [];
  const re = /(?:"([^"]*)"|([^",<]*))\s*<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    const email = String(m[3] || m[4] || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    let name = String(m[1] || m[2] || '').trim();
    const flipped = name.match(/^([^,]+),\s*(.+)$/);   // "Steele, Simon" -> "Simon Steele"
    if (flipped) name = `${flipped[2]} ${flipped[1]}`.trim();
    out.push({ name: name && !name.includes('@') ? name : '', email });
  }
  return out;
}

/** A full name (two words or more) found whole in the text, any spacing or case. */
function nameInText(name, text) {
  const words = String(name || '').split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 2) return false;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[^\\p{L}])${esc.join('\\s+')}($|[^\\p{L}])`, 'iu').test(String(text || ''));
}

/**
 * The people this email is from or about that the caller has ALREADY emailed since it arrived.
 * email = { date(ms), from: [addresses], text: subject + body }; sent = [{ date, subject, people }].
 * A person matches when the email is from their address, or their address or full name is in it.
 * Returns one entry per person, their newest email first: [{ name, email, date, subject }].
 */
function writtenSince(email, sent, own) {
  const from = new Set((email.from || []).map((a) => String(a).toLowerCase()));
  const text = String(email.text || '');
  const lower = text.toLowerCase();
  const hits = new Map();
  for (const s of sent || []) {
    if (!(s.date > email.date)) continue;
    for (const p of s.people || []) {
      if ((own && own.has(p.email)) || OWN_SYSTEM.some((re) => re.test(p.email))) continue;
      if (!(from.has(p.email) || lower.includes(p.email) || nameInText(p.name, text))) continue;
      const had = hits.get(p.email);
      if (!had || s.date > had.date) hits.set(p.email, { name: p.name, email: p.email, date: s.date, subject: s.subject });
    }
  }
  return [...hits.values()].sort((a, b) => b.date - a.date).slice(0, 3);
}

function writtenSinceLine(hits) {
  if (!hits.length) return null;
  const each = hits.map((h) => `${h.name ? `${h.name} <${h.email}>` : h.email} on ${brisbaneTime(h.date)} - "${h.subject || '(no subject)'}"`);
  return `YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED: to ${each.join('; and to ')}. This is from the real sent mail. NEVER say nothing has gone to them. Before offering any email to them, read what was sent (wingguy_lead_correspondence, then wingguy_read_message) - if it already does the job, the job is DONE.`;
}

/**
 * Recent sent mail from this connection, or why it could not be read. Never throws.
 * -> { ok, sent, from(ms) } | { ok:false, why }
 */
async function recentSent(inbox, oldestMs) {
  if (typeof inbox.backend.sentSince !== 'function') return { ok: false, why: 'this mailbox connection cannot list sent mail here' };
  const since = Math.max(Number(oldestMs) || 0, Date.now() - SENT_LOOKBACK_MS);
  try {
    const r = await inbox.backend.sentSince(since);
    const sent = r.sent || [];
    return { ok: true, sent, from: r.truncated && sent.length ? Math.min(...sent.map((x) => x.date)) : since };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

function sentCheckLines(check) {
  if (check.ok) {
    return [
      `SENT MAIL CHECKED back to ${brisbaneTime(check.from)}: where an email below is from, or names, someone they have emailed since it arrived, it carries a "YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED" line - a fact, act on it. No such line is NOT proof that nothing was sent (a name can be spelt another way, and they may write to the person after this list was made): still call wingguy_lead_correspondence before any job about a person.`,
      '',
    ];
  }
  return [
    `SENT MAIL NOT CHECKED (${check.why}): nothing below tells you whether they have already written to someone. Call wingguy_lead_correspondence for every person before a job about them - never say "nothing has gone to them" without it.`,
    '',
  ];
}

// ---------------------------------------------------------------------------
// The two connections. Each gives: list(max) -> { threads:[{id, subject, last, count, unread}], more },
// read(threadId) -> { subject, messages }, move(threadId, archive) -> { subject }.
// A message is { date(ms), from, to, cc, text, attachments }.
// ---------------------------------------------------------------------------

function gmailBackend() {
  const { google } = require('googleapis');
  const { getGmailOAuthClient } = require('./gmailApiService');
  const gmail = google.gmail({ version: 'v1', auth: getGmailOAuthClient() });
  const toMsg = (m) => ({
    id: m.id, date: Number(m.internalDate), from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'),
    text: cleanBody(bodyText(m.payload)) || m.snippet || '', attachments: attachmentNames(m.payload),
  });
  return {
    async list(max, page) {
      const { data } = await gmail.users.threads.list({ userId: 'me', q: 'in:inbox', maxResults: max, ...(page ? { pageToken: page } : {}) });
      // The INBOX label's own thread count is exact (threads.list's resultSizeEstimate is not).
      const total = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' }).then((r) => r.data.threadsTotal).catch(() => null);
      const out = [];
      const ids = (data.threads || []).map((t) => t.id);
      // A few at a time - Gmail rate-limits a burst of thread reads.
      for (let i = 0; i < ids.length; i += 8) {
        const batch = await Promise.all(ids.slice(i, i + 8).map((id) =>
          gmail.users.threads.get({ userId: 'me', id, format: 'full' }).then((r) => r.data).catch(() => null)));
        for (const t of batch) {
          if (!t || !(t.messages || []).length) continue;
          const msgs = t.messages;
          out.push({
            id: t.id, subject: header(msgs[0], 'Subject'), last: toMsg(msgs[msgs.length - 1]), count: msgs.length,
            unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
          });
        }
      }
      return { threads: out, more: !!data.nextPageToken, next: data.nextPageToken || null, total: Number.isFinite(total) ? total : null };
    },
    // Mail the person sent after `sinceMs`, newest first: who it went to (To + Cc) and its subject.
    async sentSince(sinceMs) {
      const { data } = await gmail.users.messages.list({ userId: 'me', q: `in:sent after:${Math.floor(sinceMs / 1000)}`, maxResults: SENT_MAX });
      const ids = (data.messages || []).map((m) => m.id);
      const sent = [];
      for (let i = 0; i < ids.length; i += 10) {
        const batch = await Promise.all(ids.slice(i, i + 10).map((id) =>
          gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['To', 'Cc', 'Subject'] }).then((r) => r.data)));
        for (const m of batch) {
          sent.push({ date: Number(m.internalDate), subject: header(m, 'Subject'), people: [...parseAddressList(header(m, 'To')), ...parseAddressList(header(m, 'Cc'))] });
        }
      }
      return { sent, truncated: !!data.nextPageToken };
    },
    async read(id) {
      const { data } = await gmail.users.threads.get({ userId: 'me', id, format: 'full' });
      const msgs = data.messages || [];
      return { subject: msgs.length ? header(msgs[0], 'Subject') : '', messages: msgs.map(toMsg), inInbox: msgs.some((m) => (m.labelIds || []).includes('INBOX')) };
    },
    async move(id, archive) {
      const { data } = await gmail.users.threads.modify({
        userId: 'me', id, requestBody: archive ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] },
      });
      let subject = header((data.messages || [])[0] || {}, 'Subject');
      if (!subject) {
        const meta = await gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject'] }).catch(() => null);
        subject = meta ? header((meta.data.messages || [])[0] || {}, 'Subject') : '';
      }
      return { subject };
    },
  };
}

function wingguyMailBackend(record, mail) {
  const toMsg = (m) => ({
    id: m.id, date: Date.parse(m.date) || 0, from: m.from, to: m.to, cc: m.cc,
    text: cleanBody(m.text || htmlToText(m.html)), attachments: m.attachments || [],
  });
  return {
    async list(max, page) {
      const r = await mail.listInbox(record, { limit: max, cursor: page });
      if (!r.ok) throw new Error(r.error);
      // The inbox is a list of messages; show each thread once, by its newest message.
      const byThread = new Map();
      for (const m of r.messages) {
        const key = m.threadId || m.id;
        const t = byThread.get(key);
        if (!t) byThread.set(key, { id: key, subject: m.subject, last: m, count: 1, unread: m.unread });
        else {
          t.count += 1;
          t.unread = t.unread || m.unread;
          if (String(m.date) > String(t.last.date)) t.last = m;
        }
      }
      const threads = [...byThread.values()]
        .sort((a, b) => String(b.last.date).localeCompare(String(a.last.date)))
        .map((t) => ({ ...t, last: toMsg(t.last) }));
      // No exact count on this connection - only "there are more".
      return { threads, more: !!r.more, next: r.cursor || null, total: null };
    },
    async read(id) {
      const r = await mail.threadMessages(record, id);
      if (!r.ok) throw new Error(r.error);
      return { subject: (r.messages[0] || {}).subject || '', messages: r.messages.map(toMsg) };
    },
    async move(id, archive) {
      const r = await mail.setThreadInInbox(record, id, !archive);
      if (!r.ok) throw new Error(r.error);
      return { subject: r.subject, unconfirmed: !!r.unconfirmed, folder: r.folder || null };
    },
    // Why emails cannot be cleared on this mailbox right now, in words to pass on - or null when
    // they can. A check that itself fails says nothing: the move still has its own guards.
    async clearBlock() {
      if (typeof mail.archiveReadiness !== 'function') return null;
      const r = await mail.archiveReadiness(record).catch(() => null);
      return r && r.ok && r.ready === false ? r.message : null;
    },
  };
}

/**
 * Whose inbox, and through which connection. Guy -> direct Gmail; anyone else -> their own
 * mailbox through Wingguy's mail link, or a plain "not connected".
 */
async function resolveInbox(tenant, deps = {}) {
  const clientService = deps.clientService || require('./clientService');
  const mail = deps.mailProvider || require('./mailProvider');
  let record = null;
  try { record = await clientService.getClientById(tenant); } catch (_e) { /* handled below */ }
  const coach = tenant === TENANT;
  const own = new Set(String((record && record.clientEmailAddress) || '').toLowerCase().split(/[,;\s]+/).filter((e) => e.includes('@')));

  const clients = new Map();
  if (coach) {
    own.add(GUY_GMAIL);
    try {
      for (const c of (await clientService.getAllClients()) || []) {
        if (c.coach !== tenant || c.clientId === tenant) continue;
        for (const e of String(c.clientEmailAddress || '').split(/[,;\s]+/)) if (e.includes('@')) clients.set(e.toLowerCase(), c.clientName);
      }
    } catch (_e) { /* tags are a nicety - the list still works without them */ }
  }
  const who = { coach, own, clients };

  if (deps.backendOverride) return { backend: deps.backendOverride, who };   // tests only
  if (coach && process.env.GMAIL_REFRESH_TOKEN) return { backend: (deps.gmailBackend || gmailBackend)(), who };
  if (record && mail.hasMailbox(record) && mail.activeMailProvider(record) === 'unipile') {
    return { backend: wingguyMailBackend(record, mail), who };
  }
  return { error: "Your mailbox isn't connected to Wingguy yet, so I can't see your inbox. Guy can connect it for you." };
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function instructionLines(tenant, deps) {
  let list = [];
  try { list = await (deps.inboxStore || require('./wingguyInboxStore')).listInstructions(tenant); } catch (_e) { /* the inbox works without them */ }
  if (!list.length) return [];
  return [
    'THEIR STANDING INBOX INSTRUCTIONS - follow these when sorting:',
    ...list.map((x) => `- [${x.id}] ${x.body}`),
    '',
  ];
}

// page_token = "<how many came before>~<the connection's own page token>", so the numbering of
// the next batch carries on from the last one ([51], [52]...) instead of starting at [1] again.
function readPageToken(raw) {
  const s = String(raw || '');
  const i = s.indexOf('~');
  if (i < 0) return { offset: 0, page: s || null };
  return { offset: Number(s.slice(0, i)) || 0, page: s.slice(i + 1) || null };
}

/**
 * What the batch covers. Guy, 2 Nov 2026: with 50 at a time, someone with 180 emails could think
 * all 180 had been gone through. When there is more than this batch, the first thing Claude says
 * has to be how much there is and how much this covers.
 */
function coverageLines({ shown, offset, more, total, next }) {
  const first = offset + 1;
  const last = offset + shown;
  if (!more && !offset) return [`All ${shown} email thread(s) in the inbox, newest first. Times are Brisbane.`];
  const of = total ? `${total}` : `more than ${last}`;
  const lines = [
    `NOT THE WHOLE INBOX: this is emails ${first}-${last} of ${of}, newest first. Times are Brisbane.`,
    `Say so in your FIRST line, before anything else - e.g. "You have ${total || `more than ${last}`} emails in your inbox - this covers ${offset ? `numbers ${first} to ${last}` : `the newest ${shown}`}." Never let them think the rest were looked at.`,
  ];
  if (more && next) lines.push(`When they want the next batch ("next 50", "keep going"): action=list with page_token=${last}~${next}`);
  else if (!more) lines.push('This is the last batch - there are no older emails in the inbox.');
  return lines;
}

/**
 * Guy only: his own emails that will not go until he says so - one-offs on the Scheduled page, the
 * weekly client emails. Unapproved weekly client emails lapse and never go, so a run of his inbox is
 * where he is reminded. The weekly email to his list is NOT here - since 9 Nov 2026 it goes unless he
 * holds it, so it needs no OK. Each source is read on its own; one failing never
 * hides the others or the inbox.
 */
async function waitingForOk(tenant) {
  const out = [];
  const add = async (what, fn) => {
    try { out.push(...(await fn())); } catch (e) { console.warn(`[wingguyInbox] waiting-for-ok ${what}: ${e.message}`); }
  };
  await add('scheduled', async () => {
    const q = require('./scheduledEmails');
    const rows = await q.listRows(tenant, { statuses: ['awaiting', 'held', 'failed'] });
    return rows.map((r) => {
      const who = [...r.to, ...r.cc].map((p) => p.name || p.email).join(' + ');
      const state = r.status === 'awaiting' ? 'needs your OK' : r.status === 'held' ? `HELD: ${r.holdReason}` : `FAILED: ${r.result}`;
      return `One-off #${r.id} "${r.subject}" to ${who} - ${q.whenLabel(r.sendAt)} - ${state} (wingguy_scheduled_emails id=${r.id}: show, approve, edit, cancel)`;
    });
  });
  await add('weekly', async () => {
    const actions = require('./clientTouchActions');
    const week = actions.weekOrDefault();
    const rows = (await require('./clientTouchPlanStore').plansFor(week)).filter((r) => r.pick && (r.status === 'proposed' || r.status === 'held'));
    return rows.map((r) => `Weekly client email to ${String(r.clientId).replace(/-/g, ' ')} for ${actions.dayLabel(week)} - ${r.status === 'held' ? 'HELD' : 'not approved yet; it never goes unless approved'} (wingguy_weekly_emails client=${r.clientId}: show, approve, edit, skip)`);
  });
  return out;
}

async function approvalLines(tenant, deps = {}) {
  if (tenant !== TENANT) return [];
  let items = [];
  try { items = await (deps.approvals || waitingForOk)(tenant); } catch (_) { items = []; }
  if (!items.length) return [];
  return [`YOUR OWN EMAILS WAITING FOR YOUR OK (${items.length}) - not inbox emails; ask about these at the end, see YOUR OWN EMAILS WAITING:`, ...items.map((i) => `  - ${i}`), ''];
}

/** Why this mailbox cannot clear emails right now (words to pass on), or null. Never throws. */
async function clearBlock(inbox) {
  if (typeof inbox.backend.clearBlock !== 'function') return null;
  try { return (await inbox.backend.clearBlock()) || null; } catch (_e) { return null; }
}

/**
 * Said at the TOP of the first list, so the person hears it before the sort - not after they have
 * said yes to a clear that then fails (Guy, 13 Nov 2026).
 */
function clearBlockLines(block) {
  if (!block) return [];
  return [
    `CLEARING WILL NOT WORK ON THIS MAILBOX RIGHT NOW: ${block}`,
    'Tell them this in your FIRST message, in plain words, with the fix if one is given above. Still sort the inbox and do the jobs with them, but do NOT offer to clear or archive anything - say they can clear those emails themselves in their mailbox.',
    '',
  ];
}

async function runList(args, inbox, tenant, deps) {
  const max = Math.min(Number(args.max) || MAX_LIST, MAX_LIST);
  const { offset, page } = readPageToken(args.page_token);
  const { threads, more, next, total } = await inbox.backend.list(max, page);
  // Guy, 2 Nov 2026: an empty inbox must not hide them, so they come first and on every first page.
  const head = [...await instructionLines(tenant, deps), ...(offset ? [] : await approvalLines(tenant, deps))];
  if (!offset && threads.length) head.push(...clearBlockLines(await clearBlock(inbox)));
  if (!threads.length) return { text: [...head, offset ? 'No more emails - that was the end of the inbox.' : 'Your inbox is empty.'].join('\n') };
  const lines = [...head, ...coverageLines({ shown: threads.length, offset, more, total, next }), ''];
  const check = await recentSent(inbox, Math.min(...threads.map((t) => t.last.date || Date.now())));
  lines.push(...sentCheckLines(check));
  threads.forEach((t, n) => {
    const m = t.last;
    const tags = senderTags(m.from, m.to, inbox.who);
    lines.push(`[${offset + n + 1}] thread_id=${t.id} | ${brisbaneTime(m.date)} | ${m.from}${t.unread ? ' | UNREAD' : ''}${t.count > 1 ? ` | ${t.count} messages` : ''}`);
    lines.push(`Subject: ${t.subject || '(no subject)'}`);
    // The newest message's id - a quick-thanks reply drafts into this thread with it.
    if (m.id) lines.push(`To reply: reply_to_message_id=${m.id}`);
    // Link the NEWEST message, not the thread: a thread id is its FIRST message's id, so on a thread
    // with several messages Gmail opened the oldest one (Laura's Wilfreed thread, Guy, 4 Nov 2026).
    const account = inbox.who.coach ? GUY_GMAIL : null;
    const link = gmailThreadLink(m.id, account) || gmailThreadLink(t.id, account);
    if (link) lines.push(`Open in Gmail: ${link}`);
    if (tags.length) lines.push(`About the sender: ${tags.join('; ')}`);
    if (m.attachments.length) lines.push(`Attachments: ${m.attachments.join(', ')}`);
    lines.push(`Text: ${excerpt(m.text, EXCERPT_CHARS).replace(/\n/g, ' / ')}`);
    if (check.ok) {
      const since = writtenSinceLine(writtenSince({ date: m.date, from: [senderAddress(m.from)], text: `${t.subject || ''}\n${m.text}` }, check.sent, inbox.who.own));
      if (since) lines.push(since);
    }
    lines.push('');
  });
  return { text: lines.join('\n') };
}

async function runRead(args, inbox) {
  const id = String(args.thread_id || '').trim();
  if (!id) return { text: 'Which email? Pass its thread_id from the list.', isError: true };
  const { subject, messages } = await inbox.backend.read(id);
  const out = [`Subject: ${subject || '(no subject)'}`, ''];
  for (const m of messages) {
    const text = m.text.length > READ_CHARS ? `${m.text.slice(0, READ_CHARS)}... (cut)` : m.text;
    out.push(`--- ${brisbaneTime(m.date)} | From: ${m.from} | To: ${m.to}${m.cc ? ` | Cc: ${m.cc}` : ''}`);
    if (m.attachments.length) out.push(`Attachments: ${m.attachments.join(', ')}`);
    out.push(text, '');
  }
  if (messages.length) {
    const lastDate = Math.max(...messages.map((m) => m.date || 0));
    const check = await recentSent(inbox, lastDate);
    if (check.ok) {
      const since = writtenSinceLine(writtenSince({
        date: lastDate, from: messages.map((m) => senderAddress(m.from)), text: `${subject || ''}\n${messages.map((m) => m.text).join('\n')}`,
      }, check.sent, inbox.who.own));
      if (since) out.push(since);
    } else out.push(...sentCheckLines(check));
  }
  return { text: out.join('\n') };
}

/**
 * One email, looked at again RIGHT NOW - called just before its job is shown (Guy, 13 Nov 2026: a run
 * of nine takes twenty minutes, and he deals with things in other chats while it is open, so what
 * the list said at the start is stale by item 6). Says: is it still in the inbox, who has the latest
 * word in its thread, and has he written since to anyone it is from or names.
 */
async function runCheck(args, inbox) {
  const id = String(args.thread_id || '').trim();
  if (!id) return { text: 'Which email? Pass its thread_id from the list.', isError: true };
  const { subject, messages, inInbox } = await inbox.backend.read(id);
  if (!messages.length) return { text: `CHECKED NOW: that email is no longer in the mailbox (thread_id=${id}). Say so in one line and move to the next job.` };
  const own = inbox.who.own;
  const isOwn = (m) => own.has(senderAddress(m.from));
  const newest = messages[messages.length - 1];
  // The email the job came from = the newest one that is not their own.
  const theirs = [...messages].reverse().find((m) => !isOwn(m)) || newest;
  const out = [`CHECKED NOW (${brisbaneTime(Date.now())}) - "${subject || '(no subject)'}"`];
  let dealt = false;

  if (inInbox === false) {
    dealt = true;
    out.push('- NO LONGER IN THE INBOX: it has been archived since the list was made - they cleared it themselves. Do not archive it again.');
  } else if (inInbox === true) out.push('- Still in the inbox.');

  if (isOwn(newest) && newest !== theirs) {
    dealt = true;
    out.push(`- THEY HAVE REPLIED IN THIS THREAD: their own message on ${brisbaneTime(newest.date)} is the latest word. "${excerpt(newest.text, 200).replace(/\n/g, ' / ')}"`);
  } else {
    out.push(`- Latest message in the thread: ${brisbaneTime(newest.date)} from ${newest.from}${messages.length > 1 ? ` (${messages.length} messages - if that is newer than the one you listed, the other side has written again: read it with action=read)` : ''}.`);
  }

  const check = await recentSent(inbox, theirs.date);
  if (check.ok) {
    const since = writtenSinceLine(writtenSince({
      date: theirs.date, from: messages.filter((m) => !isOwn(m)).map((m) => senderAddress(m.from)), text: `${subject || ''}\n${messages.map((m) => m.text).join('\n')}`,
    }, check.sent, own));
    if (since) { dealt = true; out.push(`- ${since}`); }
    else out.push('- Sent mail: nothing since this email arrived to anyone it is from or names by full name or address. If the job is about a person it only calls by first name, this is NOT proof - call wingguy_lead_correspondence for them.');
  } else out.push(`- ${sentCheckLines(check)[0]}`);

  out.push('', dealt
    ? 'LOOKS ALREADY DEALT WITH. Do not present this as a job or offer a draft. Say it in ONE line with the fact and the time ("6 of 9 - Simon Steele: you emailed him at 2:44pm - \'Something to share with the Squad team\'. Clearing this one.") and, if it is still in the inbox, archive it - unless what they sent plainly did not cover the job, in which case say what is still open. Then go straight on to the next job, checking that one first.'
    : 'NOT DEALT WITH as far as the mailbox shows. Present the job now.');
  return { text: out.join('\n') };
}

/** archive = out of the inbox; restore = put it back. Reports each by subject so they see what moved. */
async function runMove(args, inbox, archive) {
  const ids = [...new Set((Array.isArray(args.thread_ids) ? args.thread_ids : [args.thread_ids]).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return { text: 'Which emails? Pass thread_ids from the list.', isError: true };
  // One answer, not the same refusal once per email - and nothing is attempted.
  const block = await clearBlock(inbox);
  if (block) return { text: `Couldn't ${archive ? 'archive' : 'restore'} - nothing was moved: ${block}\nTell them exactly that, including the fix if one is given.`, isError: true };
  const done = [];
  const unsure = [];
  const failed = [];
  for (const id of ids) {
    try {
      const { subject, unconfirmed } = await inbox.backend.move(id, archive);
      if (unconfirmed) unsure.push(`- ${subject || '(no subject)'} (thread_id=${id})`);
      else done.push(`- ${subject || '(no subject)'} (thread_id=${id})`);
    } catch (e) {
      failed.push(`- thread_id=${id}: ${e.message}`);
    }
  }
  const lines = [];
  if (done.length) lines.push(`${archive ? 'Archived' : 'Put back in the inbox'} ${done.length}:`, ...done);
  // The mailbox took the move but reading it back did not show it. Never reported as done.
  if (unsure.length) lines.push(`NOT CONFIRMED - ${unsure.length} ${archive ? 'sent to the Archive folder' : 'sent back to the inbox'}, but when I looked again I could not see that it had moved. Tell them plainly: ask them to look in their mailbox for ${unsure.length === 1 ? 'this one' : 'these'} before trusting it, and do not count ${unsure.length === 1 ? 'it' : 'them'} as cleared:`, ...unsure);
  if (failed.length) lines.push(`Couldn't ${archive ? 'archive' : 'restore'} ${failed.length}:`, ...failed);
  if (archive && (done.length || unsure.length)) lines.push('', 'Nothing was deleted. To undo, action=restore with the same thread_ids.');
  return { text: lines.join('\n'), ...(done.length || unsure.length ? {} : { isError: true }) };
}

/** remember / forget a standing inbox instruction - no mailbox needed, just the person's own list. */
async function runInstruction(args, tenant, deps, remember) {
  const store = deps.inboxStore || require('./wingguyInboxStore');
  try {
    if (remember) {
      const saved = await store.addInstruction(tenant, args.text);
      return { text: saved.duplicate
        ? `Already one of your inbox instructions: [${saved.id}] ${saved.body}`
        : `Saved as inbox instruction [${saved.id}]: ${saved.body}\nIt applies from the next time you go through your inbox.` };
    }
    const id = Number(args.instruction_id);
    if (!id) return { text: 'Which instruction? Pass its number from the list at the top of your inbox.', isError: true };
    const body = await store.retireInstruction(tenant, id);
    return body
      ? { text: `Forgotten: [${id}] ${body}` }
      : { text: `There is no inbox instruction [${id}] of yours to forget.`, isError: true };
  } catch (e) {
    return { text: `Couldn't ${remember ? 'save' : 'forget'} that: ${e.message}`, isError: true };
  }
}

async function runInbox(args = {}, tenant = TENANT, deps = {}) {
  const action = args.action || 'list';
  if (!['list', 'read', 'check', 'archive', 'restore', 'remember', 'forget'].includes(action)) {
    return { text: `Unknown action "${action}". Use list, read, check, archive, restore, remember or forget.`, isError: true };
  }
  if (action === 'remember' || action === 'forget') return runInstruction(args, tenant, deps, action === 'remember');
  const inbox = await resolveInbox(tenant, deps);
  if (inbox.error) return { text: inbox.error, isError: true };
  try {
    if (action === 'list') return await runList(args, inbox, tenant, deps);
    if (action === 'read') return await runRead(args, inbox);
    if (action === 'check') return await runCheck(args, inbox);
    return await runMove(args, inbox, action === 'archive');
  } catch (e) {
    return { text: `Couldn't reach your mailbox: ${e.message}`, isError: true };
  }
}

const TOOL_DEFS = [
  {
    name: 'wingguy_inbox',
    description:
      "The person's own email inbox, gone through in chat - \"go through my inbox\", \"what's in my inbox?\", \"clear my inbox\", \"anything I need to deal with?\", \"check my email\". Use THIS for their inbox, not any other email connector: it is their own mailbox (Gmail or Outlook) and knows who their clients and contacts are. You read it for them, tell them in plain English what matters, and clear the rest on their yes.\n\n" +
      'ONE THING AT A TIME - THIS IS THE WHOLE POINT. A full inbox is overwhelming; never answer with a wall of numbered items, nested lists or every email at once (2 Nov 2026: a 13-item answer was "still a bit overwhelming - it should be one at a time"). Keep every message short.\n\n' +
      'FIRST, SILENTLY: action=list, then work out two things before you say a word.\n' +
      '(a) THE JOBS - each thing they actually need to do or decide, most important first. One email can hold several jobs (a report from their own system - Monday campaign numbers, Wingguy Learning, memory tidy-up, the morning brief - is usually several, in system language: turn each into a plain job and drop the rest) or none; several emails can be one job. A QUICK THANKS (below) is a job. A job is something they can act on from this chat, or with one click on a link you give them. NEVER make a job of Claude\'s own housekeeping - note merges, memory contradictions, test results in a memory tidy-up report are handled by Claude Code, not here: leave them out.\n' +
      '(b) THE EASY CLEAR - emails with no job: information, calendar acceptances, automatic notices, newsletters, receipts, copies of mail they sent.\n' +
      'CHECK EVERY JOB LIVE before it goes in the queue (wingguy_list_events for the calendar; wingguy_campaigns for campaigns; wingguy_scheduled_emails for what is queued). An email is a snapshot - on 2 Nov a tidy-up email said Steve\'s call was not on the calendar and the invite had gone 24 minutes after it was sent. A job already done is not a job: fold it into the easy clear ("Steve\'s call - already on your calendar"). Never pass on a job with "I haven\'t checked" - check it, or if nothing can check it, say plainly what to look at.\n' +
      'ANY JOB ABOUT A PERSON - writing to them, chasing them, "re-contact due", "no reply yet", and a RECAP OR NOTES OF A CALL with them (Fathom, Wispr, Zoom - the follow-up may already have gone) - first get their address (wingguy_find_person) and call wingguy_lead_correspondence: it reads the real mailbox, both directions, including what they sent today from their own email outside Wingguy. Look at everything newer than the email or report the job came from. If they have already written to that person, the job is DONE - fold it into the easy clear ("Kay - you wrote to her at 10:15 this morning"). NEVER say "nothing has gone to them", "no reply" or "you haven\'t written" from wingguy_dossier, wingguy_lead_history, a report or your own memory - none of those sees the mailbox. Guy, 2 Nov 2026: a report said Kay was due a welcome-back, Claude said "nothing has gone to her since" and offered to draft one - he had written to her that morning; one more number and she would have had two. The list now does part of this for you: an email carrying "YOU HAVE WRITTEN SINCE THIS EMAIL ARRIVED" names an email they have already sent that person - a fact from their sent mail. Say it ("you emailed Simon at 2:44pm - \'Something to share with the Squad team\'"), read that email, and only offer another if it plainly did not cover the job. Guy, 13 Nov 2026: a recap of his call with Simon Steele was presented with "Nothing has gone to him since" and an offer to draft a follow-up, 1 hour 43 minutes after he had sent one.\n\n' +
      'THEN TALK, IN THIS ORDER:\n' +
      '1. ONE LINE: "12 emails - 5 things for you, 7 can go." Count EMAILS (threads in the list), each once: the two numbers must add up to the total - an email with a job counts under "things for you" only, even when its job turns out already done. (If the list says NOT THE WHOLE INBOX, this line also says how many there are in all and that this covers the newest 50.)\n' +
      '2. THE EASY CLEAR, in one go: one short line per kind, alike ones run together ("Rick\'s 2 calendar acceptances", "3 of your own sent emails", "Rick\'s call is Fri 10:30am - on your calendar"). These are the CAN GO pile; a useful fact rides along in its line (WORTH KNOWING). End with exactly this, using the real numbers: "Type yes to clear these 7. Then I\'ll take you through your 5 things, one at a time." - and STOP. A bare "Clear them?" is not enough: Guy, 2 Nov 2026, a person cannot tell it leaves their own things alone, or that they then come one by one. On yes, archive exactly those, say "Done - 7 cleared." and go straight to job 1 in the same message.\n' +
      '3. THE JOBS, ONE PER MESSAGE. BEFORE YOU SHOW EACH JOB - every one, the first included - call action=check with that job\'s thread_id. The list was made minutes ago and they deal with things in other chats and in their mailbox while you talk; check looks again right now: is the email still in the inbox, who has the latest word, have they written to that person since. If it answers LOOKS ALREADY DEALT WITH, the job is one line ("6 of 9 - Simon Steele: you emailed him at 2:44pm. Clearing this one."), archive it, and go on to the next job in the SAME message - checking that one first too. Never show a job you have not just checked (Guy, 13 Nov 2026: job 6 of 9 offered a follow-up to someone he had already emailed that afternoon). A job with no email of its own to check (it came out of a report) gets the live check its subject needs instead.\n' +
      '   Then the job: "1 of 5 - Kay Ridge." Two or three short sentences: what it is and why now. Then the CHOICES, numbered, each on its own line, the one you recommend first, always ending with Later:\n' +
      '   1 Draft her a welcome-back with times for her first session\n' +
      '   2 Open the email in Gmail\n' +
      '   3 Later\n' +
      '   Say "Type a number." (If this chat can show clickable choices, show them as buttons instead.) STOP and wait. Never show the next job in the same message - the numbers only ever belong to the job on screen. Typing words instead of a number works too.\n' +
      '   When they answer, do it (draft, book, fix the record), confirm in one line, archive that job\'s email once every job in it is decided, then "2 of 5 - ..." "Later" leaves the email in the inbox and moves on; "nothing needed" or "skip" archives it.\n' +
      '   If something can only be done outside this chat, the choice is a link that takes them straight there (the email\'s "Open in Gmail" link from the list, their portal) - never just "go and do it".\n' +
      '4. AT THE END: "That\'s your inbox done." plus one line listing anything they said "later" to.\n' +
      'If they ask to see everything at once, show it - but one at a time is the default, every time.\n\n' +
      'YOUR OWN EMAILS WAITING (only when the list has a YOUR OWN EMAILS WAITING FOR YOUR OK section): these are emails the person is SENDING, not inbox emails - never count them in the inbox numbers or mix them into the jobs. Straight after "That\'s your inbox done." - or, when the inbox is empty, straight after "Your inbox is clear." - ask in one message, with the real count and the soonest send: "4 of your own emails need your OK before Wednesday - they won\'t go without it. Go through them now?" then "1 Yes" / "2 Later" and "Type a number." On 1, take them ONE AT A TIME the same way: show each with the tool named on its line (action=show), then choices 1 Approve it / 2 Change it / 3 Skip this week (for a one-off: 3 Cancel it) / 4 Later. Approve, change, skip or cancel ONLY on their number. Weekly client emails that are not approved never go. When there is no such section, say nothing about it. Guy, 2 Nov 2026 - his approvals were lapsing on days he did not open the review.\n\n' +
      'PILE NAMES: when you name groups, use Needs you (the jobs), Worth knowing and Can go (the easy clear) - the names the person has been told.\n\n' +
      'QUICK THANKS: when a real person wrote to them personally and a short reply would be the courteous thing - a client explaining something, someone answering their question, a favour, good news, a kind word - it is a job: "Worth a quick thanks?" with a one-line reply drafted in their voice, NEVER in the easy clear. Its choices are exactly: 1 Put it in my Drafts (wingguy_create_draft as a threaded reply, reply_to_message_id from the list - it lands in their Drafts and THEY press send; Wingguy never sends, so never say "send"), 2 Change it (they say how, you rewrite and show it again), 3 No reply needed. Archive it only after they have decided. Not for emails that expect no reply: calendar acceptances, automatic notices, their own system reports, newsletters, receipts, copies of mail they sent. Their business runs on relationships - an email from a person never disappears unanswered without their say-so.\n\n' +
      'NOT THE WHOLE INBOX: the list comes 50 at a time. When it starts "NOT THE WHOLE INBOX", your first line must say how many emails there are and how many this covers - never let them think the rest were looked at - and when this batch is done offer the next one (action=list with the page_token it gives).\n\n' +
      'ARCHIVING: only the thread_ids they have said yes to in this chat - the easy clear needs its own yes; a job\'s email goes once they have decided that job. Never on your own judgement, never "while you were at it". Archive takes it out of the inbox and nothing is deleted; action=restore puts it back. If archiving is not switched on for their mailbox, say so plainly and leave it.\n\n' +
      'FIX THE RECORD: when an email changes a fact about a person - an email address that no longer works, a new email or phone number, they have moved - make it part of that email\'s job and offer to fix their record ("Fix Lynne\'s record?"). On their yes use wingguy_update_lead (email, phone, location, LinkedIn URL on the lead\'s record). If the person is on one of their clients\' records rather than their own, say whose record it is instead of changing it. Never change a record without their yes.\n\n' +
      'STANDING INSTRUCTIONS: the list starts with any standing inbox instructions they have given - follow them when sorting (an "always clear" instruction puts those emails in Can go; the yes is still theirs to give). When they say how they always want something handled - "always clear LinkedIn notifications", "always show me anything from the accountant", "never bother me with receipts" - save it with action=remember and text = the instruction in their words, then tell them it is saved. action=forget with instruction_id removes one.\n\n' +
      'action=read with a thread_id gives the whole thread, when you need more than the excerpt. Plain English, what a thing means before what it is called, " - " not an em dash.',
    zodSchema: {
      action: z.enum(['list', 'read', 'check', 'archive', 'restore', 'remember', 'forget']).optional().describe('list (default) | read | check | archive | restore | remember | forget'),
      thread_id: z.string().optional().describe('read / check: the thread_id from the list'),
      thread_ids: z.array(z.string()).optional().describe('archive / restore: the thread_ids they said yes to'),
      max: z.number().optional().describe('list: how many threads, newest first (default and most 50)'),
      page_token: z.string().optional().describe('list: the next batch - exactly the page_token the previous list gave'),
      text: z.string().optional().describe('remember: the standing instruction, in their words'),
      instruction_id: z.number().optional().describe('forget: the instruction number shown at the top of the list'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'check', 'archive', 'restore', 'remember', 'forget'], description: 'list (default) | read | check | archive | restore | remember | forget' },
        thread_id: { type: 'string', description: 'read / check: the thread_id from the list' },
        thread_ids: { type: 'array', items: { type: 'string' }, description: 'archive / restore: the thread_ids they said yes to' },
        max: { type: 'number', description: 'list: how many threads, newest first (default and most 50)' },
        page_token: { type: 'string', description: 'list: the next batch - exactly the page_token the previous list gave' },
        text: { type: 'string', description: 'remember: the standing instruction, in their words' },
        instruction_id: { type: 'number', description: 'forget: the instruction number shown at the top of the list' },
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

// Stamp every sentence a client is told to type into the description of the tool that answers it
// (content/client-phrases.json). Must run before export - see utils/clientPhrases.js for the why.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = {
  registerWingguyInboxTools, legacyToolList, legacyToolCall, TOOL_DEFS, runInbox,
  _test: { cleanBody, bodyText, senderTags, senderAddress, attachmentNames, wingguyMailBackend, resolveInbox, gmailThreadLink, parseAddressList, nameInText, writtenSince },
};
