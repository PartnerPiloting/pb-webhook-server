/**
 * Tests for "the server can read a LinkedIn conversation from what the extension saw, and gets the
 * same answer the extension does" (utils/threadReader.js + the extension's "sighting" block,
 * 0.3.43 - step 1 of moving conversation reading to the server, Guy 15 Nov 2026).
 *
 * The extension's scrapes need a real LinkedIn page, so this test lifts the pure pieces out of the
 * REAL content script (between marker comments) and checks the server's copies against them - what
 * is compared is the code that ships.
 *
 * Contracts:
 *   1. The server's day-label rules give the same answer as the extension's for every shape.
 *   2. The server's text block for a thread is identical to the extension's formatThreadForApi.
 *   3. New messaging build: a sighting reads into the right senders, days, times and messages
 *      (paragraphs in one parent are one message; "Today" as plain text is a label - Craig Carolan).
 *   4. Classic build: rows carry sender/time forward; a heading inside its own row re-dates that row.
 *   5. A proven send stamps the coach's newest message Today; an unproven one never does (Ashley
 *      Knowles); a newest message from the lead is left alone.
 *   6. compareContent says match / differs and names the first differing lines.
 *   7. A sighting the server cannot read is reported, never guessed at.
 *   8. The extension's sighting helpers: off by default, capped, and never throw.
 *   9. The wiring is really in the shipping files.
 *
 * Run: node tests/thread-reader.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const reader = require('../utils/threadReader');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const src = read('wingguy-extension', 'content-wingguy.js');
function lift(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  assert.ok(a > 0 && b > a, `${startMarker} block not found in content-wingguy.js`);
  return src.slice(a, b);
}
const dayBlock = lift('// ---- dayLabels (pure;', '// ---- end dayLabels ----');
const formatBlock = lift('function formatThreadForApi(thread, opts = {}) {', '// Contact details the lead PROFFERS');
const sightingBlock = lift('// ---- sighting (pure;', '// ---- end sighting ----');
const ext = new Function(
  `const console = { warn() {}, log() {} };\n${dayBlock}\n${formatBlock}\n` +
  'return { dayLabelOf, dayLabelDaysAgo, stampNewestAsToday, formatThreadForApi, threadNewestKey };'
)();

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { process.exitCode = 1; console.error(`  FAIL ${name}\n       ${e.message}`); }
}

const NOW = new Date(2026, 10, 4, 14, 0); // Wed 4 Nov 2026
const TODAY = [2026, 11, 4];

test('1. day-label rules: server and extension agree on every shape', () => {
  const shapes = ['Today', 'today', ' TODAY ', 'Yesterday', 'Monday', 'saturday', 'Oct 19', 'October 19', 'Oct 19, 2025', 'Oct 19 2025',
    '19 Oct', '19 October 2025', 'Sept 3', 'Dec. 1', '9:41 AM', 'Ann Smith', 'Reply', '', null, undefined, 'Feb 31', 'Oct 32',
    'Today is good for me', 'x'.repeat(40), 'Nov 4', 'Jan 2, 2027', 'Wednesday'];
  for (const s of shapes) {
    assert.strictEqual(reader.dayLabelOf(s), ext.dayLabelOf(s), `dayLabelOf(${JSON.stringify(s)})`);
    assert.strictEqual(reader.dayLabelDaysAgo(s, NOW), ext.dayLabelDaysAgo(s, NOW), `dayLabelDaysAgo(${JSON.stringify(s)})`);
  }
});

test('2. the text block for a thread is identical to the extension\'s', () => {
  const thread = () => [
    { sender: 'Craig Carolan', text: 'Happy to chat', day: 'Oct 19', time: '9:02 AM' },
    { sender: 'Guy Wilson', text: 'Great\nsecond line', day: 'Oct 19', time: '' },
    { sender: '', text: 'no sender', day: 'not a label', time: '25 o clock' },
    { sender: 'Craig Carolan', text: 'How about Tuesday?', day: 'Today', time: '1:33 PM' },
  ];
  assert.strictEqual(reader.formatThread(thread()), ext.formatThreadForApi(thread(), {}));
});

const NEW_UI = {
  v: 1, ui: 'new', today: TODAY, header: { name: 'Craig Carolan' }, send: { proven: false },
  events: [
    { k: 'l', x: 'Craig Carolan' },
    { k: 'l', x: 'Oct 19' },
    { k: 'a', x: "View Craig Carolan's profile" },
    { k: 't', x: '9:02 AM' },
    { k: 'p', x: 'Happy to chat', g: 1 },
    { k: 'p', x: 'My email is', g: 1 },
    { k: 'a', x: 'Guy Wilson' },
    { k: 't', x: '9:10 AM' },
    { k: 'p', x: 'Great, thanks', g: 2 },
    { k: 'l', x: 'Today' },          // plain text, not a <time> - the label the old scrape missed
    { k: 'l', x: 'Reply' },
    { k: 'a', x: "View Craig Carolan's profile" },
    { k: 't', x: '1:33 PM' },
    { k: 'p', x: 'How about Tuesday?', g: 3 },
    { k: 'a', x: 'Guy Wilson' },
    { k: 't', x: '1:56 PM' },
    { k: 'p', x: 'Tuesday works', g: 4 },
  ],
};

test('3. new build: senders, days, times, and paragraphs sharing a parent are one message', () => {
  const r = reader.serverReading(NEW_UI, { now: NOW });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.thread, [
    { sender: 'Craig Carolan', text: 'Happy to chat\nMy email is', day: 'Oct 19', time: '9:02 AM' },
    { sender: 'Guy Wilson', text: 'Great, thanks', day: 'Oct 19', time: '9:10 AM' },
    { sender: 'Craig Carolan', text: 'How about Tuesday?', day: 'Today', time: '1:33 PM' },
    { sender: 'Guy Wilson', text: 'Tuesday works', day: 'Today', time: '1:56 PM' },
  ]);
  assert.deepStrictEqual(r.labelsSeen, ['Oct 19', 'Today']);
  assert.strictEqual(r.stamped, null);
  // A <time> that is a day name, and one the reader cannot read.
  const t = reader.serverReading({ ...NEW_UI, events: [{ k: 't', x: 'Saturday' }, { k: 't', x: 'Hoy' }, { k: 'a', x: 'Ann Smith' }, { k: 't', x: '8:00 AM' }, { k: 'p', x: 'Hi', g: 1 }] });
  assert.deepStrictEqual(t.thread, [{ sender: 'Ann Smith', text: 'Hi', day: 'Saturday', time: '8:00 AM' }]);
  assert.deepStrictEqual(t.unreadable, ['Hoy']);
  // A roster heading or a "profile" link is never a sender.
  const h = reader.serverReading({ ...NEW_UI, events: [{ k: 'a', x: 'Ann Smith and you 2 people in this conversation' }, { k: 'p', x: 'Hi', g: 1 }] });
  assert.strictEqual(h.thread[0].sender, 'Unknown');
});

test('4. classic build: sender and time carry forward; a heading inside its row re-dates that row', () => {
  const seen = {
    v: 1, ui: 'classic', today: TODAY, header: { name: 'Kate Hughes' }, send: { proven: false },
    events: [
      { k: 'l', x: 'Monday', h: true, inRow: false },
      { k: 'r', s: 'Kate Hughes', t: '3:15 PM', x: 'Hello Guy' },
      { k: 'r', s: '', t: '', x: 'One more thing' },
      { k: 'r', s: '', t: '', x: '' },                       // a row with no text is not a message
      { k: 'r', s: 'Guy Wilson', t: '4:00 PM', x: 'Thanks Kate' },
      { k: 'l', x: 'Today', h: true, inRow: true },           // rendered inside the row above
      { k: 'l', x: 'Today', h: false, inRow: false },         // same label again - no change
      { k: 'l', x: 'Seen', h: true, inRow: false },           // a heading that is not a day
      { k: 'r', s: '', t: '4:05 PM', x: 'And another' },
    ],
  };
  const r = reader.serverReading(seen, { now: NOW });
  assert.deepStrictEqual(r.thread, [
    { sender: 'Kate Hughes', text: 'Hello Guy', day: 'Monday', time: '3:15 PM' },
    { sender: 'Kate Hughes', text: 'One more thing', day: 'Monday', time: '3:15 PM' },
    { sender: 'Guy Wilson', text: 'Thanks Kate', day: 'Today', time: '4:00 PM' },
    { sender: 'Guy Wilson', text: 'And another', day: 'Today', time: '4:05 PM' },
  ]);
  assert.deepStrictEqual(r.unreadable, ['Seen']);
});

test('5. a proven send stamps the coach\'s newest message Today - and only then', () => {
  const stale = (proven, lastSender) => ({
    v: 1, ui: 'new', today: TODAY, header: { name: 'Ashley Knowles' }, send: { proven },
    events: [{ k: 'l', x: 'Feb 4' }, { k: 'a', x: lastSender }, { k: 't', x: '9:55 AM' }, { k: 'p', x: 'Catch up soon?', g: 1 }],
  });
  const proven = reader.serverReading(stale(true, 'Guy Wilson'), { now: NOW });
  assert.strictEqual(proven.stamped, 'Feb 4');
  assert.strictEqual(proven.thread[0].day, 'Today');
  const opened = reader.serverReading(stale(false, 'Guy Wilson'), { now: NOW });
  assert.strictEqual(opened.stamped, null, 'merely opening a thread never re-dates it');
  assert.strictEqual(opened.thread[0].day, 'Feb 4');
  const fromLead = reader.serverReading(stale(true, 'Ashley Knowles'), { now: NOW });
  assert.strictEqual(fromLead.thread[0].day, 'Feb 4', 'a newest message from the lead is left alone');
  // And the whole answer equals the extension's for the same thread and the same clock.
  const extThread = [{ sender: 'Guy Wilson', text: 'Catch up soon?', day: 'Feb 4', time: '9:55 AM' }];
  ext.stampNewestAsToday(extThread, 'Ashley Knowles', NOW);
  assert.strictEqual(proven.content, ext.formatThreadForApi(extThread, {}));
  // "today" comes from the extension's own clock, not the server's.
  assert.strictEqual(reader.sightingNow({ today: [2026, 11, 4] }).getDate(), 4);
  assert.strictEqual(reader.sightingNow({ today: 'junk' }, NOW), NOW);
});

test('6. compareContent: match, differs, and which lines', () => {
  const a = reader.serverReading(NEW_UI, { now: NOW }).content;
  assert.deepStrictEqual(reader.compareContent(a, a), { verdict: 'match', diffs: [] });
  assert.strictEqual(reader.compareContent(a.replace(/\n/g, '\r\n') + '\n\n', a).verdict, 'match', 'line endings and trailing blank lines are not a difference');
  const wrong = a.replace('Today', 'Oct 19');
  const d = reader.compareContent(wrong, a);
  assert.strictEqual(d.verdict, 'differs');
  assert.ok(d.diffs.length >= 1 && d.diffs.length <= 5);
  assert.ok(d.diffs.some((x) => x.server === 'Today'), 'the difference names the line the server read as Today');
  assert.strictEqual(reader.compareContent('one', 'one\ntwo').diffs[0].extension, '(nothing)');
});

test('7. a sighting the server cannot read is reported, never guessed at', () => {
  for (const [bad, why] of [[null, 'no sighting'], [{ v: 2, ui: 'new', events: [] }, 'unknown sighting version'], [{ v: 1, ui: 'other', events: [] }, 'unknown page build'],
    [{ v: 1, ui: 'new' }, 'no events'], [{ v: 1, skipped: 'too big', n: 500000 }, 'extension skipped it']]) {
    const r = reader.serverReading(bad);
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.includes(why), `${JSON.stringify(bad)} -> ${r.reason}`);
  }
  // Junk events are skipped, not fatal.
  const r = reader.serverReading({ v: 1, ui: 'new', events: [null, 7, 'x', { k: 'zz' }, { k: 'p', x: 'Hi', g: 1 }] });
  assert.strictEqual(r.thread.length, 1);
});

test('8. the extension\'s sighting helpers: off by default, capped, never throw', () => {
  const s = new Function(
    `${sightingBlock}\n` +
    'return { see, seeGroup, buildSeen, newSighting, on() { sighting = newSighting(); return sighting; }, off() { const x = sighting; sighting = null; return x; }, MAX: SIGHTING_MAX_EVENTS, CHARS: SIGHTING_MAX_CHARS };'
  )();
  s.see({ k: 'p', x: 'ignored' });                 // off: nothing happens, nothing throws
  assert.strictEqual(s.seeGroup({}), 0);
  assert.strictEqual(s.buildSeen(null), undefined);
  s.on();
  const parentA = {}, parentB = {};
  s.see({ k: 'p', x: 'one', g: s.seeGroup(parentA) });
  s.see({ k: 'p', x: 'two', g: s.seeGroup(parentA) });
  s.see({ k: 'p', x: 'three', g: s.seeGroup(parentB) });
  assert.strictEqual(s.seeGroup(null), 0);
  const saw = s.off();
  assert.deepStrictEqual(saw.events.map((e) => e.g), [1, 1, 2]);
  saw.ui = 'new';
  const seen = s.buildSeen(saw, { name: 'Ann Smith', profileUrl: 'https://www.linkedin.com/in/ann', sendProven: true }, NOW);
  assert.deepStrictEqual([seen.v, seen.ui, seen.today, seen.header.name, seen.send.proven], [1, 'new', TODAY, 'Ann Smith', true]);
  assert.strictEqual(seen.parents, undefined, 'only plain data is sent');
  assert.strictEqual(reader.serverReading(seen).thread.length, 2, 'and the server can read it');
  // Caps.
  const big = s.on();
  for (let i = 0; i < s.MAX + 10; i += 1) s.see({ k: 'l', x: 'x' });
  assert.strictEqual(big.events.length, s.MAX);
  assert.deepStrictEqual(s.buildSeen(s.off(), {}, NOW), { v: 1, skipped: 'too many events', n: s.MAX });
  const fat = s.on(); s.see({ k: 'p', x: 'y'.repeat(s.CHARS + 1), g: 1 }); s.off(); fat.ui = 'new';
  assert.strictEqual(s.buildSeen(fat, {}, NOW).skipped, 'too big');
});

test('9. the wiring is in the shipping files', () => {
  for (const call of ["see({ k: 't', x: t })", "see({ k: 'a', x: t })", "see({ k: 'p', x: text, g: seeGroup(node.parentElement) })",
    "see({ k: 'l', x: raw })", "see({ k: 'r', s: name || '', t: time || '', x: text })", "see({ k: 'l', x: t, h: isHeading, inRow })"]) {
    assert.ok(src.includes(call), `the scrape notes ${call}`);
  }
  assert.ok(src.includes('sighting = wantsSighting() ? newSighting() : null;'), 'a sighting is built only when the server asked');
  assert.ok(src.includes('} finally { saw = sighting; sighting = null; }'), 'and is switched off again whatever the scrape did');
  assert.ok(src.includes("section: 'linkedin', sendProven, seen, ...extras"), 'the save carries it');
  const bgSrc = read('wingguy-extension', 'background.js');
  assert.ok(bgSrc.includes('seen: message.seen') && bgSrc.includes('seen: extras.seen'), 'the background passes it through');
  const route = read('LinkedIn-Messaging-FollowUp', 'backend-extensions', 'routes', 'linkedinRoutesWithAuth.js');
  const savedAt = route.indexOf('Quick update successful for lead');
  const shadowAt = route.indexOf('captureShadow.recordSighting(');
  assert.ok(savedAt > 0 && shadowAt > savedAt, 'the shadow runs after the save, never before it');
  assert.ok(route.includes('if (wantSeen && section === \'linkedin\' && content && req.body.seen'), 'and only for clients switched on');
  assert.ok(read('routes', 'wingguyRoutes.js').includes('seen: extensionPolicy.wantsSeen(req.client.clientId)'), 'the version check says who is switched on');
});

console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES above' : ''}`);
