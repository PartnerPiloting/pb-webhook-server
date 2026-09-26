/**
 * The client's desktop icon (services/clientMachineRdp.js).
 *
 * Run: node tests/client-machine-rdp.test.js
 */
const assert = require('assert');
const { tailscaleAddress, parseSize, buildRdpFile } = require('../services/clientMachineRdp');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

check('reads the 100.x address from the Machine Tailscale field', () => {
  assert.strictEqual(tailscaleAddress('lh-sam-noble 100.83.127.27'), '100.83.127.27');
  assert.strictEqual(tailscaleAddress('100.72.251.51'), '100.72.251.51');
});

check('no address, or not a tailnet one, gives null', () => {
  assert.strictEqual(tailscaleAddress(''), null);
  assert.strictEqual(tailscaleAddress(null), null);
  assert.strictEqual(tailscaleAddress('lh-sam-noble'), null);
  assert.strictEqual(tailscaleAddress('linkedinhelper 112.213.38.11'), null);
  assert.strictEqual(tailscaleAddress('lh-x 100.300.1.1'), null);
});

check('size parses WxH and rejects anything else', () => {
  assert.deepStrictEqual(parseSize('2560x1440'), { width: 2560, height: 1440 });
  assert.strictEqual(parseSize('big'), null);
});

check('file points at the address, lands without a prompt, keeps the client drives out', () => {
  const f = buildRdpFile({ address: '100.83.127.27' });
  assert.ok(f.includes('full address:s:100.83.127.27\r\n'));
  assert.ok(f.includes('prompt for credentials:i:0'));
  assert.ok(f.includes('redirectdrives:i:0'));
  assert.ok(f.includes('smart sizing:i:1'));
  assert.ok(f.includes('desktopwidth:i:1920'));
  assert.ok(!/password/i.test(f), 'no password in the file');
});

check('refuses to build without an address', () => {
  assert.throws(() => buildRdpFile({}));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
