/**
 * services/lhMessageNotes.js
 *
 * Linked Helper messages -> the lead's Notes (=== LINKEDIN MESSAGES === section).
 *
 * WHY THIS EXISTS
 * The only thing that ever wrote a LinkedIn conversation into Notes was the Chrome extension,
 * which snapshots a thread when the HUMAN clicks Send. A message Linked Helper sends on its own
 * therefore reached nothing: the follow-up sweep works out "when did I last contact this person"
 * by reading Notes, so every lead an LH campaign had messaged still looked untouched, and the
 * lead's history showed a conversation that never happened. This closes that hole.
 *
 * HOW LH FEEDS IT
 * Put a "Send person to webhook" action straight after a messaging action in the campaign and LH
 * includes the message it just sent in the payload (last_received_message_* = what the profile
 * received FROM the client; last_sent_message_* = their reply, via the Send replied to Webhook
 * plug-in on Check for replies). Messaging history export is a PRO-licence feature - on a standard
 * licence those fields simply never arrive and this module does nothing, which is also what
 * happens for every campaign that has no webhook step after its message action. Nothing to
 * switch on, nothing to break.
 *
 * DIRECTION IS READ FROM THE NAME, NOT THE FIELD
 * LH's own docs describe the last_sent_/last_received_ pair inconsistently, so we never infer
 * direction from which field a message arrived in - the "_from" name is written into the line as
 * the sender and that is all the Notes format needs. The fallback (when LH sends no name) is the
 * only place direction matters, hence `fallbackSender` below.
 *
 * SAFETY
 * - MERGE, never replace: the section is rebuilt from existing + new, sorted newest-first, with
 *   duplicate lines dropped (mergeAndSortMessages). The extension's full-thread capture can then
 *   overwrite the section later without losing anything - its scrape contains the LH message too.
 * - A message whose text is already in the section is skipped, so a webhook retry, or a thread the
 *   extension already captured, cannot double-post it. Duplicated history would make the follow-up
 *   engine misjudge cadence, which is worse than missing the line entirely.
 * - Every failure here is swallowed by the caller: filing a message must never fail a lead upsert.
 */

const { getSection, updateSection, mergeAndSortMessages, normalizeMessageText } = require('../utils/notesSectionManager');

const NOTES_FIELD = 'Notes';
const LEADS_TABLE = 'Leads';

// The message fields LH sends. `fallbackSender` is used ONLY when LH omits the "_from" name:
// 'me' = the client (their outbound), 'lead' = the person they are talking to.
const MESSAGE_FIELD_SETS = [
    { from: 'last_received_message_from', text: 'last_received_message_text', at: 'last_received_message_send_at', fallbackSender: 'me' },
    { from: 'last_sent_message_from', text: 'last_sent_message_text', at: 'last_sent_message_send_at', fallbackSender: 'lead' },
];

/** Cheap pre-check so a payload with no messaging history costs nothing. */
function payloadHasMessages(lh) {
    if (!lh || typeof lh !== 'object') return false;
    return MESSAGE_FIELD_SETS.some(set => String(lh[set.text] || '').trim());
}

/**
 * Parse whatever LH puts in a *_send_at field. Seen as ISO strings and as epoch numbers; a
 * 10-digit number is seconds, 13 is milliseconds.
 * @returns {Date|null} null when it cannot be read as a date
 */
function parseSendAt(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number' || /^\d+$/.test(String(raw).trim())) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return null;
        const ms = n < 1e12 ? n * 1000 : n;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date as the Notes line stamp: DD-MM-YY H:MM AM.
 * Rendered in the client's own timezone so the conversation reads in their local time, matching
 * what the extension writes.
 */
function formatStamp(date, timeZone) {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || undefined,
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: 'numeric', minute: '2-digit', hour12: true,
        }).formatToParts(date);
    } catch (e) {
        // Unknown timezone string on the client record - fall back to server local time.
        parts = new Intl.DateTimeFormat('en-GB', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: 'numeric', minute: '2-digit', hour12: true,
        }).formatToParts(date);
    }
    const get = (type) => (parts.find(p => p.type === type) || {}).value || '';
    const dayPeriod = get('dayPeriod').toUpperCase().replace(/\./g, '');
    return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')} ${dayPeriod}`;
}

/** Notes lines are one per message, so a multi-line body is flattened. */
function flattenText(text) {
    return String(text || '').replace(/\s*\r?\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** Comparison key for "have we already got this message?" - text only, timestamps vary by source. */
function textKey(text) {
    return flattenText(text).toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 120);
}

/**
 * Build the Notes lines for whatever messages a payload carries.
 * @param {Object} lh          one lead object from the LH webhook payload
 * @param {Object} opts        { clientName, timezone, leadName, now }
 * @returns {Array<{line: string, key: string, usedFallbackTime: boolean}>}
 */
function buildMessageLines(lh, opts = {}) {
    const { clientName = '', timezone = null, leadName = '', now = new Date() } = opts;
    const meName = String(lh.my_full_name || clientName || 'Me').trim();
    const themName = String(leadName || [lh.firstName || lh.first_name, lh.lastName || lh.last_name].filter(Boolean).join(' ')).trim() || 'Them';

    const lines = [];
    const seen = new Set();
    for (const set of MESSAGE_FIELD_SETS) {
        const text = flattenText(lh[set.text]);
        if (!text) continue;

        const key = textKey(text);
        if (seen.has(key)) continue; // LH can echo the same message in both pairs
        seen.add(key);

        const sender = String(lh[set.from] || '').trim() || (set.fallbackSender === 'me' ? meName : themName);
        const at = parseSendAt(lh[set.at]);
        // No readable timestamp: stamp it now. The webhook fires within seconds of the send, so
        // "now" is close enough to keep cadence honest - and a message missing from the history
        // entirely is worse than one dated a few seconds late.
        lines.push({
            line: `${formatStamp(at || now, timezone)} - ${sender} - ${text}`,
            key,
            norm: normalizeMessageText(text),
            usedFallbackTime: !at,
        });
    }
    return lines;
}

/**
 * Merge new message lines into an existing LINKEDIN MESSAGES section.
 * Pure - no Airtable - so it can be tested directly.
 * @returns {{notes: string, added: number, skipped: number}}
 */
function applyMessageLinesToNotes(currentNotes, messageLines) {
    const notes = String(currentNotes || '');
    const existing = getSection(notes, 'linkedin');
    const existingNorms = existing.split(/\r?\n/).map(l => normalizeMessageText(l)).filter(Boolean);

    // "Already there" means the section holds the SAME text or a LONGER version of it. A shorter
    // stored copy is a clipped record (e.g. a scrape that read a collapsed "…see more" bubble) -
    // the full text must go through as fresh so the merge below retires the clipped line. The old
    // 60-char-prefix containment check judged the full copy "already present" against its own
    // clip, which made every clip permanent (the 24 Jul 2026 mid-sentence message).
    const fresh = messageLines.filter(m => m.norm && !existingNorms.some(nl => nl === m.norm || nl.startsWith(m.norm)));
    if (fresh.length === 0) {
        return { notes, added: 0, skipped: messageLines.length };
    }

    const merged = mergeAndSortMessages(existing, fresh.map(m => m.line).join('\n'), true);
    const result = updateSection(notes, 'linkedin', merged, { replace: true });
    return { notes: result.notes, added: fresh.length, skipped: messageLines.length - fresh.length };
}

/**
 * File any messages carried by an LH payload onto the lead's record.
 * Never throws - the caller's upsert must not fail because a message could not be filed.
 *
 * @param {Object} params
 * @param {Object} params.base       client-specific Airtable base
 * @param {string} params.recordId   lead record id (returned by upsertLead)
 * @param {Object} params.lh         the LH payload for this lead
 * @param {string} [params.clientName]
 * @param {string} [params.timezone] client's IANA timezone
 * @param {Object} [params.log]
 * @returns {Promise<{added: number, skipped: number}>}
 */
async function recordLhMessages({ base, recordId, lh, clientName, timezone, log }) {
    const noop = { info: () => {}, warn: () => {}, debug: () => {} };
    const logger = log || noop;
    if (!base || !recordId || !payloadHasMessages(lh)) return { added: 0, skipped: 0 };

    try {
        const record = await base(LEADS_TABLE).find(recordId);
        const currentNotes = record.get(NOTES_FIELD) || '';
        const leadName = [record.get('First Name'), record.get('Last Name')].filter(Boolean).join(' ');

        const messageLines = buildMessageLines(lh, { clientName, timezone, leadName });
        if (messageLines.length === 0) return { added: 0, skipped: 0 };

        const { notes, added, skipped } = applyMessageLinesToNotes(currentNotes, messageLines);
        if (added === 0) {
            logger.debug(`LH message already in Notes for ${recordId} - nothing written`);
            return { added: 0, skipped };
        }

        await base(LEADS_TABLE).update(recordId, { [NOTES_FIELD]: notes });
        const undated = messageLines.filter(m => m.usedFallbackTime).length;
        logger.info(`Filed ${added} LH message(s) into Notes for ${recordId}${skipped ? ` (${skipped} already present)` : ''}${undated ? ` - ${undated} had no readable send time` : ''}`);
        return { added, skipped };
    } catch (e) {
        logger.warn(`Could not file LH message into Notes for ${recordId}: ${e.message}`);
        return { added: 0, skipped: 0 };
    }
}

module.exports = {
    recordLhMessages,
    // exported for tests
    payloadHasMessages,
    parseSendAt,
    formatStamp,
    buildMessageLines,
    applyMessageLinesToNotes,
};
