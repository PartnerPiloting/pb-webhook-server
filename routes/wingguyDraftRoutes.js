// routes/wingguyDraftRoutes.js
//
// GET /wingguy/draft?c=<tenant>&n=<person>&s=<sig> — the read-only draft page behind the queue's
// [draft] links (services/wingguyDraftLink.js mints and signs them). One person, one page: the
// memory-jog, the pre-written message, a copy button, and the LinkedIn profile link. Deliberately
// READ-ONLY — tweaking, sending, parking and dropping stay in chat, so this page can never drift
// from the stores it reads. noindex, no external assets, link-only + HMAC-signed.
//
// ONE EXCEPTION (Guy 2026-10-03): POST /wingguy/draft/push — the "Push to email drafts" button on EMAIL
// entries. Copy-paste is the wrong tool for email (find the thread, hit reply, paste), so the button
// files the stored reply in the coach's own mailbox via the SAME wingguy_create_draft the chat uses:
// threaded, asset-gated, Follow-Up Date stamped — the record stays right, nothing is ever sent.
// One click, one draft: an unsent draft-ledger row to that person answers "already in your drafts".

const express = require('express');
const { verify } = require('../services/wingguyDraftLink');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fullPage(title, inner) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f6f5f2; color: #1c1b19; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 28px 20px 60px; }
  .card { background: #fff; border: 1px solid #e5e2db; border-radius: 10px; padding: 24px 26px; }
  h1 { font-size: 1.35rem; margin: 0 0 2px; }
  .links a { font-size: .9rem; margin-right: 14px; }
  .label { font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: #8a857b; margin: 20px 0 6px; }
  .jog, .why { margin: 0; line-height: 1.55; }
  .draft { white-space: pre-wrap; line-height: 1.6; background: #faf9f6; border: 1px solid #eceae4;
           border-radius: 8px; padding: 16px 18px; margin: 0; font-family: inherit; }
  button { margin-top: 12px; padding: 9px 18px; font-size: .95rem; border: 1px solid #1c1b19;
           border-radius: 7px; background: #1c1b19; color: #fff; cursor: pointer; }
  button:active { transform: translateY(1px); }
  button.second { background: #fff; color: #1c1b19; margin-left: 8px; }
  button:disabled { opacity: .55; cursor: default; }
  .pushmsg { font-size: .88rem; line-height: 1.5; margin: 10px 0 0; }
  .pushmsg.bad { color: #a4321f; }
  .note { font-size: .82rem; color: #8a857b; line-height: 1.5; margin-top: 22px; }
</style>
</head><body><div class="wrap"><div class="card">${inner}</div></div></body></html>`;
}

function problemPage(res, status, title, message) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(fullPage(title, `<h1>${esc(title)}</h1><p class="jog">${esc(message)}</p>`));
}

/** Find one person's entry across the two prepared stores — today's brief wins (fresher draft). */
async function findEntry(tenant, name) {
  const briefStore = require('../services/wingguyFollowupBrief');
  const backlog = require('../services/wingguyBacklogAudit');
  const nm = String(name).trim().toLowerCase();
  const parse = (row) => {
    if (!row || !row.payload) return [];
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return (p && p.items) || [];
  };
  try {
    const it = parse(await briefStore.getBrief(tenant)).find((i) => String(i.name).toLowerCase() === nm);
    if (it) return { src: 'today', it };
  } catch (_) { /* fall through to backlog */ }
  try {
    const it = parse(await backlog.getWorklist(tenant)).find((i) => String(i.name).toLowerCase() === nm);
    if (it) return { src: 'backlog', it };
  } catch (_) { /* not found */ }
  return null;
}

/** An email entry the button can file: a channel=email entry with an address and stored wording. */
function canPush(it) {
  return !!(it && it.channel === 'email' && (it.draftHtml || it.replyToMessageId)
    && String(it.email || '').trim() && (it.draftHtml || it.draftText));
}

/** Arguments for wingguy_create_draft, built ONLY from the stored entry — the page never picks a "to". */
function pushArgs(it) {
  const html = it.draftHtml
    || `<p>${esc(it.draftText).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
  const subject = it.pushSubject
    || (it.threadSubject ? (/^re:/i.test(it.threadSubject) ? it.threadSubject : `Re: ${it.threadSubject}`) : 'Picking our conversation back up');
  const args = { to: [{ email: String(it.email).trim(), name: it.name }], subject, html_body: html };
  if (it.replyToMessageId) args.reply_to_message_id = String(it.replyToMessageId);
  return args;
}

function ledgerStore() {
  if (!(process.env.DATABASE_URL || '').trim()) return null;
  return require('../services/wingguyRulesStore');
}

/** Is an unsent draft to this person already sitting in the mailbox? Best-effort — a miss is "no". */
async function alreadyPushed(tenant, it, deps = {}) {
  const store = deps.store !== undefined ? deps.store : ledgerStore();
  if (!store) return false;
  try { return !!(await store.findAwaitingDraftTo({ tenantId: tenant, toEmail: it.email })); }
  catch (_) { return false; }
}

const inFlight = new Set(); // tenant|person mid-push — a double-click must not file two drafts

/**
 * File one entry's stored reply as a draft in the coach's mailbox.
 * @returns {{ok:boolean, already?:boolean, error?:string}}
 */
async function pushEntry(tenant, it, deps = {}) {
  if (!canPush(it)) return { ok: false, error: 'This entry has no email draft to push.' };
  const key = `${String(tenant).toLowerCase()}|${String(it.name).toLowerCase()}`;
  if (inFlight.has(key)) return { ok: true, already: true };
  inFlight.add(key);
  try {
    if (await alreadyPushed(tenant, it, deps)) return { ok: true, already: true };
    const mailTools = deps.mailTools || require('../services/wingguyMailMcp').TOOL_DEFS;
    const def = mailTools.find((d) => d.name === 'wingguy_create_draft');
    if (!def) return { ok: false, error: 'The draft tool is not available.' };
    const out = await def.run(pushArgs(it), tenant);
    if (out && out.isError) return { ok: false, error: String(out.text || 'The draft was not created.') };
    return { ok: true, already: false };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    inFlight.delete(key);
  }
}

module.exports = function mountWingguyDraft(app) {
  const router = express.Router();

  // c/n/s ride the query string (same signed link as the page) so this needs no body parser.
  router.post('/wingguy/draft/push', async (req, res) => {
    const { c, n, s } = req.query || {};
    if (!c || !n || !s || !verify(c, n, s)) return res.status(403).json({ ok: false, error: 'This link is missing or has an invalid signature.' });
    let found;
    try { found = await findEntry(c, n); }
    catch (e) { return res.status(500).json({ ok: false, error: `The draft store could not be read: ${e.message}` }); }
    if (!found) return res.status(404).json({ ok: false, error: `${n} isn't in the prepared queue any more - ask your Wingguy chat for a fresh list.` });
    const out = await pushEntry(c, found.it);
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.get('/wingguy/draft', async (req, res) => {
    const { c, n, s } = req.query || {};
    if (!c || !n || !s || !verify(c, n, s)) {
      return problemPage(res, 403, 'Not available', 'This link is missing or has an invalid signature. Ask your Wingguy chat for a fresh queue — every line carries a current link.');
    }
    let found;
    try { found = await findEntry(c, n); }
    catch (e) { return problemPage(res, 500, 'Store unavailable', `The draft store could not be read: ${e.message}`); }
    if (!found) {
      return problemPage(res, 404, 'Not in the current queue', `${n} isn't in the prepared queue any more — the stores may have been rebuilt since this link was minted. Ask your Wingguy chat for a fresh list, or for this person by name.`);
    }
    const { it } = found;
    const isEmail = it.channel === 'email' && (it.draftHtml || it.replyToMessageId);
    const pushable = canPush(it);
    const already = pushable ? await alreadyPushed(c, it) : false;
    const parts = [`<h1>${esc(it.name)}</h1>`];
    const links = [];
    if (it.linkedin) links.push(`<a href="${esc(it.linkedin)}" target="_blank" rel="noopener">LinkedIn profile</a>`);
    if (links.length) parts.push(`<p class="links">${links.join('')}</p>`);
    if (it.jog) parts.push(`<p class="label">Who this is</p><p class="jog">${esc(it.jog)}</p>`);
    if (it.whyLine) parts.push(`<p class="label">Why they're on the list</p><p class="why">${esc(it.whyLine)}</p>`);
    if (it.draftText) {
      parts.push(`<p class="label">${isEmail ? 'Ready-made reply (email)' : 'Ready-made message (paste into LinkedIn)'}</p>`);
      parts.push(`<pre class="draft" id="draft">${esc(it.draftText)}</pre>`);
      parts.push(`<button id="copybtn" onclick="copyDraft()">Copy message</button>`);
      parts.push(`<script>function copyDraft(){navigator.clipboard.writeText(document.getElementById('draft').innerText).then(function(){var b=document.getElementById('copybtn');b.textContent='Copied \\u2713';setTimeout(function(){b.textContent='Copy message';},1500);});}</script>`);
      if (pushable) {
        parts.push(already
          ? `<button id="pushbtn" class="second" disabled>Already in your email drafts ✓</button>`
          : `<button id="pushbtn" class="second" onclick="pushDraft()">Push to email drafts</button>`);
        parts.push(`<p class="pushmsg" id="pushmsg"></p>`);
        parts.push(`<script>function pushDraft(){var b=document.getElementById('pushbtn'),m=document.getElementById('pushmsg');b.disabled=true;b.textContent='Pushing\\u2026';m.className='pushmsg';m.textContent='';fetch('/wingguy/draft/push'+location.search,{method:'POST'}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok){b.textContent=j.already?'Already in your email drafts \\u2713':'In your email drafts \\u2713';m.textContent='It is in the Drafts folder of your connected email, threaded under their last message. Nothing has been sent.';}else{throw new Error((j&&j.error)||'The draft was not created.');}}).catch(function(e){b.disabled=false;b.textContent='Push to email drafts';m.className='pushmsg bad';m.textContent=e.message+' You can still copy the message, or ask your Wingguy chat.';});}</script>`);
      }
    } else if (it.wgAngle) {
      // LinkedIn person: no pre-written message BY DESIGN (Guy 2026-08-01) — the reply is drafted
      // live in the thread with /wg, where the conversation and the calendar are both current.
      // The overnight homework is the angle.
      parts.push(`<p class="label">How to reply</p><p class="why">Open the LinkedIn thread and type <strong>/wg</strong> — it writes the message live from the real conversation and your real calendar.</p>`);
      parts.push(`<p class="label">Suggested angle</p><p class="why">${esc(it.wgAngle)}</p>`);
    } else {
      parts.push(`<p class="label">Draft</p><p class="why">No pre-written message is stored on this entry${it.draftError ? ` (generation failed: ${esc(it.draftError)})` : ''} — ask your Wingguy chat for ${esc(it.name)} by name; the overnight dossier usually carries one.</p>`);
    }
    if (pushable && it.draftText) parts.push(`<p class="note">Push to email drafts files this reply in the Drafts folder of your connected email, threaded under ${esc(it.name)}'s last message - it never sends. Tweak the wording there. To park ${esc(it.name)} to a date, or drop them from follow-ups, tell your Wingguy chat - that's where the record is kept.</p>`);
    else parts.push(`<p class="note">This page is read-only. To tweak the wording, send it${isEmail ? ' to Gmail' : ''}, park ${esc(it.name)} to a date, or drop them from follow-ups, tell your Wingguy chat — that's where the record is kept.</p>`);
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(fullPage(`${it.name} — draft`, parts.join('\n')));
  });

  app.use(router);
};

// Test seams.
module.exports.canPush = canPush;
module.exports.pushArgs = pushArgs;
module.exports.pushEntry = pushEntry;
