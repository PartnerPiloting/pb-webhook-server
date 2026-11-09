/**
 * Wingguy capabilities - turns content/wingguy-capabilities.json into the two things a client sees:
 *
 *   renderVision(state, now)  - the SHORT chat answer to "what can I do with Wingguy?" (wingguy_vision):
 *                               the eight parts, one line and one sentence to try each, what is new,
 *                               what they still have to switch on, and the link to the page.
 *   renderPage(now)           - the FULL page at knowaguy.com.au/what-wingguy-can-do: every line,
 *                               folded into eight cards, tap a sentence to copy it, a search box.
 *
 * Why generated: until 9 Nov 2026 the answer was hand-written prose inside the tool. It never
 * mentioned the Linked Helper machine, still said leads arrive by copy and paste, and was missing
 * most of what had been built since July - and nothing made it keep up. Now the words live in ONE
 * list and tests/wingguy-capabilities.test.js fails when a tool exists that the list does not know.
 *
 * Why two shapes: the first generated answer put all 33 lines in the chat and Guy called it what it
 * was - a wall of text (9 Nov 2026). The chat is for the shape of the thing and the next step; the
 * page is for looking something up. Both read the same list, so they cannot disagree.
 *
 *   load()            - the parsed list (cached).
 *   allListedTools()  - { shown: Set, notShown: Set } - what the test compares to reality.
 *   pageUrl()         - where the page lives.
 *
 * Pure: no database, no network. Everything client-specific comes in through state
 * (resolveState()'s shape: { name, hasMachine, hasMailbox, hasCalendar, hasFathom, rulesSeeded }).
 */

const fs = require('fs');
const path = require('path');

const LIST_PATH = path.join(__dirname, '..', 'content', 'wingguy-capabilities.json');

let cache = null;
function load() {
  if (!cache) cache = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8'));
  return cache;
}

function pageUrl(base = process.env.SITE_BASE_URL || 'https://knowaguy.com.au') {
  return `${String(base).replace(/\/+$/, '')}${load().page_path}`;
}

// What each "needs" means for one client, and the words used when they do not have it yet.
const NEEDS = {
  machine: { has: (s) => !!(s && s.hasMachine), waiting: 'once your machine is switched on' },
  mailbox: { has: (s) => !!(s && s.hasMailbox), waiting: 'once your mailbox is connected' },
  calendar: { has: (s) => !!(s && s.hasCalendar), waiting: 'once your calendar is connected' },
  notes: { has: (s) => !!(s && s.hasFathom), waiting: 'once your call note-taker is connected' },
};

function isNew(item, now, days) {
  if (!item.added) return false;
  const t = Date.parse(`${item.added}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const age = (now.getTime() - t) / 86400000;
  return age >= 0 && age <= days;
}

function allListedTools() {
  const list = load();
  const shown = new Set();
  for (const sec of list.sections) for (const it of sec.items) for (const t of it.tools || []) shown.add(t);
  return { shown, notShown: new Set(Object.keys(list.not_shown || {})) };
}

/** The one sentence a section offers in the chat answer: its starter line, else its first. */
function heroOf(sec) {
  return sec.items.find((i) => i.start) || sec.items[0];
}

// ---------------------------------------------------------------------------------------------
// The chat answer - a card, not a list.
//
// Guy, 10 Nov 2026: even the eight-line map was "still too much text", and the screenshot showed the
// client's Claude paraphrasing every line anyway. The only lever we control is how much we hand it.
// So: one sentence on what it is, the page link (the page carries all the detail), what is new,
// what is still to switch on, and ONE thing to try. Seeing that one thing work is the impressive part.
// ---------------------------------------------------------------------------------------------
function renderVision(s, now = new Date()) {
  const list = load();
  const days = Number(list.new_for_days) || 30;
  const name = s && s.name ? s.name : '';
  const total = list.sections.reduce((n, sec) => n + sec.items.length, 0);
  const parts = [];

  parts.push(`**Welcome${name ? ', ' + name : ''}.** A machine finds the right people on LinkedIn, and I look after every conversation that comes back. You run all of it from here, just by saying what you want.`);
  parts.push('');
  parts.push(`All ${total} things you can ask for are on one page, tap any to copy: ${pageUrl()}`);

  const fresh = list.sections.flatMap((sec) => sec.items.filter((it) => isNew(it, now, days)));
  if (fresh.length) {
    parts.push('');
    parts.push(`**New this month:** ${fresh.map((it) => `"${it.say}"`).join(', ')}.`);
  }

  // Where this client is up to - only what is true for them, and only the names.
  const todo = [];
  if (!s || !s.hasMachine) todo.push('your machine');
  if (!s || !s.hasMailbox) todo.push('your mailbox');
  if (!s || !s.hasCalendar) todo.push('your calendar');
  if (!s || !s.hasFathom) todo.push('a call note-taker');
  if (!s || !s.rulesSeeded) todo.push('your instructions');
  if (todo.length) {
    parts.push('');
    parts.push(`**Still to switch on:** ${todo.join(', ')}. Say **"where are we up to?"** and I'll take you through the next one.`);
  }

  parts.push('');
  parts.push(`Or just try **"${heroOf(list.sections.find((sec) => sec.id === 'followups') || list.sections[0]).say}"**.`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The page - everything, folded.
// ---------------------------------------------------------------------------------------------
const esc = (t) => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escape, then turn the list's **bold** into <b>. */
const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

function sayButton(say) {
  return `<button type="button" class="say" data-say="${esc(say)}" title="Tap to copy, then paste it into your Claude">&ldquo;${esc(say)}&rdquo;</button>`;
}

function renderPage(now = new Date()) {
  const list = load();
  const days = Number(list.new_for_days) || 30;
  const total = list.sections.reduce((n, sec) => n + sec.items.length, 0);
  const starters = list.sections.flatMap((sec) => sec.items.filter((it) => it.start));

  const row = (it) => {
    const fresh = isNew(it, now, days);
    return `<li class="line" data-text="${esc(`${it.say} ${it.does}`.toLowerCase())}">${sayButton(it.say)}${fresh ? '<span class="new">New</span>' : ''}<span class="does">${rich(cap(it.does))}</span></li>`;
  };

  const cards = list.sections.map((sec, i) => `
      <details class="part" id="${esc(sec.id)}"${i === 0 ? ' open' : ''}>
        <summary>
          <span class="num">${i + 1}</span>
          <span class="head"><b>${esc(sec.title)}</b><span class="short">${esc(sec.short)}</span></span>
          <span class="count">${sec.items.length}</span>
        </summary>
        <div class="inner">
          <p class="lead">${rich(sec.lead)}</p>
          <ul class="lines">
            ${sec.items.map(row).join('\n            ')}
          </ul>
        </div>
      </details>`).join('\n');

  return `<style>
  /* The editorial shell the one-pagers use (see content/site/how-campaigns-work.html). Single-theme.
     GENERATED by utils/wingguyCapabilities.js from content/wingguy-capabilities.json - edit the list,
     never this markup's words. */
  :root { color-scheme: light; --ground:#e9e2d3; --card:#fbf9f3; --ink:#2c2823; --ink-deep:#221f1a; --ink-soft:#6f6558; --ink-mid:#4a423a; --rule:#e2dccd; --dark:#211d18; --gold:#c49a5e; --gold-ink:#9a6a2f; --cream:#f3ede1; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman",serif; -webkit-font-smoothing:antialiased; }
  .op-page { padding:28px 16px 52px; }
  .op { max-width:720px; margin:0 auto 22px; background:var(--card); border-radius:6px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.10); }
  .op-mast { background:var(--dark); padding:34px 40px 30px; }
  .op-eb { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--gold); margin:0 0 12px; }
  .op-wm { font-size:30px; margin:0; font-weight:400; }
  .op-wm a { color:var(--cream); text-decoration:none; }
  .op-c { padding:34px 40px 8px; }
  .op-t { font-size:30px; line-height:1.2; margin:0 0 12px; color:var(--ink-deep); font-weight:400; text-wrap:balance; }
  .op-dek { font-style:italic; color:var(--ink-soft); font-size:18px; line-height:1.5; margin:0 0 20px; text-wrap:balance; }
  .op-r { border:0; border-top:1px solid var(--rule); margin:0 0 22px; }
  .how { font-size:16px; line-height:1.6; color:var(--ink-mid); margin:0 0 1.3rem; }
  .say { font:inherit; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:14px; line-height:1.4; text-align:left; color:var(--ink-deep); background:#fff; border:1px solid var(--rule); border-radius:4px; padding:6px 10px; cursor:pointer; }
  .say:hover, .say:focus-visible { border-color:var(--gold); background:var(--cream); outline:none; }
  .say.done { border-color:var(--gold); background:var(--cream); }
  .start { margin:0 0 1.6rem; padding:16px 18px 12px; border:1px solid var(--gold); border-radius:4px; background:var(--cream); }
  .start h2 { font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--gold-ink); margin:0 0 10px; font-weight:400; }
  .start .say { margin:0 8px 8px 0; }
  .find { display:block; width:100%; box-sizing:border-box; font:inherit; font-size:16px; padding:11px 14px; border:1px solid var(--rule); border-radius:4px; background:#fff; color:var(--ink); margin:0 0 6px; }
  .find:focus { outline:none; border-color:var(--gold); }
  .tools { display:flex; justify-content:space-between; align-items:baseline; margin:0 0 14px; font-size:14px; color:var(--ink-soft); }
  .tools button { font:inherit; font-size:14px; color:var(--gold-ink); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }
  .part { border:1px solid var(--rule); border-radius:4px; background:#fff; margin:0 0 10px; }
  .part[open] { border-color:var(--gold); }
  .part summary { display:flex; align-items:center; gap:14px; padding:14px 16px; cursor:pointer; list-style:none; }
  .part summary::-webkit-details-marker { display:none; }
  .num { flex:none; width:30px; height:30px; border-radius:50%; background:var(--dark); color:var(--cream); font-size:15px; display:flex; align-items:center; justify-content:center; }
  .head { flex:1; min-width:0; }
  .head b { display:block; font-size:18px; line-height:1.3; color:var(--ink-deep); font-weight:700; }
  .short { display:block; font-size:15px; line-height:1.45; color:var(--ink-soft); }
  .count { flex:none; font-size:13px; color:var(--ink-soft); border:1px solid var(--rule); border-radius:999px; padding:2px 9px; }
  .count::after { content:" +"; }
  .part[open] .count::after { content:" \\2212"; }
  .inner { padding:2px 16px 8px 60px; }
  .lead { font-size:16px; line-height:1.6; color:var(--ink-mid); margin:0 0 14px; }
  .lines { list-style:none; margin:0; padding:0; }
  .line { padding:11px 0; border-top:1px solid var(--rule); }
  .does { display:block; font-size:16px; line-height:1.55; margin-top:6px; color:var(--ink); }
  .new { display:inline-block; margin-left:8px; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#fff; background:var(--gold-ink); border-radius:3px; padding:2px 7px; vertical-align:middle; }
  .none { display:none; font-size:16px; color:var(--ink-soft); margin:0 0 1rem; }
  .hide { display:none; }
  .toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); background:var(--dark); color:var(--cream); font-size:15px; padding:10px 18px; border-radius:999px; opacity:0; pointer-events:none; transition:opacity .15s; }
  .toast.on { opacity:1; }
  .op-foot { padding:18px 40px 6px; border-top:1px solid var(--rule); margin-top:1.6rem; font-size:14px; line-height:1.6; color:var(--ink-soft); }
  .op-sign { margin:.9rem 0 0; }
  .op-bar { background:var(--dark); height:34px; }
  @media (max-width:520px) { .op-mast, .op-c, .op-foot { padding-left:22px; padding-right:22px; } .op-t { font-size:25px; } .op-wm { font-size:26px; } .inner { padding-left:16px; } }
</style>

<div class="op-page">
  <article class="op">
    <header class="op-mast">
      <p class="op-eb">Network building, rethought</p>
      <p class="op-wm"><a href="/">(I know a) Guy</a></p>
    </header>

    <div class="op-c">
      <h1 class="op-t">What you can do with Wingguy</h1>
      <p class="op-dek">A machine that finds the right people on LinkedIn, and an assistant that looks after every conversation that comes back.</p>
      <hr class="op-r">

      <p class="how">You don't learn any of this. You just say it. <b>Tap a sentence to copy it, then paste it into your Claude.</b> There are ${total} here, in ${list.sections.length} parts, in the order a new contact travels - from stranger to someone you've met.</p>

      <div class="start">
        <h2>New here? Start with these</h2>
        ${starters.map((it) => sayButton(it.say)).join('\n        ')}
      </div>

      <input class="find" id="find" type="search" placeholder="Looking for something? Type a word - email, campaign, booking..." aria-label="Search this page">
      <div class="tools"><span id="found"></span><button type="button" id="all">Open all</button></div>
      <p class="none" id="none">Nothing here matches that. Ask your Claude anyway - or ask Guy.</p>
${cards}

      <footer class="op-foot">
        <p>This page writes itself from the live list of what Wingguy can do, so anything marked New arrived in the last ${days} days and nothing here is out of date. You can also just ask your Claude: &ldquo;what can I do with Wingguy?&rdquo;</p>
        <p class="op-sign">- (I know a) Guy</p>
      </footer>
    </div>

    <div class="op-bar"></div>
  </article>
</div>
<div class="toast" id="toast" role="status" aria-live="polite">Copied - paste it into your Claude</div>

<script>
(function () {
  var toast = document.getElementById('toast'), timer;
  function copy(text, btn) {
    function done() {
      btn.classList.add('done');
      toast.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(function () { toast.classList.remove('on'); btn.classList.remove('done'); }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.say') : null;
    if (b) copy(b.getAttribute('data-say'), b);
  });

  var parts = [].slice.call(document.querySelectorAll('.part'));
  var find = document.getElementById('find'), found = document.getElementById('found'), none = document.getElementById('none');
  var all = document.getElementById('all');
  all.addEventListener('click', function () {
    var open = all.textContent === 'Open all';
    parts.forEach(function (p) { p.open = open; });
    all.textContent = open ? 'Close all' : 'Open all';
  });
  find.addEventListener('input', function () {
    var q = find.value.trim().toLowerCase(), hits = 0;
    parts.forEach(function (p, i) {
      var any = 0;
      [].forEach.call(p.querySelectorAll('.line'), function (li) {
        var ok = !q || li.getAttribute('data-text').indexOf(q) >= 0;
        li.classList.toggle('hide', !ok);
        if (ok) any++;
      });
      p.classList.toggle('hide', !any);
      p.open = q ? any > 0 : i === 0;
      if (q) hits += any;
    });
    found.textContent = q ? (hits + (hits === 1 ? ' match' : ' matches')) : '';
    none.style.display = q && !hits ? 'block' : 'none';
  });
})();
</script>`;
}

module.exports = { load, renderVision, renderPage, allListedTools, pageUrl, heroOf, LIST_PATH, NEEDS };
