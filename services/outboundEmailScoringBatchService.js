/**
 * Batch score Leads "Outbound Email Score" from "Raw Profile Data" (Gemini).
 * Used by scripts/score-outbound-email-readiness.js and scripts/score-oes-unscored.js.
 */

const { getClientBase } = require('../config/airtableClient');
const clientService = require('./clientService');
const { LEAD_FIELDS } = require('../constants/airtableUnifiedConstants');
const { scoreRawProfileForOes } = require('./outboundEmailScoreService');

const LEADS_TABLE = 'Leads';
const OES_FIELD = LEAD_FIELDS.OUTBOUND_EMAIL_SCORE;
const RAW_FIELD = LEAD_FIELDS.RAW_PROFILE_DATA;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function filterFormula(rescoreAll) {
  const hasRaw = `LEN(TRIM({${RAW_FIELD}} & "")) > 0`;
  if (rescoreAll) {
    return hasRaw;
  }
  return `AND(${hasRaw}, OR({${OES_FIELD}} = BLANK()))`;
}

/**
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {number} [opts.limit] max leads to score (attempts); default Infinity
 * @param {boolean} [opts.apply] write to Airtable
 * @param {boolean} [opts.rescoreAll] score even when OES already set
 * @param {number} [opts.pageSize]
 * @param {number} [opts.delayMs] ms after each lead
 * @returns {Promise<{ processed: number, scored: number, failed: number, skippedEmpty: number, clientId: string, baseId: string, formula: string }>}
 */
async function runOutboundEmailScoringBatch({
  clientId,
  limit = Number.POSITIVE_INFINITY,
  apply = false,
  rescoreAll = false,
  pageSize = 50,
  delayMs = 400,
}) {
  const lim = Number(limit);
  const useLimit = Number.isFinite(lim) && lim > 0;
  const maxProcessed = useLimit ? lim : Number.POSITIVE_INFINITY;

  const client = await clientService.getClientById(clientId);
  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  const base = await getClientBase(clientId);
  const formula = filterFormula(rescoreAll);

  let processed = 0;
  let scored = 0;
  let failed = 0;
  let skippedEmpty = 0;
  let stopPaging = false;

  await new Promise((resolve, reject) => {
    base(LEADS_TABLE)
      .select({
        filterByFormula: formula,
        pageSize: Math.min(100, Math.max(1, pageSize)),
        fields: [
          RAW_FIELD,
          OES_FIELD,
          LEAD_FIELDS.LINKEDIN_PROFILE_URL,
          LEAD_FIELDS.FIRST_NAME,
          LEAD_FIELDS.LAST_NAME,
        ],
      })
      .eachPage(
        (records, fetchNextPage) => {
          (async () => {
            try {
              for (const rec of records) {
                if (stopPaging || processed >= maxProcessed) {
                  stopPaging = true;
                  resolve();
                  return;
                }

                const raw = rec.get(RAW_FIELD);
                if (raw == null || String(raw).trim() === '') {
                  skippedEmpty++;
                  continue;
                }

                processed++;
                const label =
                  `${rec.get(LEAD_FIELDS.FIRST_NAME) || ''} ${rec.get(LEAD_FIELDS.LAST_NAME) || ''}`.trim() ||
                  rec.get(LEAD_FIELDS.LINKEDIN_PROFILE_URL) ||
                  rec.id;

                try {
                  const result = await scoreRawProfileForOes(raw);
                  if (!result.ok) {
                    failed++;
                    console.warn(`FAIL ${rec.id} (${label}): ${result.error}`);
                  } else {
                    scored++;
                    const prev = rec.get(OES_FIELD);
                    console.log(
                      `${apply ? 'SET' : 'WOULD'} ${rec.id} (${label}): OES ${result.score} [${result.classification}] was:${prev === undefined ? 'blank' : prev}`
                    );
                    if (apply) {
                      await base(LEADS_TABLE).update([
                        { id: rec.id, fields: { [OES_FIELD]: result.score } },
                      ]);
                    }
                  }
                } catch (e) {
                  failed++;
                  console.warn(`EXC ${rec.id} (${label}): ${e && e.message ? e.message : e}`);
                }

                await sleep(Math.max(0, delayMs));

                if (processed >= maxProcessed) {
                  stopPaging = true;
                  resolve();
                  return;
                }
              }
              if (!stopPaging) fetchNextPage();
            } catch (e) {
              reject(e);
            }
          })();
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
  });

  return {
    processed,
    scored,
    failed,
    skippedEmpty,
    clientId,
    baseId: client.airtableBaseId,
    formula,
    apply,
    rescoreAll,
  };
}

module.exports = {
  runOutboundEmailScoringBatch,
  filterFormula,
  LEADS_TABLE,
  OES_FIELD,
  RAW_FIELD,
};
