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

/** Optional exact record list (Airtable RECORD_ID). Max 30. */
function buildOesFilterFormula(rescoreAll, recordIds) {
  const hasRaw = `LEN(TRIM({${RAW_FIELD}} & "")) > 0`;
  if (Array.isArray(recordIds) && recordIds.length > 0) {
    const safeIds = recordIds
      .slice(0, 30)
      .map((id) => String(id).trim())
      .filter((id) => /^rec[a-zA-Z0-9]+$/.test(id));
    if (safeIds.length === 0) {
      return filterFormula(rescoreAll);
    }
    const idClauses = safeIds.map((id) => `RECORD_ID()='${id}'`).join(', ');
    let f = `AND(${hasRaw}, OR(${idClauses}))`;
    if (!rescoreAll) {
      f = `AND(${f}, OR({${OES_FIELD}} = BLANK()))`;
    }
    return f;
  }
  return filterFormula(rescoreAll);
}

/**
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {number} [opts.limit] max leads to score (attempts); default Infinity
 * @param {boolean} [opts.apply] write to Airtable
 * @param {boolean} [opts.rescoreAll] score even when OES already set
 * @param {number} [opts.pageSize]
 * @param {number} [opts.delayMs] ms after each lead
 * @param {boolean} [opts.collectResults] if true, include `results` array (id, label, score, …)
 * @param {boolean} [opts.quick] if true, shorter Gemini timeout + fewer 429 retries (better for HTTP / curl)
 * @param {'rules'|'ai'} [opts.oesMode] scoring engine; default rules unless OES_USE_AI=true
 * @param {string[]} [opts.recordIds] optional Airtable record IDs to score (exact set)
 * @returns {Promise<{ processed: number, scored: number, failed: number, skippedEmpty: number, clientId: string, baseId: string, formula: string, results?: Array }>}
 */
async function runOutboundEmailScoringBatch({
  clientId,
  limit = Number.POSITIVE_INFINITY,
  apply = false,
  rescoreAll = false,
  pageSize = 50,
  delayMs = 400,
  collectResults = false,
  quick = false,
  oesMode,
  recordIds,
}) {
  const lim = Number(limit);
  const useLimit = Number.isFinite(lim) && lim > 0;
  const maxProcessed = useLimit ? lim : Number.POSITIVE_INFINITY;

  const scoreOpts = {
    ...(quick ? { timeoutMs: 55000, max429Attempts: 2 } : {}),
    ...(oesMode === 'ai' || oesMode === 'rules' ? { oesMode } : {}),
  };
  const passScoreOpts = Object.keys(scoreOpts).length > 0 ? scoreOpts : undefined;

  const resolvedOesMode =
    oesMode === 'ai' || oesMode === 'rules'
      ? oesMode
      : process.env.OES_USE_AI === 'true' || process.env.OES_USE_AI === '1'
        ? 'ai'
        : 'rules';

  const client = await clientService.getClientById(clientId);
  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  const base = await getClientBase(clientId);
  const formula = buildOesFilterFormula(rescoreAll, recordIds);

  const results = [];
  const scoringFailures = [];

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
                  const result = await scoreRawProfileForOes(raw, passScoreOpts);
                  if (!result.ok) {
                    failed++;
                    console.warn(`FAIL ${rec.id} (${label}): ${result.error}`);
                    if (collectResults) {
                      scoringFailures.push({
                        id: rec.id,
                        label,
                        error: result.error || 'unknown',
                      });
                    }
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
                    if (collectResults) {
                      results.push({
                        id: rec.id,
                        label,
                        score: result.score,
                        classification: result.classification,
                        linkedinUrl: rec.get(LEAD_FIELDS.LINKEDIN_PROFILE_URL) || '',
                        written: !!apply,
                        ...(result.breakdown ? { breakdown: result.breakdown } : {}),
                      });
                    }
                  }
                } catch (e) {
                  failed++;
                  const msg = e && e.message ? e.message : String(e);
                  console.warn(`EXC ${rec.id} (${label}): ${msg}`);
                  if (collectResults) {
                    scoringFailures.push({
                      id: rec.id,
                      label,
                      error: msg,
                    });
                  }
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

  const out = {
    processed,
    scored,
    failed,
    skippedEmpty,
    clientId,
    baseId: client.airtableBaseId,
    formula,
    apply,
    rescoreAll,
    quick: !!quick,
    oesMode: resolvedOesMode,
    ...(Array.isArray(recordIds) && recordIds.length ? { recordIdsRequested: recordIds.length } : {}),
  };
  if (collectResults) {
    out.results = results;
    out.scoringFailures = scoringFailures;
  }
  return out;
}

module.exports = {
  runOutboundEmailScoringBatch,
  filterFormula,
  buildOesFilterFormula,
  LEADS_TABLE,
  OES_FIELD,
  RAW_FIELD,
};
