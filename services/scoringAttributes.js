/**
 * Scoring attributes - the read / check / write core behind the Wingguy scoring tools
 * (services/wingguyScoringMcp.js). Built 2026-10-05 from Dean Hobin's rebuild: a client hands over
 * a brief ("here's who I'm looking for"), the model drafts a whole set, the human sees exactly what
 * would change, and only then is it written - with a backup first.
 *
 * Deliberate limits (Guy's playbook, "YOUR SCORING ATTRIBUTES"):
 *   - FIXED SLOTS: only rows that already exist can change. No new rows, no deletes - an unwanted
 *     attribute is switched off (active=false) or repurposed.
 *   - A row's category (Positive / Negative) is fixed; the purpose row (PREAMBLE) is changed via
 *     `purpose`, never as a row. Step / Global Rule rows are ignored by the scorer and not editable.
 *   - The purpose row holds ONLY the client's purpose statement (since 13 Oct 2026). The scoring
 *     workflow is fixed in code (services/scoringWorkflow.js) and is refused here if someone tries
 *     to paste it back in.
 *
 * Field TYPES differ between bases: newer bases have Active / Bonus Points as checkboxes and
 * Disqualifying as a single select ("checked"); older ones (e.g. Dean's) have Active as a select
 * too. The type is read off the values already in the table, never assumed.
 */

const crypto = require('crypto');
const { looksLikeWorkflow } = require('./scoringWorkflow');
const campaignScope = require('./campaignScope');

const TABLE = process.env.ATTR_TABLE_NAME || 'Scoring Attributes';
const TEXT_MAX = 15000;
const POINTS_MAX = 50;

const truthy = (v) => v === true || (typeof v === 'string' && v.trim() !== '');

const PURPOSE_HAS_WORKFLOW = 'The purpose should say who the client is looking for and why - not how to score. The scoring workflow (disqualifier check, formula, bands) is fixed and added automatically, so leave it out.';

function normalize(rec) {
  const g = (f) => rec.get(f);
  return {
    recordId: rec.id,
    id: String(g('Attribute Id') || '').trim(),
    category: String((g('Category') && (g('Category').name || g('Category'))) || '').trim(),
    heading: String(g('Heading') || '').trim(),
    active: truthy(g('Active')),
    maxPoints: Number(g('Max Points') || 0),
    minToQualify: Number(g('Min To Qualify') || 0),
    penalty: Math.abs(Number(g('Penalty') || 0)),
    disqualifying: truthy(g('Disqualifying')),
    bonus: truthy(g('Bonus Points')),
    instructions: String(g('Instructions') || ''),
    examples: String(g('Examples') || ''),
    signals: String(g('Signals') || ''),
    // Campaign scope (services/campaignScope.js): 'all' | 'only' | 'except' + Linked Helper campaign IDs.
    ...scopeOf(g),
  };
}

function scopeOf(g) {
  const sc = campaignScope.scopeFromCells(g('Campaign Scope'), g('Scope Campaigns'));
  return { campaignScope: sc.mode, campaignIds: sc.ids };
}

const isPurpose = (r) => r.id.toUpperCase() === 'PREAMBLE' || r.category.toLowerCase() === 'meta';
const isScoring = (r) => /^(positive|negative)$/i.test(r.category);

/** How each yes/no field is stored in THIS base: 'checkbox' (true/false) or 'select' ("checked"). */
function fieldKinds(records) {
  const defaults = { 'Active': 'checkbox', 'Disqualifying': 'select', 'Bonus Points': 'checkbox' };
  const kinds = {};
  for (const f of Object.keys(defaults)) {
    let kind = null;
    for (const rec of records) {
      const v = rec.get(f);
      if (typeof v === 'string' && v !== '') { kind = 'select'; break; }
      if (v === true) { kind = 'checkbox'; break; }
    }
    kinds[f] = kind || defaults[f];
  }
  return kinds;
}

const yesNo = (kind, b) => (kind === 'select' ? (b ? 'checked' : null) : !!b);

async function readTable(base) {
  const records = await base(TABLE).select().all();
  return { records, rows: records.map(normalize).filter((r) => r.id), kinds: fieldKinds(records) };
}

/** Stable short hash of the current rows - commit refuses if the table moved since the proposal. */
function fingerprint(rows) {
  const stable = [...rows].sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 12);
}

// Proposal field (snake_case, as the tool receives it) -> normalized key.
const FIELD_MAP = {
  heading: 'heading', active: 'active', max_points: 'maxPoints', min_to_qualify: 'minToQualify',
  penalty: 'penalty', disqualifying: 'disqualifying', bonus: 'bonus',
  instructions: 'instructions', examples: 'examples', signals: 'signals',
  campaign_scope: 'campaignScope', campaign_ids: 'campaignIds',
};
const LABEL = {
  heading: 'Heading', active: 'Active', maxPoints: 'Max points', minToQualify: 'Min to qualify',
  penalty: 'Penalty', disqualifying: 'Disqualifying', bonus: 'Bonus', instructions: 'Instructions',
  examples: 'Examples', signals: 'Signals', campaignScope: 'Applies to', campaignIds: 'Campaigns',
};
const SCOPE_FIELDS = new Set(['campaignScope', 'campaignIds']);
const TEXT_FIELDS = new Set(['heading', 'instructions', 'examples', 'signals']);
const POSITIVE_ONLY = new Set(['maxPoints', 'minToQualify', 'bonus']);
const NEGATIVE_ONLY = new Set(['penalty', 'disqualifying']);

/**
 * Check a proposal against the current rows. Returns { errors, warnings, changes, after }:
 *   changes = [{ row, field, from, to }] (only real differences), after = rows as they would be.
 */
function checkProposal(rows, proposal = {}, ctx = {}) {
  // ctx.campaigns: the client's live Linked Helper campaigns [{id, name}] (services/lhCampaignList.js),
  // when known - only used to warn about a tag that matches no live campaign.
  const known = Array.isArray(ctx.campaigns) ? ctx.campaigns : null;
  const errors = [];
  const warnings = [];
  const changes = [];
  const after = rows.map((r) => ({ ...r }));
  const byId = new Map(after.map((r) => [r.id.toUpperCase(), r]));
  const seen = new Set();

  if (typeof proposal.purpose === 'string' && proposal.purpose.trim()) {
    const pre = after.find(isPurpose);
    if (!pre) errors.push('This table has no purpose (PREAMBLE) row to update.');
    else if (proposal.purpose.length > TEXT_MAX) errors.push(`The purpose text is too long (${proposal.purpose.length} characters, limit ${TEXT_MAX}).`);
    else if (looksLikeWorkflow(proposal.purpose)) errors.push(PURPOSE_HAS_WORKFLOW);
    else if (proposal.purpose.trim() !== pre.instructions.trim()) {
      changes.push({ row: pre, field: 'instructions', from: pre.instructions, to: proposal.purpose.trim() });
      pre.instructions = proposal.purpose.trim();
    }
  }

  for (const p of proposal.rows || []) {
    const key = String(p.id || '').trim().toUpperCase();
    if (!key) { errors.push('A row in the proposal has no id.'); continue; }
    if (seen.has(key)) { errors.push(`Row ${key} appears twice in the proposal.`); continue; }
    seen.add(key);
    const row = byId.get(key);
    if (!row) { errors.push(`There is no row ${key} in this table. Attributes are fixed slots - repurpose an existing row instead of adding one.`); continue; }
    if (isPurpose(row)) { errors.push(`Row ${key} is the purpose row - change it with "purpose", not as a row.`); continue; }
    if (!isScoring(row)) { errors.push(`Row ${key} (${row.category}) is not a scoring row and can't be changed here.`); continue; }
    const positive = row.category.toLowerCase() === 'positive';

    for (const [inKey, field] of Object.entries(FIELD_MAP)) {
      if (SCOPE_FIELDS.has(field)) continue; // checked together below
      if (p[inKey] === undefined || p[inKey] === null) continue;
      if (positive && NEGATIVE_ONLY.has(field)) { errors.push(`${key} is a positive attribute - it can't have ${LABEL[field].toLowerCase()}.`); continue; }
      if (!positive && POSITIVE_ONLY.has(field)) { errors.push(`${key} is a negative attribute - it can't have ${LABEL[field].toLowerCase()}.`); continue; }

      let v = p[inKey];
      if (TEXT_FIELDS.has(field)) {
        v = String(v).trim();
        if (v.length > TEXT_MAX) { errors.push(`${key} ${LABEL[field].toLowerCase()} is too long (${v.length} characters).`); continue; }
        if (field === 'heading' && !v) { errors.push(`${key} needs a heading.`); continue; }
      } else if (field === 'active' || field === 'disqualifying' || field === 'bonus') {
        v = v === true || v === 'true' || v === 'yes';
      } else {
        v = Number(v);
        if (!Number.isFinite(v) || v < 0 || Math.round(v) !== v) { errors.push(`${key} ${LABEL[field].toLowerCase()} must be a whole number of 0 or more.`); continue; }
        if (field === 'maxPoints' && (v < 1 || v > POINTS_MAX)) { errors.push(`${key} max points must be between 1 and ${POINTS_MAX}.`); continue; }
        if (field === 'penalty' && v > POINTS_MAX) { errors.push(`${key} penalty must be ${POINTS_MAX} or less.`); continue; }
      }
      if (v !== row[field]) {
        changes.push({ row, field, from: row[field], to: v });
        row[field] = v;
      }
    }

    // Which campaigns the row counts for (services/campaignScope.js). Mode and campaigns are
    // checked together: Only / Except with nobody listed is refused, All clears the list.
    if (p.campaign_scope !== undefined || p.campaign_ids !== undefined) {
      const mode = p.campaign_scope !== undefined && p.campaign_scope !== null ? campaignScope.scopeMode(p.campaign_scope) : row.campaignScope;
      let ids = p.campaign_ids !== undefined && p.campaign_ids !== null ? campaignIdList(p.campaign_ids) : row.campaignIds;
      if (ids === null) { errors.push(`${key} campaigns must be Linked Helper campaign numbers, e.g. [6, 9].`); continue; }
      if (mode === campaignScope.SCOPE.ALL) ids = [];
      else if (!ids.length) { errors.push(`${key} is set to "${campaignScope.SCOPE_LABEL[mode]}" but no campaign is chosen - pick at least one, or set it back to all campaigns.`); continue; }
      if (known) {
        for (const id of ids) {
          if (!known.some((c) => Number(c.id) === id)) warnings.push(`${key} "${row.heading}" is tagged with campaign #${id}, which is not one of the live Linked Helper campaigns - if it was archived or rebuilt, re-tag the attribute.`);
        }
      }
      if (mode !== row.campaignScope) {
        changes.push({ row, field: 'campaignScope', from: row.campaignScope, to: mode });
        row.campaignScope = mode;
        row.scopeTouched = true;
      }
      if (JSON.stringify(ids) !== JSON.stringify(row.campaignIds)) {
        changes.push({ row, field: 'campaignIds', from: row.campaignIds, to: ids });
        row.campaignIds = ids;
        row.scopeTouched = true;
      }
    }
  }

  const activePos = after.filter((r) => isScoring(r) && r.active && r.category.toLowerCase() === 'positive');
  if (!activePos.length) errors.push('No positive attribute would be active - every lead would score 0.');
  for (const r of activePos) {
    if (r.minToQualify > 0 && r.minToQualify > r.maxPoints) errors.push(`${r.id} min to qualify (${r.minToQualify}) is above its max points (${r.maxPoints}).`);
    else if (r.minToQualify > 0) warnings.push(`${r.id} "${r.heading}" has a minimum of ${r.minToQualify}: any lead below it scores 0 overall, losing its place in the order. Set min_to_qualify to 0 unless that is truly intended.`);
  }
  // Every audience must keep at least one positive attribute, or all its leads score 0.
  if (activePos.length && activePos.some((r) => r.campaignScope !== campaignScope.SCOPE.ALL)) {
    const audiences = [{ id: null, name: 'leads with no campaign (added by hand or by the extension)' }];
    const listed = new Set();
    for (const c of known || []) { audiences.push({ id: Number(c.id), name: `"${c.name}"` }); listed.add(Number(c.id)); }
    for (const r of activePos) for (const id of r.campaignIds) if (!listed.has(id)) { audiences.push({ id, name: `campaign #${id}` }); listed.add(id); }
    for (const a of audiences) {
      const count = activePos.filter((r) => campaignScope.appliesTo({ mode: r.campaignScope, ids: r.campaignIds }, a.id)).length;
      if (!count) warnings.push(`No positive attribute applies to ${a.name} - every one of those leads would score 0. Leave at least one main attribute on all campaigns.`);
    }
  }
  return { errors, warnings, changes, after };
}

/** [6, "9"] or "6, 9" -> [6, 9]; null when something in it is not a campaign number. */
function campaignIdList(v) {
  const list = Array.isArray(v) ? v : String(v).split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const x of list) {
    const n = Number(typeof x === 'object' && x !== null ? x.id : x);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function shortText(s, n = 90) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(empty)';
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

const fmt = (field, v) => {
  if (field === 'campaignScope') return campaignScope.SCOPE_LABEL[v] || campaignScope.SCOPE_LABEL.all;
  if (field === 'campaignIds') return Array.isArray(v) && v.length ? v.map((id) => `#${id}`).join(', ') : '(none)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (TEXT_FIELDS.has(field)) return shortText(v);
  return String(v);
};

/** Human-readable rundown of a set: active positives (core vs bonus), negatives, switched-off rows. */
function describeSet(rows, namesById = {}) {
  // " [Only these campaigns: Barclayss - Reach out (#6)]" on a scoped row; nothing on an all-campaigns one.
  const sc = (r) => (r.campaignScope && r.campaignScope !== campaignScope.SCOPE.ALL
    ? ` [${campaignScope.describeScope({ mode: r.campaignScope, ids: r.campaignIds }, namesById)}]` : '');
  const pos = rows.filter((r) => isScoring(r) && r.category.toLowerCase() === 'positive');
  const neg = rows.filter((r) => isScoring(r) && r.category.toLowerCase() === 'negative');
  const on = (list) => list.filter((r) => r.active);
  const core = on(pos).filter((r) => !r.bonus);
  const bonus = on(pos).filter((r) => r.bonus);
  const coreTotal = core.reduce((s, r) => s + r.maxPoints, 0);
  const lines = [];
  lines.push(`Main attributes (${coreTotal} points in total):`);
  for (const r of core) lines.push(`  ${r.id} - ${r.heading} - ${r.maxPoints} pts${r.minToQualify ? ` (min ${r.minToQualify})` : ''}${sc(r)}`);
  if (bonus.length) {
    lines.push('Bonus attributes (count at 25% in the total possible):');
    for (const r of bonus) lines.push(`  ${r.id} - ${r.heading} - up to ${r.maxPoints} pts${sc(r)}`);
  }
  if (on(neg).length) {
    lines.push('Negatives:');
    for (const r of on(neg)) lines.push(`  ${r.id} - ${r.heading} - ${r.disqualifying ? 'score set to 0' : `minus ${r.penalty}`}${sc(r)}`);
  }
  const off = [...pos, ...neg].filter((r) => !r.active);
  if (off.length) lines.push(`Switched off: ${off.map((r) => `${r.id} ${r.heading}`).join('; ')}`);
  return lines.join('\n');
}

/** Rows that a set of changes touches, deduped, in table order. */
function touchedRows(changes) {
  const seen = new Map();
  for (const c of changes) seen.set(c.row.recordId, c.row);
  return [...seen.values()];
}

// A row saved before campaign scope existed (an old backup) has no campaignScope: that is all campaigns.
const scopeModeOf = (r) => (r.campaignScope && Array.isArray(r.campaignIds) && r.campaignIds.length ? r.campaignScope : campaignScope.SCOPE.ALL);

/** Airtable update payloads for the rows a proposal changes (full writable state of each row). */
function buildWrites(changedRows, kinds, namesById = {}) {
  return changedRows.map((r) => ({
    id: r.recordId,
    fields: {
      // Campaign scope goes in only when the row uses it (or is being set back to all), so a base
      // that has not had the two fields rolled out yet still saves every ordinary change.
      ...(isScoring(r) && (scopeModeOf(r) !== campaignScope.SCOPE.ALL || r.scopeTouched) ? {
        'Campaign Scope': scopeModeOf(r) === campaignScope.SCOPE.ALL ? null : campaignScope.SCOPE_LABEL[scopeModeOf(r)],
        'Scope Campaigns': scopeModeOf(r) === campaignScope.SCOPE.ALL ? '' : campaignScope.formatCampaignIds(r.campaignIds || [], namesById),
      } : {}),
      'Heading': r.heading,
      'Instructions': r.instructions,
      'Examples': r.examples,
      'Signals': r.signals,
      ...(isScoring(r) ? {
        'Active': yesNo(kinds['Active'], r.active),
        ...(r.category.toLowerCase() === 'positive'
          ? { 'Max Points': r.maxPoints, 'Min To Qualify': r.minToQualify || null, 'Bonus Points': yesNo(kinds['Bonus Points'], r.bonus) }
          // A negative row is Penalty + Disqualifying. Max Points / Min To Qualify mean nothing on it;
          // the old portal form used to write them there (Matthew's "15", Oct 2026), so clear them.
          : { 'Penalty': r.penalty, 'Disqualifying': yesNo(kinds['Disqualifying'], r.disqualifying), 'Max Points': null, 'Min To Qualify': null }),
      } : {}),
    },
  }));
}

/**
 * Check a purpose statement on its own (the portal box). Empty is allowed - the scorer then runs on
 * the workflow and attributes alone. Returns an error string, or null when it is fine.
 */
function checkPurposeText(text) {
  const t = String(text || '');
  if (t.length > TEXT_MAX) return `The purpose text is too long (${t.length} characters, limit ${TEXT_MAX}).`;
  if (looksLikeWorkflow(t)) return PURPOSE_HAS_WORKFLOW;
  return null;
}

/** The purpose row's write payload with new text (empty string clears it). Null when there is no purpose row. */
function purposeWrite(rows, kinds, text) {
  const pre = rows.find(isPurpose);
  if (!pre) return null;
  return buildWrites([{ ...pre, instructions: String(text || '').trim() }], kinds)[0];
}

/**
 * The portal's Edit Attribute form payload (camelCase, every field every time) -> one proposal row
 * for checkProposal, so a portal save goes through exactly the checks and writes the Claude tools
 * use. Fields that do not belong to the row's category are ignored rather than refused, because
 * the form has always sent the full set.
 */
function portalProposal(row, data = {}) {
  const p = { id: row.id };
  const has = (k) => data[k] !== undefined && data[k] !== null;
  if (has('heading')) p.heading = data.heading;
  if (has('instructions')) p.instructions = data.instructions;
  if (has('examples')) p.examples = data.examples;
  if (has('signals')) p.signals = data.signals;
  if (has('active')) p.active = data.active === true || String(data.active).toLowerCase() === 'true';
  if (row.category.toLowerCase() === 'positive') {
    if (has('maxPoints') && data.maxPoints !== '') p.max_points = Number(data.maxPoints);
    // An emptied Min to Qualify box means "no minimum", not "leave it".
    if (data.minToQualify !== undefined) p.min_to_qualify = data.minToQualify === null || data.minToQualify === '' ? 0 : Number(data.minToQualify);
    if (data.bonusPoints !== undefined) p.bonus = data.bonusPoints === true || String(data.bonusPoints).toLowerCase() === 'true';
  } else if (row.category.toLowerCase() === 'negative') {
    if (data.disqualifying !== undefined) p.disqualifying = data.disqualifying === true || String(data.disqualifying).toLowerCase() === 'true';
    if (has('penalty') && data.penalty !== '') p.penalty = Number(data.penalty);
  }
  // Campaign scope: sent by the form only when the client has more than one campaign.
  if (has('campaignScope')) p.campaign_scope = data.campaignScope;
  if (has('campaignIds')) p.campaign_ids = data.campaignIds;
  return p;
}

async function writeRows(base, writes) {
  for (let i = 0; i < writes.length; i += 10) {
    await base(TABLE).update(writes.slice(i, i + 10));
  }
}

module.exports = {
  TABLE, readTable, normalize, fieldKinds, fingerprint, checkProposal, describeSet, touchedRows,
  buildWrites, writeRows, shortText, fmt, LABEL, isPurpose, isScoring, checkPurposeText, purposeWrite, portalProposal,
  PURPOSE_HAS_WORKFLOW,
};
