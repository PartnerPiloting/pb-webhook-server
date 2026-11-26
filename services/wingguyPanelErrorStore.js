/**
 * What really went wrong when the LinkedIn panel could not get a draft (26 Nov 2026).
 *
 * WHY: Dean Hobin's panel said "Wingguy lost its link to your browser for a moment" on every try
 * from 23 Nov - four tries in a row on 25 Nov - and not one of his draft requests reached this
 * server. The panel shows the client a calm sentence, and the browser's own error words, and how
 * far the request got, were thrown away. Nobody could tell where it broke without getting onto his
 * laptop.
 *
 * Now the extension writes down each step of a draft request (panel asked -> extension received ->
 * extension called the server -> what came back) and, when one fails, sends that trail here. It is
 * a fault report, not tracking: no lead names, no message text - the step, the error words, the
 * extension and Chrome versions.
 *
 * Read it with: SELECT * FROM wingguy_panel_errors ORDER BY created_at DESC;
 *
 * House style: wingguyChatJobStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations).
 * Never throws: a fault report that fails must never become a second fault.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;
const memory = []; // newest last, capped - for tests and a database hiccup
const MEMORY_CAP = 200;
const CAP = 2000; // any one text field

function getPool() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureSchema(db) {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_panel_errors (
      id                 SERIAL PRIMARY KEY,
      tenant_id          TEXT NOT NULL,
      step               TEXT,
      error              TEXT,
      trace              JSONB,
      fallback           TEXT,
      extension_version  TEXT,
      user_agent         TEXT,
      happened_at        TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaEnsured = true;
}

const clip = (v, n = CAP) => (v == null ? null : String(v).slice(0, n));

/** Shape one report from the extension into a row. Exported for the test. */
function toRow(tenantId, r = {}) {
  let trace = null;
  if (r.trace && typeof r.trace === 'object') {
    try { trace = JSON.parse(JSON.stringify(r.trace).slice(0, CAP)); } catch (_) { trace = { note: 'trace too long' }; }
  }
  const t = Date.parse(r.at || '');
  return {
    tenantId: clip(tenantId, 100),
    step: clip(r.step, 100),
    error: clip(r.error),
    trace,
    fallback: clip(r.fallback, 100),
    extensionVersion: clip(r.extensionVersion, 20),
    userAgent: clip(r.userAgent, 400),
    happenedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
  };
}

/** Store up to 10 reports for this client. Returns { stored }. Never throws. */
async function record(tenantId, reports) {
  const list = (Array.isArray(reports) ? reports : [reports]).filter(Boolean).slice(0, 10);
  if (!tenantId || !list.length) return { stored: 0 };
  const rows = list.map((r) => toRow(tenantId, r));
  for (const row of rows) memory.push(row);
  while (memory.length > MEMORY_CAP) memory.shift();
  const db = getPool();
  if (!db) return { stored: rows.length };
  try {
    await ensureSchema(db);
    for (const row of rows) {
      await db.query(
        `INSERT INTO wingguy_panel_errors
           (tenant_id, step, error, trace, fallback, extension_version, user_agent, happened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.tenantId, row.step, row.error, row.trace ? JSON.stringify(row.trace) : null,
          row.fallback, row.extensionVersion, row.userAgent, row.happenedAt]
      );
    }
  } catch (_) { /* the memory copy stands */ }
  return { stored: rows.length };
}

module.exports = { record, toRow, _memory: memory };
