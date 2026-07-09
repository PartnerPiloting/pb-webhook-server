// services/onePagerShell.js
//
// The shared "Mindset Mastery" editorial HTML shell for the one-pager series:
// dark masthead, "(I know a) Guy" wordmark, warm-paper serif body, quiet footer.
// Used by the link-only web pages now; the same shell renders the drip emails
// in a later phase (the email variant reuses articleCard with a greeting + an
// unsubscribe footer instead of the library footer).
//
// Colours are intentionally fixed (not theme-aware): this is a branded reading
// surface / email, meant to look the same everywhere, like Guy's existing
// weekly edition.

const WORDMARK = '(I know a) Guy';
const SERIES_NAME = 'Network building, rethought';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function css() {
  return `
  :root { color-scheme: light; }
  body { margin:0; background:#e9e2d3; color:#2c2823;
    font-family:Georgia,'Iowan Old Style','Palatino Linotype','Times New Roman',serif;
    -webkit-font-smoothing:antialiased; }
  .op-page { padding:28px 16px 52px; }
  .op { max-width:640px; margin:0 auto 22px; background:#fbf9f3; border-radius:6px;
    overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.10); }
  .op-mast { background:#211d18; padding:34px 40px 30px; }
  .op-eb { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#c49a5e; margin:0 0 12px; }
  .op-wm { font-size:30px; margin:0; font-weight:400; }
  .op-wm a { color:#f3ede1; text-decoration:none; }
  .op-c { padding:34px 40px 8px; }
  .op-greet { font-size:17px; margin:0 0 1.15rem; }
  .op-intro { margin:0 0 1.7rem; }
  .op-t { font-size:28px; line-height:1.25; margin:0 0 12px; color:#221f1a; font-weight:400; }
  .op-dek { font-style:italic; color:#6f6558; font-size:18px; line-height:1.5; margin:0 0 20px; }
  .op-r { border:0; border-top:1px solid #e2dccd; margin:0 0 22px; }
  .op-body p { font-size:17px; line-height:1.66; margin:0 0 1.15rem; }
  .op-body h2 { font-size:21px; line-height:1.3; margin:1.9rem 0 .4rem; color:#221f1a; font-weight:400; }
  .op-body h3 { font-size:18px; line-height:1.3; margin:1.7rem 0 .3rem; color:#221f1a; font-weight:400; }
  .op-body strong { font-weight:700; }
  .op-body em { font-style:italic; }
  .op-body a { color:#9a6a2f; }
  .op-body blockquote { margin:1.6rem 0; padding:2px 0 2px 20px; border-left:3px solid #c49a5e;
    color:#4a423a; font-style:italic; }
  .op-step { display:inline-block; margin-top:2px; color:#9a6a2f; text-decoration:none;
    border-bottom:1px solid rgba(154,106,47,.35); }
  .op-foot { padding:18px 40px 6px; border-top:1px solid #e2dccd; margin-top:1.4rem;
    font-size:14px; line-height:1.6; color:#6f6558; }
  .op-foot a { color:#9a6a2f; }
  .op-reply { font-style:italic; margin:0 0 .9rem; }
  .op-sign { margin:0; }
  .op-unsub { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#9a9184; margin-top:20px; }
  .op-unsub a { color:#9a9184; }
  .op-bar { background:#211d18; height:34px; }
  .op-cat h2 { font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:#96703f;
    margin:0 0 18px; font-weight:400; }
  .op-cat ol { list-style:none; margin:0; padding:0; }
  .op-cat li { padding:0 0 16px; margin:0 0 16px; border-bottom:1px solid #efe9dc; }
  .op-cat li:last-child { border-bottom:0; margin-bottom:0; }
  .op-cat a.title { font-size:19px; color:#221f1a; text-decoration:none; }
  .op-cat a.title:hover { color:#9a6a2f; }
  .op-cat .dek { font-style:italic; color:#6f6558; font-size:15px; line-height:1.5; margin:4px 0 0; }
  @media (max-width:520px) {
    .op-mast,.op-c,.op-foot,.op-cat .op-c { padding-left:22px; padding-right:22px; }
    .op-t { font-size:24px; }
    .op-wm { font-size:26px; }
  }`;
}

// The masthead is shared by every card.
function masthead(eyebrow) {
  return `<div class="op-mast">
    <p class="op-eb">${esc(eyebrow || SERIES_NAME)}</p>
    <p class="op-wm"><a href="/series">${esc(WORDMARK)}</a></p>
  </div>`;
}

// One article/email card. `footerHtml` is the caller's choice (library footer
// for web pages, reply+unsubscribe for emails). `greeting` and `introHtml` are
// email-only (introHtml = an optional lead-in above the title, e.g. the client
// edition-1 welcome).
function articleCard({ eyebrow, title, dek, greeting, introHtml, bodyHtml, footerHtml } = {}) {
  return `<div class="op">
    ${masthead(eyebrow)}
    <div class="op-c">
      ${greeting ? `<p class="op-greet">${esc(greeting)}</p>` : ''}
      ${introHtml ? `<div class="op-body op-intro">${introHtml}</div>` : ''}
      ${title ? `<h1 class="op-t">${esc(title)}</h1>` : ''}
      ${title && dek ? `<p class="op-dek">${esc(dek)}</p>` : ''}
      ${title ? '<hr class="op-r">' : ''}
      <div class="op-body">${bodyHtml || ''}</div>
      ${footerHtml || ''}
    </div>
    <div class="op-bar"></div>
  </div>`;
}

// The standing footer for the public library pages (no unsubscribe here — that
// is an email concern). Points back to the map, per the "never two clicks from
// orientation" rule.
function libraryFooter() {
  return `<div class="op-foot">
    New here, or want to see where it's all heading? It's all on one page -
    <a href="/series">start at the map</a>.
  </div>`;
}

// The catalogue card that lists every piece, ordered by arc position.
function catalogueCard(pieces) {
  const items = pieces.map(p => `<li>
      <a class="title" href="/series/${esc(p.slug)}">${esc(p.title)}</a>
      ${p.dek ? `<p class="dek">${esc(p.dek)}</p>` : ''}
    </li>`).join('\n');
  return `<div class="op op-cat">
    ${masthead(SERIES_NAME)}
    <div class="op-c">
      <h2>The full library</h2>
      <ol>${items}</ol>
    </div>
    <div class="op-bar"></div>
  </div>`;
}

function fullPage({ title, inner }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} - ${esc(SERIES_NAME)}</title>
<style>${css()}</style>
</head>
<body>
<div class="op-page">
${inner}
</div>
</body>
</html>`;
}

module.exports = { fullPage, articleCard, libraryFooter, catalogueCard, masthead, css, WORDMARK, SERIES_NAME };
