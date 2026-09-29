/**
 * Share links into fetchable addresses, and what the tool says about a file's progress
 * (services/machineFileLink.js, services/machineClipboardMcp.js, services/machineFileStore.js).
 *
 * Run: node tests/machine-file-link.test.js
 */
const assert = require('assert');
const { resolveShareLink, isAcceptedHost, oneDriveShareToken } = require('../services/machineFileLink');
const { cleanReport } = require('../services/machineFileStore');

let failures = 0;
// Collected, then run ONE AT A TIME at the bottom: the tool tests swap stand-ins in and out.
const tests = [];
const check = (name, fn) => tests.push([name, fn]);
const refused = (link, words) => {
  try {
    resolveShareLink(link);
  } catch (e) {
    assert.ok(e.refused, `threw, but not as a refusal: ${e.message}`);
    if (words) assert.ok(words.test(e.message), `refusal did not say ${words}: "${e.message}"`);
    return;
  }
  throw new Error(`accepted "${link}"`);
};

check('Dropbox: the same link, asked for the file instead of the page', () => {
  const r = resolveShareLink('https://www.dropbox.com/scl/fi/abc123/roland.lhd2?rlkey=xyz&dl=0');
  assert.strictEqual(r.service, 'Dropbox');
  assert.strictEqual(r.downloadUrl, 'https://www.dropbox.com/scl/fi/abc123/roland.lhd2?rlkey=xyz&dl=1');
  assert.ok(resolveShareLink('https://www.dropbox.com/s/abc/x.lhd2').downloadUrl.endsWith('?dl=1'));
});

check('Google Drive: every shape of file link gives the same fetch address', () => {
  const want = 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp_QrSt-Uv&export=download&confirm=t';
  for (const link of [
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_QrSt-Uv/view?usp=sharing',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_QrSt-Uv/view?usp=drive_link',
    'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp_QrSt-Uv',
    'https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOp_QrSt-Uv&export=download',
  ]) assert.strictEqual(resolveShareLink(link).downloadUrl, want, link);
});

check('Google Drive: a folder, or a Doc, is turned away with what to do instead', () => {
  refused('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp', /FOLDER/);
  refused('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit', /Docs or Sheets/);
});

check('OneDrive: personal links go through its sharing address, work links ask for the download', () => {
  const personal = resolveShareLink('https://1drv.ms/u/s!AbCdEf123?e=xyz');
  assert.strictEqual(personal.service, 'OneDrive');
  assert.strictEqual(personal.downloadUrl, `https://api.onedrive.com/v1.0/shares/${oneDriveShareToken('https://1drv.ms/u/s!AbCdEf123?e=xyz')}/root/content`);
  assert.ok(/^u![A-Za-z0-9_-]+$/.test(oneDriveShareToken('https://1drv.ms/u/s!AbCdEf123?e=xyz')), 'token is not url-safe');
  const work = resolveShareLink('https://gracex-my.sharepoint.com/:u:/g/personal/roland_gracex_io/EabcDEF?e=1a2b3c');
  assert.strictEqual(work.service, 'OneDrive (work)');
  assert.strictEqual(work.downloadUrl, 'https://gracex-my.sharepoint.com/:u:/g/personal/roland_gracex_io/EabcDEF?e=1a2b3c&download=1');
});

check('anything else is refused, in words a person can act on', () => {
  refused('https://example.com/roland.lhd2', /OneDrive, Google Drive or Dropbox/);
  refused('https://wetransfer.com/downloads/abc', /wetransfer\.com/);
  refused('http://www.dropbox.com/s/abc/x.lhd2', /https/);
  refused('https://user:pass@www.dropbox.com/s/abc/x.lhd2', /sign-in built into it/);
  refused('roland.lhd2', /does not look like a link/);
  refused('', /no link/);
  refused('file:///etc/passwd');
  refused('https://dropbox.com.evil.example/s/abc', /evil\.example/);
  refused('https://notdropbox.com/s/abc', /notdropbox\.com/);
});

check('the hosts a machine may be sent to', () => {
  for (const h of ['www.dropbox.com', 'drive.usercontent.google.com', 'api.onedrive.com', 'gracex-my.sharepoint.com', '1drv.ms']) assert.ok(isAcceptedHost(h), h);
  for (const h of ['example.com', 'dropbox.com.evil.example', 'evilsharepoint.com', '']) assert.ok(!isAcceptedHost(h), h);
});

check('what a machine reports is clipped before it is kept or shown', () => {
  const r = cleanReport({ ok: true, name: `x${'y'.repeat(400)}`, bytes: '1078941', kind: 'linked-helper-export', account: 571651, error: 'line one\nline two' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name.length, 160);
  assert.strictEqual(r.bytes, 1078941);
  assert.strictEqual(r.account, '571651');
  assert.strictEqual(r.error, 'line one line two');
  assert.strictEqual(cleanReport({ ok: 'yes' }).ok, false, 'only a real true counts as arrived');
  assert.strictEqual(cleanReport({ bytes: -5 }).bytes, null);
});

// ---- the tool, with the store and the client lookup stood in for ------------------------------
process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test';
process.env.MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID || 'appTest';
const clientService = require('../services/clientService');
const store = require('../services/machineFileStore');
const { legacyToolCall, TOOL_DEFS } = require('../services/machineClipboardMcp');

const roland = (fields = {}) => ({
  clientId: 'Roland-Illyes', clientName: 'Roland Illyes', machineLastSeen: new Date().toISOString(),
  rawRecord: { _rawJson: { fields } },
});
const ask = async (client, args, row) => {
  clientService.getClientById = async () => client;
  const put = [];
  store.putForMachine = async (id, link) => { put.push({ id, link }); return { ok: true, jobId: 'f1' }; };
  store.statusForMachine = async () => row || null;
  const out = await legacyToolCall('wingguy_send_file_to_machine', args, client.clientId);
  return { text: out.content[0].text, put };
};

check('the tool exists and says it only queues', () => {
  const def = TOOL_DEFS.find((d) => d.name === 'wingguy_send_file_to_machine');
  assert.ok(def && /NO url/.test(def.description) && /only queues/.test(def.description));
});

check('a good link is queued for that client only, and the answer says to check back', async () => {
  const { text, put } = await ask(roland(), { url: 'https://www.dropbox.com/s/abc/roland.lhd2?dl=0' });
  assert.strictEqual(put.length, 1);
  assert.strictEqual(put[0].id, 'Roland-Illyes');
  assert.ok(put[0].link.downloadUrl.endsWith('dl=1'));
  assert.ok(/queued, not delivered/.test(text));
});

check('a bad link queues nothing', async () => {
  const { text, put } = await ask(roland(), { url: 'https://example.com/roland.lhd2' });
  assert.strictEqual(put.length, 0);
  assert.ok(/OneDrive, Google Drive or Dropbox/.test(text));
});

check('no machine, nowhere to send it', async () => {
  const { text, put } = await ask({ clientId: 'New-Person', clientName: 'New Person' }, { url: 'https://www.dropbox.com/s/abc/x.lhd2' });
  assert.strictEqual(put.length, 0);
  assert.ok(/no Linked Helper machine on record/.test(text));
});

check('"did it arrive?" - yes, and whose export it is', async () => {
  const row = { status: 'arrived', detail: { ok: true, name: 'roland.lhd2', bytes: 1078941, kind: 'linked-helper-export', account: '571651', version: '2.130.47', folder: 'the Downloads folder' } };
  const { text } = await ask(roland({ 'LH Account ID': '000000' }), {}, row);
  assert.ok(/It arrived/.test(text) && /1\.0 MB/.test(text) && /account 571651/.test(text), text);
  assert.ok(/brought in automatically/.test(text));
  assert.ok(!/will NOT be brought in/.test(text), 'a placeholder account number was treated as a real one');
});

check('"did it arrive?" - an export for the wrong account is called out', async () => {
  const row = { status: 'arrived', detail: { ok: true, name: 'x.lhd2', bytes: 5000, kind: 'linked-helper-export', account: '999999' } };
  const { text } = await ask(roland({ 'LH Account ID': '571651' }), {}, row);
  assert.ok(/will NOT be brought in/.test(text), text);
});

check('"did it arrive?" - no, and why, and what to do', async () => {
  const row = { status: 'failed', detail: { ok: false, error: 'the link returned a web page, not the file - it needs a sign-in' } };
  const { text } = await ask(roland(), {}, row);
  assert.ok(/did NOT arrive/.test(text) && /needs a sign-in/.test(text) && /ANYONE WITH THE LINK/.test(text), text);
});

check('"did it arrive?" - still waiting, never collected, nothing sent', async () => {
  assert.ok(/waiting for/.test((await ask(roland(), {}, { status: 'waiting' })).text));
  assert.ok(/never collected/.test((await ask(roland(), {}, { status: 'waiting', gave_up: true })).text));
  assert.ok(/fetching the file now/.test((await ask(roland(), {}, { status: 'fetching' })).text));
  assert.ok(/Nothing has been sent/.test((await ask(roland(), {}, null)).text));
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures++;
      console.error(`  ✗ ${name}\n    ${e.message}`);
    }
  }
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})();
