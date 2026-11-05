/**
 * Tests for the extension version policy (services/extensionPolicy.js, content/extension-policy.json,
 * extension 0.3.41) - Guy, 5 Nov 2026.
 *
 * Extension 0.3.38 re-dated old messages as "today"; the one client who could not be fixed from
 * the server was the one who updates by hand. Guy does not want to email anyone "update urgently",
 * so: the extension reports its version, the server tells it what notice to show, and a faulty
 * version can be paused from saving while drafting carries on.
 *
 * Contracts:
 *   1. Versions compare as numbers, and only a clean version string is ever accepted.
 *   2. Up to date -> no notice. Unknown version (an older extension) -> no notice, never paused.
 *   3. Behind on the portal lane -> a calm notice with the update button.
 *   4. Behind on the updater lane -> a notice with no button (it arrives by itself).
 *   5. A paused version -> the pause notice, the button, and a toast line - even when up to date.
 *   6. The save route's answer for a paused version is a readable 200 body, not an error.
 *   7. The shipped policy file pauses nothing, and its wording keeps house style.
 *   8. The wiring: the extension sends the header, asks for status, and the save route checks the
 *      pause before it reads the lead; CORS lets the header through.
 *
 * Run: node tests/extension-policy.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const policyLib = require('../services/extensionPolicy');
const { cleanVersion, compareVersions, isPaused, extensionStatus, pausedSaveResponse, loadPolicy, currentVersion } = policyLib;

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const POLICY = {
  pausedVersions: ['0.3.41'],
  notices: { portalBehind: 'PORTAL', updaterBehind: 'UPDATER', paused: 'PAUSED', pausedToast: 'TOAST', button: 'BUTTON' },
};
const NONE_PAUSED = { ...POLICY, pausedVersions: [] };

test('1. versions compare as numbers; only clean version strings are accepted', () => {
  assert.strictEqual(compareVersions('0.3.9', '0.3.10'), -1);
  assert.strictEqual(compareVersions('0.3.41', '0.3.41'), 0);
  assert.strictEqual(compareVersions('0.4', '0.3.99'), 1);
  assert.strictEqual(cleanVersion(' 0.3.41 '), '0.3.41');
  for (const bad of ['', null, undefined, 'latest', '0.3.41; drop', '<b>1.2</b>', '1', '1.2.3.4.5']) assert.strictEqual(cleanVersion(bad), '', `rejects ${bad}`);
});

test('2. up to date = no notice; an extension that does not say its version = no notice, never paused', () => {
  const ok = extensionStatus({ version: '0.3.42', current: '0.3.42', policy: POLICY });
  assert.deepStrictEqual([ok.behind, ok.paused, ok.notice], [false, false, null]);
  const silent = extensionStatus({ version: '', current: '0.3.42', policy: POLICY });
  assert.deepStrictEqual([silent.yours, silent.behind, silent.paused, silent.notice], ['', false, false, null]);
  assert.strictEqual(isPaused('', POLICY), false);
  assert.strictEqual(isPaused(undefined, POLICY), false);
  const ahead = extensionStatus({ version: '0.3.43', current: '0.3.42', policy: POLICY });
  assert.strictEqual(ahead.notice, null, 'a newer build (Guy testing) is not nagged');
});

test('3. behind on the portal lane = calm notice with the update button', () => {
  const s = extensionStatus({ version: '0.3.42', current: '0.3.44', lane: 'portal', policy: NONE_PAUSED });
  assert.strictEqual(s.behind, true);
  assert.deepStrictEqual(s.notice, { tone: 'info', text: 'PORTAL', button: 'BUTTON', action: 'open-install' });
  assert.strictEqual(s.toast, undefined);
});

test('4. behind on the updater lane = notice without a button', () => {
  const s = extensionStatus({ version: '0.3.42', current: '0.3.44', lane: 'updater', policy: NONE_PAUSED });
  assert.deepStrictEqual(s.notice, { tone: 'info', text: 'UPDATER' });
});

test('5. a paused version gets the pause notice, the button and the toast - whatever its lane', () => {
  for (const lane of ['portal', 'updater']) {
    const s = extensionStatus({ version: '0.3.41', current: '0.3.44', lane, policy: POLICY });
    assert.strictEqual(s.paused, true);
    assert.deepStrictEqual(s.notice, { tone: 'pause', text: 'PAUSED', button: 'BUTTON', action: 'open-install' });
    assert.strictEqual(s.toast, 'TOAST');
  }
  const current = extensionStatus({ version: '0.3.41', current: '0.3.41', policy: POLICY });
  assert.strictEqual(current.paused, true, 'the current version can be paused too, before its fix exists');
  assert.strictEqual(isPaused('0.3.40', POLICY), false);
});

test('6. the save route answers a paused version with a readable body', () => {
  assert.deepStrictEqual(pausedSaveResponse(POLICY), { paused: true, saved: false, message: 'TOAST' });
});

test('7. the shipped policy pauses nothing and keeps house style', () => {
  const shipped = JSON.parse(read('content', 'extension-policy.json'));
  assert.deepStrictEqual(shipped.pausedVersions, [], 'nothing is paused by default - a pause is a deliberate commit');
  for (const key of ['portalBehind', 'updaterBehind', 'paused', 'pausedToast', 'button']) {
    const text = shipped.notices[key];
    assert.ok(typeof text === 'string' && text.length > 5, `notices.${key} is written`);
    assert.ok(!/[–—]/.test(text), `notices.${key} uses the short spaced dash, never an em or en dash`);
    assert.ok(!/\brules?\b/i.test(text), `notices.${key} never says "rules"`);
    assert.ok(!/urgent|immediately|asap/i.test(text), `notices.${key} is calm`);
  }
  assert.deepStrictEqual(loadPolicy().pausedVersions, []);
  assert.strictEqual(currentVersion(), JSON.parse(read('wingguy-extension', 'manifest.json')).version);
});

test('8. the wiring', () => {
  const bg = read('wingguy-extension', 'background.js');
  assert.ok(bg.includes("headers['x-wingguy-version'] = chrome.runtime.getManifest().version"), 'every request carries the version');
  assert.ok(bg.includes("message.type === 'WG_EXT_STATUS'") && bg.includes('/extension-status'), 'the worker asks the server');
  assert.ok(bg.includes("message.type === 'OPEN_INSTALL_PAGE'") && bg.includes('my-wingguy/install'), 'the button opens the install page');
  const content = read('wingguy-extension', 'content-wingguy.js');
  assert.ok(content.includes('refreshExtStatus().then(renderVersionNotice)'), 'the panel asks when it opens, without waiting');
  assert.ok(content.includes('text.textContent = notice.text'), 'server wording is shown as text, never as HTML');
  assert.ok(content.includes('if (extStatus && extStatus.paused) { notePausedSave(extStatus.toast); return; }'), 'a paused version skips the save');
  assert.ok(content.includes('if (qres && qres.paused)'), 'and understands the server refusing one');
  const route = read('LinkedIn-Messaging-FollowUp', 'backend-extensions', 'routes', 'linkedinRoutesWithAuth.js');
  const pauseAt = route.indexOf('extensionPolicy.isPaused(extVersion)');
  const readAt = route.indexOf("// Fetch current lead", pauseAt);
  assert.ok(pauseAt > 0 && readAt > pauseAt, 'the pause is checked before the lead is read or written');
  assert.ok(read('routes', 'wingguyRoutes.js').includes("router.get('/extension-status'"));
  assert.ok(read('index.js').includes("'x-wingguy-version'"), 'CORS allows the header');
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
