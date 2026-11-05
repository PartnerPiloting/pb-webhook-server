/**
 * captureDateGuard - the save-time check on the dates in a LinkedIn conversation capture.
 *
 * The browser extension reads a conversation off LinkedIn's page when the coach presses Send and
 * the server merges it into the lead's Notes. For four months (July - 4 Nov 2026) a message whose
 * day label the extension failed to read was saved under the previous day's date, silently: Craig
 * Carolan's reply on 4 Nov sat on his record as 19 Oct, the inbox check said it had not arrived,
 * and nobody was told. Nothing here can stop LinkedIn changing its page again; what this does is
 * make sure the first time a capture's dates look wrong, Guy hears about it that day instead of
 * finding out by accident months later.
 *
 * Pure: takes the parsed messages and the merged section text, returns a list of problems. The
 * route decides what to do with them (log + one email to the coach per lead per day).
 */

const DDMMYY = /^(\d{2})-(\d{2})-(\d{2})$/;

function stampToDate(ddmmyy, time) {
    const m = String(ddmmyy || '').match(DDMMYY);
    if (!m) return null;
    let hours = 0, minutes = 0;
    const t = String(time || '').match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (t) {
        hours = parseInt(t[1], 10) % 12;
        if (t[3] && t[3].toUpperCase() === 'PM') hours += 12;
        minutes = parseInt(t[2], 10);
    }
    return new Date(2000 + parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), hours, minutes);
}

/** DD-MM-YY for a Date (local fields). */
function toStamp(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${String(d.getFullYear()).slice(-2)}`;
}

/**
 * Check one capture.
 * @param {Object} args
 * @param {Array<{date:string,time:string,sender:string,message:string}>} args.messages - this
 *        capture's parsed messages (the parser's `messages`, any order)
 * @param {Date} args.today - today in the coach's own timezone (the route already works this out)
 * @param {string} [args.mergedSection] - the LinkedIn section as it will be saved
 * @param {boolean} [args.justSent=true] - the capture ran because the coach pressed Send, so the
 *        newest message is today's. Pass false for saves that are not on-send.
 * @returns {Array<{code:string, detail:string}>} problems, empty when the capture looks right
 */
function checkCaptureDates({ messages, today, mergedSection = '', justSent = true } = {}) {
    const problems = [];
    const list = Array.isArray(messages) ? messages : [];
    const now = today instanceof Date && !isNaN(today.getTime()) ? today : new Date();
    const todayStamp = toStamp(now);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dated = list
        .map((m) => ({ m, when: stampToDate(m.date, m.time) }))
        .filter((x) => x.when);

    // 1. Nothing may be dated after today.
    const future = dated.filter((x) => x.when.getTime() >= todayStart.getTime() + 86400000);
    if (future.length) {
        const f = future[0].m;
        problems.push({ code: 'future_date', detail: `"${clip(f.message)}" is stamped ${f.date} ${f.time}, which is after today (${todayStamp}).` });
    }

    // 2. On a Send capture the newest message is the one just sent, so it must carry today's date.
    //    This is the exact shape of the Craig Carolan miss: a label not read, the newest message
    //    filed weeks back.
    if (justSent && dated.length) {
        const newest = dated.reduce((a, b) => (b.when.getTime() > a.when.getTime() ? b : a));
        if (newest.m.date !== todayStamp) {
            problems.push({
                code: 'newest_not_today',
                detail: `The newest message in this capture ("${clip(newest.m.message)}") is stamped ${newest.m.date}, but it was captured today (${todayStamp}) when Send was pressed. The extension probably missed LinkedIn's day label above it.`,
            });
        }
    }

    // 3. The same message must not sit on the record under two dates.
    const section = String(mergedSection || '');
    if (section) {
        const seen = new Map();
        for (const line of section.split('\n')) {
            const m = line.match(/^(\d{2}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(.*?)\s*-\s*(.+)$/i);
            if (!m) continue;
            const key = `${m[2].toUpperCase().replace(/\s+/g, ' ')}|${m[4].toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()}`;
            const prior = seen.get(key);
            if (prior && prior !== m[1]) {
                problems.push({ code: 'same_message_two_dates', detail: `"${clip(m[4])}" is on the record as both ${prior} and ${m[1]}.` });
                break;
            }
            if (!prior) seen.set(key, m[1]);
        }
    }

    return problems;
}

/**
 * dropForgedToday - refuse a "sent today" date the server can tell is false.
 *
 * Extension 0.3.38 and 0.3.39 stamp the newest message Today (0.3.38 on every save, including a
 * thread merely being opened) and always claim the save was made on Send. Ashley Knowles opened a
 * thread whose newest message was his own from 4 Feb; it was saved as "05-11-26 9:55 AM", Wingguy
 * refused to draft his reconnect because he had "messaged this morning", and the lead was
 * auto-ceased as if he had just sent the reconnect (5 Nov 2026). A client can sit on an old
 * extension for weeks, so the record is protected here, where every save passes.
 *
 * Only the newest message is ever looked at, only when it is the coach's own and dated today, and
 * only on a save from an extension that cannot prove a send (`suspect`). Then:
 *   1. The record already holds the same message under an OLDER date -> it is an old message.
 *      Drop the incoming copy; the record keeps the real date.
 *   2. The record already holds it under today's date -> nothing to do.
 *   3. Never seen before -> believe it only if its clock time is within a few minutes of now (a
 *      message just sent shows the time it was sent). Otherwise drop it: a date known to be
 *      unproven is not stored. The message is saved the next time it is captured honestly.
 *
 * Pure. `now` is the current time in the coach's own timezone.
 * @returns {{content:string, action:'none'|'dropped', reason?:string, dropped?:{date,time,sender,text}}}
 */
const FORMATTED_LINE = /^(\d{2}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+-\s+(.*?)\s+-\s+(.+)$/i;
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clock = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const TWIN_MIN_CHARS = 40;          // below this, two different messages can share their whole text ("Yes", "Thanks!")
const JUST_SENT_BEFORE_MIN = 15;    // a just-sent message's clock time is at most this far behind now
const JUST_SENT_AFTER_MIN = 2;      // ...or this far ahead (clock skew between LinkedIn and the server)

function dropForgedToday({ incoming, existingSection = '', coachName = '', now, suspect = false } = {}) {
    const none = { content: incoming, action: 'none' };
    const coach = squash(coachName);
    if (!suspect || !incoming || !coach) return none;
    const at = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    const todayStamp = toStamp(at);

    const lines = String(incoming).split('\n');
    let newest = null;
    lines.forEach((line, index) => {
        const m = line.trim().match(FORMATTED_LINE);
        if (!m) return;
        const when = stampToDate(m[1], m[2]);
        if (when && (!newest || when.getTime() > newest.when.getTime())) newest = { index, when, date: m[1], time: m[2], sender: m[3], text: m[4] };
    });
    if (!newest || newest.date !== todayStamp) return none;
    const sender = squash(newest.sender);
    if (!(sender === coach || sender.startsWith(coach) || coach.startsWith(sender))) return none;

    const text = squash(newest.text);
    let onFileToday = false, onFileOlder = '';
    for (const line of String(existingSection || '').split('\n')) {
        const m = line.trim().match(FORMATTED_LINE);
        if (!m || squash(m[4]) !== text) continue;
        if (!(clock(m[2]) === clock(newest.time) || text.length >= TWIN_MIN_CHARS)) continue;
        if (m[1] === todayStamp) onFileToday = true; else if (!onFileOlder) onFileOlder = m[1];
    }

    const drop = (reason) => ({
        content: lines.filter((_, i) => i !== newest.index).join('\n'),
        action: 'dropped',
        reason,
        dropped: { date: newest.date, time: newest.time, sender: newest.sender, text: newest.text },
    });
    if (onFileOlder) return drop(`already on the record dated ${onFileOlder}`);
    if (onFileToday) return none;
    const minutesBehind = (at.getTime() - newest.when.getTime()) / 60000;
    if (minutesBehind <= JUST_SENT_BEFORE_MIN && minutesBehind >= -JUST_SENT_AFTER_MIN) return none;
    return drop(`stamped today ${newest.time} but saved at ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} - not a message just sent`);
}

/** Does a parsed message (the parser's {date,time,sender,message}) match a dropped line? */
function isDroppedMessage(msg, dropped) {
    if (!msg || !dropped) return false;
    return msg.date === dropped.date && clock(msg.time) === clock(dropped.time) && squash(msg.message) === squash(dropped.text);
}

function clip(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

/**
 * The plain-English email to the coach. One per lead per day; the route throttles.
 */
function captureAlertEmail({ leadName, clientName, problems, portalUrl }) {
    const who = leadName || 'a lead';
    const lines = [
        `Wingguy just saved a LinkedIn conversation with ${who}${clientName ? ` (${clientName}'s account)` : ''}, and the dates on it look wrong:`,
        '',
        ...problems.map((p) => `- ${p.detail}`),
        '',
        'What this usually means: the browser extension reads the day labels LinkedIn shows above each day\'s messages ("Today", "Oct 19"). When it cannot read one, a message is saved under the previous day\'s date. That is what happened to Craig Carolan\'s record on 4 Nov 2026 and went unnoticed for four months, which is why this email exists.',
        '',
        'What to do:',
        `1. Open ${who}'s record${portalUrl ? ` (${portalUrl})` : ''} and check the dates on the newest LinkedIn messages against LinkedIn.`,
        '2. If they are wrong, LinkedIn has probably changed how it labels days - the extension needs a look. The browser console on the LinkedIn tab shows "[Wingguy] thread day labels" with what it read.',
        '3. The record is still safe to fix by hand in the meantime.',
        '',
        'You will get at most one of these per lead per day.',
    ];
    return {
        subject: `Wingguy: dates on ${who}'s conversation look wrong`,
        text: lines.join('\n'),
        html: `<pre style="font-family:inherit;white-space:pre-wrap">${lines.map(escapeHtml).join('\n')}</pre>`,
    };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// One email per lead per day. In-memory is enough: a single server instance, and a repeat the
// next day is wanted (the problem is still there).
const _alerted = new Map();
function shouldAlert(key, now = Date.now()) {
    if (_alerted.has(key) && now - _alerted.get(key) < 24 * 60 * 60 * 1000) return false;
    _alerted.set(key, now);
    return true;
}
function resetAlertThrottle() { _alerted.clear(); }

module.exports = { checkCaptureDates, captureAlertEmail, shouldAlert, resetAlertThrottle, toStamp, dropForgedToday, isDroppedMessage };
