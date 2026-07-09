// services/onePagerContent.js
//
// Reads the one-pager series markdown (content/one-pagers/*.md), parses the
// YAML-ish frontmatter, strips the off-audience <!-- ENDING:X --> block, and
// renders the body to HTML.
//
// The markdown -> HTML step uses the remark/unified chain that is already a
// dependency of this repo. Those packages are ESM-only, so we load them with
// dynamic import() (works cleanly in CommonJS on Node 20+/24). remark-html was
// added for the HTML stringify step.
//
// Frontmatter `order` is the ARC position (gaps of 10), NOT the send order.
// The send order lives in the manifest (see content one-pager plan) and is the
// drip engine's concern, not this module's.

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content', 'one-pagers');

// Files in the content dir that are planning docs, not series pieces.
const NON_PIECE_FILES = new Set(['SERIES-ARC.md', 'PROSPECT-SERIES-PLAN.md']);

// ---- markdown -> HTML processor (lazy, cached) ----
let _processorPromise = null;
async function getProcessor() {
  if (_processorPromise) return _processorPromise;
  _processorPromise = (async () => {
    const { unified } = await import('unified');
    const remarkParse = (await import('remark-parse')).default;
    const remarkGfm = (await import('remark-gfm')).default;
    const remarkSmartypants = (await import('remark-smartypants')).default;
    const remarkHtml = (await import('remark-html')).default;
    // smartypants gives curly quotes/apostrophes. It only turns literal "--"
    // into an em dash, and the content deliberately uses spaced hyphens, so
    // Guy's "never an em dash" rule is preserved.
    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkSmartypants)
      .use(remarkHtml, { sanitize: false });
  })();
  return _processorPromise;
}

async function markdownToHtml(md) {
  const processor = await getProcessor();
  const file = await processor.process(md);
  return String(file);
}

// ---- frontmatter ----
// The frontmatter is a simple key: value block; values may be double-quoted.
// We only need a handful of scalar fields, so a full YAML parser is overkill.
function parseFrontmatter(raw) {
  const meta = {};
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) continue;
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[kv[1]] = val;
    }
  }
  return { meta, body };
}

// ---- ending blocks ----
// Pieces that split by audience wrap each close in
//   <!-- ENDING:CLIENT --> ... <!-- /ENDING:CLIENT -->
//   <!-- ENDING:PROSPECT --> ... <!-- /ENDING:PROSPECT -->
// For a given audience we drop the other block and unwrap the kept one.
// Pieces with no blocks are shared and pass through untouched.
function selectEnding(body, audience) {
  const keep = audience === 'client' ? 'CLIENT' : 'PROSPECT';
  const drop = keep === 'CLIENT' ? 'PROSPECT' : 'CLIENT';
  let out = body;
  // remove the off-audience block, markers and all
  out = out.replace(new RegExp(`<!--\\s*ENDING:${drop}\\s*-->[\\s\\S]*?<!--\\s*/ENDING:${drop}\\s*-->`, 'g'), '');
  // unwrap the kept block (strip just its markers)
  out = out.replace(new RegExp(`<!--\\s*/?ENDING:${keep}\\s*-->`, 'g'), '');
  return out;
}

// Strip the leading `# Title` (rendered separately in the shell) and any
// remaining HTML comments (editorial/approval notes at the foot of each file).
function stripHtmlComments(body) {
  return body.replace(/<!--[\s\S]*?-->/g, '');
}
function stripLeadingH1(body) {
  return body.replace(/^\s*#\s+.+\r?\n/, '');
}

// ---- public API ----

// List every series piece with its frontmatter (fast; no HTML render).
function listPieces() {
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md') && !NON_PIECE_FILES.has(f));
  const pieces = files.map(f => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
    const { meta } = parseFrontmatter(raw);
    return {
      slug: meta.slug || f.replace(/\.md$/, ''),
      title: meta.title || meta.slug || f,
      dek: meta.dek || '',
      order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 9999,
      status: meta.status || '',
      audience: meta.audience || '',
    };
  });
  pieces.sort((a, b) => a.order - b.order);
  return pieces;
}

// Titles are matched after smartypants has curled quotes/apostrophes in the
// rendered body, so normalise curly punctuation to straight on both sides.
function normTitle(s) {
  return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
}

// A normalised-title -> slug lookup, used to linkify the map's "→ Title" pointers.
function titleSlugMap() {
  const map = new Map();
  for (const p of listPieces()) map.set(normTitle(p.title), p.slug);
  return map;
}

// Turn the map's arrow lines ("→ <em>Choose, Don't Collect</em>") into real
// links to the matching piece. Titles in the arrows are the frontmatter titles.
function linkifyStepPointers(html) {
  const map = titleSlugMap();
  return html.replace(/→\s*<em>([^<]+)<\/em>/g, (full, title) => {
    const slug = map.get(normTitle(title));
    if (!slug) return full;
    return `<a class="op-step" href="/series/${slug}">${title}</a>`;
  });
}

// Slugs are lowercase-hyphen only; sanitise to keep the value safe for path.join
// (belt-and-braces — routes sanitise too).
function safeSlug(slug) {
  return String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function pieceExists(slug) {
  const s = safeSlug(slug);
  return !!s && fs.existsSync(path.join(CONTENT_DIR, `${s}.md`));
}

// Render one piece to HTML for a given audience.
// Returns { slug, title, dek, order, status, audience, bodyHtml }.
async function renderPiece(slug, { audience = 'prospect' } = {}) {
  const s = safeSlug(slug);
  if (!s) return null;
  const file = path.join(CONTENT_DIR, `${s}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  let md = selectEnding(body, audience);
  md = stripHtmlComments(md);
  md = stripLeadingH1(md);
  md = md.trim();

  let bodyHtml = await markdownToHtml(md);
  bodyHtml = linkifyStepPointers(bodyHtml);

  return {
    slug: meta.slug || slug,
    title: meta.title || slug,
    dek: meta.dek || '',
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 9999,
    status: meta.status || '',
    audience: meta.audience || '',
    bodyHtml,
  };
}

module.exports = { listPieces, renderPiece, pieceExists, markdownToHtml, CONTENT_DIR };
