/**
 * Wingguy mail MCP tools — the CLEAN-LINK DRAFT DOOR.
 *
 * WHY: composing a Gmail draft through Google's hosted Gmail MCP connector rewrites every hyperlink
 * into a `google.com/url?q=...` redirect at compose time (baked into the stored message), so the
 * coach has to hand-fix every link and recipients hit a "you are leaving Google" interstitial.
 * Creating the draft through the coach's own Nylas grant writes the HTML straight to the provider's
 * API (Gmail/Outlook), which does NOT rewrite links — so hyperlinks land exactly as written.
 *
 * ALSO THE THREADED-REPLY DOOR (added 2026-07-16): pass reply_to_message_id and the draft files into
 * the existing conversation (Nylas sets In-Reply-To/References). Before this, a threaded reply forced
 * a fallback to the Gmail connector — which dragged the link-mangling back in; wingguy_find_message
 * is the in-house lookup that supplies the message id, so the whole reply flow stays inside Nylas.
 *
 * ALSO THE ASSET-USAGE GATE (added 2026-07-16): the asset-usage-gates rules say "never send the same
 * asset twice without checking" — unenforceable while Wingguy was write-only for email. Rather than
 * read mailboxes, the door records what IT sent: create_draft detects the tenant's asset-library
 * links in the body ({{asset:key}} tokens resolve to the stored URL; literal library URLs are
 * recognised too), REFUSES a repeat to the same lead unless resend_ok, and writes wingguy_asset_ledger
 * rows on success. wingguy_lead_history reads the ledger back. wingguy_lead_replied_since answers the
 * one narrow inbound question ("did they reply?") via a typed Nylas messages filter — provider-
 * independent, no generic mailbox search, no search_query_native.
 *
 * ALSO THE PERSON-SCOPED READ (added 2026-07-16, same session): wingguy_lead_correspondence (both
 * directions with one person, via Nylas any_email) + wingguy_read_message (one full body, rendered
 * to text). The line held deliberately: person-scoped typed filters only — whole-mailbox keyword
 * search stays OUT (per-provider semantics diverge and the blast radius isn't worth it).
 *
 * Multi-tenant by construction: the draft is created in the coach's OWN mailbox via their Nylas grant
 * (services/mailProvider.js), the same per-tenant model calendarProvider/wingguyCalendar use. Step-1
 * auth posture: tenant hard-wired to the coach client behind the existing connector token (matches
 * wingguyBookingMcp).
 *
 * One definition, BOTH transports (same pattern as wingguyBookingMcp / wingguyRulesMcp):
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 */

const { z } = require('zod');
const mailProvider = require('./mailProvider');
// NOTE: clientService is required LAZILY inside the executor — its Airtable config crashes at module
// load when env vars are absent (local test runs), same reason as wingguyBookingMcp.

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// ---------------------------------------------------------------------------
// Pure core (unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * Detect which asset-library entries a draft body carries, and resolve {{asset:key}} tokens
 * to their stored URLs (URLs go out EXACTLY as stored — same contract as the rules renderer).
 * @param {string} html       the draft body
 * @param {Array}  assetRows  [{asset_key, url, status}] — the tenant's library (getAssets rows)
 * @returns {{html:string, assetKeys:string[], unresolved:string[]}}
 */
function detectAssets(html, assetRows = []) {
  const byKey = new Map();
  for (const a of assetRows) byKey.set(a.asset_key, a);
  const found = new Set();
  const unresolved = [];
  const resolved = String(html || '').replace(/\{\{\s*asset:([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, key) => {
    const a = byKey.get(key);
    if (a && a.url && a.status !== 'retired') { found.add(key); return a.url; }
    unresolved.push(key);
    return whole;
  });
  // Literal URLs: an active library link pasted straight into the body still counts as that asset.
  for (const a of assetRows) {
    if (!a.url || a.status === 'retired' || found.has(a.asset_key)) continue;
    if (resolved.includes(String(a.url).trim())) found.add(a.asset_key);
  }
  return { html: resolved, assetKeys: [...found], unresolved: [...new Set(unresolved)] };
}

/** Lazy store access — null when no database is configured (local runs degrade gracefully). */
function ledgerStore() {
  if (!(process.env.DATABASE_URL || '').trim()) return null;
  return require('./wingguyRulesStore');
}

/**
 * Render an email's HTML body as readable plain text for chat (strip markup, keep line
 * structure, decode the common entities). Not a general HTML parser — good enough for mail.
 */
function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

const BODY_CAP = 6000; // chars of rendered text per message read — keeps chat context sane

// ---------------------------------------------------------------------------
// Executor — returns { text, isError? }
// ---------------------------------------------------------------------------

async function runCreateDraft({ to, subject, html_body, cc, bcc, reply_to, reply_to_message_id, resend_ok } = {}, tenant = TENANT) {
  const recipients = mailProvider.toParticipants(to);
  if (!recipients.length) return { text: 'Error: at least one "to" recipient ({email, name}) is required.', isError: true };
  if (!String(subject || '').trim()) return { text: 'Error: subject is required.', isError: true };
  if (!String(html_body || '').trim()) return { text: 'Error: html_body is required (the draft body, as HTML).', isError: true };

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) before drafting.`, isError: true };
  }

  // --- Asset pass: resolve {{asset:key}} tokens, spot library links, enforce the usage gate ---
  const store = ledgerStore();
  let assetRows = [];
  if (store) {
    try { assetRows = await store.getAssets({ tenantId: tenant }); }
    catch (e) { console.warn(`[wingguyMailMcp] asset library read failed (drafting continues): ${e.message}`); }
  }
  const detected = detectAssets(html_body, assetRows);
  if (detected.unresolved.length) {
    const known = assetRows.filter((a) => a.status !== 'retired' && a.url).map((a) => a.asset_key);
    return {
      text:
        `Draft NOT created — unknown {{asset:...}} placeholder(s): ${detected.unresolved.join(', ')}.\n` +
        (known.length ? `This tenant's asset library has: ${known.join(', ')}.` : 'This tenant\'s asset library is empty (or the store is unreachable) — add the asset with wingguy_assets, or paste the URL directly.'),
      isError: true,
    };
  }
  const leadEmails = recipients.map((r) => r.email.toLowerCase());
  if (store && detected.assetKeys.length && !resend_ok) {
    try {
      const prior = await store.getAssetSendSummary({ tenantId: tenant, leadEmails, assetKeys: detected.assetKeys });
      if (prior.length) {
        const lines = prior.map((p) => `- ${p.asset_key} → ${p.lead_email} (${p.times}×, last ${new Date(p.last_sent_at).toISOString().slice(0, 10)})`);
        return {
          text:
            `Draft NOT created — the asset-usage gate: these asset(s) have ALREADY gone to this lead:\n${lines.join('\n')}\n` +
            `Either drop the repeated link from the draft, or (if re-sending is deliberate — e.g. they asked for it again) call wingguy_create_draft again with resend_ok: true.`,
          isError: true,
        };
      }
    } catch (e) {
      console.warn(`[wingguyMailMcp] asset gate check failed (drafting continues ungated): ${e.message}`);
    }
  }

  const result = await mailProvider.createDraft(coach, {
    subject: String(subject).trim(),
    html: detected.html,
    to: recipients,
    cc,
    bcc,
    replyTo: reply_to,
    replyToMessageId: reply_to_message_id,
  });
  if (!result.ok) return { text: `Draft NOT created. ${result.error}`, isError: true };

  // --- Ledger write (best-effort: the draft exists; a logging failure must not fail the tool) ---
  let ledgerLine = '';
  if (detected.assetKeys.length) {
    if (store) {
      try {
        await store.recordAssetSends({
          tenantId: tenant, leadEmails, assetKeys: detected.assetKeys,
          draftId: result.draftId, threadId: result.threadId, subject: String(subject).trim(),
        });
        ledgerLine = `Asset ledger: logged ${detected.assetKeys.join(', ')} → ${leadEmails.join(', ')} (wingguy_lead_history shows a lead's full record).\n`;
      } catch (e) {
        ledgerLine = `⚠ Asset ledger write FAILED (${e.message}) — the draft exists but ${detected.assetKeys.join(', ')} was not recorded.\n`;
      }
    } else {
      ledgerLine = `⚠ Asset(s) ${detected.assetKeys.join(', ')} detected but no database configured — nothing recorded in the ledger.\n`;
    }
  }

  const toStr = recipients.map((r) => r.email).join(', ');
  const bccStr = mailProvider.toParticipants(bcc).map((r) => r.email).join(', ');
  const threadLine = reply_to_message_id
    ? `Threaded REPLY to message ${reply_to_message_id}${result.threadId ? ` (thread ${result.threadId})` : ''} — it sits in the existing conversation, not as a new email.\n`
    : '';
  return {
    text:
      `Draft created in ${coach.clientName || tenant}'s mailbox (Nylas). draftId=${result.draftId}\n` +
      threadLine +
      ledgerLine +
      `To: ${toStr}${bccStr ? ` · Bcc: ${bccStr}` : ''} · Subject: ${String(subject).trim()}\n` +
      `Hyperlinks are stored verbatim (no google.com/url wrapping) — open the draft, give it a final read, and send. No manual link-fixing needed.`,
  };
}

async function runFindMessage({ from, subject, thread_id, limit } = {}, tenant = TENANT) {
  if (!String(from || '').trim() && !String(subject || '').trim() && !String(thread_id || '').trim()) {
    return { text: 'Error: give at least one of "from" (sender email), "subject", or "thread_id" to search on.', isError: true };
  }

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) first.`, isError: true };
  }

  const result = await mailProvider.findMessages(coach, { from, subject, threadId: thread_id, limit });
  if (!result.ok) return { text: `Message search failed. ${result.error}`, isError: true };
  if (!result.messages.length) {
    return { text: 'No messages matched. Try a looser search (sender email only), or check the address is right.' };
  }

  const lines = result.messages.map((m, i) =>
    `${i + 1}. messageId=${m.id} · threadId=${m.threadId}\n` +
    `   From: ${m.from} · ${m.date || 'no date'}\n` +
    `   Subject: ${m.subject || '(none)'}\n` +
    `   ${String(m.snippet || '').slice(0, 140)}`);
  return {
    text:
      `${result.messages.length} message(s), newest first. To draft a threaded reply, pass the messageId of the message being replied to as reply_to_message_id on wingguy_create_draft.\n\n` +
      lines.join('\n'),
  };
}

async function runLeadHistory({ lead_email, limit } = {}, tenant = TENANT) {
  const lead = String(lead_email || '').trim().toLowerCase();
  if (!lead) return { text: 'Error: lead_email is required.', isError: true };
  const store = ledgerStore();
  if (!store) return { text: 'Server config error: no database configured — the asset ledger is unavailable.', isError: true };

  let rows;
  try { rows = await store.getLeadAssetHistory({ tenantId: tenant, leadEmail: lead, limit }); }
  catch (e) { return { text: `Ledger read failed: ${e.message}`, isError: true }; }
  if (!rows.length) {
    return { text: `No assets on record for ${lead} — nothing has been drafted to them through Wingguy. (The ledger starts 2026-07-16; earlier sends are not in it.)` };
  }
  const lines = rows.map((r) =>
    `- ${r.asset_key} · ${new Date(r.sent_at).toISOString().slice(0, 10)} · "${r.subject || '(no subject)'}"${r.thread_id ? ` · thread ${r.thread_id}` : ''}`);
  return {
    text:
      `Assets already sent to ${lead} (${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}, newest first — drafted through Wingguy since 2026-07-16):\n` +
      `${lines.join('\n')}\n` +
      `Per the asset-usage gates, don't send any of these again unless the lead asks (resend_ok: true overrides deliberately).`,
  };
}

async function runReadMessage({ message_id } = {}, tenant = TENANT) {
  const id = String(message_id || '').trim();
  if (!id) return { text: 'Error: message_id is required (find it with wingguy_find_message or wingguy_lead_correspondence).', isError: true };

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) first.`, isError: true };
  }

  const result = await mailProvider.getMessage(coach, id);
  if (!result.ok) return { text: `Message read failed. ${result.error}`, isError: true };
  const m = result.message;
  const body = htmlToText(m.body) || String(m.snippet || '');
  const capped = body.length > BODY_CAP ? `${body.slice(0, BODY_CAP)}\n[... truncated — ${body.length - BODY_CAP} more characters]` : body;
  return {
    text:
      `From: ${m.from || '(unknown)'}\nTo: ${m.to || '(unknown)'}${m.cc ? `\nCc: ${m.cc}` : ''}\n` +
      `Date: ${m.date || '(unknown)'}\nSubject: ${m.subject || '(none)'}\n` +
      `(messageId=${m.id} · threadId=${m.threadId} — pass the messageId as reply_to_message_id to reply in this thread.)\n\n` +
      capped,
  };
}

async function runLeadCorrespondence({ lead_email, since_iso, limit } = {}, tenant = TENANT) {
  const lead = String(lead_email || '').trim();
  if (!lead) return { text: 'Error: lead_email is required.', isError: true };
  let receivedAfter;
  let sinceMs;
  if (String(since_iso || '').trim()) {
    sinceMs = Date.parse(String(since_iso).trim());
    if (Number.isNaN(sinceMs)) return { text: 'Error: since_iso must be an ISO 8601 date/time, e.g. "2026-06-01".', isError: true };
    receivedAfter = Math.floor(sinceMs / 1000);
  }

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) first.`, isError: true };
  }

  const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20);
  let result = await mailProvider.findMessages(coach, { anyEmail: lead, receivedAfter, limit: cap });
  if (result.ok && !result.messages.length && sinceMs && (Date.now() - sinceMs) > IMAP_CACHE_DAYS * 86400000) {
    const live = await mailProvider.findMessages(coach, { anyEmail: lead, receivedAfter, limit: cap, queryImap: true });
    if (live.ok) result = live; // a non-IMAP grant may reject the flag — keep the cached answer then
  }
  if (!result.ok) return { text: `Correspondence lookup failed. ${result.error}`, isError: true };
  if (!result.messages.length) {
    return { text: `No emails either way with ${lead}${since_iso ? ` since ${new Date(sinceMs).toISOString().slice(0, 10)}` : ''}.` };
  }

  const leadLc = lead.toLowerCase();
  const lines = result.messages.map((m, i) => {
    const dir = (m.fromEmail || '').toLowerCase() === leadLc ? '⬅ FROM them' : '➡ TO them';
    return `${i + 1}. ${dir} · ${m.date ? m.date.slice(0, 10) : 'no date'} · "${m.subject || '(none)'}"\n` +
      `   ${String(m.snippet || '').slice(0, 140)}\n` +
      `   messageId=${m.id} · threadId=${m.threadId}`;
  });
  return {
    text:
      `${result.messages.length} email(s) with ${lead}, newest first. Read one in full with wingguy_read_message (its message_id); reply in-thread via wingguy_create_draft reply_to_message_id.\n\n` +
      lines.join('\n'),
  };
}

// IMAP grants (e.g. Zoho mail) serve a ~90-day rolling cache; older windows need a live
// query_imap pass. OAuth grants (Gmail/Microsoft) never need it — so try cached first and only
// fall back for old windows, keeping the common case a single round-trip on every provider.
const IMAP_CACHE_DAYS = 90;

async function runLeadRepliedSince({ lead_email, since_iso } = {}, tenant = TENANT) {
  const lead = String(lead_email || '').trim();
  if (!lead) return { text: 'Error: lead_email is required.', isError: true };
  const sinceMs = Date.parse(String(since_iso || '').trim());
  if (Number.isNaN(sinceMs)) return { text: 'Error: since_iso must be an ISO 8601 date/time, e.g. "2026-06-01" or "2026-06-01T00:00:00+10:00".', isError: true };

  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.nylasGrantId) {
    return { text: `No Nylas grant on file for "${tenant}" — connect the mailbox via Nylas (with mail scope) first.`, isError: true };
  }

  const receivedAfter = Math.floor(sinceMs / 1000);
  let result = await mailProvider.findMessages(coach, { from: lead, receivedAfter, limit: 3 });
  if (result.ok && !result.messages.length && (Date.now() - sinceMs) > IMAP_CACHE_DAYS * 86400000) {
    const live = await mailProvider.findMessages(coach, { from: lead, receivedAfter, limit: 3, queryImap: true });
    if (live.ok) result = live; // a non-IMAP grant may reject the flag — keep the cached answer then
  }
  if (!result.ok) return { text: `Inbound check failed. ${result.error}`, isError: true };

  const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);
  if (!result.messages.length) {
    return { text: `NO — no inbound email from ${lead} since ${sinceDay}.` };
  }
  const m = result.messages[0];
  return {
    text:
      `YES — ${lead} has replied. Last inbound: ${m.date || 'date unknown'} · "${m.subject || '(no subject)'}"\n` +
      `${String(m.snippet || '').slice(0, 160)}\n` +
      `(messageId=${m.id} · threadId=${m.threadId} — pass the messageId as reply_to_message_id to reply in that thread.)`,
  };
}

// ---------------------------------------------------------------------------
// Definition — one source of truth for name/description/schema
// ---------------------------------------------------------------------------

const RECIP_DESC = 'Recipients as objects {email, name}. name is optional but preferred (shows in the To line).';

const REPLY_ID_DESC =
  'Optional: to make this draft a threaded REPLY in an existing conversation, pass the Nylas message id of the message being replied to (find it with wingguy_find_message). Nylas sets the reply headers and files the draft on that thread. Omit for a fresh standalone email.';

const RESEND_OK_DESC =
  'Optional: set true ONLY when deliberately re-sending an asset this lead already received (e.g. they asked for the link again). Without it the asset-usage gate refuses a draft that repeats an asset to the same lead.';

const TOOL_DEFS = [
  {
    name: 'wingguy_create_draft',
    description:
      'Create an email DRAFT (never sends) in the coach\'s own mailbox with hyperlinks intact. ALWAYS use this instead of the Gmail connector — for links because the Gmail connector rewrites every link into a google.com/url redirect (this does not), and for replies because this threads too: pass reply_to_message_id (from wingguy_find_message) and the draft lands IN the existing conversation. html_body is the full HTML body; put real <a href="...">text</a> links in and they are stored exactly as written; {{asset:key}} placeholders resolve to the asset library\'s stored URL. ASSET GATE: library links in the body are logged per-lead at draft time, and a draft repeating an asset to the same lead is refused unless resend_ok — check wingguy_lead_history when unsure. Returns a draftId; the coach opens the draft, reads it, and sends it themselves.',
    zodSchema: {
      to: z.array(z.object({ email: z.string(), name: z.string().optional() })).describe(RECIP_DESC),
      subject: z.string().describe('The email subject line.'),
      html_body: z.string().describe('The full email body as HTML. Use real <a href="…">…</a> anchors for links — they land clean (no redirect wrapping).'),
      cc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Cc recipients {email, name}.'),
      bcc: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Bcc recipients {email, name} — e.g. the tracking address.'),
      reply_to: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional().describe('Optional Reply-To {email, name}.'),
      reply_to_message_id: z.string().optional().describe(REPLY_ID_DESC),
      resend_ok: z.boolean().optional().describe(RESEND_OK_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', description: RECIP_DESC, items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        subject: { type: 'string', description: 'The email subject line.' },
        html_body: { type: 'string', description: 'The full email body as HTML. Use real <a href="…">…</a> anchors for links — they land clean (no redirect wrapping).' },
        cc: { type: 'array', description: 'Optional Cc recipients {email, name}.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        bcc: { type: 'array', description: 'Optional Bcc recipients {email, name} — e.g. the tracking address.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        reply_to: { type: 'array', description: 'Optional Reply-To {email, name}.', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } },
        reply_to_message_id: { type: 'string', description: REPLY_ID_DESC },
        resend_ok: { type: 'boolean', description: RESEND_OK_DESC },
      },
      required: ['to', 'subject', 'html_body'],
    },
    run: runCreateDraft,
  },
  {
    name: 'wingguy_find_message',
    description:
      'Search recent messages in the coach\'s own mailbox (via their Nylas grant) and return message ids — the lookup step before drafting a threaded reply with wingguy_create_draft. Give the sender\'s email (from) and/or a subject; returns messageId + threadId + snippet, newest first. Read-only, works on any mailbox provider (Gmail, Outlook, IMAP).',
    zodSchema: {
      from: z.string().optional().describe('Sender email address to match, e.g. the lead being replied to.'),
      subject: z.string().optional().describe('Subject line to match.'),
      thread_id: z.string().optional().describe('Nylas thread id — list the messages on one known thread.'),
      limit: z.number().optional().describe('Max results (default 5, max 20).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Sender email address to match, e.g. the lead being replied to.' },
        subject: { type: 'string', description: 'Subject line to match.' },
        thread_id: { type: 'string', description: 'Nylas thread id — list the messages on one known thread.' },
        limit: { type: 'number', description: 'Max results (default 5, max 20).' },
      },
      required: [],
    },
    run: runFindMessage,
  },
  {
    name: 'wingguy_lead_history',
    description:
      'What has this lead already been SENT? Reads the asset ledger (written by wingguy_create_draft at draft time — no mailbox access) and lists every asset-library link already drafted to a lead, with dates and subjects. THE CHECK BEHIND THE ASSET-USAGE GATES: call it before composing an email that includes an asset link, or when the human asks "have I sent them X yet?". Ledger starts 2026-07-16 — sends before that are not in it.',
    zodSchema: {
      lead_email: z.string().describe('The lead\'s email address.'),
      limit: z.number().optional().describe('Max entries (default 50, max 200).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_email: { type: 'string', description: 'The lead\'s email address.' },
        limit: { type: 'number', description: 'Max entries (default 50, max 200).' },
      },
      required: ['lead_email'],
    },
    run: runLeadHistory,
  },
  {
    name: 'wingguy_lead_replied_since',
    description:
      'Has this lead REPLIED by email since a given date? Checks the coach\'s own mailbox (via their Nylas grant — works on Gmail, Outlook, IMAP/Zoho alike) for inbound messages FROM the lead after since_iso, and answers YES with the last inbound message (date, subject, messageId for a threaded reply) or NO. Use before follow-ups: "did they ever come back to me?", "any reply since the call?". Narrow by design — one lead, one question; it is not a mailbox search.',
    zodSchema: {
      lead_email: z.string().describe('The lead\'s email address (the sender to look for).'),
      since_iso: z.string().describe('ISO 8601 date/time — count only messages received AFTER this, e.g. "2026-06-01".'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_email: { type: 'string', description: 'The lead\'s email address (the sender to look for).' },
        since_iso: { type: 'string', description: 'ISO 8601 date/time — count only messages received AFTER this, e.g. "2026-06-01".' },
      },
      required: ['lead_email', 'since_iso'],
    },
    run: runLeadRepliedSince,
  },
  {
    name: 'wingguy_read_message',
    description:
      'Read ONE email in full from the coach\'s own mailbox (via their Nylas grant — Gmail, Outlook, IMAP/Zoho alike): from/to/date/subject + the body as readable text. Use when the human says "read me their reply" / "what did that email say" — get the message_id from wingguy_find_message, wingguy_lead_correspondence, or wingguy_lead_replied_since first. Read-only; long bodies are truncated.',
    zodSchema: {
      message_id: z.string().describe('The Nylas message id to read (from wingguy_find_message / wingguy_lead_correspondence).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The Nylas message id to read (from wingguy_find_message / wingguy_lead_correspondence).' },
      },
      required: ['message_id'],
    },
    run: runReadMessage,
  },
  {
    name: 'wingguy_lead_correspondence',
    description:
      'List the recent email correspondence with ONE person, BOTH directions (their messages and the coach\'s), newest first — date, subject, snippet, direction, messageId. Use for "show me my emails with X" / "where did we leave things with X". Works on any provider via the coach\'s own Nylas grant. Person-scoped by design — it is not a mailbox keyword search. Follow up with wingguy_read_message (full body) or wingguy_create_draft reply_to_message_id (threaded reply).',
    zodSchema: {
      lead_email: z.string().describe('The person\'s email address (matches from/to/cc/bcc).'),
      since_iso: z.string().optional().describe('Optional ISO 8601 date — only messages received after this.'),
      limit: z.number().optional().describe('Max messages (default 10, max 20).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_email: { type: 'string', description: 'The person\'s email address (matches from/to/cc/bcc).' },
        since_iso: { type: 'string', description: 'Optional ISO 8601 date — only messages received after this.' },
        limit: { type: 'number', description: 'Max messages (default 10, max 20).' },
      },
      required: ['lead_email'],
    },
    run: runLeadCorrespondence,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyBookingMcp)
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register all mail tools on an McpServer instance.
 *  `tenant` scopes the draft to the caller's client (per-request; defaults to Guy). */
function registerWingguyMailTools(server, tenant = TENANT) {
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

module.exports = { registerWingguyMailTools, legacyToolList, legacyToolCall, TOOL_DEFS, detectAssets, htmlToText };
