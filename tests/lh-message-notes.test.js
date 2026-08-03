/**
 * tests/lh-message-notes.test.js
 *
 * Covers the pure half of services/lhMessageNotes.js - line building and the merge into Notes.
 * The Airtable half (recordLhMessages) is a thin read/update wrapper and is not covered here.
 *
 * Run: node tests/lh-message-notes.test.js
 */

const assert = require('assert');
const {
    payloadHasMessages,
    parseSendAt,
    buildMessageLines,
    applyMessageLinesToNotes,
} = require('../services/lhMessageNotes');

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

const TZ = 'Australia/Brisbane';

// A profile-only payload, i.e. every campaign that has no webhook step after a messaging action.
const PROFILE_ONLY = {
    first_name: 'Ana',
    last_name: 'Asanovic',
    profile_url: 'https://www.linkedin.com/in/ana-asanovic',
    my_full_name: 'Guy Wilson',
    my_email: 'guy@example.com',
};

const WITH_SENT_MESSAGE = {
    ...PROFILE_ONLY,
    last_received_message_from: 'Guy Wilson',
    last_received_message_text: 'Hi Ana, thought you might like this: https://knowaguy.com.au',
    last_received_message_send_at: '2026-08-03T05:39:00.000Z', // 3:39 PM Brisbane
};

console.log('lhMessageNotes');

test('a profile-only payload carries no messages', () => {
    assert.strictEqual(payloadHasMessages(PROFILE_ONLY), false);
    assert.strictEqual(payloadHasMessages(null), false);
    assert.strictEqual(payloadHasMessages({ last_received_message_text: '   ' }), false);
});

test('a payload with a sent message is detected', () => {
    assert.strictEqual(payloadHasMessages(WITH_SENT_MESSAGE), true);
});

test('send_at parses ISO, epoch seconds and epoch milliseconds alike', () => {
    const iso = parseSendAt('2026-08-03T05:39:00.000Z');
    assert.strictEqual(iso.toISOString(), '2026-08-03T05:39:00.000Z');
    assert.strictEqual(parseSendAt(1785735540).toISOString(), parseSendAt(1785735540000).toISOString());
    assert.strictEqual(parseSendAt(''), null);
    assert.strictEqual(parseSendAt('not a date'), null);
});

test('a sent message becomes a properly stamped Notes line in the client timezone', () => {
    const [msg] = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ, clientName: 'Guy Wilson' });
    assert.strictEqual(msg.line, '03-08-26 3:39 PM - Guy Wilson - Hi Ana, thought you might like this: https://knowaguy.com.au');
    assert.strictEqual(msg.usedFallbackTime, false);
});

test('a multi-line message body is flattened onto one line', () => {
    const [msg] = buildMessageLines({
        ...WITH_SENT_MESSAGE,
        last_received_message_text: 'Hi Ana,\n\nThought you might like this.\n\nCheers,\nGuy',
    }, { timezone: TZ });
    assert.ok(!msg.line.includes('\n'), 'line should not contain newlines');
    assert.ok(msg.line.endsWith('Hi Ana, Thought you might like this. Cheers, Guy'));
});

test('a missing sender name falls back by direction', () => {
    const [outbound] = buildMessageLines({
        ...PROFILE_ONLY,
        last_received_message_text: 'my outbound',
    }, { timezone: TZ, clientName: 'Guy Wilson' });
    assert.ok(outbound.line.includes('- Guy Wilson - my outbound'));

    const [inbound] = buildMessageLines({
        ...PROFILE_ONLY,
        my_full_name: '',
        last_sent_message_text: 'their reply',
    }, { timezone: TZ, leadName: 'Ana Asanovic' });
    assert.ok(inbound.line.includes('- Ana Asanovic - their reply'));
});

test('an unreadable send time is stamped now and flagged', () => {
    const now = new Date('2026-08-03T05:39:00.000Z');
    const [msg] = buildMessageLines({
        ...WITH_SENT_MESSAGE,
        last_received_message_send_at: 'garbage',
    }, { timezone: TZ, now });
    assert.strictEqual(msg.usedFallbackTime, true);
    assert.ok(msg.line.startsWith('03-08-26 3:39 PM'));
});

test('the same message echoed in both field pairs is only written once', () => {
    const lines = buildMessageLines({
        ...WITH_SENT_MESSAGE,
        last_sent_message_from: 'Guy Wilson',
        last_sent_message_text: 'Hi Ana, thought you might like this: https://knowaguy.com.au',
        last_sent_message_send_at: '2026-08-03T05:39:00.000Z',
    }, { timezone: TZ });
    assert.strictEqual(lines.length, 1);
});

test('a message is added to an empty Notes field, creating the section', () => {
    const lines = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ });
    const { notes, added } = applyMessageLinesToNotes('', lines);
    assert.strictEqual(added, 1);
    assert.ok(notes.includes('=== LINKEDIN MESSAGES ==='));
    assert.ok(notes.includes('Hi Ana, thought you might like this'));
});

test('a new message lands above existing history, which survives intact', () => {
    const existing = [
        '=== LINKEDIN MESSAGES ===',
        '22-06-26 11:23 AM - Guy Wilson - Perfect, Friday it is.',
        '19-06-26 10:15 AM - Ana Asanovic - Does Friday work?',
    ].join('\n');
    const lines = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ });
    const { notes, added } = applyMessageLinesToNotes(existing, lines);

    assert.strictEqual(added, 1);
    const body = notes.split('=== LINKEDIN MESSAGES ===')[1].trim().split('\n');
    assert.ok(body[0].startsWith('03-08-26'), `newest first, got: ${body[0]}`);
    assert.strictEqual(body.length, 3);
    assert.ok(notes.includes('Does Friday work?'), 'existing history must survive');
});

test('a message already in the section is not written again', () => {
    const existing = [
        '=== LINKEDIN MESSAGES ===',
        '03-08-26 3:39 PM - Guy Wilson - Hi Ana, thought you might like this: https://knowaguy.com.au',
    ].join('\n');
    const lines = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ });
    const { notes, added, skipped } = applyMessageLinesToNotes(existing, lines);
    assert.strictEqual(added, 0);
    assert.strictEqual(skipped, 1);
    assert.strictEqual(notes, existing);
});

test('the same message captured by the extension at a different time is not duplicated', () => {
    // The extension stamps a neutral time when it cannot read one from the DOM.
    const existing = [
        '=== LINKEDIN MESSAGES ===',
        '03-08-26 12:00 PM - Guy Wilson - Hi Ana, thought you might like this: https://knowaguy.com.au',
    ].join('\n');
    const lines = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ });
    const { added } = applyMessageLinesToNotes(existing, lines);
    assert.strictEqual(added, 0);
});

test('other Notes sections are preserved', () => {
    const existing = [
        'Tags: #promised',
        '',
        '=== LINKEDIN MESSAGES ===',
        '19-06-26 10:15 AM - Ana Asanovic - Does Friday work?',
        '',
        '=== MANUAL NOTES ===',
        '20-06-26: rang her, no answer',
        '',
        '=== EMAIL CORRESPONDENCE ===',
        'Subject: Following up',
    ].join('\n');
    const lines = buildMessageLines(WITH_SENT_MESSAGE, { timezone: TZ });
    const { notes, added } = applyMessageLinesToNotes(existing, lines);

    assert.strictEqual(added, 1);
    assert.ok(notes.includes('Tags: #promised'), 'tags preserved');
    assert.ok(notes.includes('rang her, no answer'), 'manual notes preserved');
    assert.ok(notes.includes('Subject: Following up'), 'email section preserved');
    assert.ok(notes.includes('Does Friday work?'), 'prior LinkedIn history preserved');
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
