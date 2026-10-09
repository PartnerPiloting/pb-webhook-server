/**
 * Tests for "a message carries the real href of every link in it" (wingguy-extension/content-wingguy.js
 * 0.3.32, Guy 2026-10-10). LinkedIn shows a lead's booking link as mangled text - the next line glued
 * straight onto it ("…/consultationLook forward"), the https:// dropped - and renders the anchor as its
 * own redirect (linkedin.com/redir/redirect?url=<encoded>). The scanner on the server read the text and
 * missed a TidyCal link four times on 9 Oct 2026. Now each scraped message also carries `links`, the
 * unwrapped hrefs, and the server checks those first. The unwrapping is realHref, a pure helper inside
 * the content script. The content script is one big IIFE that needs a LinkedIn DOM, so this test lifts
 * the helper's source text out of the REAL file (between its marker comments) and runs that - what is
 * tested is the code that ships, not a copy.
 * Contracts:
 *   1. A plain https address comes back as it is (trimmed).
 *   2. LinkedIn's redirect wrapper (redir/redirect?url=...) is unwrapped to the real address, query intact.
 *   3. The safety/go wrapper is unwrapped too; a wrapper inside a wrapper is unwrapped again.
 *   4. A wrapper with no url parameter, or a url that is not http(s), is returned as the wrapper itself.
 *   5. Not a link: mailto:, javascript:, '#', a relative path, blank, null -> ''.
 *   6. A LinkedIn address that is not a wrapper (a profile, a post) is left alone, as is an lnkd.in short link.
 *   7. The helper really is in the shipping file and both thread scrapers attach links (withLinks).
 * Run: node tests/wingguy-extension-message-links.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js');
const src = fs.readFileSync(FILE, 'utf8');
const START = '// ---- realHref (pure;';
const END = '// ---- end realHref ----';
const a = src.indexOf(START);
const b = src.indexOf(END);
assert.ok(a > 0 && b > a, 'realHref marker block not found in content-wingguy.js');
const block = src.slice(a, b);
const realHref = new Function(block + '\nreturn realHref;')();
assert.strictEqual(typeof realHref, 'function');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const TIDY = 'https://tidycal.com/thepowertoask/consultation';
const wrap = (inner, extra = '') => `https://www.linkedin.com/redir/redirect?url=${encodeURIComponent(inner)}${extra}`;

check('1. a plain https address comes back as it is, trimmed', () => {
  assert.strictEqual(realHref(TIDY), TIDY);
  assert.strictEqual(realHref(`  ${TIDY}\n`), TIDY);
  assert.strictEqual(realHref('http://calendly.com/candacengok/intro'), 'http://calendly.com/candacengok/intro');
});

check('2. the redirect wrapper is unwrapped, with urlhash and trk dropped and the inner query kept', () => {
  assert.strictEqual(realHref(wrap(TIDY, '&urlhash=Ab12&trk=messaging')), TIDY);
  assert.strictEqual(realHref(wrap(`${TIDY}?month=2026-10`, '&urlhash=Ab12')), `${TIDY}?month=2026-10`);
  assert.strictEqual(realHref(`https://linkedin.com/redir/redirect?url=${encodeURIComponent('https://calendar.app.google/Rt3HARJvfXUBpviz7')}`), 'https://calendar.app.google/Rt3HARJvfXUBpviz7');
});

check('3. safety/go is unwrapped; a wrapper inside a wrapper is unwrapped again', () => {
  assert.strictEqual(realHref(`https://www.linkedin.com/safety/go?url=${encodeURIComponent(TIDY)}&trk=flagship-messaging-web`), TIDY);
  assert.strictEqual(realHref(wrap(wrap(TIDY))), TIDY);
});

check('4. a wrapper with no usable url parameter is returned as itself', () => {
  const bare = 'https://www.linkedin.com/redir/redirect?urlhash=Ab12';
  assert.strictEqual(realHref(bare), bare);
  const junk = 'https://www.linkedin.com/redir/redirect?url=javascript%3Aalert(1)';
  assert.strictEqual(realHref(junk), junk);
});

check('5. not a link -> empty string', () => {
  for (const v of ['mailto:sam@example.com', 'javascript:void(0)', '#', '/in/sam-trattles', '', '   ', null, undefined, 'tidycal.com/thepowertoask/consultation']) {
    assert.strictEqual(realHref(v), '', JSON.stringify(v));
  }
});

check('6. a LinkedIn profile or post, and an lnkd.in short link, are left alone', () => {
  for (const v of ['https://www.linkedin.com/in/sam-trattles/', 'https://www.linkedin.com/posts/sam_abc-123', 'https://lnkd.in/gAbC123']) {
    assert.strictEqual(realHref(v), v);
  }
});

check('7. the helper ships, and both thread scrapers attach links through withLinks', () => {
  assert.ok(/function realHref\(/.test(src));
  assert.ok(/function messageLinks\(/.test(src) && /function withLinks\(/.test(src));
  const newUi = src.slice(src.indexOf('function scrapeNewUiThread('), src.indexOf('function currentThreadContainer('));
  const oldUi = src.slice(src.indexOf('function scrapeOpenThread('), src.indexOf('function threadQuietDays('));
  assert.ok(/withLinks\(/.test(newUi), 'scrapeNewUiThread must attach links');
  assert.ok(/withLinks\(/.test(oldUi), 'scrapeOpenThread must attach links');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wingguy-extension', 'manifest.json'), 'utf8'));
  assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'manifest version must be a dotted triple');
});

console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all extension message-links tests passed');
process.exit(failures ? 1 : 0);
