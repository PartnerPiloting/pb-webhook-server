/**
 * Shared logic: backfill Airtable Leads {Email} from profile_url + email export (CSV/XLSX).
 * Used by scripts/backfill-lead-emails-from-csv.js and POST /admin/backfill-lead-emails.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const fetch = require('node-fetch');
const { getClientBase } = require('../config/airtableClient');
const clientService = require('./clientService');
const { normalizeLinkedInUrl } = require('../utils/pbPostsSync');

const LEADS_TABLE = 'Leads';
const LINKEDIN_FIELD = 'LinkedIn Profile URL';
const EMAIL_FIELD = 'Email';

const BLANK_EMAIL_FORMULA = `AND(OR({${EMAIL_FIELD}} = BLANK(), {${EMAIL_FIELD}} = ""), LEN(TRIM({${LINKEDIN_FIELD}} & "")) > 0)`;

function rowUrlEmail(row) {
  const lower = {};
  for (const [k, v] of Object.entries(row)) {
    lower[String(k).trim().toLowerCase()] = v;
  }
  const url = String(lower.profile_url || lower['linkedin url'] || lower['linkedin profile url'] || '').trim();
  const email = String(lower.email || '').trim();
  return { url, email };
}

function mapFromRows(rows, warnings) {
  const map = new Map();
  const w = warnings || [];
  for (const row of rows) {
    const { url, email } = rowUrlEmail(row);
    if (!url || !email || !email.includes('@')) continue;
    const norm = normalizeLinkedInUrl(url);
    if (!norm) continue;
    if (map.has(norm) && map.get(norm).toLowerCase() !== email.toLowerCase()) {
      w.push(`Duplicate profile_url with different emails (using last): ${norm}`);
    }
    map.set(norm, email.trim());
  }
  return { map, warnings: w };
}

function parseXlsxBuffer(buf) {
  const warnings = [];
  const wb = XLSX.read(buf, { type: 'buffer' });
  const name = wb.SheetNames[0];
  if (!name) return { map: new Map(), warnings: ['Workbook has no sheets'] };
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return mapFromRows(rows, warnings);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsvText(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { map: new Map(), warnings: ['CSV is empty'] };

  const header = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const urlIdx = header.findIndex((h) => h === 'profile_url' || h === 'linkedin url' || h === 'linkedin profile url');
  const emailIdx = header.findIndex((h) => h === 'email');
  const warnings = [];
  if (urlIdx < 0 || emailIdx < 0) {
    warnings.push(`Expected header columns profile_url and email; got: ${header.join(', ')}`);
  }

  const map = new Map();
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    let url;
    let email;
    if (urlIdx >= 0 && emailIdx >= 0) {
      const cells = splitCsvLine(line);
      url = (cells[urlIdx] || '').trim().replace(/^"|"$/g, '');
      email = (cells[emailIdx] || '').trim().replace(/^"|"$/g, '').replace(/""/g, '"');
    } else {
      const firstComma = line.indexOf(',');
      if (firstComma < 0) continue;
      url = line.slice(0, firstComma).trim().replace(/^"|"$/g, '');
      email = line.slice(firstComma + 1).trim().replace(/^"|"$/g, '').replace(/""/g, '"');
    }
    if (!url || !email || !email.includes('@')) continue;
    const norm = normalizeLinkedInUrl(url);
    if (!norm) continue;
    if (map.has(norm) && map.get(norm).toLowerCase() !== email.toLowerCase()) {
      warnings.push(`Duplicate profile_url with different emails (using last): ${norm}`);
    }
    map.set(norm, email.trim());
  }
  return { map, warnings };
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName filename for extension hint
 */
function buildEmailMapFromBuffer(buffer, originalName = '') {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    return parseXlsxBuffer(buffer);
  }
  return parseCsvText(buffer.toString('utf8'));
}

function buildEmailMapFromFilePath(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === '.xlsx' || ext === '.xls') {
    return parseXlsxBuffer(buf);
  }
  return parseCsvText(buf.toString('utf8'));
}

async function buildEmailMapFromPublicCsvUrl(sheetUrl) {
  const res = await fetch(sheetUrl, { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || text.trim().startsWith('<!')) {
    throw new Error(
      'URL did not return CSV (publish the sheet or upload a file).'
    );
  }
  return parseCsvText(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {Map<string,string>} opts.urlToEmail normalized LinkedIn path -> email
 * @param {string[]} [opts.parserWarnings]
 * @param {boolean} [opts.apply]
 * @param {number} [opts.previewMax]
 * @param {number} [opts.maxUpdates] cap when apply (default: all matches)
 * @param {number} [opts.pageSize]
 */
async function runBackfillLeadEmails({
  clientId,
  urlToEmail,
  parserWarnings = [],
  apply = false,
  previewMax = 20,
  maxUpdates = Number.POSITIVE_INFINITY,
  pageSize = 100,
}) {
  if (!urlToEmail || urlToEmail.size === 0) {
    return {
      clientId,
      clientName: null,
      airtableBaseId: null,
      exportRowsWithEmail: 0,
      matchedLeads: 0,
      preview: [],
      previewTruncated: false,
      apply: false,
      applied: 0,
      warnings: [...parserWarnings, 'No rows in export with profile_url + email'],
    };
  }

  const client = await clientService.getClientById(clientId);
  if (!client) {
    throw new Error(`Client not found in Master: ${clientId}`);
  }

  const base = await getClientBase(clientId);
  const toUpdate = [];
  const seenIds = new Set();

  await base(LEADS_TABLE)
    .select({
      filterByFormula: BLANK_EMAIL_FORMULA,
      pageSize: Math.min(100, Math.max(1, pageSize)),
      fields: [LINKEDIN_FIELD, EMAIL_FIELD],
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        const rawUrl = rec.get(LINKEDIN_FIELD);
        const norm = normalizeLinkedInUrl(rawUrl);
        if (!norm) continue;
        const email = urlToEmail.get(norm);
        if (!email) continue;
        const current = rec.get(EMAIL_FIELD);
        if (current != null && String(current).trim() !== '') continue;
        if (seenIds.has(rec.id)) continue;
        seenIds.add(rec.id);
        toUpdate.push({ id: rec.id, email, norm, url: rawUrl });
      }
      fetchNextPage();
    });

  const preview = toUpdate.slice(0, previewMax).map((row) => ({
    id: row.id,
    norm: row.norm,
    email: row.email,
  }));

  let applied = 0;
  const cap =
    Number.isFinite(maxUpdates) && maxUpdates > 0
      ? Math.min(maxUpdates, toUpdate.length)
      : toUpdate.length;
  const capped = apply ? toUpdate.slice(0, cap) : [];

  if (apply && capped.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < capped.length; i += batchSize) {
      const chunk = capped.slice(i, i + batchSize).map((row) => ({
        id: row.id,
        fields: { [EMAIL_FIELD]: row.email },
      }));
      await base(LEADS_TABLE).update(chunk);
      applied += chunk.length;
      await sleep(220);
    }
  }

  return {
    clientId,
    clientName: client.clientName || '',
    airtableBaseId: client.airtableBaseId,
    exportRowsWithEmail: urlToEmail.size,
    matchedLeads: toUpdate.length,
    preview,
    previewTruncated: toUpdate.length > preview.length,
    apply,
    applied,
    maxUpdatesPlanned: apply ? cap : 0,
    warnings: [...parserWarnings],
  };
}

module.exports = {
  LEADS_TABLE,
  LINKEDIN_FIELD,
  EMAIL_FIELD,
  BLANK_EMAIL_FORMULA,
  buildEmailMapFromBuffer,
  buildEmailMapFromFilePath,
  buildEmailMapFromPublicCsvUrl,
  runBackfillLeadEmails,
};
