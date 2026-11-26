/**
 * Wingguy Learning guides - knowaguy.com.au/learn/<slug> (Guy, 26 Nov 2026). utils/learnGuides.js.
 *
 *   node tests/learn-guides.test.js
 *
 * The point of a guide is ONE copy of the words: the page is built from docs/client-playbook.md. So
 * this fails when a guide names a topic the playbook no longer has, a picture file that is missing, or
 * a sub-heading a picture hangs off that has been reworded away.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const g = require('../utils/learnGuides');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.log(`  ✗ ${name}\n    ${e.message}`); } };

const guides = g.loadGuides();
const topics = g.loadTopics();
const strip = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');

console.log('learn guides');
check('there is at least one guide, and slugs are unique and web-safe', () => {
  assert.ok(guides.length >= 1);
  const slugs = guides.map((x) => x.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length);
  slugs.forEach((s) => assert.ok(/^[a-z0-9-]+$/.test(s), s));
});

for (const guide of guides) {
  check(`${guide.slug}: every topic it names is in Wingguy Learning`, () => {
    for (const t of guide.topics) assert.ok(topics.some((x) => x.title.toUpperCase().startsWith(t.title.toUpperCase())), `no topic starts "${t.title}"`);
  });
  check(`${guide.slug}: every picture file exists and hangs off a sub-heading that is still there`, () => {
    for (const t of guide.topics) {
      const topic = topics.find((x) => x.title.toUpperCase().startsWith(t.title.toUpperCase()));
      const ids = g.partsOf(topic.text).map((p) => p.id);
      for (const f of t.figures || []) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'content', 'learn', 'figures', `${f.name}.html`)), `missing picture ${f.name}`);
        assert.ok(ids.includes(g.slugOf(f.after)), `"${t.title}" has no part called "${f.after}" any more - the picture ${f.name} would vanish`);
      }
    }
  });
  check(`${guide.slug}: the page carries the playbook's own words, every picture, and no stray markdown`, () => {
    const html = g.renderGuide(guide.slug);
    const text = strip(html);
    const pictures = guide.topics.reduce((n, t) => n + (t.figures || []).length, 0);
    assert.strictEqual((html.match(/<figure class="fig">/g) || []).length, pictures);
    assert.ok(!/\*/.test(text), 'an asterisk is showing - some markdown was not turned into HTML');
    assert.ok(!/[–—]/.test(text), 'an em or en dash is on the page');
    // a sentence taken from the playbook itself must be on the page word for word
    const first = topics.find((x) => x.title.toUpperCase().startsWith(guide.topics[0].title.toUpperCase()));
    const sentence = first.text.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, ' ').trim()).find((b) => b && !/[*"'&<>]/.test(b) && b.length > 20);
    assert.ok(text.includes(sentence), `the page does not carry "${sentence}"`);
  });
  check(`${guide.slug}: its made-up people are made up (no real address or phone in a picture)`, () => {
    for (const t of guide.topics) {
      for (const f of t.figures || []) {
        const pic = fs.readFileSync(path.join(__dirname, '..', 'content', 'learn', 'figures', `${f.name}.html`), 'utf8');
        (pic.match(/[\w.+-]+@[\w.-]+/g) || []).forEach((addr) => assert.ok(/\.example$/.test(addr), `${f.name}: ${addr} is not an .example address`));
        (pic.match(/\b0[2-478]\d{2} ?\d{3} ?\d{3}\b/g) || []).forEach((ph) => assert.ok(/^0400 555 /.test(ph), `${f.name}: ${ph} is not a made-up number`));
      }
    }
  });
}

check('a topic in a guide gets a link to its place on the page; any other topic gets none', () => {
  const t = guides[0].topics[0];
  const full = topics.find((x) => x.title.toUpperCase().startsWith(t.title.toUpperCase())).title;
  const link = g.topicLink(full);
  assert.ok(new RegExp(`/learn/${guides[0].slug}#[a-z0-9-]+$`).test(link), link);
  assert.ok(g.renderGuide(guides[0].slug).includes(`id="${link.split('#')[1]}"`), 'the link points at a place that is on the page');
  assert.strictEqual(g.topicLink('YOUR PACE - CHOOSING IT AND HOLDING IT'), '');
  assert.strictEqual(g.topicLink(''), '');
});

check('no such guide = null (the route answers 404)', () => {
  assert.strictEqual(g.renderGuide('nope'), null);
  assert.strictEqual(g.guideMeta('nope'), null);
});

check('the words: bold, italic, a sentence to say, and HTML made safe', () => {
  assert.strictEqual(g.inline('press **Import** now'), 'press <strong>Import</strong> now');
  assert.ok(g.inline('say *"open my portal"* please').includes('data-say="open my portal"'));
  assert.strictEqual(g.inline('a <b> & c'), 'a &lt;b&gt; &amp; c');
  const parts = g.partsOf('Opening line.\n\n**Finding someone.** Type a name.\n\n- one\n- two\n  more\n\n**Just a heading**\n\nAfter.');
  assert.deepStrictEqual(parts.map((p) => p.label), ['', 'Finding someone', 'Just a heading']);
  assert.ok(parts[1].html.join('').includes('<li>two more</li>'));
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
