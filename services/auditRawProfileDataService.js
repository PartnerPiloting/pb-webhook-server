/**
 * Audit Airtable "Raw Profile Data" for JSON parse health (no AI).
 * Used by scripts/audit-raw-profile-data-json.js and GET /admin/audit-raw-profile-json.
 */

const { getClientBase } = require('../config/airtableClient');
const clientService = require('./clientService');
const { LEAD_FIELDS } = require('../constants/airtableUnifiedConstants');

const LEADS_TABLE = 'Leads';
const RAW_FIELD = LEAD_FIELDS.RAW_PROFILE_DATA;

/**
 * Classify one raw field value.
 * @returns {{ ok: boolean, category: string, detail?: string, charLen: number, doubleParse?: boolean }}
 */
function analyzeRawProfileValue(raw) {
  const str = raw == null ? '' : typeof raw === 'string' ? raw : String(raw);
  const charLen = str.length;
  const trimmed = str.trim();
  if (!trimmed) {
    return { ok: false, category: 'empty_after_trim', detail: null, charLen };
  }

  let first;
  try {
    first = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      category: 'json_parse_error',
      detail: (e && e.message) || String(e),
      charLen,
    };
  }

  const t = first === null ? 'null' : Array.isArray(first) ? 'array' : typeof first;

  if (t === 'string') {
    const inner = first.trim();
    if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
      try {
        JSON.parse(inner);
        return {
          ok: true,
          category: 'json_string_wrapping_json',
          detail: 'Outer JSON is a string; inner parses (possible double-encoding in the past)',
          charLen,
          doubleParse: true,
        };
      } catch {
        return {
          ok: false,
          category: 'json_string_invalid_inner',
          detail: 'Outer value is JSON string that looks like JSON but inner parse failed',
          charLen,
        };
      }
    }
    return { ok: true, category: 'json_primitive_string', detail: null, charLen };
  }

  if (t === 'object') {
    return { ok: true, category: 'json_object', detail: null, charLen };
  }
  if (t === 'array') {
    return { ok: true, category: 'json_array', detail: null, charLen };
  }
  return { ok: true, category: `json_primitive_${t}`, detail: null, charLen };
}

function percentile(sortedLens, p) {
  if (!sortedLens.length) return 0;
  const i = Math.min(sortedLens.length - 1, Math.floor((p / 100) * sortedLens.length));
  return sortedLens[i];
}

/**
 * @param {Object} opts
 * @param {string} [opts.clientId]
 * @param {number} [opts.limit] max records to scan
 * @param {number} [opts.pageSize] Airtable page size (max 100)
 * @param {number} [opts.sampleErrors] max error samples in result
 */
async function runRawProfileDataAudit({
  clientId = 'Guy-Wilson',
  limit = 1000,
  pageSize = 100,
  sampleErrors = 25,
}) {
  const lim = Math.max(1, Math.min(5000, Number(limit) || 1000));
  const pg = Math.min(100, Math.max(1, Number(pageSize) || 100));
  const errCap = Math.max(0, Math.min(100, Number(sampleErrors) || 25));

  const client = await clientService.getClientById(clientId);
  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  const base = await getClientBase(clientId);
  const formula = `LEN(TRIM({${RAW_FIELD}} & "")) > 0`;

  const stats = {
    scanned: 0,
    parse_ok: 0,
    parse_fail: 0,
    byCategory: {},
    charLens: [],
    errors: [],
  };

  let stopPaging = false;

  await new Promise((resolve, reject) => {
    base(LEADS_TABLE)
      .select({
        filterByFormula: formula,
        pageSize: pg,
        fields: [
          RAW_FIELD,
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
                if (stopPaging || stats.scanned >= lim) {
                  stopPaging = true;
                  resolve();
                  return;
                }

                stats.scanned++;
                const raw = rec.get(RAW_FIELD);
                const r = analyzeRawProfileValue(raw);
                stats.charLens.push(r.charLen);
                stats.byCategory[r.category] = (stats.byCategory[r.category] || 0) + 1;

                if (r.ok) {
                  stats.parse_ok++;
                } else {
                  stats.parse_fail++;
                  if (stats.errors.length < errCap) {
                    const name = `${rec.get(LEAD_FIELDS.FIRST_NAME) || ''} ${rec.get(LEAD_FIELDS.LAST_NAME) || ''}`.trim();
                    stats.errors.push({
                      id: rec.id,
                      url: rec.get(LEAD_FIELDS.LINKEDIN_PROFILE_URL) || '',
                      name,
                      category: r.category,
                      detail: r.detail,
                      charLen: r.charLen,
                    });
                  }
                }

                if (stats.scanned >= lim) {
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

  stats.charLens.sort((a, b) => a - b);

  return {
    success: true,
    clientId,
    clientName: client.clientName || '',
    baseId: client.airtableBaseId,
    limitRequested: lim,
    scanned: stats.scanned,
    parse_ok: stats.parse_ok,
    parse_fail: stats.parse_fail,
    fail_rate: stats.scanned ? stats.parse_fail / stats.scanned : 0,
    byCategory: stats.byCategory,
    charLen_min: stats.charLens[0] ?? 0,
    charLen_median: percentile(stats.charLens, 50),
    charLen_p95: percentile(stats.charLens, 95),
    charLen_max: stats.charLens[stats.charLens.length - 1] ?? 0,
    sample_errors: stats.errors,
  };
}

module.exports = {
  analyzeRawProfileValue,
  runRawProfileDataAudit,
  RAW_FIELD,
  LEADS_TABLE,
};
