/**
 * Wingguy selector store — where Wingguy keeps the list of things it looks for on a LinkedIn page.
 *
 * The problem this solves: the extension finds the name, the headline, the message box and so on by
 * matching CSS selectors ("landmarks"). Those landmarks were baked into content-wingguy.js, which
 * means they sat frozen on every client's laptop. When LinkedIn renamed one, Wingguy went looking for
 * something that no longer existed and came back empty — and the fix was a code change plus chasing
 * every client to reinstall. Serving them from here turns that into a row in Postgres.
 *
 * House style: recallWebhookDb.js / wingguyRulesStore.js (lazy Pool, ensureSchema CREATE-IF-NOT-EXISTS,
 * no migrations; tenant key = coach_client_id convention).
 *
 * Tables:
 *   wingguy_selectors        — append-only: one row per VERSION of a landmark. An edit inserts n+1 and
 *                              retires n, so "what did we change when LinkedIn moved, and what was it
 *                              before" is always answerable and a rollback is one insert.
 *   wingguy_selector_health  — what the extension found in the field. One row per landmark per check.
 *
 * Tenant semantics (deliberately built now, deliberately unused):
 *   tenant_id NULL  — the shared set, read by everyone. This is the only layer in use today.
 *   tenant_id set   — an override for ONE coach, shadowing the shared row for that key.
 * LinkedIn A/B-serves different markup to different accounts (already seen once — see the 2026-07-15
 * "typing /wg silently does nothing" note in content-wingguy.js), so the day one client is served new
 * markup ahead of the others, the override is there. Building the column costs nothing now and is
 * awkward to retrofit into an append-only table later.
 *
 * SAFETY: this store is an OVERRIDE layer, never the source of truth. content-wingguy.js ships with a
 * complete set of built-in defaults and falls back to them whenever this store is empty, unreachable,
 * or serving a key it doesn't recognise. A dead database degrades Wingguy to exactly today's
 * behaviour — it can never be the reason Wingguy stops working.
 */

const { Pool } = require('pg');

let pool;
let schemaEnsured = false;

/** The landmarks this store is allowed to override. A key outside this list is refused at the door
 *  rather than stored, so a typo in a fix can never quietly become a row nothing reads. Kept in step
 *  with SELECTOR_DEFAULTS in wingguy-extension/content-wingguy.js. */
const KNOWN_KEYS = [
  'profile_name',            // the person's name on an /in/ page
  'profile_headline',        // their headline under the name
  'profile_location',        // the location line
  'profile_top_card',        // the top-card container the name/headline are read from
  'profile_about_spans',     // the About copy inside the About section
  'profile_activity_anchor', // the Activity section (their recent posts) — anchor ids
  'profile_activity_items',  // the post-preview text inside the Activity section
  'convo_container',         // the conversation containers (bubble / pane / thread)
  'convo_header',            // the open thread's header, where the participant's name lives
  'message_group_name',      // "who said this" on a run of message bubbles
  'message_timestamp',       // the time on a message group
  'message_body',            // one message's text
  'message_group',           // the container for a run of bubbles from one sender
  'message_group_item',      // same, looser — a plain list row is an acceptable answer
  'message_item',            // one message row or a date heading in the thread list
  'message_item_row',        // one message row specifically (not a date heading)
  'message_time_heading',    // a date/time separator row in the thread list
  'message_surface',         // "is this editable inside the message area" — guards a wrong insert
  'message_send_surface',    // the surface a Send button must sit in to count as a send
  'bubble_open_composer',    // a floating bubble with its composer actually open
  'convo_pane',              // the pane a conversation sits in (full detail view or bubble)
  'convo_header_name',       // where the participant's name sits in a thread header
  'composer_box',            // LinkedIn's "Write a message…" box
  'thread_open_marker',      // how we tell a thread is open at all (drives the launcher)
];

/** Surfaces a landmark can be expected on. Used by the health read to tell a real miss ("the name
 *  vanished from a profile") apart from a landmark simply not applying ("no message body on a
 *  profile page") — the distinction that decides whether noise or a real alarm. */
const SURFACES = ['profile', 'messaging', 'other'];

const DEFAULT_TENANT = 'Guy-Wilson';

function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/** Test seam: inject a fake pool (unit tests never touch a real database). */
function __setTestPool(fake) {
  pool = fake;
  schemaEnsured = fake ? true : false;
}

async function ensureSchema(client) {
  if (schemaEnsured) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_selectors (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ,
      tenant_id TEXT,
      selector_key TEXT NOT NULL,
      selector_value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_by TEXT
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wingguy_selectors_active_idx
      ON wingguy_selectors (selector_key, tenant_id) WHERE retired_at IS NULL;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wingguy_selector_health (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id TEXT,
      selector_key TEXT NOT NULL,
      surface TEXT,
      found BOOLEAN NOT NULL,
      source TEXT,
      shape TEXT,
      extension_version TEXT
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS wingguy_selector_health_recent_idx
      ON wingguy_selector_health (created_at DESC);
  `);

  schemaEnsured = true;
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;                       // no DATABASE_URL — caller falls back to defaults
  const client = await p.connect();
  try {
    await ensureSchema(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * The live landmark set for one coach: the shared rows, with any of that coach's own overrides
 * shadowing them. Returns a plain { key: { value, version, tenant } } map, or null when there is no
 * database at all (which the caller must treat as "use the built-in defaults", not as an error).
 */
async function getSelectors({ tenantId } = {}) {
  const tenant = (tenantId || '').trim() || null;
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT selector_key, selector_value, version, tenant_id
         FROM wingguy_selectors
        WHERE retired_at IS NULL
          AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY tenant_id NULLS FIRST, id ASC`,
      [tenant]
    );
    // Shared rows land first; a tenant row for the same key overwrites it. That ordering IS the
    // shadowing rule — keep the ORDER BY and this loop together.
    const out = {};
    for (const r of rows) {
      out[r.selector_key] = {
        value: r.selector_value,
        version: r.version,
        tenant: r.tenant_id || null,
      };
    }
    return out;
  });
}

/**
 * Change one landmark. Append-only: retires the current active row for (key, tenant) and inserts the
 * next version. `note` is the why — "LinkedIn renamed the top card, 2026-08-05" — and is the thing
 * that makes the history readable a year later.
 */
async function setSelector({ key, value, note, tenantId, actor } = {}) {
  if (!KNOWN_KEYS.includes(key)) {
    throw new Error(`Unknown selector key "${key}". Known keys: ${KNOWN_KEYS.join(', ')}`);
  }
  const val = String(value || '').trim();
  if (!val) throw new Error('A selector value is required.');
  const tenant = (tenantId || '').trim() || null;

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const { rows: cur } = await client.query(
        `SELECT id, version FROM wingguy_selectors
          WHERE selector_key = $1 AND retired_at IS NULL
            AND tenant_id IS NOT DISTINCT FROM $2
          ORDER BY id DESC LIMIT 1`,
        [key, tenant]
      );
      const nextVersion = cur.length ? cur[0].version + 1 : 1;
      if (cur.length) {
        await client.query('UPDATE wingguy_selectors SET retired_at = now() WHERE id = $1', [cur[0].id]);
      }
      const { rows: ins } = await client.query(
        `INSERT INTO wingguy_selectors (tenant_id, selector_key, selector_value, version, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, version`,
        [tenant, key, val, nextVersion, note || null, actor || DEFAULT_TENANT]
      );
      await client.query('COMMIT');
      return { key, value: val, version: ins[0].version, tenant };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

/**
 * Drop an override and fall back to whatever sits behind it — the shared row for a tenant override,
 * or the extension's built-in default for a shared row. This is the rollback path when a fix of mine
 * turns out to be wrong: one call, no deploy, and the extension is back to known-good.
 */
async function retireSelector({ key, tenantId } = {}) {
  const tenant = (tenantId || '').trim() || null;
  return withClient(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE wingguy_selectors SET retired_at = now()
        WHERE selector_key = $1 AND retired_at IS NULL
          AND tenant_id IS NOT DISTINCT FROM $2`,
      [key, tenant]
    );
    return { key, tenant, retired: rowCount };
  });
}

/** Every version of one landmark, newest first — what it is now, what it was, and why it changed. */
async function getSelectorHistory({ key, limit = 20 } = {}) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT selector_key, selector_value, version, tenant_id, note, created_by, created_at, retired_at
         FROM wingguy_selectors
        WHERE ($1::text IS NULL OR selector_key = $1)
        ORDER BY id DESC LIMIT $2`,
      [key || null, Math.min(Number(limit) || 20, 200)]
    );
    return rows;
  });
}

/**
 * Record what the extension actually found in the field. Called from real client machines, so it is
 * deliberately cheap and deliberately incapable of failing loudly: a health write that throws must
 * never surface to the person using Wingguy.
 *
 * `shape` is the structural fingerprint of what sat where the landmark used to be — tag names and
 * class names only, no page text (see shapeOf in content-wingguy.js). It is what lets a fix be worked
 * out from the report alone, without needing to get onto LinkedIn.
 */
async function recordHealth({ tenantId, checks, extensionVersion } = {}) {
  const tenant = (tenantId || '').trim() || null;
  const list = Array.isArray(checks) ? checks.slice(0, 60) : [];
  if (!list.length) return { recorded: 0 };

  return withClient(async (client) => {
    let recorded = 0;
    for (const c of list) {
      if (!c || !KNOWN_KEYS.includes(c.key)) continue;   // ignore anything we don't recognise
      const surface = SURFACES.includes(c.surface) ? c.surface : 'other';
      await client.query(
        `INSERT INTO wingguy_selector_health
           (tenant_id, selector_key, surface, found, source, shape, extension_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenant,
          c.key,
          surface,
          !!c.found,
          c.source === 'server' ? 'server' : 'default',
          c.shape ? String(c.shape).slice(0, 2000) : null,
          extensionVersion ? String(extensionVersion).slice(0, 20) : null,
        ]
      );
      recorded += 1;
    }
    return { recorded };
  });
}

/**
 * What the field is reporting, grouped by landmark. This is the read I make when Guy says "is
 * anything broken" — misses over the window, which surfaces they were on, whose machine, and the most
 * recent shape sample for anything failing.
 *
 * NOTE ON READING THIS: a landmark showing misses is not automatically broken. Plenty of landmarks
 * legitimately miss (no message body on a profile page). The signal is a landmark that USED to be
 * found on a surface and now never is — which is why `firstSeen`/`lastFound` are here and why the
 * alerting thresholds are deliberately not built yet. They need real traffic to be worth anything.
 */
async function getHealthSummary({ hours = 48 } = {}) {
  const window = Math.min(Math.max(Number(hours) || 48, 1), 24 * 30);
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT selector_key,
              surface,
              COUNT(*)::int                                        AS checks,
              COUNT(*) FILTER (WHERE found)::int                   AS found,
              COUNT(*) FILTER (WHERE NOT found)::int               AS missed,
              COUNT(DISTINCT tenant_id)::int                       AS machines,
              MIN(created_at)                                      AS first_seen,
              MAX(created_at) FILTER (WHERE found)                 AS last_found,
              MAX(created_at) FILTER (WHERE NOT found)             AS last_missed,
              (ARRAY_AGG(source ORDER BY created_at DESC))[1]      AS latest_source,
              (ARRAY_AGG(shape ORDER BY created_at DESC)
                 FILTER (WHERE NOT found AND shape IS NOT NULL))[1] AS latest_miss_shape
         FROM wingguy_selector_health
        WHERE created_at > now() - ($1 || ' hours')::interval
        GROUP BY selector_key, surface
        ORDER BY missed DESC, selector_key ASC`,
      [String(window)]
    );
    return rows;
  });
}

module.exports = {
  getSelectors,
  setSelector,
  retireSelector,
  getSelectorHistory,
  recordHealth,
  getHealthSummary,
  KNOWN_KEYS,
  SURFACES,
  __setTestPool,
};
