/**
 * Tests for "a line break in a LinkedIn message never fuses two lines into one word"
 * (wingguy-extension/content-wingguy.js 0.3.36, Craig Carolan 2026-10-19).
 *
 * Craig replied on three lines - "Can do" / "My email is" / "Craig.carolan@infocus.com.au". LinkedIn
 * renders each line as its own <p>; textContent glued them into "Can doMy email isCraig.carolan@...",
 * the address finder took "iscraig.carolan@infocus.com.au" (a valid-looking address that does not
 * exist), it was saved as his primary email and the calendar invite bounced. The fix is blockText - a
 * DOM walk that puts a break back at every <br> and around every block element - used by the thread
 * scrape instead of textContent. The content script is one big IIFE that needs a LinkedIn DOM, so
 * this test lifts the helpers' source text out of the REAL file (between marker comments) and runs
 * that - what is tested is the code that ships, not a copy.
 *
 * Contracts:
 *   1. Lines in separate <p> elements come out separated (the Craig shape).
 *   2. <br> breaks separate too, and a <br> run does not swallow text.
 *   3. Inline elements (a, span, strong) do NOT add breaks - "go to <a>site</a> now" stays one phrase.
 *   4. The full chain scrape-text -> cleanText -> extractProfferedContact yields Craig's clean address
 *      with the lead's name, and NOT the "is"-prefixed one.
 *   5. A real one-line message is unchanged by the walk (no spurious spaces inside words).
 *   6. The address glued to the NEXT sentence (the Ayaan shape) is still trimmed.
 *   7. Junk input (null, element with no children, a text node) is harmless.
 *   8. The helpers really are in the shipping file and the scrape really calls blockText.
 *
 * Run: node tests/wingguy-extension-message-linebreaks.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'wingguy-extension', 'content-wingguy.js');
const src = fs.readFileSync(FILE, 'utf8');

function lift(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker);
  assert.ok(a > 0 && b > a, `${startMarker} block not found in content-wingguy.js`);
  return src.slice(a, b);
}
const blockBlock = lift('// ---- blockText (pure;', '// ---- end blockText ----');
const profferBlock = lift('// ---- profferedContact (pure;', '// ---- end profferedContact ----');

const blockText = new Function(blockBlock + '\nreturn blockText;')();
const cleanText = (t) => (t || '').replace(/\s+/g, ' ').trim(); // verbatim copy of the shipping cleanText
const { trimRunOnEmail, extractProfferedContact } = new Function(profferBlock + '\nreturn { trimRunOnEmail, extractProfferedContact };')();

// ── A tiny fake DOM: just what blockText reads (nodeType, tagName, childNodes, nodeValue) ─────────
const text = (s) => ({ nodeType: 3, nodeValue: s });
const el = (tag, ...kids) => ({ nodeType: 1, tagName: tag.toUpperCase(), childNodes: kids });

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

// Craig's bubble as LinkedIn renders it: one <p> per line, no whitespace between them.
const craigBubble = el('div',
  el('p', text('Can do')),
  el('p', text('My email is')),
  el('p', text('Craig.carolan@infocus.com.au')),
);

check('1. lines in separate <p> elements stay separate words', () => {
  const out = cleanText(blockText(craigBubble));
  assert.strictEqual(out, 'Can do My email is Craig.carolan@infocus.com.au');
  assert.ok(!/isCraig/.test(out), 'the old glued shape "isCraig" must never come back');
});

check('2. <br> breaks separate lines and never swallow text', () => {
  const bubble = el('p', text('My email is'), el('br'), text('craig.carolan@infocus.com.au'), el('br'), el('br'), text('Cheers'));
  assert.strictEqual(cleanText(blockText(bubble)), 'My email is craig.carolan@infocus.com.au Cheers');
});

check('3. inline elements add no breaks', () => {
  const bubble = el('p', text('go to '), el('a', text('the site')), text(' now, '), el('strong', text('today')), el('span', text('.')));
  assert.strictEqual(cleanText(blockText(bubble)), 'go to the site now, today.');
});

check('4. the full chain files Craig\'s clean address, not the "is" one', () => {
  const thread = [
    { sender: 'Guy Wilson', text: cleanText(blockText(el('p', text('Hi Craig, let\'s connect.')))) },
    { sender: 'Craig Carolan', text: cleanText(blockText(craigBubble)) },
  ];
  const got = extractProfferedContact(thread, 'craig', 'carolan');
  assert.strictEqual(got.email, 'Craig.carolan@infocus.com.au');
});

check('4b. the OLD textContent path really did produce the bad address (regression proof)', () => {
  // What shipped before: textContent glues the <p>s. Prove the test would have caught it.
  const glued = 'Can doMy email isCraig.carolan@infocus.com.au';
  const got = extractProfferedContact([{ sender: 'Craig Carolan', text: glued }], 'craig', 'carolan');
  assert.strictEqual(got.email, 'isCraig.carolan@infocus.com.au', 'old shape reproduces the bounce address');
});

check('5. a one-line message is unchanged', () => {
  const bubble = el('p', text('Perfect, Craig - see you Wed 28 October, 2:00 pm.'));
  assert.strictEqual(cleanText(blockText(bubble)), 'Perfect, Craig - see you Wed 28 October, 2:00 pm.');
});

check('6. the Ayaan shape (sentence glued to the END) is still trimmed', () => {
  assert.strictEqual(trimRunOnEmail('ayaanaihub@gmail.com.Looking'), 'ayaanaihub@gmail.com');
  assert.strictEqual(trimRunOnEmail('ayaanaihub@gmail.comLooking'), 'ayaanaihub@gmail.com');
  assert.strictEqual(trimRunOnEmail('v@SmartTokenLabs.com'), 'v@SmartTokenLabs.com');
});

check('7. junk input is harmless', () => {
  assert.strictEqual(blockText(null), '');
  assert.strictEqual(blockText(el('p')), '\n\n');
  assert.strictEqual(blockText(text('bare')), 'bare');
  assert.strictEqual(cleanText(blockText(el('p', el('script', text('evil()')), text('ok')))), 'ok');
});

check('8. the scrape in the shipping file reads bubbles through blockText', () => {
  assert.ok(/cleanText\(blockText\(bodyEl\)\)/.test(src), 'thread scrape must call cleanText(blockText(bodyEl))');
  assert.ok(!/cleanText\(bodyEl && bodyEl\.textContent\)/.test(src), 'the old textContent read must be gone');
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
