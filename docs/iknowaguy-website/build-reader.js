#!/usr/bin/env node
/**
 * build-reader.js - render the prospect drip run (18 emails, send order) into one
 * readable HTML page in the website's "Connector's Study" styling.
 *
 * Usage: node docs/iknowaguy-website/build-reader.js
 * Output: docs/iknowaguy-website/prospect-run-reader.html
 *
 * - Body text is taken verbatim from content/one-pagers/*.md (one source of truth).
 * - ENDING:CLIENT blocks are dropped; ENDING:PROSPECT blocks are kept and softly
 *   labelled so the per-audience seam is visible during review.
 * - Draft-note HTML comments are stripped.
 * - Verdict chips come from SERIES-WEBSITE-PASS.md (2026-07-18 website pass).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'content', 'one-pagers');
const OUT = path.join(__dirname, 'prospect-run-reader.html');

// Send order (post-2026-07-09 reorder) + website-pass verdicts.
const RUN = [
  { slug: 'feast-or-famine',              verdict: 'unchanged' },
  { slug: 'introduction-before-we-spoke', verdict: 'unchanged' },
  { slug: 'pleasing-methods',             verdict: 'light' },
  { slug: 'choose-the-room',              verdict: 'surgery', note: 'opening is verbatim the homepage "Start here" - add one echo-own line' },
  { slug: 'twenty-second-thank-you',      verdict: 'light' },
  { slug: 'never-send-calendly',          verdict: 'unchanged' },
  { slug: 'reason-to-follow-up',          verdict: 'unchanged' },
  { slug: 'first-discovery-call',         verdict: 'light' },
  { slug: 'connection-isnt-charm',        verdict: 'promote', note: 'now owns the homepage’s "not a natural networker" gateway' },
  { slug: 'revisit-your-big-picture',     verdict: 'unchanged' },
  { slug: 'patience-curve',               verdict: 'light' },
  { slug: 'why-not-buy-a-network',        verdict: 'light' },
  { slug: 'four-hours-not-forty',         verdict: 'surgery', note: 'most pre-told piece - opener must own the homepage’s two scenes' },
  { slug: 'you-could-build-this',         verdict: 'unchanged' },
  { slug: 'builders-not-blobs',           verdict: 'unchanged' },
  { slug: 'nodes',                        verdict: 'light' },
  { slug: 'i-know-a-guy-principle',       verdict: 'light' },
  { slug: 'imagine-if',                   verdict: 'surgery', note: 'homepage also closes on "Imagine if" - add one line owning the bookend' },
];

const VERDICT_LABEL = {
  unchanged: 'unchanged',
  light: 'light echo-own line',
  surgery: 'small surgery',
  promote: 'promoted',
};

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').trim();
    }
  }
  return { fm, body: m ? raw.slice(m[0].length) : raw };
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function mdBlocks(md) {
  // -> array of <p>/<h2> html strings. First H1 is skipped (title comes from frontmatter).
  const out = [];
  for (const block of md.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    if (/^# /.test(t)) continue; // in-file H1 duplicates the frontmatter title
    if (/^## /.test(t)) { out.push(`<h3>${inline(esc(t.replace(/^## /, '')))}</h3>`); continue; }
    out.push(`<p>${inline(esc(t.replace(/\n/g, ' ')))}</p>`);
  }
  return out.join('\n');
}

function renderPiece(slug, i, verdict, note) {
  const raw = fs.readFileSync(path.join(SRC, slug + '.md'), 'utf8');
  const { fm, body } = parseFrontmatter(raw);

  let b = body;
  // Drop client endings entirely.
  b = b.replace(/<!--\s*ENDING:CLIENT\s*-->[\s\S]*?<!--\s*\/ENDING:CLIENT\s*-->/g, '');
  // Keep prospect endings, marked for rendering.
  b = b.replace(/<!--\s*ENDING:PROSPECT\s*-->([\s\S]*?)<!--\s*\/ENDING:PROSPECT\s*-->/g,
    (_, inner) => `\n\n@@ENDING@@\n\n${inner.trim()}\n\n@@/ENDING@@\n\n`);
  // Strip all remaining comments (draft notes).
  b = b.replace(/<!--[\s\S]*?-->/g, '');

  // Render, then wrap the ending marker region.
  let html = mdBlocks(b);
  html = html
    .replace(/<p>@@ENDING@@<\/p>/, '<div class="ending"><p class="ending-label">prospect ending</p>')
    .replace(/<p>@@\/ENDING@@<\/p>/, '</div>');

  const chip = `<span class="chip chip-${verdict}">${VERDICT_LABEL[verdict]}</span>`;
  const noteHtml = note ? `<p class="verdict-note">${esc(note)}</p>` : '';
  return `
<article id="${slug}">
  <div class="wrap reading">
    <p class="eyebrow">Email ${i + 1} of ${RUN.length} &middot; piece #${fm.order} ${chip}</p>
    <h2>${esc(fm.title)}</h2>
    ${fm.dek ? `<p class="dek">${inline(esc(fm.dek))}</p>` : ''}
    ${noteHtml}
    ${html}
    <p class="backtop"><a href="#top">&uarr; back to the run</a></p>
  </div>
</article>`;
}

const toc = RUN.map((r, i) => {
  const raw = fs.readFileSync(path.join(SRC, r.slug + '.md'), 'utf8');
  const { fm } = parseFrontmatter(raw);
  return `<li><a class="toc-item" href="#${r.slug}"><span class="toc-n">${String(i + 1).padStart(2, '0')}</span><span class="toc-t">${esc(fm.title)}</span><span class="chip chip-${r.verdict}">${VERDICT_LABEL[r.verdict]}</span></a></li>`;
}).join('\n');

const pieces = RUN.map((r, i) => renderPiece(r.slug, i, r.verdict, r.note)).join('\n');

const page = `<title>The Prospect Run - I Know A Guy</title>
<style>
  :root {
    --paper:#F2EEE6; --surface:#FBF9F4; --ink:#22201C; --ink-soft:#4C473F;
    --ink-faint:#726B60; --line:#DBD3C5; --teal:#1E5E58; --teal-bright:#2C7C72;
    --marker:rgba(198,150,74,0.30); --ochre:#A5761F; --shadow:rgba(34,32,28,0.10);
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:"SF Mono",ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;
    --measure:34rem; --pad:clamp(1.25rem,5vw,2.5rem);
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper:#1A1917; --surface:#232120; --ink:#ECE6DA; --ink-soft:#B6AD9E;
      --ink-faint:#8A8073; --line:#35312B; --teal:#63B6AB; --teal-bright:#7FCABF;
      --marker:rgba(212,168,98,0.28); --ochre:#D4A862; --shadow:rgba(0,0,0,0.35); }
  }
  :root[data-theme="light"] { --paper:#F2EEE6; --surface:#FBF9F4; --ink:#22201C; --ink-soft:#4C473F;
    --ink-faint:#726B60; --line:#DBD3C5; --teal:#1E5E58; --teal-bright:#2C7C72;
    --marker:rgba(198,150,74,0.30); --ochre:#A5761F; --shadow:rgba(34,32,28,0.10); }
  :root[data-theme="dark"] { --paper:#1A1917; --surface:#232120; --ink:#ECE6DA; --ink-soft:#B6AD9E;
    --ink-faint:#8A8073; --line:#35312B; --teal:#63B6AB; --teal-bright:#7FCABF;
    --marker:rgba(212,168,98,0.28); --ochre:#D4A862; --shadow:rgba(0,0,0,0.35); }

  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans);
    font-size:1.0625rem; line-height:1.65; -webkit-font-smoothing:antialiased; }
  .wrap { width:100%; max-width:46rem; margin:0 auto; padding:0 var(--pad); }
  .reading { max-width:calc(var(--measure) + 2*var(--pad)); }
  nav { display:flex; align-items:baseline; justify-content:space-between; gap:1rem;
    padding:1.25rem var(--pad); max-width:46rem; margin:0 auto; }
  .wordmark { font-family:var(--serif); font-size:1.15rem; font-weight:600; color:var(--ink); text-decoration:none; }
  .wordmark .amp { color:var(--teal); }
  .navnote { font-size:0.85rem; color:var(--ink-faint); }
  .eyebrow { font-family:var(--mono); font-size:0.72rem; letter-spacing:0.16em; text-transform:uppercase;
    color:var(--teal); margin:0 0 0.9rem; font-weight:600; }
  header.top { padding:clamp(1.5rem,5vw,3rem) 0 clamp(1rem,3vw,1.5rem); }
  h1 { font-family:var(--serif); font-weight:600; font-size:clamp(2rem,6vw,2.8rem); line-height:1.08;
    letter-spacing:-0.015em; margin:0 0 1rem; text-wrap:balance; }
  .lede { font-size:1.1rem; color:var(--ink-soft); max-width:var(--measure); margin:0; }
  .toc { list-style:none; margin:1.5rem 0 0; padding:0; }
  .toc-item { display:flex; align-items:baseline; gap:0.9rem; padding:0.55rem 0.4rem; border-radius:8px;
    text-decoration:none; color:inherit; }
  .toc-item:hover { background:var(--surface); }
  .toc-item:focus-visible { outline:2px solid var(--teal); outline-offset:2px; }
  .toc-n { font-family:var(--mono); font-size:0.8rem; color:var(--ink-faint); font-variant-numeric:tabular-nums; }
  .toc-t { font-family:var(--serif); font-size:1.05rem; font-weight:600; flex:1 1 auto; }
  .toc-item:hover .toc-t { color:var(--teal); }
  .chip { font-family:var(--mono); font-size:0.62rem; letter-spacing:0.1em; text-transform:uppercase;
    border-radius:999px; padding:0.18rem 0.55rem; white-space:nowrap; border:1px solid var(--line); color:var(--ink-faint); }
  .chip-light { border-color:color-mix(in srgb, var(--ochre) 55%, var(--line)); color:var(--ochre); }
  .chip-surgery { border-color:var(--teal); color:var(--teal); font-weight:700; }
  .chip-promote { background:color-mix(in srgb, var(--teal) 12%, transparent); border-color:var(--teal); color:var(--teal); font-weight:700; }
  article { padding:clamp(2.25rem,6vw,3.5rem) 0; border-top:1px solid var(--line); }
  article h2 { font-family:var(--serif); font-weight:600; font-size:clamp(1.6rem,4.2vw,2.2rem);
    line-height:1.12; letter-spacing:-0.01em; margin:0 0 0.6rem; text-wrap:balance; }
  article h3 { font-family:var(--serif); font-weight:600; font-size:1.25rem; margin:1.8rem 0 0.6rem; }
  .dek { font-family:var(--serif); font-style:italic; font-size:1.1rem; color:var(--ink-faint); margin:0 0 1.6rem; }
  .verdict-note { font-size:0.85rem; color:var(--ochre); margin:-0.9rem 0 1.6rem; }
  article p { margin:0 0 1.15rem; max-width:var(--measure); }
  .ending { border-left:3px solid var(--teal); padding:0.2rem 0 0.2rem 1.1rem; margin:1.6rem 0; }
  .ending-label { font-family:var(--mono); font-size:0.62rem; letter-spacing:0.14em; text-transform:uppercase;
    color:var(--teal); margin:0 0 0.6rem; }
  .backtop { margin-top:2rem; }
  .backtop a { font-size:0.85rem; color:var(--teal); text-decoration:none; }
  .backtop a:hover { text-decoration:underline; }
  footer { border-top:1px solid var(--line); padding:2rem var(--pad) 3rem; }
  .foot-inner { max-width:46rem; margin:0 auto; display:flex; flex-wrap:wrap; gap:0.4rem 1rem;
    justify-content:space-between; color:var(--ink-faint); font-size:0.85rem; }
  .foot-inner .fw { font-family:var(--serif); color:var(--ink-soft); }
  html { scroll-behavior:smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } }
</style>

<nav>
  <a class="wordmark" href="#top">I Know&nbsp;a&nbsp;<span class="amp">Guy</span></a>
  <span class="navnote">internal review copy</span>
</nav>

<header class="top" id="top">
  <div class="wrap">
    <p class="eyebrow">The prospect run &middot; ${RUN.length} emails, send order</p>
    <h1>The whole drip, as the reader will meet it.</h1>
    <p class="lede">Rendered straight from the one-pager files - shared body plus the prospect ending, client endings and draft notes stripped. Chips carry each piece's verdict from the website pass (2026-07-18).</p>
    <ol class="toc">
${toc}
    </ol>
  </div>
</header>

${pieces}

<footer>
  <div class="foot-inner">
    <span class="fw">I Know a Guy</span>
    <span>generated from content/one-pagers - do not edit this file</span>
  </div>
</footer>
`;

fs.writeFileSync(OUT, page, 'utf8');
console.log('Wrote', OUT, '-', RUN.length, 'pieces');
