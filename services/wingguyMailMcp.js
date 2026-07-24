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

// A library URL counts as "in the body" only where it appears as a whole link, not as a prefix of
// a longer one. Without the boundary check, an asset at .../benefits-page-v1/ matches inside
// .../benefits-page-v1/pricing and both keys get logged off one send.
function bodyCarriesUrl(body, url) {
  const u = String(url || '').trim();
  if (!u) return false;
  const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Followed by a URL terminator (quote, whitespace, <, >) or end-of-string — never by more path.
  return new RegExp(`${esc}(?=["'\\s<>]|$)`).test(body);
}

/**
 * Detect which asset-library entries a draft body carries, and resolve {{asset:key}} tokens
 * to their stored URLs (URLs go out EXACTLY as stored — same contract as the rules renderer).
 *
 * TWO KEYS CAN SHARE ONE URL (e.g. signup_link and cost_benefit_page both pointing at the
 * benefits page for different purposes). The ledger's unit is the ASSET KEY, not the URL, so the
 * literal-URL scan runs over the ORIGINAL body — scanning the resolved body would let a token's
 * own expansion match its URL twin, silently burning that twin's usage gate off one send
 * (observed live 2026-07-17: drafting cost_benefit_page logged signup_link too).
 *
 * @param {string} html       the draft body
 * @param {Array}  assetRows  [{asset_key, url, status}] — the tenant's library (getAssets rows)
 * @returns {{html:string, assetKeys:string[], unresolved:string[]}}
 */
function detectAssets(html, assetRows = []) {
  const byKey = new Map();
  for (const a of assetRows) byKey.set(a.asset_key, a);
  const found = new Set();
  const unresolved = [];
  const original = String(html || '');
  const resolved = original.replace(/\{\{\s*asset:([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, key) => {
    const a = byKey.get(key);
    if (a && a.url && a.status !== 'retired') { found.add(key); return a.url; }
    unresolved.push(key);
    return whole;
  });
  // Literal URLs: an active library link pasted straight into the body still counts as that asset.
  // Scanned against the ORIGINAL body — see the URL-twin note above.
  for (const a of assetRows) {
    if (!a.url || a.status === 'retired' || found.has(a.asset_key)) continue;
    if (bodyCarriesUrl(original, a.url)) found.add(a.asset_key);
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
// Follow-up sweep — pure core (Stage A: who-spoke-last + gates + rank)
// ---------------------------------------------------------------------------
// Read-only, stores NOTHING: the list is rebuilt from live data every call (the whole point — a
// stored follow-up list rots, a re-read of the real conversation can't). Merges the email window
// with the LinkedIn history in each lead's Notes, applies the gates (Cease FUP / On-Series suppress
// CADENCE only — a reply or a due deferral always surfaces), and ranks by closeness-to-broken-
// promise. See docs/PREP-ME-FOR-TODAY-FEATURE.md §13.

const SWEEP_WINDOW_DAYS = 90;    // the FEATURE window — how far back a follow-up can surface (settled: 90)
const EMAIL_READ_DAYS = 45;      // how far back we READ email live — shorter than the window because the
                                 // deep history comes from LinkedIn (free, already in Notes); deep-reading
                                 // months of mail is slow and 504s. The overnight pre-read can go full-depth.
const CADENCE_OVERDUE_DAYS = 14; // "you spoke last and went silent this long" = a cadence nudge
const CADENCE_MAX_DAYS = 45;     // beyond this a silence is too cold for a "just following up" nudge — it
                                 // needs a proper re-engagement, so it drops off (a later re-engage tier can own it)
// "Ball's in your court" only counts as LIVE if the reply is recent — a reply you haven't answered
// in a couple of days is the one to jump on; past this it's gone cold or been handled elsewhere, so
// it drops off rather than nagging (Guy's call 2026-07-22, after a real-data test surfaced 6-month-
// old dead threads at the top). Reply-owed is ranked MOST-RECENT-FIRST.
const REPLY_LIVE_DAYS = 30;
// Deferral store guard — a Reconnect-On date this far past is treated as stale, not a live "contact
// me on this day". (Reconnect On is engine-written and clean, so this is just belt-and-braces.)
const DEFERRAL_LIVE_DAYS = 45;
// Calendar cross-check: look this far forward for an already-booked meeting with a surfaced lead
// (don't nag someone who's already in your diary). Covers the cadence/deferral horizon comfortably.
const CAL_LOOKAHEAD_DAYS = 60;

// "DD-MM-YY H:MM AM - <Sender Name> - <text>" — the line format inside the Notes LinkedIn block.
const LI_MSG_RE = /^(\d{2})-(\d{2})-(\d{2})\s+\d{1,2}:\d{2}\s*[AP]M\s*-\s*(.+?)\s*-\s*/i;

/**
 * Newest LinkedIn message in a lead's Notes: { ms, inbound } or null. The block is newest-first, so
 * the first parseable line wins. Inbound = the sender line names the LEAD (their first name); any
 * other name is the coach — which avoids hard-coding the coach's name, so it works per-tenant.
 * (Heuristic: a lead whose first name collides with the coach's could misread — acceptable for v1.)
 */
function parseLinkedInLast(notes, leadFirstName) {
  const block = String(notes || '');
  const start = block.indexOf('=== LINKEDIN MESSAGES ===');
  if (start === -1) return null;
  let seg = block.slice(start);
  const nextHdr = seg.indexOf('\n=== ', 1);
  if (nextHdr !== -1) seg = seg.slice(0, nextHdr);
  const first = String(leadFirstName || '').trim().toLowerCase();
  for (const raw of seg.split('\n')) {
    const m = raw.trim().match(LI_MSG_RE);
    if (!m) continue;
    const [, dd, mm, yy, sender] = m;
    const ms = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd));
    if (Number.isNaN(ms)) continue;
    return { ms, inbound: first ? sender.toLowerCase().includes(first) : false };
  }
  return null;
}

/** Read Airtable's singleSelect cell as a plain string (airtable.js gives a string; be defensive). */
function selectName(v) { return (v && typeof v === 'object' ? v.name : v) || ''; }

const MS_DAY = 86400000;

/**
 * Derive per-lead email signals from the mailbox window, THREAD-AWARE and 1:1-ONLY. A message counts
 * for a lead only on a thread whose participant set (union of from/to/cc across all its messages) is
 * exactly {you, that lead} — i.e. exactly 2 distinct parties, one of them a lead. On such a thread a
 * message FROM the lead is inbound (they wrote to you); anything else is your outbound (by
 * elimination — in your own mailbox the only other party is you). Threads with 3+ parties
 * (introductions, group threads) are ignored, so brokering an intro never manufactures a phantom
 * "reply owed". Pure — no I/O — unit-tested.
 * @param {Array} messages   from mailProvider.listRecent: { fromEmail, toEmails, ccEmails, threadId, date }
 * @param {Set<string>} leadEmails  lowercased lead emails present in the base
 * @returns {Map<string,{lastInboundMs:number|null,lastOutboundMs:number|null}>} keyed by lead email
 */
function computeMailSignals(messages, leadEmails) {
  // Group by thread, collecting each thread's full participant set + its messages.
  const threads = new Map();
  for (const m of (messages || [])) {
    if (!m.date) continue;
    const ms = new Date(m.date).getTime();
    if (Number.isNaN(ms)) continue;
    const tid = m.threadId || `__solo__${m.id}`; // a thread-less message is its own 1-message thread
    let th = threads.get(tid);
    if (!th) { th = { parties: new Set(), msgs: [] }; threads.set(tid, th); }
    const from = (m.fromEmail || '').toLowerCase();
    if (from) th.parties.add(from);
    for (const e of (m.toEmails || [])) if (e) th.parties.add(String(e).toLowerCase());
    for (const e of (m.ccEmails || [])) if (e) th.parties.add(String(e).toLowerCase());
    th.msgs.push({ from, ms });
  }

  const out = new Map();
  for (const th of threads.values()) {
    if (th.parties.size !== 2) continue;          // 3+ parties = intro/group → not a 1:1 reply signal
    let leadEmail = null;
    for (const p of th.parties) if (leadEmails.has(p)) { leadEmail = p; break; }
    if (!leadEmail) continue;                       // neither party is a lead → nothing to attribute
    let sig = out.get(leadEmail);
    if (!sig) { sig = { lastInboundMs: null, lastOutboundMs: null }; out.set(leadEmail, sig); }
    for (const msg of th.msgs) {
      if (msg.from === leadEmail) { if (!sig.lastInboundMs || msg.ms > sig.lastInboundMs) sig.lastInboundMs = msg.ms; }
      else if (!sig.lastOutboundMs || msg.ms > sig.lastOutboundMs) sig.lastOutboundMs = msg.ms; // other party = you
    }
  }
  return out;
}

/**
 * Classify one lead from its merged signals into a surfaced item or null. Pure — no I/O — so the
 * ranking logic is unit-testable. `nowMs`/`todayMidMs` passed in (Date.now is unavailable in some
 * sandboxes and keeps this deterministic for tests).
 */
function classifyLead(lead, { lastInboundMs, lastOutboundMs, nowMs, todayMidMs }) {
  // Deferral tier reads the engine-written `Reconnect On` date. Until that field exists on the bases
  // and the content-read populates it, lead.reconnectOn is null everywhere → no deferral surfaces
  // (deliberate: the rotted legacy Follow-Up Date must NOT drive the engine).
  let deferralLive = false; let deferDays = 0; let reconnectFuture = false;
  if (lead.reconnectOn) {
    const dt = Date.parse(lead.reconnectOn);
    if (!Number.isNaN(dt)) {
      const d = Math.floor((todayMidMs - dt) / MS_DAY); // >0 = past
      if (d >= 0 && d <= DEFERRAL_LIVE_DAYS) { deferralLive = true; deferDays = d; }
      else if (d < 0) { reconnectFuture = true; }       // promised date still ahead → parked (no early cadence nudge)
    }
  }
  const replyWaiting = !!lastInboundMs && (!lastOutboundMs || lastInboundMs > lastOutboundMs);
  const inboundDays = lastInboundMs ? Math.floor((nowMs - lastInboundMs) / MS_DAY) : null;
  const outboundDays = lastOutboundMs ? Math.floor((nowMs - lastOutboundMs) / MS_DAY) : null;
  const cadenceOverdue = !replyWaiting && !!lastOutboundMs && outboundDays >= CADENCE_OVERDUE_DAYS;
  const gated = lead.cease || lead.onSeries; // suppress CADENCE only

  // Reply owed and a due deferral surface even when gated (Cease/Series); cadence is the only thing
  // those gates silence. A FUTURE Reconnect On is different: it's an explicit, dated human decision
  // ("park her till September") usually made BECAUSE of what their last reply said — so it silences
  // the reply signal too, or the parked person re-nags daily until the reply ages out (the Marianne
  // re-nag, observed live 2026-07-23 an hour after stamping her). Known trade-off: a NEW message
  // from a parked lead won't resurface them here until their date — the human's own inbox covers it.
  if (replyWaiting && inboundDays <= REPLY_LIVE_DAYS) {
    if (reconnectFuture) return { tier: null, gatedCadence: true };
    return { tier: 'reply', why: `they replied ${inboundDays}d ago — ball's in your court`, sortKey: -inboundDays, gated };
  }
  if (deferralLive) return { tier: 'deferral', why: `reconnect date reached (${deferDays === 0 ? 'today' : deferDays + 'd ago'})`, sortKey: deferDays, gated };
  if (cadenceOverdue) {
    if (outboundDays > CADENCE_MAX_DAYS) return null;                                   // too cold — needs re-engagement, drop
    if (gated) return { tier: null, gatedCadence: true };                              // Cease/Series → cadence off
    if (reconnectFuture) return { tier: null, gatedCadence: true };                    // parked until their reconnect date → no early nudge
    // Decision B: only chase "went quiet" for a REAL relationship (connected, or they've replied at least
    // once). Pure cold outreach that was simply ignored is not an owed follow-up — drop it.
    if (!(lead.connected || !!lastInboundMs)) return { tier: null, coldCadence: true };
    // Recent-first, like reply-owed: a fresh silence is the most naturally nudgeable (sortKey = -days).
    return { tier: 'cadence', why: `you messaged last, ${outboundDays}d silent`, sortKey: -outboundDays, gated: false };
  }
  return null;
}

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

  // Learn-from-my-edit (email half): log the generated body so the review tool can later diff it
  // against what ACTUALLY went out after the human edited it in their mail client. Best-effort —
  // the draft exists; a ledger miss must never fail the tool.
  if (store) {
    try {
      await store.recordDraftBody({
        tenantId: tenant,
        draftId: result.draftId,
        threadId: result.threadId,
        toEmail: leadEmails[0],
        subject: String(subject).trim(),
        generated: htmlToText(detected.html),
      });
    } catch (e) {
      console.warn(`[wingguyMailMcp] draft-ledger write failed (non-fatal): ${e.message}`);
    }
  }

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

// Ranking = closeness-to-broken-promise (the settled 2026-07-21 design): a DUE DATED PROMISE
// outranks a recent reply — forgetting "I said I'd ping you today" costs more than a slow answer.
// (Was reply-first until 2026-07-24, which buried ten due promises below the prepared fold.)
const TIER_ORDER = { deferral: 0, reply: 1, cadence: 2 };
const TIER_LABEL = { reply: '↩ REPLY OWED', deferral: '📅 DEFERRAL DUE', cadence: '⏳ WENT QUIET' };

/**
 * The follow-up sweep core (Stage A), STRUCTURED. Rebuilds "who do I owe a follow-up, and in what
 * order" live from the tenant's mailbox + LinkedIn history (lead Notes) + the gates on each lead
 * record. Stores nothing. Returns { ok, coach, surfaced (ranked, uncapped), counts, ... } for the
 * brief PREPARER and the text tool alike — runFollowupSweep wraps this with cap + formatting.
 */
async function computeFollowupSweep({ window_days } = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { ok: false, error: `Server config error: coach client "${tenant}" not found.` };
  if (!coach.airtableBaseId) return { ok: false, error: `No Airtable base on file for "${tenant}" — can't read the leads.` };
  if (!coach.nylasGrantId) return { ok: false, error: `No Nylas grant on file for "${tenant}" — connect the mailbox (Nylas, mail scope) first.` };

  const windowDays = Math.min(Math.max(parseInt(window_days, 10) || SWEEP_WINDOW_DAYS, 7), 180);
  const nowMs = Date.now();
  // "Today" is the COACH's day, not UTC's (Guy 2026-07-24: a stamp dated "24 July" must fire on
  // his 24 July morning, not at UTC midnight = 10am AEST). Day boundary = midnight in the coach's
  // timezone; falls back to UTC when no timezone is on the client record.
  // Implementation note: Reconnect On values parse as UTC midnight of their civil date, so
  // "today" must be the coach's CIVIL DATE also expressed as UTC midnight — then day arithmetic
  // against stamps stays exact.
  let todayMidMs;
  try {
    const { DateTime } = require('luxon');
    const local = DateTime.fromMillis(nowMs, { zone: coach.timezone || 'UTC' });
    if (!local.isValid) throw new Error('invalid zone');
    todayMidMs = Date.UTC(local.year, local.month - 1, local.day);
  } catch (_) {
    const td = new Date(nowMs);
    todayMidMs = Date.UTC(td.getUTCFullYear(), td.getUTCMonth(), td.getUTCDate());
  }
  const afterMs = nowMs - windowDays * MS_DAY;                     // LinkedIn / feature window (full depth)
  const emailDays = Math.min(windowDays, EMAIL_READ_DAYS);         // email read is shallower (deep history = LinkedIn)
  const emailAfterSec = Math.floor((nowMs - emailDays * MS_DAY) / 1000);

  // --- 1. Leads from the tenant's own base ---
  // NB: `Reconnect On` is NOT read yet — the field doesn't exist on the bases (adding it is a TODO)
  // and requesting an unknown field 422s. The legacy `Follow-Up Date` is deliberately NOT read (rot).
  let records;
  const BASE_LEAD_FIELDS = ['First Name', 'Last Name', 'Email', 'Cease FUP', 'Notes', 'Series Sent Count', 'Series Unsubscribed', 'Date Connected', 'LinkedIn Profile URL'];
  try {
    const base = clientService.getClientBase(coach.airtableBaseId);
    try {
      // Reconnect On is the engine's deferral-date store (added 2026-07-23). Ask for it first.
      records = await base('Leads').select({ fields: [...BASE_LEAD_FIELDS, 'Reconnect On'] }).all();
    } catch (e) {
      // A tenant base that predates the Reconnect On rollout 422s on the unknown field — fall back
      // to reading without it (their deferral tier simply stays dormant, no break).
      if (/Reconnect On|UNKNOWN_FIELD_NAME|422|INVALID|Unknown field/i.test(e.message)) {
        records = await base('Leads').select({ fields: BASE_LEAD_FIELDS }).all();
      } else {
        throw e;
      }
    }
  } catch (e) {
    return { ok: false, error: `Lead read failed: ${e.message}` };
  }

  const leads = [];
  const byEmail = new Map();
  for (const r of records) {
    const f = r.fields || {};
    const email = String(f['Email'] || '').trim().toLowerCase();
    const lead = {
      recId: r.id, // Airtable record id — links to recall_meeting_leads for the dossier's transcripts
      first: f['First Name'] || '',
      last: f['Last Name'] || '',
      email,
      reconnectOn: f['Reconnect On'] || null, // engine's deferral-date store; null where the field is absent/unset
      linkedinUrl: String(f['LinkedIn Profile URL'] || '').trim() || null, // for hyperlinked names in the brief
      cease: selectName(f['Cease FUP']) === 'Yes',
      onSeries: Number(f['Series Sent Count'] || 0) > 0 && f['Series Unsubscribed'] !== true,
      connected: !!f['Date Connected'], // real-relationship signal for the cadence gate (Decision B)
      notes: f['Notes'] || '',
      lastInboundMs: null,
      lastOutboundMs: null,
    };
    leads.push(lead);
    if (email) byEmail.set(email, lead);
  }

  // --- 2. Mail window: ONE paginated read, then THREAD-AWARE 1:1 signals ---
  // The old code marked a lead "inbound" for ANY message they sent into the mailbox and "outbound"
  // for ANY message they were a recipient of — thread-blind and recipient-blind, so every intro Guy
  // brokered (he's cc on a thread between two other people) manufactured a phantom "reply owed".
  // computeMailSignals fixes that: a message only counts on a thread whose participants are exactly
  // {you, that lead} (a real 1:1); intro/group threads (3+ parties) are ignored for reply/cadence.
  const mail = await mailProvider.listRecent(coach, { after: emailAfterSec, max: 3000 });
  if (!mail.ok) return { ok: false, error: `Mailbox window read failed: ${mail.error}` };
  const signals = computeMailSignals(mail.messages, new Set(byEmail.keys()));
  for (const [email, sig] of signals) {
    const lead = byEmail.get(email);
    if (lead) { lead.lastInboundMs = sig.lastInboundMs; lead.lastOutboundMs = sig.lastOutboundMs; }
  }

  // --- 3. Merge LinkedIn history, classify, rank ---
  const surfaced = [];
  let gatedCadence = 0;
  let coldCadence = 0;
  // Parked pipeline (Guy 2026-07-23: a calm brief must never look like an empty pipeline) —
  // count future Reconnect On stamps + the soonest one, so the brief can show what's QUEUED.
  let parkedCount = 0;
  let nextReconnect = null;
  for (const lead of leads) {
    if (lead.reconnectOn) {
      const dt = Date.parse(lead.reconnectOn);
      if (!Number.isNaN(dt) && dt > todayMidMs) {
        parkedCount++;
        if (!nextReconnect || lead.reconnectOn < nextReconnect) nextReconnect = lead.reconnectOn;
      }
    }
  }
  for (const lead of leads) {
    let lastInboundMs = lead.lastInboundMs;
    let lastOutboundMs = lead.lastOutboundMs;
    const li = parseLinkedInLast(lead.notes, lead.first);
    if (li && li.ms >= afterMs) { // window LinkedIn the SAME as email — an ancient LI thread is not a live signal
      if (li.inbound) lastInboundMs = Math.max(lastInboundMs || 0, li.ms);
      else lastOutboundMs = Math.max(lastOutboundMs || 0, li.ms);
    }
    const c = classifyLead(lead, { lastInboundMs: lastInboundMs || null, lastOutboundMs: lastOutboundMs || null, nowMs, todayMidMs });
    if (!c) continue;
    if (c.gatedCadence) { gatedCadence++; continue; }
    if (c.coldCadence) { coldCadence++; continue; }
    surfaced.push({ lead, ...c });
  }
  surfaced.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || (b.sortKey - a.sortKey));

  // Calendar cross-check: never nag someone already booked with you. Read the forward window ONCE and
  // drop any surfaced lead matched to an upcoming event — by attendee email, or (for email-less
  // leads) by their full name in the event title/attendees. Best-effort: a calendar failure just
  // skips the check (noted in diagnostics), it never breaks the sweep.
  let bookedSuppressed = 0;
  let calChecked = false;
  if (surfaced.length) {
    try {
      const wingguyCalendar = require('./wingguyCalendar');
      const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
      const cal = await wingguyCalendar.listEventsForCoach(tenant, { date: fmt(todayMidMs), endDate: fmt(todayMidMs + CAL_LOOKAHEAD_DAYS * MS_DAY) });
      if (cal && cal.ok && Array.isArray(cal.events)) {
        calChecked = true;
        const bookedEmails = new Set();
        const titleBlobs = [];
        for (const ev of cal.events) {
          if (ev.isFree) continue; // free/transparent time isn't a booked meeting
          for (const a of (ev.attendees || [])) {
            if (!a || !a.email) continue;
            // Response-aware (Celeste, 2026-07-24): a DECLINED invite is NOT a booked meeting —
            // her 12 Jul decline was silencing her whole pipeline. 'needsAction' still counts as
            // booked on purpose: agreed-in-chat leads often never click Accept, and un-suppressing
            // them re-creates the reply-owed false positives. The safety net for an unanswered
            // pencil-in invite is a Reconnect On checkpoint stamp — immune below.
            if (String(a.responseStatus || '').toLowerCase() === 'declined') continue;
            bookedEmails.add(String(a.email).toLowerCase());
          }
          titleBlobs.push(`${ev.summary || ''} ${(ev.attendees || []).map((a) => a.displayName || '').join(' ')}`.toLowerCase());
        }
        const kept = [];
        for (const s of surfaced) {
          // A human-set reconnect date OUTRANKS calendar inference: a due stamp always surfaces,
          // meeting or no meeting — worst case the chat reports "already booked, clear the stamp".
          if (s.tier === 'deferral') { kept.push(s); continue; }
          const email = (s.lead.email || '').toLowerCase();
          const full = `${s.lead.first} ${s.lead.last}`.trim().toLowerCase();
          const emailHit = !!email && bookedEmails.has(email);
          const nameHit = !!s.lead.first && !!s.lead.last && titleBlobs.some((b) => b.includes(full));
          if (emailHit || nameHit) { bookedSuppressed++; continue; }
          kept.push(s);
        }
        surfaced.length = 0; surfaced.push(...kept);
      }
    } catch (e) {
      console.warn(`[wingguyMailMcp] followup calendar cross-check skipped: ${e.message}`);
    }
  }

  return {
    ok: true,
    coach,
    surfaced,
    counts: { gatedCadence, coldCadence, bookedSuppressed, calChecked, leadsScanned: leads.length, parkedCount, nextReconnect },
    mailInfo: { count: mail.messages.length, partialError: mail.partialError || null, truncated: !!mail.truncated },
    windowDays,
    emailDays,
  };
}

/**
 * The follow-up sweep TOOL: computeFollowupSweep + cap + plain-text formatting.
 */
async function runFollowupSweep({ window_days, limit } = {}, tenant = TENANT) {
  const r = await computeFollowupSweep({ window_days }, tenant);
  if (!r.ok) return { text: r.error, isError: true };
  const cap = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 100);
  const { surfaced, counts, mailInfo, windowDays, emailDays } = r;
  const { gatedCadence, coldCadence, bookedSuppressed, calChecked } = counts;

  if (!surfaced.length) {
    const booked = bookedSuppressed ? `, ${bookedSuppressed} already booked` : '';
    return { text: `No follow-ups surfaced from the last ${windowDays} days. (${counts.leadsScanned} leads scanned; suppressed ${gatedCadence} Cease/Series + ${coldCadence} cold-outreach cadence${booked}.)` };
  }
  const shown = surfaced.slice(0, cap);
  const more = surfaced.length - shown.length;
  const lines = shown.map((s, i) => {
    const name = `${s.lead.first} ${s.lead.last}`.trim() || s.lead.email || '(no name)';
    const gate = s.gated ? ' [Cease/Series — surfaced anyway: a real obligation, not cadence]' : '';
    return `${i + 1}. ${TIER_LABEL[s.tier]} · ${name}${s.lead.email ? ` <${s.lead.email}>` : ''} — ${s.why}${gate}`;
  });
  return {
    text:
      `Top ${shown.length} of ${surfaced.length} follow-up${surfaced.length === 1 ? '' : 's'} (live, nothing stored):\n` +
      lines.join('\n') +
      (more > 0 ? `\n(${more} more behind these — call again with limit to show all.)` : '') +
      `\n[diagnostics — do not relay unless asked: ${counts.leadsScanned} leads scanned; ${mailInfo.count} emails/${emailDays}d${mailInfo.partialError ? ' ⚠PARTIAL' : (mailInfo.truncated ? ' ⚠capped' : '')}, LinkedIn ${windowDays}d; suppressed ${gatedCadence} Cease/Series + ${coldCadence} cold-outreach${calChecked ? ` + ${bookedSuppressed} already-booked` : ''}. ` +
      `REPLY OWED = a lead replied last on a 1:1 thread (≤${REPLY_LIVE_DAYS}d), ball in your court — intro/group threads (3+ parties) are NOT counted; DEFERRAL DUE = a stamped Reconnect On date has arrived (≤${DEFERRAL_LIVE_DAYS}d past), ranks above cadence; WENT QUIET = you spoke last ${CADENCE_OVERDUE_DAYS}-${CADENCE_MAX_DAYS}d ago on a 1:1 thread, connected/replied leads only. A FUTURE Reconnect On parks a lead from cadence until then. Calendar cross-check ${calChecked ? 'ON (already-booked leads dropped)' : '⚠ SKIPPED this run (calendar read failed) — verify already-booked before nudging'}.]`,
  };
}

// ---------------------------------------------------------------------------
// Set / clear a lead's Reconnect On — the engine's deferral-date WRITE path
// ---------------------------------------------------------------------------

/**
 * Stamp (or clear) a lead's `Reconnect On` date — the "ping them ~this date" promise that the
 * follow-up sweep surfaces at the DEFERRAL DUE tier and parks cadence against until then.
 * Find the lead by email (preferred) or a name substring in the tenant's own base, then write the
 * field. Empty/omitted `reconnect_on` CLEARS it (un-park). The chat is expected to have CONFIRMED
 * the date with the human first (propose-then-confirm) — this is the write, not the proposal.
 */
async function runSetReconnect({ lead_email, lead_name, reconnect_on } = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach) return { text: `Server config error: coach client "${tenant}" not found.`, isError: true };
  if (!coach.airtableBaseId) return { text: `No Airtable base on file for "${tenant}" — can't set a reconnect date.`, isError: true };

  const email = String(lead_email || '').trim().toLowerCase();
  const name = String(lead_name || '').trim();
  if (!email && !name) return { text: 'Give me a lead_email (preferred) or lead_name to find the lead.', isError: true };

  // Empty reconnect_on = CLEAR. Otherwise parse and normalise to YYYY-MM-DD (the date field's shape).
  let dateVal = null;
  const raw = String(reconnect_on == null ? '' : reconnect_on).trim();
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return { text: `Couldn't read "${reconnect_on}" as a date — give an ISO date like 2026-08-15.`, isError: true };
    dateVal = new Date(t).toISOString().slice(0, 10);
  }

  const FIELD_ABSENT = /Reconnect On|Unknown field|UNKNOWN_FIELD_NAME|INVALID_/i;
  const base = clientService.getClientBase(coach.airtableBaseId);
  const esc = (s) => String(s).replace(/"/g, '\\"');
  const formula = email
    ? `LOWER({Email}) = "${esc(email)}"`
    : `FIND(LOWER("${esc(name)}"), LOWER({First Name} & " " & {Last Name})) > 0`;

  let matches;
  try {
    matches = await base('Leads').select({ filterByFormula: formula, fields: ['First Name', 'Last Name', 'Email', 'Reconnect On'], maxRecords: 10 }).all();
  } catch (e) {
    if (FIELD_ABSENT.test(e.message)) return { text: `The "Reconnect On" field isn't on this client's base yet — add it (scripts/add-reconnect-on-field.js) before stamping reconnect dates.`, isError: true };
    return { text: `Lead lookup failed: ${e.message}`, isError: true };
  }

  if (!matches.length) return { text: `No lead found matching ${email ? `email ${email}` : `name "${name}"`}. (Try the other identifier, or create the lead first.)`, isError: true };
  if (matches.length > 1) {
    const list = matches.slice(0, 8).map((r) => `- ${`${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim()}${r.fields['Email'] ? ` <${r.fields['Email']}>` : ''}`).join('\n');
    return { text: `More than one lead matches "${name || email}" — tell me which, or pass lead_email:\n${list}` };
  }

  const rec = matches[0];
  try {
    await base('Leads').update(rec.id, { 'Reconnect On': dateVal });
  } catch (e) {
    if (FIELD_ABSENT.test(e.message)) return { text: `The "Reconnect On" field isn't on this client's base yet — add it first.`, isError: true };
    return { text: `Couldn't write Reconnect On: ${e.message}`, isError: true };
  }

  const who = `${rec.fields['First Name'] || ''} ${rec.fields['Last Name'] || ''}`.trim() || rec.fields['Email'] || rec.id;
  return {
    text: dateVal
      ? `Set ${who}'s Reconnect On to ${dateVal}. They'll surface at the top of your follow-ups (DEFERRAL DUE) from that day, and won't be nudged before then.`
      : `Cleared ${who}'s Reconnect On — no longer parked to a date.`,
  };
}

// ---------------------------------------------------------------------------
// Cease follow-ups — the permanent "drop this lead" flag, settable from chat
// ---------------------------------------------------------------------------

/**
 * Set (or unset) a lead's Cease FUP flag — the permanent "never chase this person on a timer
 * again". Also clears any Reconnect On stamp when ceasing (a dropped lead shouldn't resurface on
 * a date). Nothing is sent; this is pure record-keeping. Same lead lookup as runSetReconnect.
 */
async function runCeaseFollowups({ lead_email, lead_name, cease } = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const coach = await clientService.getClientById(tenant);
  if (!coach || !coach.airtableBaseId) return { text: `No Airtable base on file for "${tenant}".`, isError: true };
  const email = String(lead_email || '').trim().toLowerCase();
  const name = String(lead_name || '').trim();
  if (!email && !name) return { text: 'Give me a lead_email (preferred) or lead_name.', isError: true };
  const turningOn = cease !== false; // default = cease
  const base = clientService.getClientBase(coach.airtableBaseId);
  const esc = (s) => String(s).replace(/"/g, '\\"');
  const formula = email
    ? `LOWER({Email}) = "${esc(email)}"`
    : `FIND(LOWER("${esc(name)}"), LOWER({First Name} & " " & {Last Name})) > 0`;
  let matches;
  try {
    matches = await base('Leads').select({ filterByFormula: formula, fields: ['First Name', 'Last Name', 'Email', 'Cease FUP'], maxRecords: 10 }).all();
  } catch (e) { return { text: `Lead lookup failed: ${e.message}`, isError: true }; }
  if (!matches.length) return { text: `No lead found matching ${email ? `email ${email}` : `name "${name}"`}.`, isError: true };
  if (matches.length > 1) {
    const list = matches.slice(0, 8).map((r) => `- ${`${r.fields['First Name'] || ''} ${r.fields['Last Name'] || ''}`.trim()}${r.fields['Email'] ? ` <${r.fields['Email']}>` : ''}`).join('\n');
    return { text: `More than one lead matches — tell me which, or pass lead_email:\n${list}` };
  }
  const rec = matches[0];
  try {
    const fields = { 'Cease FUP': turningOn ? 'Yes' : 'No' };
    if (turningOn) fields['Reconnect On'] = null; // a dropped lead shouldn't resurface on a stamp
    await base('Leads').update(rec.id, fields);
  } catch (e) { return { text: `Couldn't update Cease FUP: ${e.message}`, isError: true }; }
  const who = `${rec.fields['First Name'] || ''} ${rec.fields['Last Name'] || ''}`.trim() || rec.fields['Email'] || rec.id;
  return {
    text: turningOn
      ? `${who} dropped — Cease FUP set (and any reconnect stamp cleared). No timer will ever chase them again. NOTE: if they personally REPLY in future, that still surfaces (a reply is a reply); only cadence is silenced. Nothing was sent.`
      : `${who} re-opened — Cease FUP cleared; normal follow-up cadence applies again.`,
  };
}

// ---------------------------------------------------------------------------
// Prepared brief — instant read + background rebuild (see wingguyFollowupBrief.js)
// ---------------------------------------------------------------------------

/** Serve the STORED brief instantly — no computation at ask time. */
async function runFollowupBriefRead(_args = {}, tenant = TENANT) {
  const brief = require('./wingguyFollowupBrief');
  let row;
  try { row = await brief.getBrief(tenant); }
  catch (e) { return { text: `Brief store unavailable: ${e.message}`, isError: true }; }
  if (!row) {
    return { text: 'No prepared brief exists yet for this coach. Start one with wingguy_prepare_brief (~2-3 minutes, runs in the background), or fall back to the live wingguy_followup_sweep.' };
  }
  if (row.status === 'preparing' && !row.payload) {
    return { text: `The first brief is being prepared right now (started ${row.started_at}). Ask again in a minute or two.` };
  }
  const text = brief.formatBrief(row);
  if (!text) return { text: `No brief content stored${row.error ? ` (last preparation failed: ${row.error})` : ''}. Run wingguy_prepare_brief.`, isError: true };
  // Self-healing routing (works even when a chat cached old tool descriptions): a general
  // follow-up ask must land on the ACTION QUEUE, not this status store.
  const redirect = 'ROUTING NOTE TO ASSISTANT: if the human asked generally for their follow-ups / what\'s due / who they owe, do NOT present this — call wingguy_queue NOW and present THAT (a ranked action to-do list). Use the data below ONLY for a specific person\'s detail (jog/draft/push params) or an explicit status question.\n' + LEVERS_NOTE + '\n\n';
  const note = row.status === 'error' ? `⚠ The LATEST preparation failed (${row.error}) — this is the previous brief.\n` : (row.status === 'preparing' ? '(A fresh brief is being prepared right now — this is the previous one.)\n' : '');
  // Backlog ledger (cheap PG read): the daily brief must show the OTHER queue exists too.
  let backlogLine = '';
  try {
    const bl = await require('./wingguyBacklogAudit').getWorklist(tenant);
    if (bl && bl.payload) {
      const bp = typeof bl.payload === 'string' ? JSON.parse(bl.payload) : bl.payload;
      const pending = (bp.items || []).filter((i) => i.status === 'pending').length;
      if (pending) backlogLine = `\nBACKLOG (relay this): ${pending} older neglected follow-ups pending in the backlog worklist — say "show my backlog" to work them.`;
    }
  } catch (_) { /* footer is best-effort */ }
  return { text: redirect + note + text + backlogLine };
}

/** Kick a background rebuild and return immediately — the human never waits on it. */
async function runPrepareBrief(_args = {}, tenant = TENANT) {
  const brief = require('./wingguyFollowupBrief');
  try {
    const row = await brief.getBrief(tenant);
    if (row && row.status === 'preparing' && row.started_at && (Date.now() - new Date(row.started_at).getTime()) < 10 * 60 * 1000) {
      return { text: `A preparation is already running (started ${row.started_at}). Ask for the brief in a minute or two.` };
    }
  } catch (e) { return { text: `Brief store unavailable: ${e.message}`, isError: true }; }
  setImmediate(() => {
    require('./wingguyFollowupBrief').prepareFollowupBrief(tenant)
      .then((r) => console.log(`[wingguyMailMcp] brief prepared for ${tenant}: ${JSON.stringify(r)}`))
      .catch((e) => console.error(`[wingguyMailMcp] brief prepare crashed for ${tenant}: ${e.message}`));
  });
  return { text: 'Preparation started in the background (~2-3 minutes: sweep → read each top thread → triage → pre-write the reply drafts into the mailbox). Serve wingguy_followup_brief shortly — do NOT make the human wait on this call.' };
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
  {
    name: 'wingguy_followup_sweep',
    description:
      'LIVE follow-up sweep — the SLOW fallback (~2 min). For "show me my follow-ups" prefer wingguy_followup_brief (instant, pre-triaged, drafts pre-written); use this only when no prepared brief exists or the human explicitly wants a raw live rebuild. Rebuilds the list LIVE every call (nothing stored — a stored follow-up list rots) from the coach\'s own mailbox (Nylas, ~90-day window in ONE read) merged with each lead\'s LinkedIn history (Notes) and the gates on the lead record. Returns a ranked, capped plain-text list: REPLY OWED (they replied, ball\'s in your court) → DEFERRAL DUE (a date they named has arrived) → WENT QUIET (you messaged last, past the interval). Cease FUP / On-Series suppress the WENT QUIET (cadence) nudge only — a reply or a due deferral still surfaces. Use for "prep me for today" (bundled with meetings), "show me what I need to follow up", or "who\'s waiting". Read-only. Reply-owed is thread-aware: only messages on a genuine 1:1 thread (you + the lead) count, so introductions you broker never manufacture phantom follow-ups; and already-booked leads are cross-checked against the calendar and dropped.',
    zodSchema: {
      window_days: z.number().optional().describe('How far back to read mail (default 90, min 7, max 180).'),
      limit: z.number().optional().describe('Max items to show (default 5 — the tight brief; pass a big number like 100 for "show all").'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        window_days: { type: 'number', description: 'How far back to read mail (default 90, min 7, max 180).' },
        limit: { type: 'number', description: 'Max items to show (default 5 — the tight brief; pass a big number like 100 for "show all").' },
      },
      required: [],
    },
    run: runFollowupSweep,
  },
  {
    name: 'wingguy_set_reconnect',
    description:
      'Stamp (or clear) a lead\'s reconnect date — the "ping them ~this date" promise. Use it when a lead defers to a specific time ("I\'m away, back mid-August, chat then" / "circle back next quarter"): once you and the human agree the date, call this to write it. The follow-up sweep then surfaces that lead at the TOP of the brief (DEFERRAL DUE tier) the day the date arrives, and PARKS them from "went quiet" nudges until then — so a named promise lands on its day instead of getting lost. Find the lead by lead_email (preferred) or lead_name. Pass reconnect_on as an ISO date (YYYY-MM-DD); OMIT it (or pass empty) to CLEAR a reconnect date. PROPOSE-THEN-CONFIRM: agree the date with the human first, then call this — it writes immediately. Writes ONLY the engine\'s dedicated Reconnect On field (never the legacy Follow-Up Date).',
    zodSchema: {
      lead_email: z.string().optional().describe('The lead\'s email address (preferred — unambiguous).'),
      lead_name: z.string().optional().describe('The lead\'s name (first, or "First Last") — used if no email. Matched as a case-insensitive substring; if several leads match you\'ll be asked which.'),
      reconnect_on: z.string().optional().describe('The reconnect date as ISO YYYY-MM-DD (e.g. "2026-08-15"). Resolve vague phrases like "mid-August" to a concrete date before calling. Omit or pass empty to CLEAR the date (un-park the lead).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_email: { type: 'string', description: 'The lead\'s email address (preferred — unambiguous).' },
        lead_name: { type: 'string', description: 'The lead\'s name (first, or "First Last") — used if no email. Matched as a case-insensitive substring; if several leads match you\'ll be asked which.' },
        reconnect_on: { type: 'string', description: 'The reconnect date as ISO YYYY-MM-DD (e.g. "2026-08-15"). Resolve vague phrases like "mid-August" to a concrete date before calling. Omit or pass empty to CLEAR the date (un-park the lead).' },
      },
      required: [],
    },
    run: runSetReconnect,
  },
  {
    name: 'wingguy_cease_followups',
    description:
      'Permanently DROP a lead from timed follow-ups ("drop X", "take X off the list for good", "stop chasing X") — sets the lead\'s Cease FUP flag and clears any reconnect stamp. NOTHING IS SENT. Confirm intent first when ambiguous: "off the list forever" = this; "not now, later" = park via wingguy_set_reconnect instead; "handled it" (backlog) = wingguy_backlog action done/skip. Honest behavior note: ceasing silences the TIMERS only — if the person personally replies in future, that still surfaces (a reply is a reply). Pass cease=false to re-open a previously dropped lead.',
    zodSchema: {
      lead_email: z.string().optional().describe('The lead\'s email (preferred — unambiguous).'),
      lead_name: z.string().optional().describe('The lead\'s name if no email; substring match, asks on multiple hits.'),
      cease: z.boolean().optional().describe('Default true (drop). false = re-open (clear the flag).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        lead_email: { type: 'string', description: 'The lead\'s email (preferred — unambiguous).' },
        lead_name: { type: 'string', description: 'The lead\'s name if no email; substring match, asks on multiple hits.' },
        cease: { type: 'boolean', description: 'Default true (drop). false = re-open (clear the flag).' },
      },
      required: [],
    },
    run: runCeaseFollowups,
  },
  {
    name: 'wingguy_followup_brief',
    description:
      'The PREPARED daily store BEHIND the action queue — for follow-up requests call wingguy_queue FIRST (the human wants action, not status). Call THIS for: a today-person\'s full detail (jog + draft text + push parameters — draft is IN the brief: show it, let the human tweak in chat, and ONLY on approval push via wingguy_create_draft with the entry\'s to/subject/reply_to_message_id; LinkedIn people get paste-ready text), park proposals (stamp via wingguy_set_reconnect on confirm), or when the human EXPLICITLY asks for status ("what\'s parked?", "was X checked?", "when was the brief built?") — the diagnostics/checked-clear tail answers those instantly. If it reports STALE or missing, offer wingguy_prepare_brief (background rebuild). wingguy_followup_sweep = live fallback only.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {}, required: [] },
    run: runFollowupBriefRead,
  },
  {
    name: 'wingguy_prepare_brief',
    description:
      'Rebuild the prepared follow-up brief IN THE BACKGROUND (~2-3 min) and return immediately — the human never waits on it. Use when the human says "refresh my follow-ups" / "rebuild the brief", when wingguy_followup_brief reports stale/missing, or after a batch of actions has made the brief outdated. It re-runs the sweep, reads each top person\'s recent messages, triages them, and pre-writes the reply drafts. Tell the human it\'s preparing and they can ask for the brief in a couple of minutes — do not poll.',
    zodSchema: {},
    jsonSchema: { type: 'object', properties: {}, required: [] },
    run: runPrepareBrief,
  },
  {
    name: 'wingguy_queue',
    description:
      'THE ACTION QUEUE — THE FIRST CALL for "show me my follow-ups" / "what\'s due" / "who do I owe" / "prep me for today". ONE ranked, pageable to-do list (ten per page), every line an ACTION waiting for a yes: today\'s due items first (drafts ready / park proposals / needs-eyes), then backlog reopens (drafts ready), then backlog parks. Instant — merges the prepared stores at serve time. Work it top-down: name a person → serve their jog + draft (from wingguy_followup_brief for today\'s people, wingguy_backlog name=... for backlog people; DEEP memory — "any emails? how did the call go? what did we agree?" — comes INSTANTLY from wingguy_dossier) → tweak → push/copy on approval → they drop off. "Next ten" = page 2, 3… DELIBERATELY ABSENT (pure action, no status): parked-until-date people (they surface on their day), nothing-owed people, anything already done — relay status info ONLY if the human explicitly asks ("what\'s parked?", "was X checked?").',
    zodSchema: {
      page: z.number().optional().describe('Page number, 10 per page (default 1). "next ten" = the next page.'),
    },
    jsonSchema: {
      type: 'object',
      properties: { page: { type: 'number', description: 'Page number, 10 per page (default 1). "next ten" = the next page.' } },
      required: [],
    },
    run: runQueue,
  },
  {
    name: 'wingguy_dossier',
    description:
      'THE INSTANT MEMORY behind every queue person — call this for "remind me about X", "jog X", "any emails from X?", "how did the call with X go?", "what did we agree?". Returns the PRE-BUILT dossier (no waiting): where the relationship actually stands, commitments each side made, suggested next move, meeting summaries from the transcript store, and the full dated timeline (emails incl. calendar accepts/declines, LinkedIn messages). Rebuilt automatically whenever the person\'s thread changes. If no dossier exists for the name (person outside the prepared queue), say so and offer the live dig (wingguy_lead_correspondence / recall transcripts) with a "this will take a moment" warning.',
    zodSchema: {
      name: z.string().describe('The person\'s name (or part of it).'),
    },
    jsonSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The person\'s name (or part of it).' } },
      required: ['name'],
    },
    run: runDossier,
  },
  {
    name: 'wingguy_backlog',
    description:
      'The BACKLOG WORKLIST — the one-time reckoning of neglected follow-ups (threads quiet 6 weeks to 12 months), pre-triaged into reopen (re-opening DRAFTS pre-written — email push-ready or LinkedIn paste-ready) / park (a date to stamp) / writeoff. Separate from the daily brief. Use when the human says "show my backlog", "give me the draft for [name]", "what\'s left on the old list". No args = summary + the next few reopens. name = that person\'s full entry (jog + draft + push params). action done|skip (with name) = mark them dealt with so the list shrinks. Instant — everything was pre-computed by the audit. Serve drafts for tweaking in chat; push email drafts via wingguy_create_draft ONLY on explicit approval; parks are stamped via wingguy_set_reconnect.',
    zodSchema: {
      name: z.string().optional().describe('A person\'s name (or part of it) — returns their full entry with the draft.'),
      action: z.enum(['done', 'skip']).optional().describe('With name: mark that person dealt with (done) or deliberately passed over (skip).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A person\'s name (or part of it) — returns their full entry with the draft.' },
        action: { type: 'string', enum: ['done', 'skip'], description: 'With name: mark that person dealt with (done) or deliberately passed over (skip).' },
      },
      required: [],
    },
    run: runBacklogTool,
  },
];

// Authoritative crib appended to the queue (and the brief's routing note) so ANY conversation —
// including one whose pinned tool list predates a tool — knows what the controls are. Born
// 2026-07-24: a chat confidently told Guy "there's no way to express 'don't chase unless they
// reply'" while wingguy_cease_followups sat deployed, then invented a LinkedIn blindness the
// sweep doesn't have. The fix is the ROUTING-NOTE trick: put the truth in the output itself.
const LEVERS_NOTE =
  '[THE LEVERS — authoritative; never tell the human a control is missing without checking this list: ' +
  'wingguy_cease_followups = drop a person WITHOUT sending anything (all timers silenced permanently; a future reply from them still surfaces — this IS "don\'t chase unless they reply") · ' +
  'wingguy_set_reconnect = park until a date (fires as due that day; clearable) · ' +
  'wingguy_backlog name+done/skip = tick off a backlog item · ' +
  'wingguy_dossier name = instant memory jog + ready draft. ' +
  'LinkedIn: the sweep DOES see LinkedIn — LinkedHelper syncs each thread into the lead\'s Notes, so a message the human sends there counts as their last outbound once synced (minutes-to-hours lag), and a LinkedIn reply surfaces them even when ceased. ' +
  'PRESENTATION RULE: whenever you show a draft (first time OR re-shown from earlier in the chat), ALWAYS put the person\'s LinkedIn profile link right beside it — the human clicks straight into LinkedIn and pastes. The URL is in the queue\'s linked name, the dossier, and the backlog entry; if you don\'t have it in context, pull wingguy_dossier for the person. ' +
  'DRAFTS: every actionable person\'s overnight dossier (wingguy_dossier) carries a ready guidance draft or an explicit let-it-rest note — NEVER tell the human no draft was pre-written without pulling the dossier first.]';

/**
 * The unified QUEUE: everything actionable RIGHT NOW, one ranked pageable list (Guy 2026-07-23:
 * "a list of people in priority order, one line each, top ten, next ten — that I can start
 * actioning straight away"). Merges, at serve time (both stores are instant PG reads):
 *   1. today's brief items needing action (replies-ready, park-proposals, needs-eyes)
 *   2. the backlog reopens (pre-written drafts), then backlog parks
 * Parked-until-date people are deliberately NOT here (they surface on their day); writeoffs and
 * checked-clears are not here (nothing owed). The morning brief = the pulse; this = the grind.
 */
async function runQueue({ page } = {}, tenant = TENANT) {
  const briefStore = require('./wingguyFollowupBrief');
  const backlog = require('./wingguyBacklogAudit');
  const items = [];
  try {
    const row = await briefStore.getBrief(tenant);
    const p = row && row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
    // A park proposal whose date has already passed is not a park decision any more — their own
    // named window closed, so it serves as "reach out now" (Joe Cozzupoli, observed 2026-07-24:
    // the queue proposed parking him to 10 July on the 24th).
    const parkLine = (it) => (it.parkDate && it.parkDate <= new Date().toISOString().slice(0, 10))
      ? `their own window (${it.parkDate}) has PASSED — reach out now, natural opening [draft in dossier]`
      : `${it.whyLine} → propose park ${it.parkDate || '?'}`;
    for (const it of ((p && p.items) || [])) {
      if (it.verdict === 'draft') items.push({ ...it, src: 'today', line: `${it.whyLine} [draft ready]` });
      else if (it.verdict === 'park') items.push({ ...it, src: 'today', line: parkLine(it) });
      else if (it.verdict === 'attention') items.push({ ...it, src: 'today', line: `${it.whyLine} [needs your judgment]` });
    }
  } catch (_) { /* brief store down — queue still serves backlog */ }
  try {
    const row = await backlog.getWorklist(tenant);
    const p = row && row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
    const pend = ((p && p.items) || []).filter((i) => i.status === 'pending');
    const parkLine = (it) => (it.parkDate && it.parkDate <= new Date().toISOString().slice(0, 10))
      ? `their own window (${it.parkDate}) has PASSED — reach out now, natural opening [draft in dossier]`
      : `${it.whyLine} → propose park ${it.parkDate || '?'}`;
    for (const it of pend.filter((i) => i.verdict === 'reopen')) items.push({ ...it, src: 'backlog', line: `${it.whyLine} (${it.quietDays}d quiet)${it.draftText ? ' [draft ready]' : ''}` });
    for (const it of pend.filter((i) => i.verdict === 'park')) items.push({ ...it, src: 'backlog', line: parkLine(it) });
  } catch (_) { /* ignore */ }
  if (!items.length) return { text: 'The queue is empty — nothing actionable right now (parked people surface on their dates).' };
  // Dedupe by name (a person can appear in both stores — today's view wins).
  const seen = new Set();
  const deduped = items.filter((it) => { const k = it.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const PAGE = 10;
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const totalPages = Math.ceil(deduped.length / PAGE);
  const slice = deduped.slice((pg - 1) * PAGE, pg * PAGE);
  const nm = (it) => (it.linkedin ? `[${it.name}](${it.linkedin})` : it.name);
  const lines = [
    `THE QUEUE — ${deduped.length} actionable, priority order (page ${pg}/${totalPages}; today's brief first, then backlog reopens, then parks). Ask for anyone by name for jog + draft; "next ten" = next page.`,
    ...slice.map((it, i) => `${(pg - 1) * PAGE + i + 1}. ${nm(it)} — ${it.line}`),
  ];
  if (pg < totalPages) lines.push(`(${deduped.length - pg * PAGE} more — say "next ten".)`);
  lines.push('', LEVERS_NOTE);
  return { text: lines.join('\n') };
}

/** Serve a person's pre-built dossier — instant, from the store. */
async function runDossier({ name } = {}, tenant = TENANT) {
  const dossier = require('./wingguyDossier');
  try {
    const row = await dossier.findDossierByName(tenant, name);
    if (!row) return { text: `No prepared dossier for "${name}" — they're outside the prepared queue. Offer the live dig (wingguy_lead_correspondence, transcripts) with a "this will take a moment" warning.` };
    // Profile-link fallback for dossiers built before `linkedin` was stored in the payload
    // (Guy 2026-07-24: "click through to their LinkedIn profile" while actioning). Best-effort —
    // one light Airtable lookup; any failure just serves the dossier without the link.
    const opts = {};
    try {
      const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (p && (!p.linkedin || !p.location)) {
        const clientService = require('./clientService');
        const coach = await clientService.getClientById(tenant);
        if (coach && coach.airtableBaseId) {
          const base = clientService.getClientBase(coach.airtableBaseId);
          const esc = (s) => String(s).replace(/"/g, '\\"');
          const formula = p.email
            ? `LOWER({Email}) = "${esc(String(p.email).toLowerCase())}"`
            : `FIND(LOWER("${esc(p.name)}"), LOWER({First Name} & " " & {Last Name})) > 0`;
          const m = await base('Leads').select({ filterByFormula: formula, fields: ['LinkedIn Profile URL', 'Location'], maxRecords: 1 }).all();
          if (m.length) {
            opts.linkedin = String(m[0].fields['LinkedIn Profile URL'] || '').trim() || null;
            opts.location = String(m[0].fields['Location'] || '').trim() || null;
          }
        }
      }
    } catch (_) { /* link is a nicety, never block the serve */ }
    return { text: dossier.formatDossier(row, opts) };
  } catch (e) { return { text: `Dossier store unavailable: ${e.message}`, isError: true }; }
}

/** The backlog worklist tool: summary / per-person entry / mark done-skip. All instant (stored). */
async function runBacklogTool({ name, action } = {}, tenant = TENANT) {
  const backlog = require('./wingguyBacklogAudit');
  try {
    if (action && name) {
      const it = await backlog.markItem(tenant, name, action);
      if (!it) return { text: `No backlog entry matching "${name}".`, isError: true };
      const row = await backlog.getWorklist(tenant);
      const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const left = (p.items || []).filter((i) => i.status === 'pending').length;
      return { text: `${it.name} marked ${action}. ${left} pending remain.` };
    }
    const row = await backlog.getWorklist(tenant);
    if (!row) return { text: 'No backlog worklist exists yet — the audit has not been run for this coach.' };
    return { text: backlog.formatWorklist(row, { name }) };
  } catch (e) {
    return { text: `Backlog store unavailable: ${e.message}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Learn-from-my-edit (email half) — settle awaiting drafts against sent mail
// ---------------------------------------------------------------------------

/**
 * Cut a sent email's text at the quoted-history boundary, so a reply compares as JUST the human's
 * words, not the thread Gmail/Outlook appended underneath. Conservative: only cuts at the classic
 * markers; an unrecognised quote style just means a noisier diff for the human to dismiss.
 */
function stripQuotedTail(text) {
  const t = String(text || '');
  const markers = [
    /^On .{0,200}wrote:\s*$/m,          // Gmail: "On Fri, 18 Jul 2026 ... wrote:"
    /^-{3,}\s*Original Message\s*-{3,}/mi,
    /^_{5,}\s*$/m,                       // Outlook divider
    /^From:\s.+\r?\nSent:\s/m,           // Outlook header block
    /^>{1}\s?\S/m,                       // a ">"-quoted line
  ];
  let cut = t.length;
  for (const re of markers) {
    const m = t.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return t.slice(0, cut).trim();
}

const DRAFT_SETTLE_EXPIRY_DAYS = 14; // a draft with no send after this long was abandoned, not edited

/**
 * Settle the tenant's awaiting draft-ledger rows: for each, look for the sent counterpart in the
 * mailbox (thread when known, else subject+recipient), diff generated vs sent (quoted tail
 * stripped), and file an edit pair (surface='email') when the human changed it. Called lazily by
 * wingguy_edit_review — pull-only, no cron. Every failure is per-row and non-fatal.
 * Returns { checked, paired, noDiff, expired, awaiting }.
 */
async function settleEmailEditPairs(tenant = TENANT) {
  const out = { checked: 0, paired: 0, noDiff: 0, expired: 0, awaiting: 0 };
  const store = ledgerStore();
  if (!store) return out;
  let rows;
  try { rows = await store.getAwaitingDrafts({ tenantId: tenant }); }
  catch (e) { console.warn(`[wingguyMailMcp] settle: ledger read failed: ${e.message}`); return out; }
  if (!rows.length) return out;

  const clientService = require('./clientService');
  let coach = null;
  try { coach = await clientService.getClientById(tenant); } catch (_) { /* fall through */ }
  if (!coach || !coach.nylasGrantId) { out.awaiting = rows.length; return out; }

  for (const row of rows) {
    out.checked++;
    try {
      const createdMs = new Date(row.created_at).getTime();
      // Sent counterpart: messages in the draft's thread (or matching subject+recipient when the
      // draft had no thread yet), landed after draft time. The one addressed TO the lead and not
      // FROM them is the coach's send.
      const query = row.thread_id
        ? { threadId: row.thread_id, receivedAfter: Math.floor(createdMs / 1000) - 60, limit: 10 }
        : { anyEmail: row.to_email, subject: row.subject || undefined, receivedAfter: Math.floor(createdMs / 1000) - 60, limit: 10 };
      const found = await mailProvider.findMessages(coach, query);
      if (!found.ok) { out.awaiting++; continue; }
      const candidates = (found.messages || [])
        .filter((m) => String(m.to || '').toLowerCase().includes(row.to_email))
        .filter((m) => String(m.fromEmail || '').toLowerCase() !== row.to_email)
        .filter((m) => !m.date || new Date(m.date).getTime() >= createdMs - 60000)
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      if (!candidates.length) {
        // Not sent yet — or abandoned. After the expiry window, stop looking.
        if (Date.now() - createdMs > DRAFT_SETTLE_EXPIRY_DAYS * 24 * 3600 * 1000) {
          await store.settleDraftRecord({ tenantId: tenant, id: row.id, status: 'expired' });
          out.expired++;
        } else {
          out.awaiting++;
        }
        continue;
      }
      const full = await mailProvider.getMessage(coach, candidates[0].id);
      if (!full.ok) { out.awaiting++; continue; }
      const sentText = stripQuotedTail(htmlToText(full.message.body) || String(full.message.snippet || ''));
      if (!sentText) { out.awaiting++; continue; }
      const pair = await store.recordEditPair({
        tenantId: tenant,
        leadName: row.to_email,
        leadUrl: null,
        surface: 'email',
        generated: row.generated,
        sent: sentText,
      });
      await store.settleDraftRecord({ tenantId: tenant, id: row.id, status: pair.stored ? 'paired' : 'no-diff' });
      if (pair.stored) out.paired++; else out.noDiff++;
    } catch (e) {
      console.warn(`[wingguyMailMcp] settle: row #${row.id} failed (non-fatal): ${e.message}`);
      out.awaiting++;
    }
  }
  return out;
}

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

module.exports = { registerWingguyMailTools, legacyToolList, legacyToolCall, TOOL_DEFS, detectAssets, htmlToText, stripQuotedTail, settleEmailEditPairs, parseLinkedInLast, classifyLead, computeMailSignals, computeFollowupSweep, runFollowupSweep };
