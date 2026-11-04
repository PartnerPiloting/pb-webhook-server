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

module.exports = { checkCaptureDates, captureAlertEmail, shouldAlert, resetAlertThrottle, toStamp };
