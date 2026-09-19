/**
 * The onboarding run sheet: doc parsing and page rendering.
 *
 * Why this exists: the run sheet is the thing Guy follows in front of a client's screen. If the
 * doc parser drops a step, or a link lands on the wrong step, or the page shell breaks so the
 * republish-from-source path produces a different body than the generator, he finds out live.
 * These pin: every concierge step parses with its fields; the standard overview parses all 15;
 * links sit on the right steps; HTML in client data is escaped; the page carries its data,
 * state and script blocks so it can republish itself.
 *
 * Run: node tests/wingguy-run-sheet.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rs = require('../services/runSheet');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const conciergeMd = fs.readFileSync(path.join(__dirname, '..', 'docs', 'concierge-run-sheet.md'), 'utf8');
const checklistMd = fs.readFileSync(path.join(__dirname, '..', 'docs', 'wingguy-onboarding-checklist.md'), 'utf8');

console.log('\nConcierge doc');
const steps = rs.parseConciergeDoc(conciergeMd);

check('parses every step in order with no gaps', () => {
  assert.ok(steps.length >= 12, `got ${steps.length}`);
  steps.forEach((s, i) => assert.strictEqual(s.n, i + 1, `step ${i + 1} numbered ${s.n}`));
});

check('every step has a phase, a who and at least one do', () => {
  for (const s of steps) {
    assert.ok(s.phase, `step ${s.n} phase`);
    assert.ok(s.who, `step ${s.n} who`);
    assert.ok(s.dos.length >= 1, `step ${s.n} dos`);
  }
});

check('the links sit on the right steps and nowhere else', () => {
  const byLink = {};
  for (const s of steps) if (s.link) byLink[s.link] = (byLink[s.link] || []).concat(s.n);
  assert.deepStrictEqual(Object.keys(byLink).sort(), ['connector', 'installer', 'unipile', 'wingguy-first']);
  assert.strictEqual(byLink.connector.length, 1);
  assert.strictEqual(byLink.unipile.length, 1);
  assert.strictEqual(byLink.installer.length, 1);
  assert.strictEqual(byLink['wingguy-first'].length, 1);
  assert.ok(byLink.connector[0] < byLink.unipile[0] && byLink.unipile[0] < byLink.installer[0], 'connector before calendar before extension');
  // Wingguy first goes IMMEDIATELY after the connector: memory forms from the first answer given,
  // so nothing about the machine or the method may be asked before Claude is told to ask Wingguy.
  assert.strictEqual(byLink['wingguy-first'][0], byLink.connector[0] + 1, 'Wingguy first is the step right after the connector');
});

check('say / worked when / watch / proves parse where present', () => {
  const remote = steps.find((s) => /^runs one small file/.test(s.who));
  assert.ok(remote.why.length > 20, 'every session step opens with a plain "why" line');
  assert.ok(remote.check.includes('mouse'));
  assert.ok(remote.who.startsWith('runs'), 'who lines start with the client\'s action');
  const ext = steps.find((s) => s.link === 'installer');
  assert.deepStrictEqual(ext.proves, [9, 10]);
  assert.ok(ext.watch.includes('Fiddliest'));
  assert.strictEqual(ext.minutes, 8);
});

console.log('\nStandard overview');
const std = rs.parseStandardOverview(checklistMd);

check('parses all fifteen checklist steps, 0 to 14', () => {
  assert.strictEqual(std.length, 15, `got ${std.length}: ${std.map((s) => s.n).join(',')}`);
  std.forEach((s, i) => assert.strictEqual(s.n, i));
});

check('each carries its paragraph, its tag as the phase, and the link map', () => {
  for (const s of std) assert.ok(s.dos[0].length > 40, `step ${s.n} paragraph`);
  assert.strictEqual(std[1].link, 'connector');
  assert.strictEqual(std[2].link, 'unipile');
  assert.strictEqual(std[9].link, 'installer');
  assert.strictEqual(std[10].link, 'portal');
  assert.strictEqual(std[3].link, null);
  assert.strictEqual(std[0].phase, 'solo');
  assert.ok(/Linked Helper/.test(std[14].title));
});

console.log('\nRendering');
const detail = {
  clientId: 'Test-Client',
  clientName: 'Test <Client>',
  links: { connectorUrl: 'https://x/mcp2/TOK', installerWindows: "$t='TOK'; x", installerMac: 'T=TOK', portalUrl: 'https://p/?token=TOK' },
  setup: { timezone: 'Australia/Brisbane', managedClaudeKey: true, hasAnthropicKey: false, unipileConnected: false, loginEmail: 'a@b.c' },
  preflight: { steps: [{ n: 0, name: 'record ready', verdict: 'done', evidence: 'Active & fine' }, { n: 2, name: 'calendar + mailbox', verdict: 'owed', evidence: 'nothing connected' }] },
};
const data = rs.buildData({ mode: 'concierge', detail, steps, docText: conciergeMd, minted: { url: 'https://unipile/link' }, now: new Date('2026-09-16T04:00:00Z') });
const html = rs.renderRunSheet(data, { ticks: { 3: true } });

check('facts from the reply email render at the top, blanks flagged, escaped', () => {
  const d = rs.buildData({ mode: 'concierge', detail, steps, docText: 'x', facts: [{ k: 'Recorder', v: 'none' }, { k: 'Machine', v: '' }, { k: 'Address', v: 'a<b>@c' }, { k: '', v: 'dropped' }] });
  assert.strictEqual(d.facts.length, 3);
  const h = rs.renderRunSheet(d);
  assert.ok(h.includes('From Test&rsquo;s reply'));
  assert.ok(h.includes('<div class="k">Recorder</div><div class="">none</div>'));
  assert.ok(h.includes('<div class="k">Machine</div><div class="bad">not answered - ask on the call</div>'));
  assert.ok(h.includes('a&lt;b&gt;@c'));
  // The page's own script carries the "'s reply" template text, so test the RENDERED heading.
  assert.ok(!html.includes('From Test&rsquo;s reply'), 'no facts block when none given');
});

check('the page carries its data, state, css and script blocks by id', () => {
  for (const id of ['rs-data', 'rs-state', 'rs-css', 'rs-app']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.startsWith('<!doctype html>'));
});

check('steps the record proves DONE arrive ticked; steps that prove nothing, or are OWED, do not', () => {
  const ticks = rs.initialTicks(data);
  const record = steps.find((s) => s.proves.length === 1 && s.proves[0] === 0);
  const calendar = steps.find((s) => s.link === 'unipile');
  const remote = steps.find((s) => /^runs one small file/.test(s.who));
  assert.strictEqual(ticks[String(record.n)], true, 'record step (preflight 0 = done) ticked');
  assert.strictEqual(ticks[String(calendar.n)], undefined, 'calendar step (preflight 2 = owed) not ticked');
  assert.strictEqual(ticks[String(remote.n)], undefined, 'remote access proves nothing - never pre-ticked');
  const both = steps.find((s) => s.proves.length === 2);
  assert.strictEqual(ticks[String(both.n)], undefined, 'a step needs EVERY proof done - one missing = unticked');
});

check('client data is escaped in the body but intact in the data block', () => {
  assert.ok(html.includes('<h1>Test &lt;Client&gt;</h1>'));
  assert.ok(html.includes('"name":"Test <Client>"'));
  assert.ok(!html.includes('<h1>Test <Client>'));
});

check('links render on their steps with copy buttons; the minted link and the verdicts appear', () => {
  assert.ok(html.includes('https://x/mcp2/TOK'));
  assert.ok(html.includes('https://unipile/link'));
  assert.ok(html.includes('data-copy="installer"'));
  assert.ok(html.includes('data-copy="portal"'));
  assert.ok(html.includes('data-copy="wingguy-first-preferences"'), 'the Wingguy-first preferences text has its own copy button');
  assert.ok(html.includes('data-copy="wingguy-first-canary"'), 'the canary phrase has its own copy button');
  assert.ok(html.includes('Active &amp; fine'));
  assert.ok(html.includes('class="v owed"'));
});

check('no {{first}} placeholder survives in the rendered body - name filled in everywhere the reader looks', () => {
  const body = html.replace(/<script id="rs-data"[^>]*>[\s\S]*?<\/script>/, '').replace(/<script id="rs-app">[\s\S]*?<\/script>/, '');
  assert.ok(!body.includes('{{first}}'), 'placeholder left in visible text');
  assert.ok(body.includes('The session - Test is here'), 'phase heading carries the name');
  assert.ok(!data.docText.includes('{{first}}'), 'the Ask Claude prompt text carries the name too');
});

check('a tick in state renders the step as done and checked', () => {
  assert.ok(/id="tick-3" data-tick="3" checked/.test(html));
  assert.ok(/class="step done" data-step="3"/.test(html));
  assert.ok(/class="step" data-step="4"/.test(html));
});

check('without a minted link the calendar step says so instead of a copy button', () => {
  const d2 = rs.buildData({ mode: 'concierge', detail, steps, docText: conciergeMd, minted: null });
  const h2 = rs.renderRunSheet(d2);
  assert.ok(h2.includes('Not minted - ask Claude'));
  assert.ok(!h2.includes('data-copy="unipile"'));
});

check('a script-closing sequence inside the data cannot break out of the JSON block', () => {
  const d3 = rs.buildData({ mode: 'concierge', detail: { ...detail, clientName: 'Evil </script><b>' }, steps, docText: 'x' });
  const h3 = rs.renderRunSheet(d3);
  assert.ok(!h3.includes('Evil </script>'));
  assert.ok(h3.includes('Evil <\\/script>'));
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
