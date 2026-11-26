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

function loadFile() {
  return JSON.parse(fs.readFileSync(GUIDES_PATH, 'utf8'));
}
function loadGuides() {
  return loadFile().guides || [];
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

/**
 * What Claude is told to put after a topic's words: the link to that topic on its web page. EVERY
 * topic gets one (Guy, 26 Nov 2026: "just show the link without the user specifically asking").
 * The words before the link promise pictures only when the page has them.
 */
function topicLinkLine(title) {
  const link = topicLink(title);
  if (!link) return '';
  return topicHasPictures(title)
    ? `PICTURES: this topic is also on a web page with pictures of the screens. After Guy's words, on a line of its own, give them this link exactly as written: See it with pictures: ${link}`
    : `WEB PAGE: this topic is also on a web page they can keep, come back to or pass on. After Guy's words, on a line of its own, give them this link exactly as written: Read it on a page: ${link}`;
}

/** The same for the list of topics: the front page, where every topic is a link. */
function everythingLinkLine() {
  return `WEB PAGE: all of this is also on the web, a page at a time, easier to read than one long answer. At the end, on a line of its own, give them this link exactly as written: All of it on one page: ${siteBase()}/learn`;
}
function indexLinkLine() {
  return `WEB PAGE: all of Wingguy Learning is also on the web, every topic a link. After the list, on a line of its own, give them this link exactly as written: All of it on one page: ${siteBase()}/learn`;
}

/** Does the guide show PICTURES for this topic? It decides how the link is worded, not whether it goes. */
function topicHasPictures(title) {
  const t = String(title || '').toUpperCase();
  if (!t) return false;
  return loadGuides().some((g) => (g.topics || []).some((x) => t.startsWith(String(x.title || '').toUpperCase()) && (x.figures || []).length > 0));
}

// ---------------------------------------------------------------------------- the words

/**
 * Inline markdown: escape first, then the marks. A quoted sentence in italics is one to SAY. A web
 * address becomes a link (a made-up one like "https://..." stays as text), and `ticks` become code.
 * Anything that ends up inside an HTML attribute is parked first so a later mark cannot break it.
 */
function inline(text) {
  let s = esc(String(text).replace(/\s*\n\s*/g, ' ').trim());
  const parked = [];
  const park = (html) => { parked.push(html); return `\u0001${parked.length - 1}\u0001`; };
  s = s.replace(/\*&quot;([^*]+?)&quot;\*/g, (_, say) => park(`<button type="button" class="say" data-say="${say}" title="Tap to copy, then paste it into your Claude">&ldquo;${say}&rdquo;</button>`));
  s = s.replace(/`([^`]+?)`/g, (_, code) => park(`<code>${code}</code>`));
  s = s.replace(/https?:\/\/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+[^\s<\u0001]*/gi, (m) => {
    const tail = (m.match(/(?:&quot;|&#39;|[.,;:!?)\]*])+$/) || [''])[0];
    const url = tail ? m.slice(0, -tail.length) : m;
    return park(`<a class="lnk" href="${url}" rel="noopener">${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>`) + tail;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => parked[Number(i)]);
}

/** The words of a block with the marks taken off - what a Copy button puts on the clipboard. */
const plain = (text) => esc(String(text).replace(/\s*\n\s*/g, ' ').replace(/\*+/g, '').replace(/`/g, '').trim());
const copyBtn = (text) => `<button type="button" class="say cp" data-say="${plain(text)}" data-toast="Copied">Copy</button>`;

/**
 * One block of the playbook (the text between two blank lines) can hold more than one thing: a "### "
 * heading, a paragraph, then a list straight under it. Split it into runs of one kind each:
 * h (heading) / p (paragraph) / ul / ol / q (a "> " quote).
 */
function runsOf(block) {
  const out = []; let buf = []; let kind = 'p';
  const flush = () => { if (buf.length) out.push({ kind, text: buf.join('\n') }); buf = []; };
  for (const ln of String(block).split('\n')) {
    if (/^#{3,}\s+/.test(ln)) { flush(); out.push({ kind: 'h', text: ln.replace(/^#{3,}\s+/, '').trim() }); kind = 'p'; continue; }
    const k = /^\s*>/.test(ln) ? 'q' : /^\s*- /.test(ln) ? 'ul' : /^\s*\d+[.)] /.test(ln) ? 'ol' : null;
    if (k && k !== kind) { flush(); kind = k; } else if (!k && kind === 'q') { flush(); kind = 'p'; }
    buf.push(ln);
  }
  flush();
  return out;
}

/**
 * A topic's text as parts: [{ label, id, html }] - the opening part has label ''. A paragraph that
 * opens with a bold run ending in a full stop, question mark or nothing-else starts a new part.
 */
function partsOf(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map((b) => b.replace(/\s+$/, '')).filter((b) => b.trim() && !/^-{3,}$/.test(b.trim()));
  const parts = [{ label: '', id: '', html: [] }];
  const cur = () => parts[parts.length - 1];
  for (const run of blocks.flatMap(runsOf)) {
    const b = run.text;
    if (run.kind === 'h') { parts.push({ label: b, id: slugOf(b), html: [] }); continue; }
    if (run.kind === 'ul') {
      const items = b.split(/\n(?=\s*- )/).map((it) => it.replace(/^\s*- /, ''));
      cur().html.push(`<ul class="pts">${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
      continue;
    }
    if (run.kind === 'ol') {
      const items = b.split(/\n(?=\s*\d+[.)] )/).map((it) => it.replace(/^\s*\d+[.)] /, ''));
      cur().html.push(`<ol class="steps">${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>`);
      continue;
    }
    if (run.kind === 'q') {
      // words to copy and use - a message to send, or something to say to Claude
      const said = b.split('\n').map((ln) => ln.replace(/^\s*> ?/, '')).join('\n').trim();
      const bare = said.replace(/^\*([^*]+)\*$/s, '$1').replace(/^"([^"]+)"$/s, '$1');
      cur().html.push(`<blockquote class="quote">${bare.split(/\n\s*\n/).map((p) => `<p>${inline(p)}</p>`).join('')}${copyBtn(bare)}</blockquote>`);
      continue;
    }
    const flat = b.replace(/\s*\n\s*/g, ' ').trim();
    if (!flat) continue;
    const code = flat.match(/^`([^`]+)`$/);
    if (code) { cur().html.push(`<div class="code"><code>${esc(code[1])}</code>${copyBtn(code[1])}</div>`); continue; }
    const head = flat.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
    if (head && (head[2] === '' || /[.?!]$/.test(head[1]))) {
      const label = head[1].replace(/[.:]$/, '').trim();
      parts.push({ label, id: slugOf(label), html: [] });
      if (head[2]) cur().html.push(`<p>${inline(head[2])}</p>`);
      continue;
    }
    cur().html.push(`<p>${inline(flat)}</p>`);
  }
  return parts;
}

function figure(name, caption, bar) {
  const safe = String(name || '').replace(/[^a-z0-9-]/gi, '');
  let inner;
  try { inner = fs.readFileSync(path.join(FIGURES_DIR, `${safe}.html`), 'utf8'); } catch (_) { return ''; }
  return `<figure class="fig"><div class="shot"><div class="bar"><i></i><i></i><i></i><span>${esc(bar || 'portal.knowaguy.com.au')}</span></div><div class="screen">${inner}</div></div>${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
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
    const mine = figs.filter((f) => slugOf(f.after) === p.id && p.id).map((f) => figure(f.name, f.caption, f.bar)).join('');
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

  const all = loadGuides();
  const next = all[all.findIndex((x) => x.slug === slug) + 1];
  const inner = `${g.intro ? `<p class="how">${inline(g.intro)}</p>` : ''}
${action}
      ${shown.length > 1 ? `<ul class="map">
          ${map}
      </ul>` : ''}
${shown.map((t, i) => topicSection(g, t, topics, i + 1)).join('\n')}
      <nav class="more">${next ? `<a class="nx" href="/learn/${next.slug}"><span>Next page</span><b>${esc(next.title)} &rarr;</b></a>` : ''}<a class="all" href="/learn">Everything in Wingguy Learning</a></nav>`;
  return page({ eyebrow: g.eyebrow, title: g.title, dek: g.dek, inner, footer: g.footer || loadFile().footer });
}

/** The front page, knowaguy.com.au/learn: every guide, and every topic in it, each one a link. */
function renderIndex() {
  const file = loadFile();
  const ix = file.index || {};
  const topics = loadTopics();
  const cards = (file.guides || []).map((g, i) => {
    const shown = (g.topics || []).filter((t) => findTopic(topics, t.title));
    return `<li class="gd"><a class="gt" href="/learn/${g.slug}"><span class="num">${i + 1}</span><span><b>${esc(g.title)}</b>${g.dek ? `<span class="short">${esc(g.dek)}</span>` : ''}</span></a>
          <ul class="tl">${shown.map((t) => `<li><a href="/learn/${g.slug}#${slugOf(t.heading || t.title)}">${esc(t.heading || t.title)}</a></li>`).join('')}</ul></li>`;
  }).join('\n        ');
  const more = ix.more && (ix.more.items || []).length ? `
      <h2 class="mh">${esc(ix.more.heading || 'More pages')}</h2>
      <ul class="map">
          ${ix.more.items.map((m) => `<li><a href="${esc(m.href)}"><span><b>${esc(m.title)}</b>${m.sub ? `<span class="short">${esc(m.sub)}</span>` : ''}</span></a></li>`).join('\n          ')}
      </ul>` : '';
  const inner = `${ix.intro ? `<p class="how">${inline(ix.intro)}</p>` : ''}
      <ul class="idx">
        ${cards}
      </ul>${more}`;
  return page({ title: ix.title || 'Wingguy Learning', dek: ix.dek, inner, footer: file.footer });
}
function indexMeta() {
  const ix = loadFile().index || {};
  return { title: `${ix.title || 'Wingguy Learning'} - I Know A Guy`, description: ix.dek || '' };
}

/** The editorial shell every Learning page wears. o = { eyebrow, title, dek, inner, footer }. */
function page(o) {
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

  .steps { list-style:none; counter-reset:s; margin:.3rem 0 1.3rem; padding:0; }
  .steps li { counter-increment:s; position:relative; padding:0 0 .8rem 40px; font-size:17px; line-height:1.6; color:var(--ink); }
  .steps li::before { content:counter(s); position:absolute; left:0; top:.1em; width:26px; height:26px; border-radius:50%; border:1px solid var(--gold); color:var(--gold-ink); font-size:14px; display:flex; align-items:center; justify-content:center; }
  .quote { margin:.4rem 0 1.4rem; padding:16px 18px 12px; background:#fff; border:1px solid var(--rule); border-left:3px solid var(--gold); border-radius:4px; }
  .body .quote p { font-size:16.5px; line-height:1.6; margin:0 0 .7rem; color:var(--ink-deep); }
  .say.cp { font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:13px; font-weight:600; color:var(--gold-ink); padding:4px 12px; }
  .code { margin:.2rem 0 1.2rem; padding:12px 14px 10px; background:#fff; border:1px solid var(--rule); border-radius:4px; }
  .code code { display:block; margin:0 0 8px; overflow-wrap:anywhere; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.84em; color:var(--ink-deep); }
  .lnk { color:var(--gold-ink); overflow-wrap:anywhere; }
  .more { display:flex; flex-direction:column; gap:12px; margin:0 0 2rem; padding-top:1.6rem; border-top:1px solid var(--rule); }
  .more .nx { display:block; padding:14px 18px; border:1px solid var(--gold); border-radius:6px; background:var(--cream); text-decoration:none; }
  .more .nx span { display:block; font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold-ink); margin:0 0 3px; }
  .more .nx b { font-size:20px; font-weight:400; color:var(--ink-deep); }
  .more .all { font-size:16px; color:var(--gold-ink); }
  .idx { list-style:none; margin:0 0 2rem; padding:0; }
  .mh { font-size:13px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold-ink); margin:0 0 12px; font-weight:400; }
  .gd { margin:0 0 14px; border:1px solid var(--rule); border-radius:5px; background:#fff; }
  .gt { display:flex; align-items:center; gap:14px; padding:14px 16px; text-decoration:none; color:inherit; }
  .gt:hover { background:var(--cream); }
  .gt b { display:block; font-size:20px; line-height:1.25; color:var(--ink-deep); font-weight:400; }
  .tl { list-style:none; margin:0; padding:10px 16px 12px 60px; border-top:1px solid var(--rule); display:flex; flex-wrap:wrap; gap:4px 18px; }
  .tl a { font-size:15px; line-height:1.5; color:var(--gold-ink); text-decoration:none; }
  .tl a:hover { text-decoration:underline; }

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
    .now { padding:18px 16px 14px; } .tl { padding-left:16px; } .screen { padding:11px; } .pair { grid-template-columns:1fr; }
    .u-row { grid-template-columns:70px minmax(0,1fr); } .u-row .u-wide { grid-column:1 / -1; }
    .u-tabs { gap:14px; } .u-tab small { display:none; }
  }
</style>

<div class="op-page">
  <article class="op">
    <header class="op-mast">
      <p class="op-wm"><a href="/">(I know a) Guy</a></p>
      <p class="op-eb">${esc(o.eyebrow || 'Wingguy Learning')}</p>
    </header>

    <div class="op-c">
      <h1 class="op-t">${esc(o.title)}</h1>
      ${o.dek ? `<p class="op-dek">${esc(o.dek)}</p>` : ''}
      <hr class="op-r">
      ${o.inner}

      <footer class="op-foot">
        ${o.footer ? `<p>${inline(o.footer)}</p>` : ''}
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
  var said = toast.textContent;
  function done(btn) { toast.textContent = btn.getAttribute('data-toast') || said; toast.classList.add('on'); btn.classList.add('done'); clearTimeout(timer); timer = setTimeout(function () { toast.classList.remove('on'); btn.classList.remove('done'); }, 1800); }
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

module.exports = { renderGuide, guideMeta, renderIndex, indexMeta, topicLink, topicLinkLine, indexLinkLine, everythingLinkLine, topicHasPictures, runsOf, loadGuides, loadTopics, partsOf, inline, slugOf, GUIDES_PATH };
