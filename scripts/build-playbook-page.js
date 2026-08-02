#!/usr/bin/env node
/**
 * build-playbook-page.js - render the whole client playbook as one review page.
 *
 * WHY: wingguy_learn serves clients ONE topic at a time, which is right for them but leaves nobody
 * able to see the whole thing at once - which is how the missing follow-up topic went unnoticed.
 * This lays all the topics out in journey order with a word count per topic, so a thin one shows up
 * without having to read for it.
 *
 * Reads docs/client-playbook.md every run, so the page can never drift from what clients get.
 *
 *   node scripts/build-playbook-page.js                      # -> playbook-review.html (git-ignored)
 *   node scripts/build-playbook-page.js <src.md> <out.html>  # explicit paths
 *
 * Then open the HTML in a browser.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SRC = process.argv[2] || path.join(REPO, 'docs', 'client-playbook.md');
const OUT = process.argv[3] || path.join(REPO, 'playbook-review.html');

// Which commit clients are actually being served from, when it can be worked out.
function currentCommit() {
  if (process.argv[4]) return process.argv[4];
  for (const ref of ['origin/main', 'HEAD']) {
    try {
      return execFileSync('git', ['rev-parse', '--short', ref], { cwd: REPO, encoding: 'utf8' }).trim();
    } catch { /* not a checkout, or no remote - the page just omits it */ }
  }
  return '';
}
const COMMIT = currentCommit();

const raw = fs.readFileSync(SRC, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

// Minimal block renderer for the shapes this doc actually uses.
function renderBlocks(lines) {
  const out = [];
  let para = [];
  let list = null; // {tag, items:[[lines]]}
  let quote = [];

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it) => `<li>${inline(it.join(' '))}</li>`).join('\n');
    out.push(`<${list.tag}>\n${items}\n</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; }
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flushAll(); continue; }
    if (t === '---') { flushAll(); continue; }

    const bullet = t.match(/^[-*]\s+(.*)$/);
    const numbered = t.match(/^(\d+)\.\s+(.*)$/);
    const quoted = t.match(/^>\s?(.*)$/);

    if (quoted) { flushPara(); flushList(); quote.push(quoted[1]); continue; }
    flushQuote();

    if (bullet) {
      flushPara();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push([bullet[1]]);
      continue;
    }
    if (numbered) {
      flushPara();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push([numbered[2]]);
      continue;
    }
    // continuation of the current list item (the doc wraps them with indentation)
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1].push(t); continue; }

    flushList();
    para.push(t);
  }
  flushAll();
  return out.join('\n');
}

const sections = raw.split(/^## /m);
const intro = sections[0];
const topics = sections.slice(1).map((sec, i) => {
  const lines = sec.split('\n');
  const title = lines[0].trim();
  const body = lines.slice(1);
  const dash = title.indexOf(' - ');
  const shortName = dash > -1 ? title.slice(0, dash) : title;
  const clause = dash > -1 ? title.slice(dash + 3) : '';
  const words = body.join(' ').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  return { n: i + 1, title, shortName, clause, words, html: renderBlocks(body), id: `t${i + 1}` };
});

const maxWords = Math.max(...topics.map((t) => t.words));
const totalWords = topics.reduce((a, t) => a + t.words, 0);

// The serving-contract bullets from the intro, so the rules governing the content sit with it.
const contract = intro
  .split('\n')
  .filter((l) => /^-\s/.test(l.trim()) || /^\s{2,}\S/.test(l))
  .join('\n');

const nav = topics
  .map(
    (t) => `      <li>
        <a href="#${t.id}" data-nav="${t.id}">
          <span class="nav-n">${String(t.n).padStart(2, '0')}</span>
          <span class="nav-name">${esc(t.shortName.toLowerCase())}</span>
          <span class="nav-bar" aria-hidden="true"><i style="inline-size:${Math.round((t.words / maxWords) * 100)}%"></i></span>
        </a>
      </li>`
  )
  .join('\n');

const body = topics
  .map(
    (t) => `    <section class="topic" id="${t.id}">
      <header class="topic-head">
        <p class="topic-meta"><span class="topic-n">${String(t.n).padStart(2, '0')}</span> <span class="topic-words">${t.words} words</span></p>
        <h2><span class="t-name">${esc(t.shortName)}</span>${t.clause ? `<span class="t-clause">${esc(t.clause)}</span>` : ''}</h2>
      </header>
      <div class="prose">
${t.html}
      </div>
    </section>`
  )
  .join('\n');

const html = `<title>The client playbook - full review copy</title>
<style>
  :root {
    --paper: #F6F7F9;
    --surface: #FFFFFF;
    --ink: #16202A;
    --muted: #5C6B7A;
    --hair: #DDE3E9;
    --accent: #0F6E7E;
    --accent-soft: #E4F0F2;
    --serif: Georgia, "Iowan Old Style", "Source Serif Pro", "Times New Roman", serif;
    --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    --measure: 65ch;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #10161C; --surface: #161E26; --ink: #E6ECF2; --muted: #93A3B2;
      --hair: #26313C; --accent: #4FB3C4; --accent-soft: #14313A;
    }
  }
  :root[data-theme="dark"] {
    --paper: #10161C; --surface: #161E26; --ink: #E6ECF2; --muted: #93A3B2;
    --hair: #26313C; --accent: #4FB3C4; --accent-soft: #14313A;
  }
  :root[data-theme="light"] {
    --paper: #F6F7F9; --surface: #FFFFFF; --ink: #16202A; --muted: #5C6B7A;
    --hair: #DDE3E9; --accent: #0F6E7E; --accent-soft: #E4F0F2;
  }

  body { background: var(--paper); color: var(--ink); font-family: var(--serif); line-height: 1.6; }
  a { color: var(--accent); }
  code { font-family: var(--mono); font-size: 0.88em; background: var(--accent-soft); padding: 0.1em 0.35em; border-radius: 3px; }

  .wrap { max-inline-size: 1180px; margin-inline: auto; padding: clamp(1.5rem, 4vw, 3.5rem) clamp(1rem, 3vw, 2rem) 6rem; }

  /* Masthead */
  .masthead { border-block-end: 2px solid var(--ink); padding-block-end: 1.25rem; margin-block-end: 2rem; }
  .eyebrow { font-family: var(--sans); font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-block-end: 0.6rem; }
  .masthead h1 { font-size: clamp(1.9rem, 4.5vw, 2.9rem); line-height: 1.1; text-wrap: balance; font-weight: 400; letter-spacing: -0.01em; }
  .standfirst { font-size: 1.05rem; color: var(--muted); max-inline-size: 60ch; margin-block-start: 0.7rem; }
  .facts { display: flex; flex-wrap: wrap; gap: 0.5rem 1.75rem; font-family: var(--sans); font-size: 0.8rem; color: var(--muted); margin-block-start: 1.25rem; font-variant-numeric: tabular-nums; }
  .facts b { color: var(--ink); font-weight: 600; }

  /* Contract note */
  .contract { background: var(--surface); border: 1px solid var(--hair); border-inline-start: 3px solid var(--accent); padding: 1.1rem 1.3rem; margin-block-end: 2.5rem; }
  .contract h2 { font-family: var(--sans); font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-block-end: 0.6rem; }
  .contract ul { padding-inline-start: 1.1rem; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.93rem; color: var(--muted); }

  .cols { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: clamp(1.5rem, 4vw, 3.5rem); align-items: start; }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }

  /* Index */
  .index { position: sticky; top: 1.5rem; font-family: var(--sans); }
  @media (max-width: 860px) { .index { position: static; } }
  .index h2 { font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-block-end: 0.8rem; }
  .index ol { list-style: none; display: flex; flex-direction: column; gap: 0.1rem; }
  .index a { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); gap: 0.1rem 0.5rem; text-decoration: none; color: var(--muted); padding: 0.32rem 0.4rem; border-radius: 4px; font-size: 0.82rem; line-height: 1.25; }
  .index a:hover { background: var(--accent-soft); color: var(--ink); }
  .index a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .index a[aria-current="true"] { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
  .nav-n { font-variant-numeric: tabular-nums; font-size: 0.72rem; color: var(--accent); padding-block-start: 0.1em; }
  .nav-bar { grid-column: 2; block-size: 2px; background: var(--hair); display: block; margin-block-start: 0.3rem; }
  .nav-bar i { display: block; block-size: 100%; background: var(--accent); opacity: 0.55; }

  /* Topics */
  .topic { padding-block: 2.5rem; border-block-start: 1px solid var(--hair); }
  .topic:first-of-type { border-block-start: 0; padding-block-start: 0; }
  .topic-meta { font-family: var(--sans); font-size: 0.72rem; letter-spacing: 0.06em; color: var(--muted); display: flex; gap: 0.9rem; margin-block-end: 0.5rem; font-variant-numeric: tabular-nums; }
  .topic-n { color: var(--accent); font-weight: 700; }
  .topic h2 { font-weight: 400; line-height: 1.15; text-wrap: balance; max-inline-size: 30ch; }
  .t-name { display: block; font-family: var(--sans); font-size: clamp(1.1rem, 2.2vw, 1.35rem); font-weight: 650; letter-spacing: -0.01em; }
  .t-clause { display: block; font-size: clamp(1.05rem, 2vw, 1.3rem); color: var(--muted); font-style: italic; margin-block-start: 0.15rem; }
  .prose { max-inline-size: var(--measure); margin-block-start: 1.2rem; display: flex; flex-direction: column; gap: 1rem; }
  .prose p { font-size: 1.02rem; }
  .prose ul, .prose ol { padding-inline-start: 1.35rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .prose li { padding-inline-start: 0.2rem; }
  .prose blockquote { border-inline-start: 3px solid var(--accent); padding: 0.2rem 0 0.2rem 1.1rem; color: var(--muted); font-style: italic; }
  .prose strong { font-weight: 700; }

  footer.foot { margin-block-start: 3.5rem; padding-block-start: 1.25rem; border-block-start: 1px solid var(--hair); font-family: var(--sans); font-size: 0.78rem; color: var(--muted); }

  @media print {
    .index, .contract { display: none; }
    .cols { grid-template-columns: 1fr; }
    .topic { break-inside: avoid-page; }
  }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Review copy - not client-facing in this form</p>
    <h1>The client playbook</h1>
    <p class="standfirst">Everything <code>wingguy_learn</code> can serve a client, in one place. Clients get one topic at a time; this is the whole thing, in journey order, for spotting what is thin or missing.</p>
    <div class="facts">
      <span><b>${topics.length}</b> topics</span>
      <span><b>${totalWords.toLocaleString('en-AU')}</b> words</span>
      <span>source <b>docs/client-playbook.md</b></span>
      ${COMMIT ? `<span>main @ <b>${esc(COMMIT)}</b></span>` : ''}
    </div>
  </header>

  <section class="contract">
    <h2>How Wingguy is told to serve this</h2>
    ${renderBlocks(contract.split('\n'))}
  </section>

  <div class="cols">
    <nav class="index" aria-label="Topics">
      <h2>In journey order</h2>
      <ol>
${nav}
      </ol>
    </nav>

    <main>
${body}
      <footer class="foot">
        Bars in the index are word count relative to the longest topic - a short bar is worth a second look, not necessarily a problem.
      </footer>
    </main>
  </div>
</div>

<script>
  (function () {
    var links = {};
    document.querySelectorAll('[data-nav]').forEach(function (a) { links[a.dataset.nav] = a; });
    var current = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        if (current) current.removeAttribute('aria-current');
        current = links[e.target.id];
        if (current) current.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    document.querySelectorAll('.topic').forEach(function (s) { obs.observe(s); });
  })();
</script>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT}: ${topics.length} topics, ${totalWords} words, ${html.length} bytes`);
