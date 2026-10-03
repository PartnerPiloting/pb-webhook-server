// routes/wingguyDraftRoutes.js
//
// GET /wingguy/draft?c=<tenant>&n=<person>&s=<sig> — the draft page behind the queue's [draft]
// links (services/wingguyDraftLink.js mints and signs them). One person, one page: the memory-jog,
// the pre-written message, a copy button, and the LinkedIn profile link. Parking and dropping stay
// in chat, so this page never drifts from the stores it reads. noindex, no external assets,
// link-only + HMAC-signed.
//
// Two things the page DOES do (Guy 2026-10-03), both through doors that already exist:
//   POST /wingguy/draft/push — "Push to email drafts" on EMAIL entries. Files the wording on screen
//     in the coach's own mailbox via the SAME wingguy_create_draft the chat uses: threaded,
//     asset-gated, Follow-Up Date stamped, never sent. The recipient always comes from the stored
//     entry. A first push is refused when an unsent draft to that person is already on record;
//     "Push again" is the human's deliberate second copy.
//   POST /wingguy/draft/ask — the Discuss box. The SAME one-person agent as the portal's Ask box
//     (services/wingguyFollowupsAsk.js: dossier, live calendar, mailbox), told what draft is on
//     screen. A draft it writes replaces the one on the page, ready to copy or push. One brain,
//     two windows — no second chat logic lives here.

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
  .draft.fresh { border-color: #2f7d4f; background: #f3faf5; }
  button { margin-top: 12px; padding: 9px 18px; font-size: .95rem; border: 1px solid #1c1b19;
           border-radius: 7px; background: #1c1b19; color: #fff; cursor: pointer; }
  button:active { transform: translateY(1px); }
  button.second { background: #fff; color: #1c1b19; margin-left: 8px; }
  button:disabled { opacity: .55; cursor: default; }
  .pushmsg { font-size: .88rem; line-height: 1.5; margin: 10px 0 0; }
  .pushmsg.bad { color: #a4321f; }
  .chat { margin-top: 18px; border-top: 1px solid #eceae4; padding-top: 14px; }
  .chat .msg { font-size: .93rem; line-height: 1.55; margin: 0 0 10px; white-space: pre-wrap; }
  .chat .you { color: #5d5a53; }
  .chat .you::before { content: "You: "; font-weight: 600; }
  .chat .bad { color: #a4321f; }
  .chat form { display: flex; gap: 8px; align-items: flex-end; }
  .chat textarea { flex: 1; font: inherit; font-size: .95rem; padding: 9px 11px; border: 1px solid #cfcbc2;
                   border-radius: 7px; resize: vertical; min-height: 42px; }
  .chat form button { margin: 0; }
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

/** An email person the button can file a draft to — with stored wording, or wording from the box. */
function canPush(it, text) {
  return !!(it && it.channel === 'email' && String(it.email || '').trim()
    && (String(text || '').trim() || it.draftHtml || it.draftText));
}

/** Plain wording (the page's draft box) as simple email HTML: paragraphs, line breaks, live links. */
function textToHtml(text) {
  const body = esc(String(text || '').trim())
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')
    .replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  return `<p>${body}</p>`;
}

/**
 * Arguments for wingguy_create_draft. Recipient, subject and thread come ONLY from the stored
 * entry — the page never picks a "to". `text` (the wording on screen after a Discuss rewrite)
 * replaces the stored body when given.
 */
function pushArgs(it, text) {
  const html = String(text || '').trim() ? textToHtml(text) : (it.draftHtml || textToHtml(it.draftText));
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
async function alreadyPushed(tenant, it, opts = {}) {
  const store = opts.store !== undefined ? opts.store : ledgerStore();
  if (!store) return false;
  try { return !!(await store.findAwaitingDraftTo({ tenantId: tenant, toEmail: it.email })); }
  catch (_) { return false; }
}

const inFlight = new Set(); // tenant|person mid-push — a double-click must not file two drafts

/**
 * File a draft to one entry's person in the coach's mailbox.
 * @param {Object} [opts]  text: wording on screen (else the stored draft) · again: the human asked
 *                         for another copy, skip the already-there check · mailTools/store: test seams
 * @returns {{ok:boolean, already?:boolean, error?:string}}
 */
async function pushEntry(tenant, it, opts = {}) {
  if (!canPush(it, opts.text)) return { ok: false, error: 'This entry has no email draft to push.' };
  const key = `${String(tenant).toLowerCase()}|${String(it.name).toLowerCase()}`;
  if (inFlight.has(key)) return { ok: true, already: true };
  inFlight.add(key);
  try {
    if (!opts.again && await alreadyPushed(tenant, it, opts)) return { ok: true, already: true };
    const mailTools = opts.mailTools || require('../services/wingguyMailMcp').TOOL_DEFS;
    const def = mailTools.find((d) => d.name === 'wingguy_create_draft');
    if (!def) return { ok: false, error: 'The draft tool is not available.' };
    const out = await def.run(pushArgs(it, opts.text), tenant);
    if (out && out.isError) return { ok: false, error: String(out.text || 'The draft was not created.') };
    return { ok: true, already: false };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    inFlight.delete(key);
  }
}

const MAX_TURNS = 40;          // messages kept per conversation
const MAX_MSG_CHARS = 6000;

/**
 * The conversation as the Ask agent should see it: clean roles, capped, and the FIRST question
 * carrying the draft that is on screen — "make it shorter" means nothing without it. Pure.
 */
function askMessages(it, messages) {
  const clean = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_MSG_CHARS) }));
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return [];
  if (it.draftText) {
    clean[0] = {
      role: 'user',
      content: `(I am looking at the prepared draft page for ${it.name}. The draft on screen reads:\n"""\n${it.draftText}\n"""\nWhen I ask for a change, give me the full new wording in a draft block.)\n\n${clean[0].content}`,
    };
  }
  return clean;
}

/**
 * The page's own script. Written as a real function and inlined with toString(), so it is
 * syntax-checked with this file and needs no escaping inside a template string.
 */
/* eslint-disable no-undef */
function pageScript() {
  var $ = function (id) { return document.getElementById(id); };
  var qs = location.search;
  var draftEl = $('draft'), copyBtn = $('copybtn'), pushBtn = $('pushbtn'), pushMsg = $('pushmsg');
  var edited = false, messages = [], busy = false;

  function post(path, body) {
    return fetch(path + qs, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); });
  }
  function copyTo(btn, text) {
    var label = btn.textContent;
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = label; }, 1500);
    });
  }
  if (copyBtn) copyBtn.onclick = function () { copyTo(copyBtn, draftEl.innerText); };

  function say(text, bad) { if (pushMsg) { pushMsg.className = bad ? 'pushmsg bad' : 'pushmsg'; pushMsg.textContent = text; } }
  function armPush(label, again) { pushBtn.textContent = label; pushBtn.dataset.again = again ? '1' : ''; pushBtn.disabled = false; }
  if (pushBtn) pushBtn.onclick = function () {
    var was = pushBtn.textContent, again = pushBtn.dataset.again === '1';
    pushBtn.disabled = true; pushBtn.textContent = 'Pushing…'; say('');
    post('/wingguy/draft/push', { again: again, text: edited ? draftEl.innerText : '' }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || 'The draft was not created.');
      armPush('Push again to email drafts', true);
      say(j.already
        ? 'One is already in your email drafts. Push again adds another copy - delete the old one in your mailbox if you do.'
        : 'In your email drafts ✓ - threaded under their last message. Nothing has been sent.');
    }).catch(function (e) {
      armPush(was, again);
      say(e.message + ' You can still copy the message.', true);
    });
  };

  // ---- Discuss ----
  var chat = $('chat'), log = $('chatlog'), form = $('chatform'), box = $('chatbox'), discussBtn = $('discussbtn');
  if (!chat) return;
  function line(cls, text) {
    var p = document.createElement('p'); p.className = 'msg ' + cls; p.textContent = text; log.appendChild(p); return p;
  }
  function showDraft(text) {
    if (draftEl) {
      draftEl.textContent = text; draftEl.className = 'draft fresh'; edited = true;
      if (pushBtn) armPush('Push this version to email drafts', true);
      say('');
      return 'New wording is in the draft box above.';
    }
    var pre = document.createElement('pre'); pre.className = 'draft fresh'; pre.textContent = text; log.appendChild(pre);
    var b = document.createElement('button'); b.textContent = 'Copy message'; b.onclick = function () { copyTo(b, text); }; log.appendChild(b);
    return '';
  }
  function showReply(reply) {
    var out = [], last = 0, m, re = /```(draft|park)[^\n]*\n([\s\S]*?)\n?```/g;
    while ((m = re.exec(reply))) {
      out.push(reply.slice(last, m.index).trim());
      if (m[1] === 'draft') out.push(showDraft(m[2].trim()));
      else out.push('Suggested park date: ' + m[2].trim().split('\n')[0] + ' - to park, tell your Wingguy chat.');
      last = re.lastIndex;
    }
    out.push(reply.slice(last).trim());
    var text = out.filter(Boolean).join('\n\n');
    if (text) line('them', text);
  }
  function send(q) {
    if (busy || !q) return;
    busy = true; box.value = '';
    line('you', q);
    messages.push({ role: 'user', content: q });
    var wait = line('them', 'Thinking…');
    post('/wingguy/draft/ask', { messages: messages }).then(function (j) {
      wait.remove();
      if (!j || !j.ok) throw new Error((j && j.error) || 'No answer came back.');
      messages.push({ role: 'assistant', content: j.reply });
      showReply(j.reply);
    }).catch(function (e) {
      wait.remove(); messages.pop();
      line('bad', e.message + ' Try again.');
      box.value = q;
    }).then(function () { busy = false; box.focus(); });
  }
  discussBtn.onclick = function () { chat.hidden = false; discussBtn.hidden = true; box.focus(); };
  form.onsubmit = function (ev) { ev.preventDefault(); send(box.value.trim()); };
  box.onkeydown = function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(box.value.trim()); } };
}
/* eslint-enable no-undef */

module.exports = function mountWingguyDraft(app) {
  const router = express.Router();
  const json = express.json({ limit: '300kb' });

  // c/n/s ride the query string — the same signed link as the page. Resolves the entry or answers.
  async function entryFor(req, res) {
    const { c, n, s } = req.query || {};
    if (!c || !n || !s || !verify(c, n, s)) { res.status(403).json({ ok: false, error: 'This link is missing or has an invalid signature.' }); return null; }
    let found;
    try { found = await findEntry(c, n); }
    catch (e) { res.status(500).json({ ok: false, error: `The draft store could not be read: ${e.message}` }); return null; }
    if (!found) { res.status(404).json({ ok: false, error: `${n} isn't in the prepared queue any more - ask your Wingguy chat for a fresh list.` }); return null; }
    return { tenant: c, it: found.it };
  }

  router.post('/wingguy/draft/push', json, async (req, res) => {
    const e = await entryFor(req, res);
    if (!e) return undefined;
    const body = req.body || {};
    const out = await pushEntry(e.tenant, e.it, { again: body.again === true, text: String(body.text || '').slice(0, 20000) });
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/wingguy/draft/ask', json, async (req, res) => {
    const e = await entryFor(req, res);
    if (!e) return undefined;
    const messages = askMessages(e.it, (req.body || {}).messages);
    if (!messages.length) return res.status(400).json({ ok: false, error: 'Type a question first.' });
    try {
      const coach = await require('../services/clientService').getClientById(e.tenant);
      if (!coach) return res.status(404).json({ ok: false, error: 'This account could not be found.' });
      const { answerAboutPerson } = require('../services/wingguyFollowupsAsk');
      const r = await answerAboutPerson({ coach, person: { name: e.it.name, email: e.it.email, linkedin: e.it.linkedin }, messages });
      if (!r.ok) return res.status(r.blocked || r.keyError ? 402 : 422).json({ ok: false, error: String(r.error || 'No answer came back.') });
      return res.json({ ok: true, reply: r.reply });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
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
    const pushable = canPush(it) && !!it.draftText;
    const already = pushable ? await alreadyPushed(c, it) : false;
    const discussBtn = `<button id="discussbtn" class="second">Discuss</button>`;
    const parts = [`<h1>${esc(it.name)}</h1>`];
    const links = [];
    if (it.linkedin) links.push(`<a href="${esc(it.linkedin)}" target="_blank" rel="noopener">LinkedIn profile</a>`);
    if (links.length) parts.push(`<p class="links">${links.join('')}</p>`);
    if (it.jog) parts.push(`<p class="label">Who this is</p><p class="jog">${esc(it.jog)}</p>`);
    if (it.whyLine) parts.push(`<p class="label">Why they're on the list</p><p class="why">${esc(it.whyLine)}</p>`);
    if (it.draftText) {
      parts.push(`<p class="label">${isEmail ? 'Ready-made reply (email)' : 'Ready-made message (paste into LinkedIn)'}</p>`);
      parts.push(`<pre class="draft" id="draft">${esc(it.draftText)}</pre>`);
      parts.push(`<button id="copybtn">Copy message</button>`);
      if (pushable) {
        parts.push(already
          ? `<button id="pushbtn" class="second" data-again="1">Push again to email drafts</button>`
          : `<button id="pushbtn" class="second">Push to email drafts</button>`);
      }
      parts.push(discussBtn);
      if (pushable) parts.push(`<p class="pushmsg" id="pushmsg">${already ? 'One is already in your email drafts. Push again adds another copy - delete the old one in your mailbox if you do.' : ''}</p>`);
    } else if (it.wgAngle) {
      // LinkedIn person: no pre-written message BY DESIGN (Guy 2026-08-01) — the reply is drafted
      // live in the thread with /wg, where the conversation and the calendar are both current.
      // The overnight homework is the angle.
      parts.push(`<p class="label">How to reply</p><p class="why">Open the LinkedIn thread and type <strong>/wg</strong> — it writes the message live from the real conversation and your real calendar.</p>`);
      parts.push(`<p class="label">Suggested angle</p><p class="why">${esc(it.wgAngle)}</p>`);
      parts.push(discussBtn.replace(' class="second"', ''));
    } else {
      parts.push(`<p class="label">Draft</p><p class="why">No pre-written message is stored on this entry${it.draftError ? ` (generation failed: ${esc(it.draftError)})` : ''} — ask for one below.</p>`);
      parts.push(discussBtn.replace(' class="second"', ''));
    }
    // The Discuss box (Guy 2026-10-03: "a simple discuss button like we have in /wg").
    const first = esc(String(it.name).split(' ')[0]);
    parts.push(`<div class="chat" id="chat" hidden><div id="chatlog"></div><form id="chatform"><textarea id="chatbox" rows="2" placeholder="Ask about ${first}, or say what to change - e.g. shorter, or offer three times next week"></textarea><button type="submit">Send</button></form></div>`);
    parts.push(`<p class="note">${pushable ? `Push to email drafts files the wording above in the Drafts folder of your connected email, threaded under ${esc(it.name)}'s last message - it never sends. ` : ''}Discuss knows ${first}'s history and your live calendar. To park ${esc(it.name)} to a date, or drop them from follow-ups, tell your Wingguy chat - that's where the record is kept.</p>`);
    parts.push(`<script>(${pageScript.toString()})();</script>`);
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(fullPage(`${it.name} — draft`, parts.join('\n')));
  });

  app.use(router);
};

// Test seams.
module.exports.canPush = canPush;
module.exports.pushArgs = pushArgs;
module.exports.pushEntry = pushEntry;
module.exports.askMessages = askMessages;
module.exports.textToHtml = textToHtml;
