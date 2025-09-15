// utils/airtableFieldScriptGen.js
// Generates an Airtable Scripting app script to add missing fields to a table per a manifest.
const fs = require('fs');
const path = require('path');

const TYPE_MAP = {
  singleLineText: { type: 'singleLineText' },
  longText: { type: 'multilineText' },
  dateTime: { type: 'dateTime' },
  number: { type: 'number', options: { precision: 0 } },
  checkbox: { type: 'checkbox', options: { color: 'greenBright' } },
  singleSelect: (opts) => ({ type: 'singleSelect', options: { choices: (opts?.choices||[]).map(n=>({name:n})) } }),
  multipleSelect: (opts) => ({ type: 'multipleSelects', options: { choices: (opts?.choices||[]).map(n=>({name:n})) } })
};

function fieldTypeToScript(fieldDef) {
  const base = TYPE_MAP[fieldDef.type];
  if (!base) return null;
  if (typeof base === 'function') return JSON.stringify(base(fieldDef.options));
  return JSON.stringify(base);
}

function generateScript(tableName, fields) {
  const lines = [];
  lines.push("// Paste this into the Airtable Scripting app for the target base");
  lines.push("// It will add any missing fields on table: " + tableName);
  lines.push("const table = base.getTable(\"" + tableName.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + "\");");
  lines.push("const existing = new Set(table.fields.map(f=>f.name));");
  lines.push("async function ensureField(name, config){ if(!existing.has(name)){ await table.createFieldAsync(name, config.type, config.options); output.markdown(`✅ Created field **${name}**`); } else { output.markdown(`➖ Field **${name}** already exists`); } }");
  lines.push("output.markdown('### Field creation results');");
  for (const f of fields) {
    const cfg = fieldTypeToScript(f);
    if (!cfg) continue;
    lines.push(`await ensureField(${JSON.stringify(f.name)}, ${cfg});`);
  }
  return lines.join('\n');
}

function loadManifest() {
  const p = path.join(__dirname, '..', 'schema', 'airtable.schema.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function buildScriptFor(tableName) {
  const manifest = loadManifest();
  const table = manifest.tables?.[tableName];
  if (!table) throw new Error(`Table not found in manifest: ${tableName}`);
  return generateScript(tableName, table.fields || []);
}

module.exports = { buildScriptFor };
