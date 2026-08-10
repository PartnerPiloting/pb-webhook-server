/**
 * Measure how widespread LinkedIn-message clipping is in the synced Notes copies. READ-ONLY.
 *
 * Ground truth: every LH webhook stores its unmodified payload on the lead ({Profile Full JSON} /
 * {Raw Profile Data}), including the full text of the last sent/received message. If the Notes
 * copy of that same message is SHORTER than the payload copy, the record is clipped - "the record
 * ended there", not "the message ended there". (Observed 2026-08-10: a 24 Jul message complete on
 * LinkedIn was stored cut mid-sentence, and the dossier invented an apology for it.)
 *
 * LIMITATION: the payload only carries the LATEST message in each direction, so this samples the
 * newest messages per lead rather than whole threads. There is no fuller ground truth on record -
 * treat the reported rate as a floor estimate for older history.
 *
 * Usage (server environment - run via Render one-off job, not locally):
 *   node scripts/scan-clipped-linkedin-messages.js                    # all clients
 *   node scripts/scan-clipped-linkedin-messages.js --client=Guy-Wilson
 *   node scripts/scan-clipped-linkedin-messages.js --examples=20      # show more clipped examples
 *
 * Prerequisites: AIRTABLE_API_KEY, MASTER_CLIENTS_BASE_ID
 */

require('dotenv').config();
const Airtable = require('airtable');
const { getSection, normalizeMessageText } = require('../utils/notesSectionManager');

const MASTER_TABLE = 'Clients';
const LEADS_TABLE = 'Leads';
const BASE_ID_FIELD = 'Airtable Base ID';
const CLIENT_ID_FIELD = 'Client ID';

// A prefix shorter than this can't distinguish "same message clipped" from "two messages that
// open the same way" - mirrors CLIP_MIN_PREFIX in notesSectionManager.mergeAndSortMessages.
const MIN_COMPARE = 60;

const MESSAGE_TEXT_FIELDS = ['last_received_message_text', 'last_sent_message_text'];

const argClient = (process.argv.find(a => a.startsWith('--client=')) || '').split('=')[1] || null;
const maxExamples = parseInt((process.argv.find(a => a.startsWith('--examples=')) || '').split('=')[1], 10) || 10;

function normPayloadText(text) {
    // Same normalisation the Notes lines get, applied to raw payload text (no stamp to strip).
    return String(text || '').replace(/\s*\r?\n\s*/g, ' ').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function scanClient(apiKey, client) {
    const base = new Airtable({ apiKey }).base(client.baseId);
    const stats = {
        clientId: client.clientId, leads: 0, leadsWithSection: 0, leadsWithPayloadMsg: 0,
        compared: 0, intact: 0, clipped: 0, missing: 0, unparseable: 0, examples: [],
    };

    await base(LEADS_TABLE).select({
        fields: ['First Name', 'Last Name', 'Notes', 'Profile Full JSON', 'Raw Profile Data', 'LinkedIn Profile URL'],
        pageSize: 100,
    }).eachPage((records, next) => {
        for (const rec of records) {
            stats.leads++;
            const notes = rec.get('Notes') || '';
            const section = getSection(notes, 'linkedin');
            if (section) stats.leadsWithSection++;

            const rawJson = rec.get('Profile Full JSON') || rec.get('Raw Profile Data') || '';
            if (!rawJson) continue;
            let lh;
            try { lh = JSON.parse(rawJson); } catch (e) { stats.unparseable++; continue; }

            const lineNorms = section ? section.split(/\r?\n/).map(l => normalizeMessageText(l)).filter(Boolean) : [];
            let leadHadMsg = false;

            for (const field of MESSAGE_TEXT_FIELDS) {
                const full = normPayloadText(lh[field]);
                if (full.length < MIN_COMPARE) continue; // absent or too short to judge
                leadHadMsg = true;
                stats.compared++;

                const prefix = full.slice(0, MIN_COMPARE);
                const match = lineNorms.find(nl => nl.startsWith(prefix) || (nl.length >= MIN_COMPARE && full.startsWith(nl.slice(0, MIN_COMPARE))));
                if (!match) {
                    stats.missing++;
                } else if (match.length >= full.length || match === full) {
                    stats.intact++;
                } else if (full.startsWith(match)) {
                    stats.clipped++;
                    if (stats.examples.length < maxExamples) {
                        const name = [rec.get('First Name'), rec.get('Last Name')].filter(Boolean).join(' ') || rec.id;
                        stats.examples.push({
                            lead: name,
                            url: rec.get('LinkedIn Profile URL') || '',
                            storedChars: match.length,
                            fullChars: full.length,
                            opening: String(lh[field]).slice(0, 90).replace(/\s+/g, ' '),
                        });
                    }
                } else {
                    // Shares a 60-char prefix but diverges after - edited/re-sent message; count as intact.
                    stats.intact++;
                }
            }
            if (leadHadMsg) stats.leadsWithPayloadMsg++;
        }
        next();
    });
    return stats;
}

(async () => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const masterBaseId = process.env.MASTER_CLIENTS_BASE_ID;
    if (!apiKey || !masterBaseId) {
        console.error('Need AIRTABLE_API_KEY and MASTER_CLIENTS_BASE_ID');
        process.exit(1);
    }

    const master = new Airtable({ apiKey }).base(masterBaseId);
    const clients = [];
    await master(MASTER_TABLE).select({ fields: [CLIENT_ID_FIELD, BASE_ID_FIELD] }).eachPage((records, next) => {
        for (const rec of records) {
            const clientId = rec.get(CLIENT_ID_FIELD);
            const baseId = rec.get(BASE_ID_FIELD);
            if (clientId && baseId && (!argClient || clientId === argClient)) clients.push({ clientId, baseId });
        }
        next();
    });
    if (!clients.length) {
        console.error(argClient ? `No client matched --client=${argClient}` : 'No clients found');
        process.exit(1);
    }

    let totCompared = 0, totClipped = 0, totMissing = 0;
    for (const client of clients) {
        try {
            const s = await scanClient(apiKey, client);
            totCompared += s.compared; totClipped += s.clipped; totMissing += s.missing;
            const pct = s.compared ? ((s.clipped / s.compared) * 100).toFixed(1) : '0.0';
            console.log(`\n=== ${s.clientId} ===`);
            console.log(`Leads: ${s.leads} | with LinkedIn section: ${s.leadsWithSection} | with payload message >= ${MIN_COMPARE} chars: ${s.leadsWithPayloadMsg}${s.unparseable ? ` | unparseable payloads: ${s.unparseable}` : ''}`);
            console.log(`Messages compared: ${s.compared} | intact: ${s.intact} | CLIPPED: ${s.clipped} (${pct}%) | not in Notes at all: ${s.missing}`);
            for (const ex of s.examples) {
                console.log(`  CLIPPED ${ex.lead} (${ex.url}) stored ${ex.storedChars} of ${ex.fullChars} chars: "${ex.opening}..."`);
            }
        } catch (e) {
            console.error(`\n=== ${client.clientId} === FAILED: ${e.message}`);
        }
    }
    const totPct = totCompared ? ((totClipped / totCompared) * 100).toFixed(1) : '0.0';
    console.log(`\n=== TOTAL === compared: ${totCompared} | clipped: ${totClipped} (${totPct}%) | missing from Notes: ${totMissing}`);
    console.log('Reminder: this samples each lead\'s LATEST message per direction (the only ground truth on record) - older history may be worse.');
})();
