/**
 * Wingguy Learning GUIDES - knowaguy.com.au/learn/<slug> (Guy, 26 Nov 2026).
 *
 * A guide is a web page made of Wingguy Learning topics shown one after another, with pictures. The
 * topics' WORDS are read from docs/client-playbook.md on every request - the same file wingguy_learn
 * serves to a client's Claude - so there is one copy of the method and the page cannot fall behind
 * it. content/learn-guides.json only says which topics a guide is made of, in what order, and where
 * the pictures go.
 *
 *   renderGuide(slug)     the page body for routes/marketingRoutes.js (null when there is no such guide)
 *   topicLink(title)      "https://knowaguy.com.au/learn/<slug>#<topic>" for a topic that is in a guide,
 *                         or '' - wingguy_learn adds it to the end of Claude's answer
 *   guideMeta(slug)       { title, description } for the page head
 *
 * The playbook's markdown is a small, steady subset: paragraphs, "- " lists, **bold**, *italic*, and a
 * bold run that opens a paragraph ("**Finding someone.** In Your CRM ...") which reads as a
 * sub-heading. A sentence a client is told to say - *"save Jane Smith to my contacts"* - becomes a
 * tap-to-copy button, as on /what-wingguy-can-do. Anything outside the subset is shown as plain text,
 * never dropped.
 */

const fs = require('fs');
const path = require('path');

const GUIDES_PATH = path.join(__dirname, '..', 'content', 'learn-guides.json');
const PLAYBOOK_PATH = path.join(__dirname, '..', 'docs', 'client-playbook.md');
const FIGURES_DIR = path.join(__dirname, '..', 'content', 'learn', 'figures');

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugOf = (s) => String(s || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function loadGuides() {
  return JSON.parse(fs.readFileSync(GUIDES_PATH, 'utf8')).guides || [];
}

/** The playbook as { title, body } topics - the same split wingguy_learn uses ("## " headings). */
function loadTopics() {
  const raw = fs.readFileSync(PLAYBOOK_PATH, 'utf8').replace(/\r\n/g, '\n');
  return raw.split(/^## /m).slice(1).map((sec) => {
    const lines = sec.split('\n');
    return { title: lines[0].trim(), text: lines.slice(1).join('\n') };
  });
}

const findTopic = (topics, prefix) => topics.find((t) => t.title.toUpperCase().startsWith(String(prefix || '').toUpperCase()));

function siteBase() {
  return String(process.env.SITE_BASE_URL || 'https://knowaguy.com.au').replace(/\/+$/, '');
}

/** The link to a topic's place in a guide, or '' when no guide carries it. */
function topicLink(title) {
  const t = String(title || '').toUpperCase();
  if (!t) return '';
  for (const g of loadGuides()) {
    const hit = (g.topics || []).find((x) => t.startsWith(String(x.title || '').toUpperCase()));
    if (hit) return `${siteBase()}/learn/${g.slug}#${slugOf(hit.heading || hit.title)}`;
  }
  return '';
}

// ---------------------------------------------------------------------------- the words

/** Inline markdown: escape first, then the three marks. A quoted sentence in italics is one to SAY. */
function inline(text) {
  let s = esc(String(text).replace(/\s*\n\s*/g, ' ').trim());
  s = s.replace(/\*&quot;([^*]+?)&quot;\*/g, (_, say) => `<button type="button" class="say" data-say="${say}" title="Tap to copy, then paste it into your Claude">&ldquo;${say}&rdquo;</button>`);
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  return s;
}

/**
 * A topic's text as parts: [{ label, id, html }] - the opening part has label ''. A paragraph that
 * opens with a bold run ending in a full stop, question mark or nothing-else starts a new part.
 */
function partsOf(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim() && !/^-{3,}$/.test(b.trim()));
  const parts = [{ label: '', id: '', html: [] }];
  const cur = () => parts[parts.length - 1];
  for (const b of blocks) {
    if (/^\s*- /.test(b)) {
      const items = b.split(/\n(?=\s*- )/).map((it) => it.replace(/^\s*- /, ''));
      cur().html.push(`<ul class="pts">${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
      continue;
    }
    const flat = b.replace(/\s*\n\s*/g, ' ').trim();
    const head = flat.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (head && (head[2] === '' || /[.?!]$/.test(head[1]))) {
      const label = head[1].replace(/[.]$/, '').trim();
      parts.push({ label, id: slugOf(label), html: [] });
      if (head[2]) cur().html.push(`<p>${inline(head[2])}</p>`);
      continue;
    }
    cur().html.push(`<p>${inline(flat)}</p>`);
  }
  return parts;
}

function figure(name, caption) {
  const safe = String(name || '').replace(/[^a-z0-9-]/gi, '');
  let inner;
  try { inner = fs.readFileSync(path.join(FIGURES_DIR, `${safe}.html`), 'utf8'); } catch (_) { return ''; }
  return `<figure class="fig"><div class="shot"><div class="bar"><i></i><i></i><i></i><span>portal.knowaguy.com.au</span></div><div class="screen">${inner}</div></div>${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
}

function topicSection(g, t, topics, n) {
  const topic = findTopic(topics, t.title);
  if (!topic) return '';
  const id = slugOf(t.heading || t.title);
  const parts = partsOf(topic.text);
  const figs = t.figures || [];
  // Two paragraphs that each open with one of the guide's "pair" words (Leads / Contacts) sit side by
  // side as cards - same words, in the same order, only the layout changes.
  if (Array.isArray(t.pair) && t.pair.length === 2) {
    for (const p of parts) {
      const at = (w) => p.html.findIndex((h) => h.startsWith(`<p><strong>${esc(w)}</strong> `));
      const a = at(t.pair[0]); const b = at(t.pair[1]);
      if (a >= 0 && b === a + 1) {
        const card = (h, i) => `<div class="kind k${i}">${h}</div>`;
        p.html.splice(a, 2, `<div class="pair">${card(p.html[a], 1)}${card(p.html[b], 2)}</div>`);
      }
    }
  }
  const body = parts.map((p) => {
    const mine = figs.filter((f) => slugOf(f.after) === p.id && p.id).map((f) => figure(f.name, f.caption)).join('');
    const top = p.label ? `<h3 id="${id}-${p.id}">${esc(p.label)}</h3>` : '';
    return `${top}${p.html.join('\n')}${mine}`;
  }).join('\n');
  return `
      <section class="topic" id="${id}">
        <div class="step"><span class="num">${n}</span><div class="head"><h2>${esc(t.heading || topic.title)}</h2>${t.sub ? `<p class="sub">${esc(t.sub)}</p>` : ''}</div></div>
        <div class="body">${body}</div>
      </section>`;
}

function guideMeta(slug) {
  const g = loadGuides().find((x) => x.slug === slug);
  return g ? { title: `${g.title} - Wingguy Learning`, description: g.dek || '' } : null;
}

function renderGuide(slug) {
  const g = loadGuides().find((x) => x.slug === slug);
  if (!g) return null;
  const topics = loadTopics();
  const shown = (g.topics || []).filter((t) => findTopic(topics, t.title));
  const map = shown.map((t, i) => `<li><a href="#${slugOf(t.heading || t.title)}"><span class="num">${i + 1}</span><span><b>${esc(t.heading || t.title)}</b>${t.sub ? `<span class="short">${esc(t.sub)}</span>` : ''}</span></a></li>`).join('\n          ');
  const a = g.action;
  const action = a ? `
      <aside class="now">
        <h2>${esc(a.heading)}</h2>
        <ol>${(a.steps || []).map((s) => `<li>${inline(s)}</li>`).join('')}</ol>
        ${a.button ? `<p class="go"><a class="btn" href="${esc(a.button.href)}">${esc(a.button.label)} &rarr;</a></p>` : ''}
        ${a.say ? `<p class="then">${esc(a.then || 'Then say:')} ${inline(`*"${a.say}"*`)}</p>` : ''}
      </aside>` : '';

  return `<style>
  /* The editorial shell the one-pagers use (see utils/wingguyCapabilities.js). GENERATED by
     utils/learnGuides.js: the topics' words come from docs/client-playbook.md - edit them there. */
  :root { color-scheme: light; --ground:#e9e2d3; --card:#fbf9f3; --ink:#2c2823; --ink-deep:#221f1a; --ink-soft:#6f6558; --ink-mid:#4a423a; --rule:#e2dccd; --dark:#211d18; --gold:#c49a5e; --gold-ink:#9a6a2f; --cream:#f3ede1; --ui:#1d4ed8; --ui-soft:#eff4ff; --ui-line:#d7dde8; --ui-ink:#111827; --ui-mute:#6b7280; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman",serif; -webkit-font-smoothing:antialiased; }
  .op-page { padding:28px 16px 52px; }
  .op { max-width:740px; margin:0 auto 22px; background:var(--card); border-radius:6px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.10); }
  .op-mast { background:var(--dark); padding:30px 40px 26px; display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  .op-eb { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--gold); margin:0; }
  .op-wm { font-size:24px; margin:0; font-weight:400; }
  .op-wm a { color:var(--cream); text-decoration:none; }
  .op-c { padding:38px 40px 8px; }
  .op-t { font-size:36px; line-height:1.15; margin:0 0 14px; color:var(--ink-deep); font-weight:400; text-wrap:balance; letter-spacing:-.01em; }
  .op-dek { font-style:italic; color:var(--ink-soft); font-size:19px; line-height:1.5; margin:0 0 22px; text-wrap:balance; }
  .op-r { border:0; border-top:1px solid var(--rule); margin:0 0 24px; }
  .how { font-size:17px; line-height:1.62; color:var(--ink-mid); margin:0 0 1.5rem; }

  .now { margin:0 0 2rem; padding:22px 24px 18px; border:1px solid var(--gold); border-radius:6px; background:var(--cream); }
  .now h2 { font-size:13px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold-ink); margin:0 0 14px; font-weight:400; }
  .now ol { list-style:none; counter-reset:n; margin:0 0 16px; padding:0; }
  .now li { counter-increment:n; position:relative; padding:0 0 12px 42px; font-size:17px; line-height:1.55; color:var(--ink); }
  .now li::before { content:counter(n); position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; background:var(--dark); color:var(--cream); font-size:14px; display:flex; align-items:center; justify-content:center; }
  .now .go { margin:0 0 14px; }
  .btn { display:inline-block; font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:15.5px; font-weight:600; color:var(--cream); background:var(--dark); text-decoration:none; padding:11px 20px; border-radius:5px; }
  .btn:hover, .btn:focus-visible { background:#3a332b; outline:none; }
  .now .then { margin:0; padding-top:14px; border-top:1px solid #e3d6bd; font-size:16px; line-height:1.9; color:var(--ink-mid); }

  .say { font:inherit; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:14px; line-height:1.4; text-align:left; color:var(--ink-deep); background:#fff; border:1px solid var(--rule); border-radius:4px; padding:5px 10px; cursor:pointer; vertical-align:baseline; }
  .say:hover, .say:focus-visible { border-color:var(--gold); background:var(--cream); outline:none; }
  .say.done { border-color:var(--gold); background:var(--cream); }

  .map { list-style:none; margin:0 0 2.4rem; padding:0; border:1px solid var(--rule); border-radius:4px; background:#fff; }
  .map li + li { border-top:1px solid var(--rule); }
  .map a { display:flex; align-items:center; gap:14px; padding:12px 16px; text-decoration:none; color:inherit; }
  .map a:hover { background:var(--cream); }
  .map b { display:block; font-size:17px; line-height:1.3; color:var(--ink-deep); font-weight:400; }
  .short { display:block; font-size:14.5px; line-height:1.45; color:var(--ink-soft); }
  .num { flex:none; width:30px; height:30px; border-radius:50%; background:var(--dark); color:var(--cream); font-size:15px; display:flex; align-items:center; justify-content:center; }

  .topic { margin:0 0 2.6rem; padding-top:2rem; border-top:1px solid var(--rule); scroll-margin-top:12px; }
  .step { display:flex; gap:14px; align-items:flex-start; margin:0 0 14px; }
  .head h2 { font-size:27px; line-height:1.2; margin:0 0 4px; color:var(--ink-deep); font-weight:400; text-wrap:balance; }
  .head .sub { font-style:italic; font-size:16.5px; line-height:1.45; color:var(--ink-soft); margin:0; }
  .body p { font-size:17.5px; line-height:1.66; margin:0 0 1.05rem; color:var(--ink); }
  .body h3 { font-size:18.5px; line-height:1.3; margin:1.9rem 0 .5rem; color:var(--ink-deep); font-weight:700; scroll-margin-top:12px; }
  .body strong { color:var(--ink-deep); }
  .pts { list-style:none; margin:.2rem 0 1.2rem; padding:0; }
  .pts li { position:relative; padding:0 0 .7rem 22px; font-size:17px; line-height:1.6; color:var(--ink); }
  .pts li::before { content:""; position:absolute; left:3px; top:.62em; width:7px; height:7px; border-radius:50%; background:var(--gold); }

  .pair { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:.3rem 0 1.3rem; }
  .kind { background:#fff; border:1px solid var(--rule); border-top:3px solid var(--dark); border-radius:5px; padding:16px 18px 4px; }
  .kind.k2 { border-top-color:var(--gold); }
  .body .kind p { font-size:16.5px; line-height:1.58; margin:0 0 .8rem; }
  .body .kind strong { display:block; font-size:21px; font-weight:400; margin:0 0 6px; }

  .fig { margin:1.5rem 0 1.9rem; }
  .shot { border:1px solid #cfc6b4; border-radius:8px; overflow:hidden; background:#fff; box-shadow:0 10px 28px -14px rgba(33,29,24,.45), 0 2px 5px rgba(33,29,24,.08); }
  .bar { display:flex; align-items:center; gap:6px; padding:9px 12px; background:#efeae0; border-bottom:1px solid #ddd5c5; }
  .bar i { width:9px; height:9px; border-radius:50%; background:#cbbfa9; }
  .bar span { margin-left:10px; flex:1; max-width:300px; font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:11.5px; color:#857a69; background:#fbf9f4; border:1px solid #ddd5c5; border-radius:999px; padding:3px 12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .screen { padding:16px; background:#f6f7f9; font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ui-ink); font-size:13.5px; line-height:1.45; }
  .fig figcaption { margin:10px 4px 0; font-style:italic; font-size:15px; line-height:1.5; color:var(--ink-soft); text-align:center; text-wrap:balance; }
  /* the drawn screens - shared pieces */
  .u-tabs { display:flex; gap:22px; margin:0 0 12px; padding:0 2px; border-bottom:1px solid var(--ui-line); }
  .u-tab { padding:0 0 9px; color:var(--ui-mute); }
  .u-tab b { display:block; font-weight:500; color:#374151; font-size:13.5px; }
  .u-tab small { display:block; font-size:11px; }
  .u-tab.on { border-bottom:2px solid var(--ui); margin-bottom:-1px; }
  .u-tab.on b { color:var(--ui); }
  .u-card { background:#fff; border:1px solid var(--ui-line); border-radius:8px; padding:14px 16px; }
  .u-card h4 { margin:0; font-size:14.5px; font-weight:600; }
  .body .screen p { font-size:13px; line-height:1.45; margin:0; color:inherit; }
  .body .screen .u-mute { margin:2px 0 0; color:var(--ui-mute); font-size:12.5px; }
  .u-btns { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  .u-btn { border:1px solid #93b4f5; color:var(--ui); background:#fff; border-radius:7px; padding:6px 12px; font-size:13px; white-space:nowrap; }
  .u-btn.hot { background:var(--ui-soft); box-shadow:0 0 0 3px rgba(196,154,94,.55); }
  .u-btn.solid { background:var(--ui); border-color:var(--ui); color:#fff; font-weight:600; }
  .u-btn.plain { border-color:transparent; color:#374151; }
  .body .screen .u-note { margin-top:10px; font-size:12.5px; color:#374151; }
  .u-note u { color:var(--ui); }
  .u-pill { display:inline-block; font-size:11px; font-weight:600; border-radius:999px; padding:1px 9px; }
  .u-pill.lead { background:#e7f0ff; color:#1e40af; }
  .u-pill.contact { background:#eef2f1; color:#3f5f57; }
  .u-row { display:grid; grid-template-columns:84px minmax(0,1.1fr) minmax(0,1.5fr); gap:6px 12px; align-items:center; padding:9px 4px; border-top:1px solid #edf0f4; }
  .u-row b { font-weight:600; }
  .u-row .u-sm { display:block; color:var(--ui-mute); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .u-row a { color:var(--ui); text-decoration:none; }
  .u-input { display:flex; align-items:center; gap:8px; border:1px solid var(--ui-line); border-radius:7px; background:#fff; padding:8px 12px; color:var(--ui-ink); }
  .u-input::before { content:""; width:11px; height:11px; border:2px solid #9aa3b2; border-radius:50%; flex:none; }
  .u-sum { background:var(--ui-soft); border:1px solid #c9d8f7; border-radius:7px; padding:11px 13px; color:#1e3a8a; font-size:13px; }
  .body .screen .u-sum p { margin:0 0 6px; font-size:13px; } .body .screen .u-sum p:last-child { margin:0; }
  .u-grid { width:100%; border-collapse:collapse; font-size:12.5px; background:#fff; }
  .u-grid th { text-align:left; font-weight:600; background:#eef1f5; color:#374151; padding:6px 9px; border:1px solid var(--ui-line); white-space:nowrap; }
  .u-grid td { padding:6px 9px; border:1px solid var(--ui-line); white-space:nowrap; }
  .u-grid .k { background:#fdf6e9; }
  .u-scroll { overflow-x:auto; border-radius:6px; }

  .op-foot { padding:20px 40px 8px; border-top:1px solid var(--rule); margin-top:.6rem; font-size:15px; line-height:1.6; color:var(--ink-soft); }
  .op-foot a { color:var(--gold-ink); }
  .op-sign { margin:.9rem 0 0; }
  .op-bar { background:var(--dark); height:34px; }
  .toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); background:var(--dark); color:var(--cream); font-size:15px; padding:10px 18px; border-radius:999px; opacity:0; pointer-events:none; transition:opacity .15s; font-family:Georgia,serif; }
  .toast.on { opacity:1; }
  @media (max-width:560px) {
    .op-page { padding:0 0 36px; } .op { border-radius:0; }
    .op-mast, .op-c, .op-foot { padding-left:20px; padding-right:20px; }
    .op-t { font-size:29px; } .head h2 { font-size:23px; }
    .now { padding:18px 16px 14px; } .screen { padding:11px; } .pair { grid-template-columns:1fr; }
    .u-row { grid-template-columns:70px minmax(0,1fr); } .u-row .u-wide { grid-column:1 / -1; }
    .u-tabs { gap:14px; } .u-tab small { display:none; }
  }
</style>

<div class="op-page">
  <article class="op">
    <header class="op-mast">
      <p class="op-wm"><a href="/">(I know a) Guy</a></p>
      <p class="op-eb">${esc(g.eyebrow || 'Wingguy Learning')}</p>
    </header>

    <div class="op-c">
      <h1 class="op-t">${esc(g.title)}</h1>
      ${g.dek ? `<p class="op-dek">${esc(g.dek)}</p>` : ''}
      <hr class="op-r">
      ${g.intro ? `<p class="how">${inline(g.intro)}</p>` : ''}
${action}
      ${shown.length > 1 ? `<ul class="map">\n          ${map}\n      </ul>` : ''}
${shown.map((t, i) => topicSection(g, t, topics, i + 1)).join('\n')}

      <footer class="op-foot">
        ${g.footer ? `<p>${inline(g.footer)}</p>` : ''}
        <p class="op-sign">- (I know a) Guy</p>
      </footer>
    </div>

    <div class="op-bar"></div>
  </article>
</div>
<div class="toast" id="toast" role="status" aria-live="polite">Copied - paste it into your Claude</div>

<script>
(function () {
  var toast = document.getElementById('toast'); var timer;
  function done(btn) { toast.classList.add('on'); btn.classList.add('done'); clearTimeout(timer); timer = setTimeout(function () { toast.classList.remove('on'); btn.classList.remove('done'); }, 1800); }
  function fallback(text, btn) { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(btn); } catch (e) {} document.body.removeChild(t); }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.say') : null;
    if (!btn) return;
    var text = btn.getAttribute('data-say');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(btn); }, function () { fallback(text, btn); });
    else fallback(text, btn);
  });
})();
</script>`;
}

module.exports = { renderGuide, guideMeta, topicLink, loadGuides, loadTopics, partsOf, inline, slugOf, GUIDES_PATH };
