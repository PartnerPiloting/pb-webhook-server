// services/clientBaseBuilder.js
//
// Creates a new client Airtable base from the version-controlled schema
// (config/clientBaseSchema.json) and seeds its config rows
// (config/clientBaseSeeds.json). This is the importable port of
// scripts/create-client-base.js (first used for Paul Salvage, 2026-08-25),
// so the join provisioning chain (stage 4) can call it in-process.
//
// Since 2026-09-04 the schema carries no field the API cannot create as a
// primary (LinkedIn Profile URL is the Leads primary; Profile Key, Date Created
// and Posts Relevance Status are gone - the server no longer reads them), so a
// join should produce a finished base with manualSteps empty. The fallback
// below stays as a safety net.
//
// Computed fields (formula, createdTime) may not be creatable through the
// API. Strategy: try the full schema first; if the API refuses, create the
// base without them (a computed primary becomes a plain-text placeholder)
// and then try adding each computed field individually; whatever still
// fails comes back in manualSteps for a human.
//
// Env: AIRTABLE_API_KEY (needs schema.bases:write + workspace creator role).

const API = 'https://api.airtable.com/v0';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { ok: res.ok, status: res.status, json, text };
}

function fieldForCreate(f) {
  const out = { name: f.name, type: f.type };
  if (f.options) out.options = f.options;
  return out;
}

function tablesPayload(schema, includeComputed) {
  return schema.tables.map((t) => {
    const fields = [];
    t.fields.forEach((f, idx) => {
      if (!f.computed) { fields.push(fieldForCreate(f)); return; }
      if (includeComputed) { fields.push(fieldForCreate(f)); return; }
      // Excluding computed fields - but the FIRST field is the table's primary
      // and must exist, so a computed primary becomes a text placeholder.
      if (idx === 0) fields.push({ name: f.name, type: 'singleLineText' });
    });
    return { name: t.name, fields };
  });
}

/**
 * Create "My Leads - <clientName>" in the given workspace.
 * Returns { ok, baseId, tableIds, manualSteps, seedWarnings } or { ok: false, error }.
 * Never throws.
 */
async function createClientBase({ clientName, workspaceId }) {
  try {
    if (!process.env.AIRTABLE_API_KEY) return { ok: false, error: 'AIRTABLE_API_KEY not set' };
    if (!clientName || !workspaceId) return { ok: false, error: 'clientName and workspaceId are required' };

    const schema = require('../config/clientBaseSchema.json');
    const seeds = require('../config/clientBaseSeeds.json');
    const baseName = `My Leads - ${clientName}`;
    const manualSteps = [];
    const seedWarnings = [];

    let created = await call('POST', `${API}/meta/bases`, {
      name: baseName, workspaceId, tables: tablesPayload(schema, true),
    });
    let computedViaApi = true;
    if (!created.ok) {
      computedViaApi = false;
      created = await call('POST', `${API}/meta/bases`, {
        name: baseName, workspaceId, tables: tablesPayload(schema, false),
      });
    }
    if (!created.ok) {
      return { ok: false, error: `Base creation failed (${created.status}): ${created.text.slice(0, 500)}` };
    }
    const baseId = created.json.id;
    const tableIds = {};
    created.json.tables.forEach((t) => { tableIds[t.name] = t.id; });

    if (!computedViaApi) {
      for (const t of schema.tables) {
        for (const [idx, f] of t.fields.entries()) {
          if (!f.computed) continue;
          if (idx === 0) {
            manualSteps.push(`Table "${t.name}", field "${f.name}": convert the placeholder text field to a FORMULA in the Airtable UI. Formula: ${(f.options && f.options.formula) || '(created time)'}`);
            continue;
          }
          const add = await call('POST', `${API}/meta/bases/${baseId}/tables/${tableIds[t.name]}/fields`, fieldForCreate(f));
          if (!add.ok) {
            manualSteps.push(`Table "${t.name}": create field "${f.name}" (${f.type}) in the Airtable UI.${f.type === 'formula' ? ` Formula: ${f.options.formula}` : ''}`);
          }
        }
      }
    }

    for (const [tableName, rows] of Object.entries(seeds)) {
      if (tableName.startsWith('//')) continue;
      for (let i = 0; i < rows.length; i += 10) {
        const batch = rows.slice(i, i + 10).map((f) => ({ fields: f }));
        const res = await call('POST', `${API}/${baseId}/${encodeURIComponent(tableName)}`, {
          records: batch, typecast: true,
        });
        if (!res.ok) {
          seedWarnings.push(`Seeding ${tableName} rows ${i}-${i + batch.length - 1} failed: ${res.text.slice(0, 300)}`);
        }
      }
    }

    return { ok: true, baseId, baseName, tableIds, manualSteps, seedWarnings };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

module.exports = { createClientBase };
