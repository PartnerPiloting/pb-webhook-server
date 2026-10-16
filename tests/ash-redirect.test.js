/**
 * Tests for the retired-ASH redirect (middleware/ashRedirect.js): australiansidehustles.com.au
 * requests 301 to the matching knowaguy.com.au page; every other host passes straight through.
 *
 * Run: node tests/ash-redirect.test.js
 */
const assert = require('assert');
const { ashRedirect, knowaguyPathFor } = require('../middleware/ashRedirect');

function run(host, path) {
  let redirected = null;
  let passed = false;
  const req = { headers: { host }, path };
  const res = { redirect: (code, url) => { redirected = { code, url }; } };
  ashRedirect(req, res, () => { passed = true; });
  return { redirected, passed };
}

// Path mapping
assert.strictEqual(knowaguyPathFor('/'), '/');
assert.strictEqual(knowaguyPathFor('/renew-membership/'), '/join');
assert.strictEqual(knowaguyPathFor('/portal-benefits/'), '/join');
assert.strictEqual(knowaguyPathFor('/benefits-page-v1/'), '/join');
assert.strictEqual(knowaguyPathFor('/contact/'), '/guy');
assert.strictEqual(knowaguyPathFor('/privacy-policy/'), '/privacy');
assert.strictEqual(knowaguyPathFor('/terms-and-conditions'), '/terms');
assert.strictEqual(knowaguyPathFor('/wp-login.php'), '/');
assert.strictEqual(knowaguyPathFor('/some-old-blog-post/'), '/');
assert.strictEqual(knowaguyPathFor('/contactless-payments-guide/'), '/guy'); // prefix match is deliberate

// ASH hosts redirect permanently
for (const host of ['australiansidehustles.com.au', 'www.australiansidehustles.com.au', 'AustralianSideHustles.com.au:443']) {
  const r = run(host, '/renew-membership/');
  assert.deepStrictEqual(r.redirected, { code: 301, url: 'https://knowaguy.com.au/join' }, host);
  assert.strictEqual(r.passed, false);
}

// Every other host is untouched
for (const host of ['knowaguy.com.au', 'pb-webhook-server.onrender.com', 'mail.australiansidehustles.com.au', '', undefined]) {
  const r = run(host, '/');
  assert.strictEqual(r.redirected, null, String(host));
  assert.strictEqual(r.passed, true, String(host));
}

console.log('ash-redirect: all tests passed');
