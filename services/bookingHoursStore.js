/**
 * Each person's OWN booking hours - which days they take meetings, the earliest and latest START
 * time on each, the gap they want between meetings, and how many in a day is the limit.
 *
 * WHY (David Gould, 10 Nov 2026): every client's time offers came from one set of code defaults -
 * Guy's (10:00-4:30 weekdays, no gap, 4 a day as a preference). David takes calls at 5:30pm on
 * Mon/Tue/Thu only, never Fridays, weekends 8:30-5, with a 60-minute gap and at most 3 a day. He
 * kept being offered Friday mornings, and nothing anywhere could hold his hours. The setup page's
 * "earliest time" boxes only changed the WORDING of drafts; the code that picks times never read them.
 *
 * One row per person (tenant_id = their client id). No row = the shared defaults, exactly as before.
 * The value is checked by normaliseBookingHours (config/wingguyBookingPrefs.js) on the way in AND
 * on the way out, so a bad row can only ever fall back to the defaults, never break an offer.
 *
 * House style: wingguyInboxStore.js - lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS, no migrations.
 * No DATABASE_URL means no overrides, and booking still works on the defaults.
 */

const { Pool } = require('pg');

const CACHE_MS = 60 * 1000;

let pool;
let schemaEnsured = false;
let testPool = null;
const cache = new Map(); // tenant -> { at, value }

function getPool() {
  if (testPool) return testPool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
  return pool;
}

function __setTestPool(fake) { testPool = fake; schemaEnsured = false; cache.clear(); }

async function ensureSchema(db) {
  if (schemaEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wingguy_booking_hours (
      tenant_id  TEXT        PRIMARY KEY,
      hours      JSONB       NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

/** The person's saved hours (raw JSON), or null. Never throws - a read failure means "defaults". */
async function getBookingHours(tenantId) {
  const key = String(tenantId || '').trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const db = getPool();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const r = await db.query('SELECT hours FROM wingguy_booking_hours WHERE tenant_id = $1', [key]);
    const value = r.rows.length ? r.rows[0].hours : null;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.warn(`[bookingHoursStore] read failed for ${key}: ${e.message} - using the defaults`);
    return null;
  }
}

async function setBookingHours(tenantId, hours) {
  const key = String(tenantId || '').trim();
  if (!key) throw new Error('no client id');
  const db = getPool();
  if (!db) throw new Error('no database here, so booking hours cannot be kept');
  await ensureSchema(db);
  await db.query(
    `INSERT INTO wingguy_booking_hours (tenant_id, hours, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET hours = EXCLUDED.hours, updated_at = now()`,
    [key, JSON.stringify(hours)]);
  cache.set(key, { at: Date.now(), value: hours });
  return hours;
}

/** Back to the shared defaults. Returns true when there was something to clear. */
async function clearBookingHours(tenantId) {
  const key = String(tenantId || '').trim();
  const db = getPool();
  if (!db) throw new Error('no database here');
  await ensureSchema(db);
  const r = await db.query('DELETE FROM wingguy_booking_hours WHERE tenant_id = $1', [key]);
  cache.set(key, { at: Date.now(), value: null });
  return r.rowCount > 0;
}

module.exports = { getBookingHours, setBookingHours, clearBookingHours, __setTestPool };
