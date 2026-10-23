/**
 * Campaign scope on scoring attributes (2026-10-23, Sam Noble: Barclayss vs Find Me First).
 *
 * WHY: a client with two audiences (two businesses, or two very different campaigns) needs some
 * attributes to count for one audience only. Guy's design, settled on the 23 Oct call: ONE attribute
 * list, ONE Today list - each attribute optionally says which Linked Helper campaigns it applies to:
 *
 *   All campaigns              (blank - the default, and every attribute before this change)
 *   Only these campaigns       - counts for leads from the listed campaigns, nobody else
 *   All except these campaigns - counts for everyone except leads from the listed campaigns
 *
 * A lead is scored ONLY on the attributes that apply to it, so the total possible is per lead: a
 * Barclayss-only attribute never drags a Find Me First lead's score down. A lead with no campaign
 * (added by hand, or by the extension) and a campaign started later get All + Except rows, never
 * Only rows.
 *
 * Campaigns are matched on Linked Helper's campaign ID (every lead LH sends carries campaign_id in
 * {Raw Profile Data}), so renaming a campaign in LH does not break a tag. The names are only for
 * people to read.
 *
 * With no scoped attribute in a set, forCampaign() hands back the SAME set untouched - scoring for
 * every client who never uses this is byte-for-byte what it was.
 */

const SCOPE = { ALL: 'all', ONLY: 'only', EXCEPT: 'except' };

// The single-select choices in Airtable ("Campaign Scope" on Scoring Attributes). Blank = all.
const SCOPE_LABEL = {
  all: 'All campaigns',
  only: 'Only these campaigns',
  except: 'All except these campaigns',
};

/** Airtable select value (or a mode word) -> 'all' | 'only' | 'except'. Anything unknown is 'all'. */
function scopeMode(value) {
  const v = String((value && value.name) || value || '').trim().toLowerCase();
  if (!v || v === 'all' || v.startsWith('all campaigns')) return SCOPE.ALL;
  if (v === 'only' || v.startsWith('only')) return SCOPE.ONLY;
  if (v === 'except' || v.startsWith('all except') || v.startsWith('except')) return SCOPE.EXCEPT;
  return SCOPE.ALL;
}

/**
 * The "Scope Campaigns" cell -> campaign IDs. One campaign per line (or ; / , separated), each
 * starting with its Linked Helper ID: "6 - Barclayss - Reach out". The name after the ID is for
 * people reading the table; only the leading number counts.
 */
function parseCampaignIds(text) {
  const ids = [];
  for (const part of String(text || '').split(/[\n;,]+/)) {
    const m = part.trim().match(/^#?(\d+)\b/);
    if (m) {
      const n = Number(m[1]);
      if (!ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

/** IDs (+ optional names by ID) -> the "Scope Campaigns" cell text. */
function formatCampaignIds(ids = [], namesById = {}) {
  return ids.map((id) => {
    const name = namesById[id] || namesById[String(id)];
    return name ? `${id} - ${name}` : String(id);
  }).join('\n');
}

/** A scope object from the two Airtable cells. */
function scopeFromCells(scopeCell, campaignsCell) {
  const mode = scopeMode(scopeCell);
  const ids = parseCampaignIds(campaignsCell).sort((a, b) => a - b);
  // Only / Except with nobody listed would quietly switch the row off (Only) or do nothing
  // (Except) - read as All, and the editors refuse to save it that way.
  if (mode !== SCOPE.ALL && !ids.length) return { mode: SCOPE.ALL, ids: [] };
  return { mode, ids: mode === SCOPE.ALL ? [] : ids };
}

const isScoped = (scope) => !!scope && scope.mode !== SCOPE.ALL && Array.isArray(scope.ids) && scope.ids.length > 0;

/** Does an attribute with this scope count for a lead from campaignId (null = no campaign)? */
function appliesTo(scope, campaignId) {
  if (!isScoped(scope)) return true;
  const id = campaignId === null || campaignId === undefined || campaignId === '' ? null : Number(campaignId);
  const listed = id !== null && scope.ids.includes(id);
  return scope.mode === SCOPE.ONLY ? listed : !listed;
}

/** The Linked Helper campaign ID a lead came from, off {Raw Profile Data} (JSON string or object). */
function campaignIdOf(rawProfileData) {
  if (!rawProfileData) return null;
  let v;
  if (typeof rawProfileData === 'object') v = rawProfileData.campaign_id;
  else {
    try {
      v = (JSON.parse(rawProfileData) || {}).campaign_id;
    } catch (_) {
      // A clipped cell is not valid JSON - read the one field directly.
      const m = String(rawProfileData).match(/"campaign_id"\s*:\s*"?(\d+)/);
      v = m ? m[1] : null;
    }
  }
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** An Airtable lead record's campaign ID (reads {Raw Profile Data}). */
function campaignIdOfRecord(rec) {
  try {
    return campaignIdOf(rec && typeof rec.get === 'function' ? rec.get('Raw Profile Data') : null);
  } catch (_) {
    return null;
  }
}

/** Does this attribute set have any campaign-scoped row? */
function hasScopes(set) {
  return !!set && !!set.scopes && Object.values(set.scopes).some(isScoped);
}

/**
 * The attribute set as it applies to one campaign: positives / negatives filtered to the rows that
 * count for campaignId. With no scoped rows, the same object comes back (nothing changes). The
 * returned set never carries `scopes`, so it can go straight into a prompt.
 */
function forCampaign(set, campaignId) {
  if (!hasScopes(set)) return set;
  const keep = (dict) => {
    const out = {};
    for (const [id, def] of Object.entries(dict || {})) {
      if (appliesTo(set.scopes[id], campaignId)) out[id] = def;
    }
    return out;
  };
  return { preamble: set.preamble, positives: keep(set.positives), negatives: keep(set.negatives) };
}

/** One readable line about a scope, for tools and warnings. namesById optional. */
function describeScope(scope, namesById = {}) {
  if (!isScoped(scope)) return SCOPE_LABEL.all;
  const names = scope.ids.map((id) => (namesById[id] ? `${namesById[id]} (#${id})` : `campaign #${id}`));
  return `${SCOPE_LABEL[scope.mode]}: ${names.join(', ')}`;
}

module.exports = {
  SCOPE, SCOPE_LABEL, scopeMode, parseCampaignIds, formatCampaignIds, scopeFromCells, isScoped, appliesTo,
  campaignIdOf, campaignIdOfRecord, hasScopes, forCampaign, describeScope,
};
