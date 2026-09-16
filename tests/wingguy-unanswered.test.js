/**
 * tests/wingguy-unanswered.test.js
 *
 * Covers the pure half of services/wingguyUnansweredStore.js - CSV reading, working out which
 * name is the coach, building threads, and the sign-off heuristic. The Postgres half is a thin
 * read/write wrapper and is not covered here.
 *
 * Run: node tests/wingguy-unanswered.test.js
 */

const assert = require('assert');
const {
    parseCsv,
    parseMessagesCsv,
    detectOwnerName,
    buildThreads,
    closingHeuristic,
} = require('../services/wingguyUnansweredStore');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (e) {
        console.error(`  FAIL  ${name}\n        ${e.message}`);
        process.exitCode = 1;
    }
}

console.log('wingguyUnansweredStore');

// --- CSV reading -----------------------------------------------------------
// LinkedIn puts message bodies in the file verbatim, so the parser has to survive commas, quotes
// and hard newlines INSIDE a field. This is the failure that would silently corrupt an import.

test('a plain file parses into rows', () => {
    const rows = parseCsv('A,B\n1,2\n3,4\n');
    assert.deepStrictEqual(rows, [['A', 'B'], ['1', '2'], ['3', '4']]);
});

test('quoted fields keep their commas, newlines and escaped quotes', () => {
    const rows = parseCsv('A,B\n"hello, there","line one\nline two"\n"she said ""yes""",x\n');
    assert.strictEqual(rows[1][0], 'hello, there');
    assert.strictEqual(rows[1][1], 'line one\nline two');
    assert.strictEqual(rows[2][0], 'she said "yes"');
});

test('a leading BOM is stripped so the first header still matches', () => {
    const rows = parseCsv('﻿CONVERSATION ID,FROM\nc1,Guy Wilson\n');
    assert.strictEqual(rows[0][0], 'CONVERSATION ID');
});

test('blank lines are dropped', () => {
    assert.strictEqual(parseCsv('A,B\n\n1,2\n\n').length, 2);
});

// --- Header mapping --------------------------------------------------------

const EXPORT = [
    'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER',
    'c1,,Guy Wilson,https://linkedin.com/in/guy,Ana Asanovic,https://linkedin.com/in/ana,2026-08-01 02:00:00 UTC,,"Great to connect Ana",INBOX',
    'c1,,Ana Asanovic,https://linkedin.com/in/ana,Guy Wilson,https://linkedin.com/in/guy,2026-08-02 02:00:00 UTC,,"Thanks Guy - what do you actually do?",INBOX',
    'c2,,Guy Wilson,https://linkedin.com/in/guy,Bob Smith,https://linkedin.com/in/bob,2026-08-03 02:00:00 UTC,,"Hi Bob",INBOX',
    'c2,,Bob Smith,https://linkedin.com/in/bob,Guy Wilson,https://linkedin.com/in/guy,2026-08-04 02:00:00 UTC,,"Thanks!",INBOX',
    'c3,,Guy Wilson,https://linkedin.com/in/guy,Cara Lee,https://linkedin.com/in/cara,2026-08-05 02:00:00 UTC,,"Hi Cara",INBOX',
    '',
].join('\n');

test('export columns map onto field names regardless of case and spacing', () => {
    const rows = parseMessagesCsv(EXPORT);
    assert.strictEqual(rows.length, 5);
    assert.strictEqual(rows[0].threadKey, 'c1');
    assert.strictEqual(rows[0].fromName, 'Guy Wilson');
    assert.strictEqual(rows[1].content, 'Thanks Guy - what do you actually do?');
});

test('unknown columns are ignored rather than breaking the import', () => {
    const csv = 'CONVERSATION ID,FROM,DATE,CONTENT,SOME NEW COLUMN\nc1,Guy,2026-08-01 02:00:00 UTC,hi,whatever\n';
    const rows = parseMessagesCsv(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].content, 'hi');
});

test('rows with no conversation id are skipped', () => {
    const csv = 'CONVERSATION ID,FROM,DATE,CONTENT\n,Guy,2026-08-01 02:00:00 UTC,hi\nc1,Guy,2026-08-01 02:00:00 UTC,hi\n';
    assert.strictEqual(parseMessagesCsv(csv).length, 1);
});

// --- Owner detection -------------------------------------------------------
// The coach is a party to every conversation; everyone else appears in one or two. Counting
// DISTINCT CONVERSATIONS (not messages) is what stops one chatty contact outranking them.

test('the coach is the sender appearing in the most conversations', () => {
    assert.strictEqual(detectOwnerName(parseMessagesCsv(EXPORT)), 'Guy Wilson');
});

test('one very chatty contact does not get mistaken for the coach', () => {
    const csv = [
        'CONVERSATION ID,FROM,TO,DATE,CONTENT',
        'c1,Guy Wilson,Ana,2026-08-01 02:00:00 UTC,hi',
        'c2,Guy Wilson,Bob,2026-08-01 02:00:00 UTC,hi',
        'c1,Ana Asanovic,Guy Wilson,2026-08-02 02:00:00 UTC,a',
        'c1,Ana Asanovic,Guy Wilson,2026-08-03 02:00:00 UTC,b',
        'c1,Ana Asanovic,Guy Wilson,2026-08-04 02:00:00 UTC,c',
        'c1,Ana Asanovic,Guy Wilson,2026-08-05 02:00:00 UTC,d',
        '',
    ].join('\n');
    // Ana sends four messages to Guy's two, but only in one conversation.
    assert.strictEqual(detectOwnerName(parseMessagesCsv(csv)), 'Guy Wilson');
});

// --- Thread building -------------------------------------------------------

test('threads carry who spoke last, and outbound is judged against the coach', () => {
    const threads = buildThreads(parseMessagesCsv(EXPORT), 'Guy Wilson');
    const byKey = Object.fromEntries(threads.map((t) => [t.threadKey, t]));

    assert.strictEqual(byKey.c1.lastOutbound, false);           // Ana asked a question
    assert.strictEqual(byKey.c1.counterpartName, 'Ana Asanovic');
    assert.strictEqual(byKey.c1.messageCount, 2);

    assert.strictEqual(byKey.c2.lastOutbound, false);           // Bob said thanks (still inbound)
    assert.strictEqual(byKey.c3.lastOutbound, true);            // Guy spoke last - nothing owed
});

test('messages are ordered by date, not by file order', () => {
    const csv = [
        'CONVERSATION ID,FROM,TO,DATE,CONTENT',
        'c1,Ana,Guy Wilson,2026-08-09 02:00:00 UTC,later',
        'c1,Guy Wilson,Ana,2026-08-01 02:00:00 UTC,earlier',
        '',
    ].join('\n');
    const t = buildThreads(parseMessagesCsv(csv), 'Guy Wilson')[0];
    assert.strictEqual(t.lastText, 'later');
    assert.strictEqual(t.lastOutbound, false);
});

test('group conversations are excluded - nobody owes a personal reply to a group thread', () => {
    const csv = [
        'CONVERSATION ID,FROM,TO,DATE,CONTENT',
        'g1,Guy Wilson,"Ana, Bob",2026-08-01 02:00:00 UTC,hi both',
        'g1,Ana,"Guy Wilson, Bob",2026-08-02 02:00:00 UTC,hello',
        '',
    ].join('\n');
    assert.strictEqual(buildThreads(parseMessagesCsv(csv), 'Guy Wilson').length, 0);
});

test('messages with an unreadable date are dropped, not guessed at', () => {
    const csv = [
        'CONVERSATION ID,FROM,TO,DATE,CONTENT',
        'c1,Guy Wilson,Ana,not-a-date,hi',
        'c1,Ana,Guy Wilson,2026-08-02 02:00:00 UTC,hello',
        '',
    ].join('\n');
    const t = buildThreads(parseMessagesCsv(csv), 'Guy Wilson')[0];
    assert.strictEqual(t.messageCount, 1);
    assert.strictEqual(t.lastText, 'hello');
});

test('the same message imported twice keeps the same key, so re-uploading is additive', () => {
    const a = buildThreads(parseMessagesCsv(EXPORT), 'Guy Wilson').find((t) => t.threadKey === 'c1');
    const b = buildThreads(parseMessagesCsv(EXPORT), 'Guy Wilson').find((t) => t.threadKey === 'c1');
    assert.strictEqual(a.lastMessageKey, b.lastMessageKey);
});

// --- The sign-off heuristic -----------------------------------------------
// This is the drop that makes the screen usable. Everything it clears never reaches the model.

test('plain sign-offs need no reply', () => {
    for (const s of ['Thanks', 'thanks!', 'Thank you so much', 'Cheers', 'No worries.',
                     'Will do', 'Great!', 'speak soon', 'You too', 'ok', 'Noted']) {
        assert.strictEqual(closingHeuristic(s), 'no-reply', `expected no-reply for ${JSON.stringify(s)}`);
    }
});

test('an emoji-only or empty message needs no reply', () => {
    assert.strictEqual(closingHeuristic('👍'), 'no-reply');
    assert.strictEqual(closingHeuristic('   '), 'no-reply');
    assert.strictEqual(closingHeuristic(''), 'no-reply');
});

test('anything that might be asking something goes to the model', () => {
    for (const s of ['Thanks - what do you charge?', 'Can we talk Tuesday?',
                     'Sounds good, send me the link', 'Great, who should I speak to?']) {
        assert.strictEqual(closingHeuristic(s), null, `expected null (ask the model) for ${JSON.stringify(s)}`);
    }
});

test('a long message always goes to the model even if it opens with thanks', () => {
    const long = 'Thanks ' + 'x'.repeat(200);
    assert.strictEqual(closingHeuristic(long), null);
});

console.log(`\n${passed} passed`);
