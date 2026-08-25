#!/usr/bin/env node
/**
 * scripts/create-client-base.js
 *
 * Creates a new client Airtable base from the version-controlled schema
 * (config/clientBaseSchema.json) and seeds its config rows
 * (config/clientBaseSeeds.json) - the replacement for hand-duplicating
 * "My Leads - Client Template". Stripe cutover stage 4 component; first used
 * for Paul Salvage, 2026-08-25.
 *
 * Usage:
 *   node scripts/create-client-base.js --name "Paul Salvage" --workspace wspXXXXXXXXXXXX [--dry-run]
 *
 * Env: AIRTABLE_API_KEY (needs schema.bases:write + workspace creator role).
 *
 * Computed fields (formula, createdTime) may not be creatable through the
 * API. Strategy: try the full schema first; if the API refuses, create the
 * base without them (primary formula field becomes a plain-text placeholder)
 * and then try adding each computed field individually; whatever still fails
 * is printed as a short manual to-do with paste-ready formulas.
 */

const fs = require('fs');
const path = require('path');

const API = 'https://api.airtable.com/v0';
const KEY = process.env.AIRTABLE_API_KEY;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}
const DRY = process.argv.includes('--dry-run');
const clientName = arg('name');
const workspaceId = arg('workspace');

if (!KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }
if (!clientName || !workspaceId) {
  console.error('Usage: node scripts/create-client-base.js --name "First Last" --workspace wspXXXXXXXXXXXX [--dry-run]');
  process.exit(1);
}

const schema = require('../config/clientBaseSchema.json');
const seeds = require('../config/clientBaseSeeds.json');
const baseName = `My Leads - ${clientName}`;

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
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

function tablesPayload(includeComputed) {
  return schema.tables.map(t => {
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

async function main() {
  console.log(`Creating "${baseName}" in workspace ${workspaceId}${DRY ? ' (DRY RUN)' : ''}`);
  const manual = [];

  if (DRY) {
    const p = tablesPayload(true);
    p.forEach(t => console.log(`  would create table ${t.name} with ${t.fields.length} fields`));
    return;
  }

  // --- 1. Create the base: full schema first, fallback without computed fields
  let created = await call('POST', `${API}/meta/bases`, {
    name: baseName, workspaceId, tables: tablesPayload(true)
  });
  let computedViaApi = true;
  if (!created.ok) {
    console.log(`Full-schema create refused (${created.status}): ${created.text.slice(0, 300)}`);
    console.log('Retrying without computed fields...');
    computedViaApi = false;
    created = await call('POST', `${API}/meta/bases`, {
      name: baseName, workspaceId, tables: tablesPayload(false)
    });
  }
  if (!created.ok) {
    console.error(`Base creation failed (${created.status}): ${created.text.slice(0, 500)}`);
    process.exit(1);
  }
  const baseId = created.json.id;
  const tableIds = {};
  created.json.tables.forEach(t => { tableIds[t.name] = t.id; });
  console.log(`\n✅ Base created: ${baseId}`);
  Object.entries(tableIds).forEach(([n, id]) => console.log(`   ${n}: ${id}`));

  // --- 2. If computed fields were excluded, try adding each individually
  if (!computedViaApi) {
    for (const t of schema.tables) {
      for (const [idx, f] of t.fields.entries()) {
        if (!f.computed) continue;
        if (idx === 0) {
          manual.push(`Table "${t.name}", field "${f.name}": convert the placeholder text field to a FORMULA in the Airtable UI. Formula:\n${f.options?.formula || '(created time)'}`);
          continue;
        }
        const add = await call('POST', `${API}/meta/bases/${baseId}/tables/${tableIds[t.name]}/fields`, fieldForCreate(f));
        if (add.ok) {
          console.log(`   ➕ computed field created via API after all: ${t.name}.${f.name}`);
        } else {
          manual.push(`Table "${t.name}": create field "${f.name}" (${f.type}) in the Airtable UI.` +
            (f.type === 'formula' ? ` Formula:\n${f.options.formula}` : ''));
        }
      }
    }
  }

  // --- 3. Seed config rows (batches of 10, typecast for select options)
  for (const [tableName, rows] of Object.entries(seeds)) {
    if (tableName.startsWith('//')) continue;
    for (let i = 0; i < rows.length; i += 10) {
      const batch = rows.slice(i, i + 10).map(f => ({ fields: f }));
      const res = await call('POST', `${API}/${baseId}/${encodeURIComponent(tableName)}`, {
        records: batch, typecast: true
      });
      if (!res.ok) {
        console.error(`   ⚠ seeding ${tableName} rows ${i}-${i + batch.length - 1} failed: ${res.text.slice(0, 300)}`);
      }
    }
    console.log(`   🌱 seeded ${rows.length} row(s) into ${tableName}`);
  }

  // --- 4. Report
  console.log(`\nBase ready: ${baseName} (${baseId})`);
  if (manual.length) {
    console.log(`\n⚠ ${manual.length} manual step(s) the API could not do:\n`);
    manual.forEach((m, i) => console.log(`${i + 1}. ${m}\n`));
  } else {
    console.log('No manual steps - the API did everything.');
  }
  console.log(`Next: onboard the client with this base id, e.g. via POST /api/onboard-client.`);
}

main().catch(e => { console.error(e); process.exit(1); });
