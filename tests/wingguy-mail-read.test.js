/**
 * Tests for the person-scoped mail READ helpers (wingguy_read_message / wingguy_lead_correspondence).
 * Pure parts only — the executors hit Nylas + Airtable and are proven on prod by
 * scripts/wingguy-mail-read-test.js. ⚠ Synthetic content only (public repo).
 *
 * Run: node tests/wingguy-mail-read.test.js
 */
const assert = require('assert');
const { htmlToText } = require('../services/wingguyMailMcp');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

console.log('htmlToText() — email HTML to readable text:');
check('strips tags, keeps line structure', () => {
  const t = htmlToText('<div><p>Hi Guy,</p><p>Tuesday works.</p><br>Cheers<br>Bob</div>');
  assert.strictEqual(t, 'Hi Guy,\nTuesday works.\n\nCheers\nBob');
});
check('drops style/script blocks entirely', () => {
  const t = htmlToText('<style>.x{color:red}</style><script>alert(1)</script><p>Body only</p>');
  assert.strictEqual(t, 'Body only');
});
check('decodes the common entities', () => {
  const t = htmlToText('<p>Fish &amp; chips &lt;today&gt; &quot;yes&quot; &#8211; ok&nbsp;then</p>');
  assert.ok(t.includes('Fish & chips <today> "yes"'));
  assert.ok(t.includes('ok then'));
});
check('collapses runs of blank lines', () => {
  const t = htmlToText('<p>a</p><p></p><p></p><p>b</p>');
  assert.strictEqual(t, 'a\n\nb');
});
check('empty/null input returns empty string', () => {
  assert.strictEqual(htmlToText(''), '');
  assert.strictEqual(htmlToText(null), '');
});
check('a plain-text body passes through', () => {
  assert.strictEqual(htmlToText('just words, no markup'), 'just words, no markup');
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
