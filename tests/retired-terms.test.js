/**
 * Retired terms - does any doc still describe a way of doing things that has been retired?
 *
 * The Linked Helper machine method changed on 10 Sep 2026 and the docs describing the old way sat
 * there looking current: a Claude memory page served it to Guy on 19 Sep, and the machine-setup
 * doc on main still opened with netplwiz and powercfg. Nothing connected "the method changed" to
 * "every doc that describes the old one". This does. content/retired-terms.json lists the old
 * method's distinctive words; this test names every doc that still uses them where a reader would
 * take them as current.
 *
 *   1. client-facing docs: a retired term anywhere fails - a client cannot tell old from current;
 *   2. operating docs: a retired term is allowed only under a heading marked RETIRED/SUPERSEDED, in
 *      a paragraph that calls itself retired/superseded/history, or in a script whose first ten
 *      lines say RETIRED - anywhere else fails, with the file and line;
 *   3. method docs: each carries a "Method status:" line near the top saying what is current since
 *      when and what it supersedes - so the next change has somewhere to be recorded.
 *
 * Run: node tests/retired-terms.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'retired-terms.json'), 'utf8'));

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const TEXT_EXT = new Set(['.md', '.html', '.json', '.txt', '.sh', '.py', '.ps1', '.js']);
function expand(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs)
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.posix.join(rel.replace(/\\/g, '/'), f));
}

function termRegex(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole-word for plain words; a term with punctuation (Update.exe) is matched literally.
  return /^[a-z0-9 ]+$/i.test(term) ? new RegExp(`\\b${esc}\\b`, 'i') : new RegExp(esc, 'i');
}
const TERMS = REG.retired.map((r) => ({ ...r, re: termRegex(r.term) }));
const MARKER = /retired|superseded|history/i;

/** Every line that carries a retired term, with whether the doc excuses it there. */
function scan(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const isScript = /\.(sh|py|ps1|js)$/.test(rel);
  const scriptRetired = isScript && lines.slice(0, 10).some((l) => /RETIRED/.test(l));
  // Heading chain (markdown only): a section is retired when any heading above it says so.
  const chain = [];
  let sectionRetired = false;
  // Paragraph markers: a paragraph (blank-line separated) that calls itself retired/superseded/history.
  const paraStarts = [];
  let p = 0;
  for (let i = 0; i < lines.length; i++) { if (i === 0 || lines[i - 1].trim() === '') p = i; paraStarts[i] = p; }
  const paraMarked = new Map();
  const paraText = (i) => {
    const s = paraStarts[i];
    if (!paraMarked.has(s)) {
      let e = s; while (e < lines.length && lines[e].trim() !== '') e++;
      paraMarked.set(s, MARKER.test(lines.slice(s, e).join(' ')));
    }
    return paraMarked.get(s);
  };
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = !isScript && line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      while (chain.length && chain[chain.length - 1].level >= level) chain.pop();
      chain.push({ level, retired: /RETIRED|SUPERSEDED/.test(h[2]) });
      sectionRetired = chain.some((c) => c.retired);
    }
    for (const t of TERMS) {
      if (!t.re.test(line)) continue;
      const excused = scriptRetired || sectionRetired || paraText(i);
      hits.push({ line: i + 1, term: t.term, excused, text: line.trim().slice(0, 110) });
    }
  }
  return hits;
}

console.log(`\nretired terms - ${TERMS.length} term(s) from retired methods\n`);

check('registry is well-formed', () => {
  for (const r of REG.retired) {
    assert.ok(r.term && r.retired && r.was && r.now, `entry needs term/retired/was/now: ${JSON.stringify(r)}`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.retired), `${r.term}: retired must be a date`);
  }
  assert.ok(Array.isArray(REG.client_facing) && REG.client_facing.length, 'client_facing list');
  assert.ok(Array.isArray(REG.operating) && REG.operating.length, 'operating list');
});

console.log('\n1. client-facing docs carry no retired term at all');
for (const rel of REG.client_facing.flatMap(expand)) {
  check(rel, () => {
    const hits = scan(rel);
    assert.ok(!hits.length, hits.map((h) => `line ${h.line}: "${h.term}" - ${h.text}`).join('\n    '));
  });
}

console.log('\n2. operating docs use a retired term only where they say it is retired');
for (const rel of REG.operating.flatMap(expand)) {
  check(rel, () => {
    const bad = scan(rel).filter((h) => !h.excused);
    assert.ok(!bad.length, `describes the old way as if current:\n    ${bad.map((h) => `line ${h.line}: "${h.term}" - ${h.text}`).join('\n    ')}\n    (move it under a RETIRED/SUPERSEDED heading, or say so in the paragraph)`);
  });
}

console.log('\n3. every method doc says what is current, since when, and what it supersedes');
for (const rel of REG.method_docs) {
  check(rel, () => {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} does not exist`);
    const top = fs.readFileSync(abs, 'utf8').split(/\r?\n/).slice(0, 15).join('\n');
    assert.ok(/Method status:/.test(top), 'no "Method status:" line in the first 15 lines');
    assert.ok(/CURRENT since \d{1,2} \w+ \d{4}/.test(top), 'the status line must say "CURRENT since <date>"');
    assert.ok(/[Ss]upersedes/.test(top), 'the status line must say what it supersedes');
  });
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
