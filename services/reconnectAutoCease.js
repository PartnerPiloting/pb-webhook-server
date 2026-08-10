/**
 * services/reconnectAutoCease.js
 *
 * Cease-on-send for the "warm reply, no meeting, gone quiet" cohort.
 *
 * WHY: when a message goes out to someone who once replied, never got to a meeting, and has been
 * quiet a month or more, that message IS the reconnect touch - the last word. The owner's call
 * (2026-08-10): cease follow-ups at the send, not on a six-week timer. Nothing more was ever
 * going to be sent anyway, a timer is a silent background action on data that can arrive late,
 * and the cease waiver in classifyLead means a reply from them at ANY later time still surfaces -
 * the door stays open, the chasing stops.
 *
 * Evaluated at capture time (the extension snapshots the thread on every send) against the
 * PRE-SEND record, so the judgment is about the thread as it stood before this message: did they
 * ever reply, was there ever a meeting, how long quiet. Deliberately code-owned - no reliance on
 * the model flagging which message pattern it drafted.
 *
 * THE BACKDATED STAMP: LinkedIn reply timestamps in Notes are date-only (parsed as midnight UTC),
 * and the sweep suppresses inbound at-or-before {Cease FUP At}. A cease stamped at send time
 * would therefore swallow a reply that arrives later the SAME day - the most likely reply window
 * there is. So the stamp is the last millisecond of the PREVIOUS day (in the client's own
 * calendar). Safe here because the cohort is by definition 4+ weeks quiet - there is no genuine
 * earlier same-day inbound to falsely resurface.
 */

const { getSection, extractNewestDate } = require('../utils/notesSectionManager');

// Four weeks, matching the cohort definition in the warm-then-quiet-reconnect instruction.
const QUIET_DAYS_MIN = 28;

/** Message lines of a section as { ms, sender } - date-only ms, matching how the sweep reads them. */
function parseSectionLines(section) {
    const out = [];
    for (const raw of String(section || '').split(/\r?\n/)) {
        const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{2})[^\n]*?\s-\s([^\n]*?)\s-\s/);
        if (!m) continue;
        out.push({ ms: Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1])), sender: m[4].trim() });
    }
    return out;
}

/** Today's calendar date in the client's timezone, as a UTC-midnight ms (date-only, like the lines). */
function todayMsInTimezone(now, timezone) {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || undefined, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
    } catch (e) {
        parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
    }
    const get = (type) => Number((parts.find(p => p.type === type) || {}).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'));
}

function ddmmyyToMs(str) {
    const m = String(str || '').match(/^(\d{2})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

/**
 * Decide whether this send should cease follow-ups. Pure - no Airtable.
 *
 * @param {Object} params
 * @param {string} params.notes            the lead's Notes BEFORE this capture was merged in
 * @param {Array}  params.newMessages      parsed messages from the incoming capture ({date, time, sender, message})
 * @param {string} params.clientFirstName  the coach's first name (senders are matched by name)
 * @param {string} params.leadFirstName    the lead's first name
 * @param {boolean} params.alreadyCeased
 * @param {string} [params.timezone]       client's IANA timezone
 * @param {Date}   [params.now]
 * @returns {{cease: boolean, reason: string, quietDays?: number, ceaseAtIso?: string}}
 */
function evaluateReconnectAutoCease({ notes, newMessages, clientFirstName, leadFirstName, alreadyCeased, timezone, now = new Date() }) {
    if (alreadyCeased) return { cease: false, reason: 'already ceased' };

    const clientFirst = String(clientFirstName || '').trim().toLowerCase();
    const leadFirst = String(leadFirstName || '').trim().toLowerCase();
    // Senders are matched by first name; with either name missing, or the coach and the lead
    // sharing one, direction cannot be told apart - never cease on a guess.
    if (!clientFirst || !leadFirst || clientFirst === leadFirst) return { cease: false, reason: 'names unusable for direction' };

    // The newest message in this capture must be the COACH's, dated TODAY. Coach's: a capture
    // whose last word is the lead's is a reply landing, the opposite of a goodbye. Today's: the
    // extension also snapshots threads on OPEN, and without the date gate merely opening a quiet
    // old thread would read as "the coach just sent the reconnect" and cease them unsent.
    const todayMs = todayMsInTimezone(now, timezone);
    const msgs = (newMessages || []).filter(m => m && m.sender);
    if (!msgs.length) return { cease: false, reason: 'no parsed messages' };
    let newest = msgs[0];
    for (const m of msgs) {
        const ms = ddmmyyToMs(m.date);
        const nms = ddmmyyToMs(newest.date);
        if (ms !== null && (nms === null || ms >= nms)) newest = m; // ties: later in scrape order wins
    }
    if (!String(newest.sender).toLowerCase().includes(clientFirst)) return { cease: false, reason: 'newest message is not the coach\'s' };
    if (ddmmyyToMs(newest.date) !== todayMs) return { cease: false, reason: 'newest message is not from today - nothing was just sent' };

    // They must have genuinely replied at least once. Connection acceptances never become message
    // lines, so any stored inbound line is a real reply.
    const li = parseSectionLines(getSection(String(notes || ''), 'linkedin'));
    const everReplied = li.some(l => l.sender.toLowerCase().includes(leadFirst));
    if (!everReplied) return { cease: false, reason: 'they never replied' };

    // No meeting ever held - a meeting on record makes them a post-call relationship, not this
    // cohort. Meeting evidence = a meeting-notes section or a Fathom recording block.
    if (/===\s*MEETING NOTES\s*===/i.test(notes) || /\[Recorded\s/i.test(notes)) {
        return { cease: false, reason: 'meeting on record' };
    }

    // Quiet 4+ weeks in EITHER direction before this send, across LinkedIn and email history.
    let lastMs = li.reduce((acc, l) => Math.max(acc, l.ms), 0);
    const emailNewest = ddmmyyToMs(extractNewestDate(getSection(String(notes || ''), 'email')));
    if (emailNewest) lastMs = Math.max(lastMs, emailNewest);
    if (!lastMs) return { cease: false, reason: 'no dated history' };
    const quietDays = Math.floor((todayMs - lastMs) / 86400000);
    if (quietDays < QUIET_DAYS_MIN) return { cease: false, reason: `only ${quietDays} days quiet` };

    // Last millisecond of the previous day, client calendar (see header).
    return { cease: true, reason: 'warm reply, no meeting, gone quiet', quietDays, ceaseAtIso: new Date(todayMs - 1).toISOString() };
}

module.exports = { evaluateReconnectAutoCease, QUIET_DAYS_MIN };
