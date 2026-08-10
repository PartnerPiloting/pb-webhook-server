/**
 * tests/reconnect-auto-cease.test.js
 *
 * Covers evaluateReconnectAutoCease - the code-owned cohort test behind cease-on-send for the
 * "warm reply, no meeting, gone quiet" pattern. Pure function, no Airtable.
 *
 * Run: node tests/reconnect-auto-cease.test.js
 */

const assert = require('assert');
const { evaluateReconnectAutoCease } = require('../services/reconnectAutoCease');

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
// Fixed "now": 10 Aug 2026, 2pm Brisbane (04:00 UTC). Brisbane date = 10-08-26.
const NOW = new Date('2026-08-10T04:00:00.000Z');
const TODAY = '10-08-26';

// Warm reply on 20 Jun, coach's follow-up 22 Jun, quiet since (49 days by 10 Aug).
const QUIET_WARM_NOTES = [
    '=== LINKEDIN MESSAGES ===',
    '22-06-26 11:23 AM - Guy Wilson - No worries at all, whenever suits.',
    '20-06-26 10:15 AM - Ana Asanovic - Sounds great Guy, keen to hear more when things settle down.',
    '15-06-26 9:00 AM - Guy Wilson - Hi Ana, thought this might be up your alley.',
].join('\n');

// The reconnect send: newest message is the coach's, dated today.
const SEND_TODAY = [
    { date: '20-06-26', time: '10:15 AM', sender: 'Ana Asanovic', message: 'Sounds great Guy, keen to hear more when things settle down.' },
    { date: TODAY, time: '2:00 PM', sender: 'Guy Wilson', message: 'We connected a while back and never got to that chat...' },
];

const BASE = {
    notes: QUIET_WARM_NOTES,
    newMessages: SEND_TODAY,
    clientFirstName: 'Guy',
    leadFirstName: 'Ana',
    alreadyCeased: false,
    timezone: TZ,
    now: NOW,
};

console.log('reconnectAutoCease');

test('a reconnect send to a warm-then-quiet lead ceases them', () => {
    const r = evaluateReconnectAutoCease(BASE);
    assert.strictEqual(r.cease, true, r.reason);
    assert.strictEqual(r.quietDays, 49);
});

test('the stamp is the last millisecond of the PREVIOUS day, so a same-day reply survives', () => {
    const r = evaluateReconnectAutoCease(BASE);
    // Brisbane 10 Aug -> stamp must be strictly before 2026-08-10T00:00:00Z (how a same-day
    // LinkedIn reply is parsed), and within the preceding day.
    const ceaseMs = Date.parse(r.ceaseAtIso);
    const midnight = Date.UTC(2026, 7, 10);
    assert.ok(ceaseMs < midnight, `stamp ${r.ceaseAtIso} must be before ${new Date(midnight).toISOString()}`);
    assert.strictEqual(midnight - ceaseMs, 1, 'stamp is exactly 1ms before midnight');
});

test('merely OPENING a quiet old thread does not cease - nothing sent today', () => {
    const r = evaluateReconnectAutoCease({
        ...BASE,
        newMessages: [
            { date: '20-06-26', time: '10:15 AM', sender: 'Ana Asanovic', message: 'Sounds great Guy.' },
            { date: '22-06-26', time: '11:23 AM', sender: 'Guy Wilson', message: 'No worries at all.' },
        ],
    });
    assert.strictEqual(r.cease, false);
    assert.ok(/not from today/.test(r.reason), r.reason);
});

test('they never replied - excluded (the reopener would be a lie)', () => {
    const notes = [
        '=== LINKEDIN MESSAGES ===',
        '15-06-26 9:00 AM - Guy Wilson - Hi Ana, thought this might be up your alley.',
    ].join('\n');
    const r = evaluateReconnectAutoCease({ ...BASE, notes });
    assert.strictEqual(r.cease, false);
    assert.ok(/never replied/.test(r.reason), r.reason);
});

test('a meeting on record - excluded (post-call relationship, not this cohort)', () => {
    const notes = QUIET_WARM_NOTES + '\n\n=== MEETING NOTES ===\nAna Asanovic <> Guy Wilson [Recorded 25/06/2026, 10:00 am]';
    const r = evaluateReconnectAutoCease({ ...BASE, notes });
    assert.strictEqual(r.cease, false);
    assert.ok(/meeting/.test(r.reason), r.reason);
});

test('an active thread is not quiet - excluded', () => {
    const notes = [
        '=== LINKEDIN MESSAGES ===',
        '05-08-26 11:23 AM - Ana Asanovic - Sure, next week works.',
        '20-06-26 10:15 AM - Ana Asanovic - Sounds great Guy.',
    ].join('\n');
    const r = evaluateReconnectAutoCease({ ...BASE, notes });
    assert.strictEqual(r.cease, false);
    assert.ok(/days quiet/.test(r.reason), r.reason);
});

test('recent EMAIL traffic also counts as not quiet', () => {
    const notes = QUIET_WARM_NOTES + '\n\n=== EMAIL CORRESPONDENCE ===\n01-08-26: Subject: Re: catching up - sounds good';
    const r = evaluateReconnectAutoCease({ ...BASE, notes });
    assert.strictEqual(r.cease, false);
    assert.ok(/days quiet/.test(r.reason), r.reason);
});

test('already ceased - never double-fires', () => {
    const r = evaluateReconnectAutoCease({ ...BASE, alreadyCeased: true });
    assert.strictEqual(r.cease, false);
});

test('newest message is the LEAD\'s - a reply landing never ceases', () => {
    const r = evaluateReconnectAutoCease({
        ...BASE,
        newMessages: [
            ...SEND_TODAY,
            { date: TODAY, time: '3:00 PM', sender: 'Ana Asanovic', message: 'Good timing - yes!' },
        ],
    });
    assert.strictEqual(r.cease, false);
    assert.ok(/not the coach/.test(r.reason), r.reason);
});

test('coach and lead sharing a first name - never cease on ambiguous direction', () => {
    const r = evaluateReconnectAutoCease({ ...BASE, leadFirstName: 'Guy' });
    assert.strictEqual(r.cease, false);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
