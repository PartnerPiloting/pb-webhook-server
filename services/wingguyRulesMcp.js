/**
 * Wingguy rules MCP tools — ONE definition, exposed on BOTH transports:
 *   - the SDK server (services/mcpRecallServer.js → /mcp2/:token, claude.ai)
 *   - the legacy hand-rolled endpoint (routes/recallWebhookRoutes.js → /mcp/:token, Claude Code)
 *
 * The trigger phrase in chat is "update my rules" (decided 2026-07-04 — names the thing, not
 * the storage layer). The propose→commit split enforces LLM-proposes / code-writes /
 * human-confirms: commit REQUIRES the expected_version a propose handed back, so no write can
 * happen without a proposal (and the human eyeballing it) first.
 *
 * Step-1 auth posture: tenant hard-wired to the coach client behind the existing connector
 * token; per-person tokens + roles land at roadmap step 3.
 */

const { z } = require('zod');
const store = require('./wingguyRulesStore');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || store.DEFAULT_TENANT).trim();
// Per-request tenant is threaded into every executor (2nd arg, defaults to TENANT); the door's
// audit actor is derived per-tenant as `mcp:${tenant}` at each write site.

// ---------------------------------------------------------------------------
// Executors — shared by both transports; return { text, isError? }
// ---------------------------------------------------------------------------

// Plain-English name for what KIND of instruction a row is — the three kinds the human actually
// cares about. layer= is kept in the line because the model needs it for the follow-up tool calls.
const KIND = { fixed: 'FIXED', standard: 'STANDARD', yours: 'YOURS', 'yours-override': 'YOURS (replaces the standard)', 'yours-inert': 'YOURS (never applies - the shared one is FIXED)', template: 'TEMPLATE (seed only)' };

function ruleKind(r, { overridden = new Set(), inert = new Set() } = {}) {
  if (r.layer === 'template') return 'template';
  if (r.layer === 'foundation') return store.ruleTier(r) === 'locked' ? 'fixed' : 'standard';
  const id = `${r.rule_key}|${r.campaign || ''}`;
  if (inert.has(id)) return 'yours-inert';
  return overridden.has(id) ? 'yours-override' : 'yours';
}

// The KIND is the group heading, so it is not repeated per line; layer= stays because the model
// needs it for the follow-up wingguy_rule_get / propose calls.
function ruleLine(r) {
  const camp = r.campaign ? ` [campaign:${r.campaign}]` : '';
  return `- ${r.rule_key} (v${r.version}, layer=${r.layer}, ${r.context}/${r.rule_type}${camp})`;
}

function scopeFromLayer(layer, tenant = TENANT) {
  // client rules belong to the caller's tenant; foundation/template are tenant-less
  return layer === 'client' ? { layer, tenantId: tenant } : { layer, tenantId: undefined };
}

// The rulebook's tail extras — a discovery hint (pending draft edits exist) and the structural
// hygiene sweep. Both best-effort: a hiccup in either must never break the listing. The guidance
// baked into the text keeps the offer to ONE line at the END of whatever the human asked for.
async function rulebookExtras(tenant) {
  let extras = '';
  try {
    const pending = await store.getEditPairs({ tenantId: tenant, status: 'pending', limit: 100 });
    if (pending.length) {
      extras += `\n\nBy the way: ${pending.length} recent send${pending.length === 1 ? ' has' : 's have'} unreviewed edits (what Wingguy drafted vs what was actually sent). Mention it in ONE line — the human can say "review my edits" to go through them.`;
    }
  } catch (_) { /* non-fatal */ }
  extras += await hygieneExtra(tenant);
  return extras;
}

/** The structural-sweep tail on its own (edit-review appends this without the pending-edits hint). */
async function hygieneExtra(tenant) {
  try {
    const findings = await store.rulebookHygiene({ tenantId: tenant });
    if (!findings.length) return '';
    const top = findings.slice(0, 3).map((f) => `- ${f.detail}`);
    const more = findings.length > 3 ? `\n(…and ${findings.length - 3} more — the human can ask for the full housekeeping list any time.)` : '';
    return `\n\nHOUSEKEEPING (structural sweep — code-detected facts, not opinions): ${findings.length} item${findings.length === 1 ? '' : 's'}:\n${top.join('\n')}${more}\nOffer ONCE, at the END of what the human actually asked for: sort these now, or later? If later, drop the subject. Fixes go through the normal propose→commit door — never fix silently.`;
  } catch (_) { return ''; /* non-fatal */ }
}

async function runRulesList({ context, layer, campaign, view, limit } = {}, tenant = TENANT) {
  if (view === 'divergence') return runDivergence({ limit }, tenant);

  const raw = await store.getActiveRules({
    tenantId: tenant,
    contexts: context ? [context] : undefined,
    layer: layer || undefined,
    campaign: campaign || undefined,
  });
  const extras = await rulebookExtras(tenant);
  if (!raw.length) return { text: `No active instructions matched. (An empty store is expected until the Notion import runs.)${extras}` };

  // With an explicit layer filter the human is inspecting ONE drawer — show it raw. Otherwise show
  // the RUNTIME view: shadowing applied, so what is listed is exactly what reaches the model.
  const { rules, dropped } = layer
    ? { rules: raw, dropped: [] }
    : store.resolveRuleShadowing(raw, { campaign: campaign || undefined });
  const ident = (r) => `${r.rule_key}|${r.campaign || ''}`;
  const marks = {
    overridden: new Set(dropped.filter((d) => d.reason === 'override').map((d) => ident(d.by))),
    inert: new Set(dropped.filter((d) => d.reason === 'locked').map((d) => ident(d.rule))),
  };
  // A suppressed client copy is not in `rules` (it does not render) but the human must still see it
  // exists, or "where did my version go?" has no answer.
  const suppressed = dropped.filter((d) => d.reason === 'locked').map((d) => d.rule);

  const groups = new Map();
  for (const r of [...rules, ...suppressed]) {
    const k = ruleKind(r, marks);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const order = ['fixed', 'standard', 'yours-override', 'yours', 'yours-inert', 'template'];
  const parts = [];
  for (const k of order) {
    const rows = groups.get(k);
    if (!rows || !rows.length) continue;
    parts.push(`${KIND[k]} (${rows.length}):\n${rows.map(ruleLine).join('\n')}`);
  }

  const overrideCount = marks.overridden.size;
  const tail = overrideCount
    ? `\n\n${overrideCount} standard instruction${overrideCount === 1 ? ' has' : 's have'} a version of your own in place of the shared one. "What have I changed?" (wingguy_rules_list with view=divergence) shows yours and the current standard side by side.`
    : '';
  return {
    text: `${layer ? `The ${layer} layer` : 'Active Wingguy instructions'} for ${tenant}${layer ? ' (raw - no shadowing applied)' : ' - this is exactly what reaches the model'}:\n\n${parts.join('\n\n')}${tail}\n\nUse wingguy_rule_get for an instruction's body + history.${extras}`,
  };
}

// "What have I changed?" — TWO sections, because there are two different answers:
//   CHANGED — they took a shared instruction and made it their own. Both bodies, side by side.
//   ADDED   — they wrote something with no shared version behind it. Shown in FULL: an addition
//             means they found a gap in the shared set, which is the stronger signal and the
//             promotion candidate. (Until 2026-07-31 additions were one line of comma-separated
//             keys, because the view was built comparison-shaped — useless for a tenant like Guy
//             whose 71 own instructions are ALL additions and none are overrides.)
// Additions are capped and newest-first: dumping 71 bodies into one reply helps nobody.
async function runDivergence({ limit } = {}, tenant = TENANT) {
  const d = await store.getDivergence({ tenantId: tenant });
  const extras = await rulebookExtras(tenant);
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const moved = d.overrides.filter((o) => o.standardMoved);

  const lines = [
    `${tenant}: ${d.overrides.length} CHANGED, ${d.yoursOnly.length} ADDED, out of ${d.standardCount} shared instructions.`,
    '',
  ];

  if (!d.overrides.length) {
    lines.push(`CHANGED (0): none - every shared instruction is running exactly as it comes.`, '');
  } else {
    lines.push(`CHANGED (${d.overrides.length}) - a shared instruction replaced by their own version:`, '');
  }
  for (const o of d.overrides) {
    lines.push(`━━ ${o.ruleKey}${o.campaign ? ` [campaign:${o.campaign}]` : ''} · ${o.context}/${o.ruleType}`);
    if (!o.applies) {
      lines.push(`⚠ The shared version of this one is FIXED (a guardrail), so YOUR version never applies - the shared one below is what actually runs. Your copy is dead weight and should be archived.`);
    }
    lines.push('', `--- YOURS (v${o.yourVersion}${o.yourChangeNote ? ` - "${o.yourChangeNote}"` : ''}) ---`, o.yourBody, '');
    lines.push(`--- THE STANDARD RIGHT NOW (v${o.standardVersion}) ---`, o.standardBody, '');
    if (o.standardMoved) {
      const notes = o.standardChanges.map((c) => `v${c.version}${c.changeNote ? ` - "${c.changeNote}"` : ''}`).join(' · ');
      lines.push(`⚠ THE STANDARD HAS MOVED since you took your own version (you branched from v${o.basedOnStandardVersion}, it is now v${o.standardVersion}): ${notes}`);
      lines.push(`Your version is untouched and still applies. If the new standard is better, wingguy_rule_reset_to_standard drops yours and puts you back on the shared one.`, '');
    } else if (o.basedOnStandardVersion == null) {
      lines.push(`(This override predates drift tracking, so there is no record of which standard version it branched from - compare the two bodies above by eye.)`, '');
    } else {
      lines.push(`(The standard has not changed since you took your own version.)`, '');
    }
  }
  const shown = d.yoursOnly.slice(0, cap);
  const rest = d.yoursOnly.slice(cap);
  if (!d.yoursOnly.length) {
    lines.push(`ADDED (0): none - they have written nothing of their own beyond the shared set.`, '');
  } else {
    lines.push(
      `ADDED (${d.yoursOnly.length}) - their own instructions, with no shared version behind them. ` +
      `Each one is something the shared set did not cover${rest.length ? `. Showing the ${shown.length} most recently updated` : ''}:`,
      '',
    );
    for (const y of shown) {
      lines.push(`━━ ${y.ruleKey}${y.campaign ? ` [campaign:${y.campaign}]` : ''} · ${y.context}/${y.ruleType} · v${y.version}${y.updatedAt ? ` · last updated ${y.updatedAt}` : ''}`);
      lines.push('', y.body, '');
    }
    if (rest.length) {
      lines.push(`…and ${rest.length} more, not shown in full: ${rest.map((y) => y.ruleKey).join(', ')}.`, '');
    }
  }

  lines.push(
    'HOW TO PRESENT THIS - the two halves need different conversations:',
    `- CHANGED: lead with any where the standard has MOVED${moved.length ? ` (${moved.length}: ${moved.map((m) => m.ruleKey).join(', ')})` : ' (none right now)'}`
      + ' - those are the only ones needing a decision. Show both versions and ask whether to keep theirs or go back to the standard. Never reset anything without an explicit yes.',
    '- ADDED: these are not problems, they are the human\'s own thinking. Two things worth raising, gently and only if it fits: any that look like they would help EVERY client are candidates to promote into the shared set, and any that have gone stale can be archived. Walk a FEW at a time and ask - never dump the whole list back at them or turn it into a chore.',
  );
  if (rest.length) lines.push(`(Ask for more with a higher limit if they want to work through the rest.)`);
  return { text: lines.join('\n') + extras };
}

async function runResetToStandard({ rule_key, campaign } = {}, tenant = TENANT) {
  const r = await store.resetRuleToStandard({
    tenantId: tenant,
    ruleKey: rule_key,
    campaign: campaign || undefined,
    createdBy: `mcp:${tenant}`,
  });
  return {
    text: `Done - your own version of "${r.ruleKey}" (v${r.retiredVersion}) is archived, and the shared standard applies again.\n\n`
      + `--- WHAT NOW APPLIES (standard v${r.standardVersion}) ---\n${r.standardBody}\n\n`
      + `Nothing was deleted: your version is still in history and wingguy_rule_revert brings it back any time.`,
  };
}

async function runRuleGet({ rule_key, layer = 'client', campaign }, tenant = TENANT) {
  const found = await store.getRule({ ...scopeFromLayer(layer, tenant), ruleKey: rule_key, campaign: campaign || undefined });
  if (!found) {
    return {
      text: `No rule "${rule_key}" in the ${layer} layer${campaign ? ` for campaign "${campaign}"` : ' (generic — pass campaign to fetch a campaign\'s version)'}. wingguy_rules_list shows what exists.`,
      isError: true,
    };
  }
  const { active, versions } = found;
  const history = await store.getHistory({ ruleKey: rule_key, limit: 20 });
  const lines = [];
  if (active) {
    const tier = store.ruleTier(active);
    lines.push(`# ${rule_key} (ACTIVE v${active.version}, ${active.layer}${tier ? `/${tier}` : ''}, ${active.context}/${active.rule_type}${active.campaign ? `, campaign:${active.campaign}` : ''})`);
    if (tier === 'locked') lines.push('This is a FIXED instruction — shared by every client and not overridable. No client version can replace it.');
    if (tier === 'standard') lines.push('This is a STANDARD instruction — shared and improved centrally, but any client may save their own version, which then replaces it for them alone.');
    if (active.layer === 'client') {
      // Is this the client's own version of something shared? That is the fact they need, and it
      // is not visible from the row itself.
      const std = await store.getRule({ layer: 'foundation', ruleKey: rule_key, campaign: campaign || undefined });
      if (std?.active) {
        const stdTier = store.ruleTier(std.active);
        lines.push(stdTier === 'locked'
          ? `⚠ There is a FIXED shared version of "${rule_key}" (v${std.active.version}). It wins — THIS version never applies and should be archived.`
          : `This is YOUR version of a STANDARD instruction (shared version is currently v${std.active.version}${active.standard_version ? `, you branched from v${active.standard_version}` : ''}). Yours applies; the shared one does not. wingguy_rules_list view=divergence shows them side by side.`);
      }
    }
    lines.push('', active.body, '');
  } else {
    lines.push(`# ${rule_key} — RETIRED (no active version)`, '');
  }
  lines.push(`Versions (${versions.length}):`);
  for (const v of versions) {
    lines.push(`- v${v.version} ${v.status}${v.change_note ? ` — "${v.change_note}"` : ''}${v.created_by ? ` (by ${v.created_by})` : ''} ${v.created_at || ''}`);
  }
  if (history.length) {
    // History is fetched by rule_key across ALL layers, while the rule above is ONE layer — so
    // print each row's layer. Without it, template and client rows for the same key render
    // byte-identical and read as double-writes (they are not: one key, one seed pass, two layers).
    // Campaign lives in detail JSONB (no column), and collapses the same way if unprinted.
    lines.push('', `Door history (${history.length} recent, ALL layers of "${rule_key}"):`);
    for (const h of history) {
      const camp = h.detail && h.detail.campaign ? `, campaign:${h.detail.campaign}` : '';
      const scope = `[${h.layer}${h.tenant_id ? `/${h.tenant_id}` : ''}${camp}]`;
      lines.push(`- ${h.created_at || ''} ${scope} ${h.action} ${h.from_version != null ? `v${h.from_version}→` : ''}${h.to_version != null ? `v${h.to_version}` : ''} by ${h.actor || '?'}`);
    }
    const layers = [...new Set(history.map((h) => h.layer))];
    if (layers.length > 1) {
      lines.push('', `NB "${rule_key}" exists in more than one layer (${layers.join(', ')}). Rows that look duplicated are usually one action per layer, not a double-write. Only ONE copy renders: a client version replaces a STANDARD shared one, and a FIXED shared one beats any client version.`);
    }
  }
  return { text: lines.join('\n') };
}

async function runRulePropose({ rule_key, layer = 'client', context, rule_type, campaign, body, tier }, tenant = TENANT) {
  const prop = await store.proposeRule({
    actorTenantId: tenant,
    via: 'door',
    ...scopeFromLayer(layer, tenant),
    // Whose rulebook to check against — always the caller's, even for a tenant-less foundation rule.
    readerTenantId: tenant,
    ruleKey: rule_key,
    context,
    ruleType: rule_type,
    campaign: campaign || undefined,
    body,
    tier: tier || undefined,
  });
  // Refused before we start — say so and stop, rather than walking the human through a proposal
  // the write-door is going to reject. Two reasons, and they need different words:
  //   locked            — the instruction is a guardrail; show it so they can see what it says.
  //   not-platform-owner / no-actor — they are trying to change the SHARED drawer, which is not
  //                       theirs to change; there is no `standard` body to show (this is a
  //                       foundation/template proposal, not an override of one).
  if (prop.blocked) {
    if (prop.blocked.reason === 'locked') {
      return {
        text: `CANNOT CHANGE THIS ONE.\n\n${prop.blocked.message}\n\n`
          + `--- THE FIXED INSTRUCTION (v${prop.standard.version}) ---\n${prop.standard.body}\n\n`
          + `Tell the human plainly that this is one of the fixed guardrails and their own version cannot be saved against it. Do NOT try wingguy_rule_commit — it will refuse too.`,
        isError: true,
      };
    }
    return {
      text: `CANNOT CHANGE THE SHARED INSTRUCTIONS.\n\n${prop.blocked.message}\n\n`
        + `WHAT TO DO INSTEAD: if they want this for themselves, propose the SAME change with layer="client" — that saves their own version, which replaces the shared one for them and leaves everyone else untouched. `
        + `If they genuinely believe every client should get it, that is a request to pass on to the platform owner, NOT something to retry from here. Do NOT try wingguy_rule_commit — it will refuse too.`,
      isError: true,
    };
  }
  const lines = [
    `PROPOSAL for ${prop.isNew ? 'NEW rule' : `rule (currently v${prop.currentVersion})`} "${prop.ruleKey}"`,
    `Scope: ${prop.layer}${prop.tenantId ? ` / ${prop.tenantId}` : ' (platform-wide — every tenant reads this)'}${prop.tier ? ` · tier=${prop.tier}${prop.tier === 'locked' ? ' (FIXED — no client can override this)' : ' (STANDARD — clients may keep their own version)'}` : ''} · ${prop.context}/${prop.ruleType}${prop.campaign ? ` · campaign:${prop.campaign}` : ''}`,
    '',
  ];
  // The override case, stated as what it IS. Before cross-layer shadowing this was the "two bodies
  // will reach the model" warning; now exactly one does, and the human needs to read the one they
  // are replacing before replacing it.
  if (prop.isOverride) {
    lines.push(
      `THIS IS AN OVERRIDE. "${prop.ruleKey}" is a STANDARD instruction (shared, kept up to date centrally). Saving your own version REPLACES it for ${prop.tenantId} only — the standard keeps improving for everyone else, and you stop receiving those improvements on this one instruction.`,
      `--- THE STANDARD YOU WOULD BE REPLACING (v${prop.standard.version}) ---`,
      prop.standard.body,
      '',
      'Show the human BOTH bodies and check the standard does not already say what they want. If it is close, ask whether the STANDARD should be improved instead (that helps every client, including them) — prefer that over a private copy whenever the change is not purely personal taste.',
      '',
    );
  }
  if (prop.layer === 'foundation' && prop.overrideTenants.length) {
    lines.push(
      `⚠ ${prop.overrideTenants.length} tenant${prop.overrideTenants.length === 1 ? '' : 's'} already run their OWN version of "${prop.ruleKey}" and will NOT receive this change: ${prop.overrideTenants.map((t) => `${t.tenantId} (their v${t.version})`).join(', ')}. They will be told the standard moved next time they ask what they have changed.`,
      '',
    );
  }
  if (!prop.isNew) {
    lines.push('--- CURRENT body ---', prop.currentBody || '(empty)', '', '--- PROPOSED body ---', prop.proposedBody, '');
  } else {
    lines.push('--- PROPOSED body (new rule) ---', prop.proposedBody, '');
  }
  // The conflict check, widest ring last. Rules are FILED by context/type but they LAND on the
  // same message, so a same-cell-only check reports a reassuring "none" while a rule one cell
  // away contradicts the proposal (the live 2026-07-17 miss). Same-key-elsewhere is listed
  // loudest: both copies render, nothing shadows.
  const excerpt = (n) => `${String(n.body).slice(0, 160)}${String(n.body).length > 160 ? '…' : ''}`;
  const label = (n) => `${n.rule_key} (v${n.version}, ${n.layer}, ${n.context}/${n.rule_type}${n.campaign ? `, campaign:${n.campaign}` : ''})`;
  // The standard being overridden is already printed in full above — don't list it again as a
  // "conflict" in the rings below; it is a replacement, not a collision.
  const isTheStandard = (n) => prop.standard && n.layer === 'foundation'
    && n.rule_key === prop.ruleKey && (n.campaign || null) === prop.campaign;
  const sameKeyOther = (prop.sameKeyElsewhere || []).filter((n) => !isTheStandard(n));
  const neighbours = prop.neighbours.filter((n) => !isTheStandard(n));
  if (sameKeyOther.length) {
    lines.push(`⚠ SAME rule_key "${prop.ruleKey}" is ALSO filed elsewhere, in a layer that does NOT shadow this one — read these, the model may end up with two bodies:`);
    for (const n of sameKeyOther) lines.push(`- ${label(n)}: ${excerpt(n)}`);
    lines.push('');
  }
  if (neighbours.length) {
    lines.push(`Neighbours in ${prop.context}/${prop.ruleType} (closest overlap — read for contradiction):`);
    for (const n of neighbours) lines.push(`- ${label(n)}: ${excerpt(n)}`);
    lines.push('');
  } else {
    lines.push(`No other rules filed in ${prop.context}/${prop.ruleType}.`, '');
  }
  if (prop.sameTypeElsewhere && prop.sameTypeElsewhere.length) {
    lines.push(`Same rule_type (${prop.ruleType}) in OTHER contexts — a rule filed elsewhere can still land on the same message, so scan these too:`);
    for (const n of prop.sameTypeElsewhere) lines.push(`- ${label(n)}: ${excerpt(n)}`);
    lines.push('');
  }
  lines.push(
    'CONFLICT CHECK IS HUMAN EYES: the lists above are retrieval, not a verdict. If this rule OVERRIDES or contradicts any of them, say so out loud to the human before committing — and prefer amending the rule that is wrong over stacking a new rule that claims to win.',
    '',
    `To commit after the human confirms: wingguy_rule_commit with expected_version=${prop.expectedVersion} (and the same scope + body).`,
    'Do NOT commit without showing this proposal to the human and getting an explicit yes.',
  );
  return { text: lines.join('\n') };
}

async function runRuleCommit({ rule_key, layer = 'client', context, rule_type, campaign, body, change_note, expected_version, tier }, tenant = TENANT) {
  const r = await store.commitRule({
    actorTenantId: tenant,
    via: 'door',
    ...scopeFromLayer(layer, tenant),
    ruleKey: rule_key,
    context,
    ruleType: rule_type,
    campaign: campaign || undefined,
    body,
    changeNote: change_note || null,
    createdBy: `mcp:${tenant}`,
    expectedVersion: expected_version,
    tier: tier || undefined,
  });
  const override = layer === 'client' && r.standardVersion
    ? ` This REPLACES the standard version (v${r.standardVersion}) for you only — wingguy_rule_reset_to_standard puts you back on the shared one whenever you want.`
    : '';
  const tierNote = r.tier ? ` Tier: ${r.tier}${r.tier === 'locked' ? ' (fixed — no client can override it)' : ' (standard — clients may keep their own version)'}.` : '';
  return {
    text: `Committed: "${r.ruleKey}" is now v${r.version} (${layer}${r.tenantId ? `/${r.tenantId}` : ''}).` +
      `${r.previousVersion ? ` v${r.previousVersion} retired (still in history — revert any time).` : ' First version.'}${tierNote}${override}`,
  };
}

async function runRuleRevert({ rule_key, layer = 'client', campaign, to_version }, tenant = TENANT) {
  const r = await store.revertRule({
    actorTenantId: tenant,
    via: 'door',
    ...scopeFromLayer(layer, tenant),
    ruleKey: rule_key,
    campaign: campaign || undefined,
    toVersion: to_version,
    createdBy: `mcp:${tenant}`,
  });
  return { text: `Reverted: "${r.ruleKey}" v${r.version} now carries the v${to_version} body (append-only — nothing was deleted).` };
}

// One home (13 Oct 2026, services/clientFactSync.js): a save to a fact the client record also holds
// (phone, timezone, meeting link, LinkedIn) writes the record too, and the reply says so.
async function recordFollows(tenant, scope, key, value) {
  const sync = require('./clientFactSync');
  const k = String(key).trim();
  if (!sync.pairFor(scope, k)) return '';
  const r = await sync.syncStoreToRecord({ tenantId: tenant, scope, key: k, value });
  return r.synced
    ? `\n(Also saved to the client record's ${r.field} - booking reads it from there.)`
    : `\n(The client record's ${r.field} was NOT updated: ${r.reason}.)`;
}

async function runVariables({ set_key, set_value, description } = {}, tenant = TENANT) {
  let recordNote = '';
  if (set_key !== undefined && set_key !== null && String(set_key).trim()) {
    await store.setVariable({ tenantId: tenant, varKey: set_key, value: set_value ?? null, description, actor: `mcp:${tenant}` });
    recordNote = await recordFollows(tenant, 'variable', set_key, set_value);
  }
  const vars = await store.getVariables({ tenantId: tenant });
  if (!vars.length) return { text: 'No variables in the catalog yet (they arrive with the Notion import / de-personalisation pass).' };
  const lines = vars.map((v) => `- ${v.var_key} = ${v.value == null ? '(unset)' : JSON.stringify(v.value)}${v.required ? ' [required]' : ''}${v.description ? ` — ${v.description}` : ''}`);
  return { text: `Wingguy variables for ${tenant}:\n${lines.join('\n')}${recordNote}` };
}

async function runAssets({ set_key, set_url, set_kind, retire } = {}, tenant = TENANT) {
  let recordNote = '';
  if (set_key !== undefined && set_key !== null && String(set_key).trim()) {
    await store.setAsset({
      tenantId: tenant,
      assetKey: set_key,
      url: set_url ?? null,
      kind: set_kind || undefined,
      status: retire ? 'retired' : 'active',
      actor: `mcp:${tenant}`,
    });
    recordNote = await recordFollows(tenant, 'asset', set_key, retire ? '' : set_url);
  }
  const assets = await store.getAssets({ tenantId: tenant });
  if (!assets.length) return { text: 'No assets in the library yet.' };
  const lines = assets.map((a) => `- ${a.asset_key}${a.kind ? ` [${a.kind}]` : ''} = ${a.url || '(no url)'}${a.status !== 'active' ? ` (${a.status})` : ''}`);
  return { text: `Wingguy asset library for ${tenant} (rules reference these as {{asset:key}} — URLs go out EXACTLY as stored, never composed):\n${lines.join('\n')}${recordNote}` };
}

// Learn-from-my-edit: surface the pending generated-vs-sent pairs the extension logged on Send,
// so the human and the model can talk each diff through ("one-off, or a preference to bake in?")
// and route any real pattern into the NORMAL propose→commit door. This tool never writes rules —
// it reads pairs and closes them out.
async function runEditReview({ action = 'list', ids, resolution = 'reviewed', note, status = 'pending', limit } = {}, tenant = TENANT) {
  if (action === 'resolve') {
    const r = await store.resolveEditPairs({ tenantId: tenant, ids: ids || [], status: resolution, note });
    return { text: `Closed out ${r.resolved} edit pair${r.resolved === 1 ? '' : 's'} as ${resolution}.${r.resolved ? '' : ' (Only pending pairs can be resolved — check the ids.)'}` };
  }
  // Email half: settle any awaiting drafts first (read sent mail back, diff, file pairs) so the
  // list below is current. Lazy + best-effort — a mail hiccup must never break the review.
  let settleLine = '';
  try {
    const settle = await require('./wingguyMailMcp').settleEmailEditPairs(tenant);
    if (settle.checked) {
      settleLine = `(Email drafts settled: ${settle.paired} edited, ${settle.noDiff} sent as drafted${settle.awaiting ? `, ${settle.awaiting} not sent yet` : ''}${settle.expired ? `, ${settle.expired} expired unsent` : ''}.)\n\n`;
    }
  } catch (e) {
    settleLine = `(Email-draft settle skipped: ${e.message})\n\n`;
  }
  const pairs = await store.getEditPairs({ tenantId: tenant, status, limit });
  if (!pairs.length) {
    return { text: settleLine + (status === 'pending'
      ? 'No pending edits to review — every recent send (LinkedIn and email) matched its draft (or nothing has been captured yet).'
      : `No ${status} edit pairs found.`) + await hygieneExtra(tenant) };
  }
  const lines = [
    settleLine +
    `${pairs.length} ${status} edit pair${pairs.length === 1 ? '' : 's'} for ${tenant} (newest first). Each is: what Wingguy drafted vs what the human actually sent.`,
    '',
  ];
  for (const p of pairs) {
    lines.push(`━━ #${p.id} · ${p.surface || 'linkedin'} · ${p.lead_name || 'unknown lead'} · ${p.created_at}${p.lead_url ? ` · ${p.lead_url}` : ''}`);
    lines.push('--- WINGGUY DRAFTED ---', p.generated, '', '--- HUMAN SENT ---', p.sent, '');
    if (p.review_note) lines.push(`(note: ${p.review_note})`);
  }
  lines.push(
    'HOW TO RUN THIS REVIEW:',
    '1. Walk the pairs WITH the human, one at a time. For each, FIRST show the full drafted-vs-sent pair verbatim - exactly what Wingguy drafted and exactly what the human sent - then describe the change you see and ask: one-off for that lead, or a general preference? Never summarise a diff without showing the two versions it came from.',
    '2. Look for the SAME change recurring across pairs — a repeated edit is one rule, not many. Never propose one micro-rule per pair.',
    '3. Before proposing anything, check the existing rulebook (wingguy_rules_list / wingguy_rule_get) — PREFER AMENDING an existing rule over adding a new one. The rulebook should get sharper from this review, not fatter.',
    '4. Route any agreed change through wingguy_rule_propose → human confirms → wingguy_rule_commit, exactly as "update my rules".',
    '5. When a pair has been discussed (rule or no rule), close it out: wingguy_edit_review with action=resolve, its id, and resolution=reviewed (or dismissed for noise/mispairs), with a one-line note.',
    '6. Email pairs compare the human\'s words only (quoted thread history is stripped before diffing) — if one still looks like quote-chain noise or a mispaired message, dismiss it rather than reading a preference into it.',
  );
  return { text: lines.join('\n') + await hygieneExtra(tenant) };
}

// ---------------------------------------------------------------------------
// Coach directory — look up one of the caller's OWN coached clients' setup
// details (portal token / URL, login email, leads base id). Coach-gated: the
// caller only ever sees clients whose `Coach` field equals the caller's tenant,
// so a plain client's connector can never read another client's record. The
// portal token is a portal access key — hence coach-only.
// ---------------------------------------------------------------------------
async function runGetClient({ client } = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const query = String(client || '').trim();
  if (!query) return { text: 'Which client? Pass a name or client id (e.g. "McPhee" or "Guy-McPhee").', isError: true };

  let all;
  try {
    all = await clientService.getAllClients();
  } catch (e) {
    return { text: `Couldn't read the client directory: ${e.message}`, isError: true };
  }

  // Coach gate: only the clients this caller coaches are ever visible.
  const mine = (all || []).filter((c) => c.coach && c.coach === tenant);
  if (!mine.length) {
    return { text: `No coached clients are visible to "${tenant}". This lookup is coach-only.`, isError: true };
  }

  const q = query.toLowerCase();
  const exact = mine.filter((c) =>
    (c.clientId && c.clientId.toLowerCase() === q) || (c.clientName && c.clientName.toLowerCase() === q));
  const matches = exact.length ? exact : mine.filter((c) =>
    (c.clientId && c.clientId.toLowerCase().includes(q)) || (c.clientName && c.clientName.toLowerCase().includes(q)));

  if (!matches.length) {
    const names = mine.map((c) => `${c.clientName} (${c.clientId})`).join(', ');
    return { text: `No coached client matched "${query}". Your clients: ${names}.`, isError: true };
  }
  if (matches.length > 1) {
    const names = matches.map((c) => `${c.clientName} (${c.clientId})`).join(', ');
    return { text: `"${query}" matched several: ${names}. Re-run with the exact client id.`, isError: true };
  }

  const c = matches[0];
  const portalUrl = c.portalToken ? `https://pb-webhook-server.vercel.app/?token=${c.portalToken}` : '(no token set)';
  const lines = [
    `Client: ${c.clientName} (${c.clientId})`,
    `Status: ${c.status || 'unknown'}${c.serviceLevel ? ` · ${c.serviceLevel}` : ''}`,
    `Login email: ${c.clientEmailAddress || '(none on record)'}`,
    `Leads base id: ${c.airtableBaseId || '(none)'}`,
    c.timezone ? `Timezone: ${c.timezone}` : null,
    `Portal token: ${c.portalToken || '(none set)'}`,
    `Portal URL: ${portalUrl}`,
  ].filter(Boolean);
  return { text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// A client's weekly emails (coach-only, 2026-10-22) - "show me Steve's emails":
// what they have already had, what is set for the coming Monday (and why, and
// its status), and what the planner would likely pick after that. Read-only;
// the same three columns as the Monday emails panel on the client board.
// ---------------------------------------------------------------------------
async function runClientEmails({ client, week } = {}, tenant = TENANT) {
  const planner = require('./clientTouchPlanner');
  const query = String(client || '').trim();
  if (!query) return { text: 'Which client? Pass a name or client id (e.g. "Steve" or "Steve-Nelson").', isError: true };
  const w = String(week || '').trim();
  let out;
  try {
    out = await planner.clientEmailFull(tenant, query, /^\d{4}-\d{2}-\d{2}$/.test(w) ? { week: w } : {});
  } catch (e) {
    return { text: `Couldn't read the weekly emails: ${e.message}`, isError: true };
  }
  if (out.error) return { text: out.error, isError: true };
  return { text: `${out.text}\n\n(To change it - approve, edit, swap, skip, pin or change the thought - use wingguy_weekly_emails.)` };
}

// ---------------------------------------------------------------------------
// The weekly review in chat (coach-only, 2026-10-22) - "let's do this week's emails". Guy goes
// through the coming Monday's weekly client emails with Claude: the week at a glance, each email in
// full, and his verdicts. Every action says back exactly what changed. Nothing here sends anything:
// approved emails go by themselves at 8am Monday, after a fresh check.
// ---------------------------------------------------------------------------
// "Network building, rethought" - the weekly email to Guy's list of prospects (services/listEditions.js,
// designed with Guy 26 Oct 2026). One email a week for him to approve; it goes Wednesday from 9:30am.
async function runListEdition(args = {}, tenant = TENANT) {
  const le = require('./listEditions');
  if (tenant !== (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim()) return { text: "This is the coach's own list - not available here.", isError: true };
  const action = String(args.action || 'status').trim().toLowerCase();
  const d = String(args.week || '').trim();
  const sendDate = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : le.nextSendDate(Date.now());
  try {
    if (action === 'status') return { text: (await le.statusText(tenant)).text };
    if (action === 'show') { const r = await le.showText(tenant, { sendDate }); return { text: r.text, isError: !!r.isError }; }
    if (action === 'write') {
      const r = await le.buildEdition(tenant, sendDate, { direction: args.text || '' });
      if (!r.ok) return { text: r.text, isError: true };
      return { text: `${r.built ? 'Written' : 'Already written'} - "${r.edition.title}".\n\n${(await le.showText(tenant, { sendDate })).text}` };
    }
    if (action === 'test') { const r = await le.testSend(tenant, { sendDate }); return { text: r.text, isError: !r.ok }; }
    if (action === 'add') {
      const r = await le.addToList(tenant, { email: args.email || '', name: args.name || '' });
      return { text: r.text, isError: !r.ok };
    }
    const ed = await le.editionFor(tenant, sendDate);
    if (!ed) return { text: 'Nothing written for that Wednesday yet - use action=write first.', isError: true };
    let r;
    if (action === 'approve') r = await le.approve(tenant, ed.id);
    else if (action === 'hold') r = await le.hold(tenant, ed.id);
    else if (action === 'edit') r = await le.edit(tenant, ed.id, { title: args.title, body: args.body });
    else if (action === 'swap' || action === 'redraft') r = await le.swap(tenant, sendDate, { idea: action === 'swap' ? args.idea : null, direction: args.text || '' });
    else return { text: 'action is one of: status, show, write, approve, edit, swap, redraft, hold, test, add', isError: true };
    if (!r.ok) return { text: r.text, isError: true };
    if (['swap', 'redraft', 'edit'].includes(action)) return { text: `${r.text}\n\n${(await le.showText(tenant, { sendDate })).text}` };
    return { text: r.text };
  } catch (e) {
    return { text: `Error: ${e.message}`, isError: true };
  }
}

async function runWeeklyEmails(args = {}, tenant = TENANT) {
  const planner = require('./clientTouchPlanner');
  const actions = require('./clientTouchActions');
  const action = String(args.action || 'status').trim().toLowerCase();
  const w = String(args.week || '').trim();
  const week = /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null;
  try {
    if (action === 'status') {
      const out = await planner.weekReview(tenant, week);
      let list = '';
      try { list = `${(await require('./listEditions').statusText(tenant)).text}\n(The list edition comes first: wingguy_list_edition action=show, then approve / edit / swap / hold.)\n\n`; } catch (_) { list = ''; }
      return { text: `${list}${out.text}\n\nNext: go through the WAITING ones one at a time with action=show, client=<name>. For each, Guy decides: approve, edit, swap, skip, pin, or change the thought.` };
    }
    if (!args.client) return { text: 'Which client? Pass client (a name or id).', isError: true };
    const r = await actions.resolveClient(tenant, args.client);
    if (r.error) return { text: r.error, isError: true };
    const id = r.client.clientId;
    const showAfter = async (said) => {
      const full = await planner.clientEmailFull(tenant, id, week ? { week } : {});
      return { text: `${said}\n\n${full.text || ''}` };
    };
    let out;
    switch (action) {
      case 'show': {
        const full = await planner.clientEmailFull(tenant, id, week ? { week } : {});
        return full.error ? { text: full.error, isError: true } : { text: full.text };
      }
      case 'approve': out = await actions.approve(tenant, id, { week, override: !!args.anyway }); break;
      case 'note': out = await actions.firstThings(tenant, id, { week, action: args.note, text: args.text }); break;
      case 'edit':
        out = await actions.edit(tenant, id, { week, opening: args.opening, subject: args.subject, body: args.body, congrats: args.congrats });
        return out.ok ? showAfter(out.said) : { text: out.said, isError: true };
      case 'swap':
        out = await actions.swap(tenant, id, { week, piece: args.piece, title: args.title, text: args.text });
        return out.ok ? showAfter(out.said) : { text: out.said, isError: true };
      case 'skip': out = await actions.skip(tenant, id, { week, whyNot: args.why_not, home: args.home, until: args.until }); break;
      case 'pin': out = await actions.pin(tenant, id, { week, piece: args.piece, title: args.title, text: args.text }); break;
      case 'steer':
        out = await actions.steer(tenant, id, { week, text: args.text, ongoing: !!args.ongoing });
        return out.ok ? showAfter(out.said) : { text: out.said, isError: true };
      case 'background': out = await actions.addBackground(tenant, id, { text: args.text }); break;
      case 'thought':
        out = await actions.setThought(tenant, id, { week, piece: args.piece, why: args.why });
        return out.ok ? showAfter(out.said) : { text: out.said, isError: true };
      default: return { text: `Unknown action "${action}". Use status, show, approve, edit, swap, skip, pin, steer, background, thought or note.`, isError: true };
    }
    return out.ok ? { text: out.said } : { text: out.said, isError: true };
  } catch (e) {
    return { text: `Couldn't do that: ${e.message}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Referrals - who introduced whom, and what came of it (coach-only, 2026-09-14)
// ---------------------------------------------------------------------------

function referralLine(r) {
  const person = r.otherClientName ? `${r.otherClientName} (client)` : r.person;
  const who = r.direction === 'From Guy'
    ? `Guy -> ${r.introducedTo || r.clientName || '(recipient not recorded)'}: ${person}`
    : `${r.clientName || '(no client)'} -> Guy: ${person}`;
  const bits = [r.stage || 'no stage', r.introducedOn || 'no date', r.company || null, r.how || null].filter(Boolean);
  const note = String(r.notes || '').split('\n')[0];
  return `  #${r.id}  ${who}  [${bits.join(' · ')}]${note ? `\n      ${note}` : ''}`;
}

async function runReferrals(args = {}, tenant = TENANT) {
  const clientService = require('./clientService');
  const referrals = require('./referralService');
  const action = String(args.action || 'list').toLowerCase();

  let all;
  try {
    all = await clientService.getAllClients();
  } catch (e) {
    return { text: `Couldn't read the client directory: ${e.message}`, isError: true };
  }
  const mine = (all || []).filter((c) => c.coach && c.coach === tenant);
  if (!mine.length) return { text: `No coached clients are visible to "${tenant}". Referrals are coach-only.`, isError: true };

  const findClient = (q) => {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return { client: null };
    const exact = mine.filter((c) => (c.clientId || '').toLowerCase() === s || (c.clientName || '').toLowerCase() === s);
    const hits = exact.length ? exact : mine.filter((c) => (c.clientId || '').toLowerCase().includes(s) || (c.clientName || '').toLowerCase().includes(s));
    if (hits.length === 1) return { client: hits[0] };
    if (!hits.length) return { error: `No coached client matched "${q}". Your clients: ${mine.map((c) => c.clientName).join(', ')}.` };
    return { error: `"${q}" matched several: ${hits.map((c) => `${c.clientName} (${c.clientId})`).join(', ')}. Use the exact client id.` };
  };

  // "Have these two already been introduced?" - the planner's check before suggesting a pair
  // (2026-10-22). Both sides may be clients; the second may also be anyone by name or email.
  if (action === 'met') {
    const { client, error } = findClient(args.client);
    if (error) return { text: error, isError: true };
    if (!client) return { text: 'Which client? Pass client, and the other person as other_client (a client) or person (a name).', isError: true };
    let other = null;
    if (args.other_client) {
      const r = findClient(args.other_client);
      if (r.error) return { text: r.error, isError: true };
      other = r.client;
    } else if (args.person || args.email) {
      other = { name: String(args.person || '').trim(), email: String(args.email || '').trim() };
    }
    if (!other) return { text: 'Who is the other person? Pass other_client (a client) or person (a name, optionally email).', isError: true };
    let scoped;
    try {
      scoped = referrals.scopeToCoach(await referrals.listAllReferrals(), all, tenant);
    } catch (e) {
      return { text: `Couldn't read the Referrals table: ${e.message}`, isError: true };
    }
    const hits = referrals.introductionsBetween(client, other, scoped, all);
    const otherName = other.clientName || other.name || other.email;
    if (!hits.length) return { text: `No introduction between ${client.clientName} and ${otherName} is on record. (The record covers introductions logged here or drafted through Wingguy since 25 Sep 2026 - an older one made by hand may be missing.)` };
    return { text: `Yes - ${client.clientName} and ${otherName} have been introduced (${hits.length} row${hits.length === 1 ? '' : 's'}):\n${hits.map(referralLine).join('\n')}` };
  }

  if (action === 'log') {
    const { client, error } = findClient(args.client);
    if (error) return { text: error, isError: true };
    if (!client) return { text: 'Which client is this introduction tied to? Pass client (the referrer for an intro TO Guy, the recipient for an intro FROM Guy).', isError: true };
    // The other side may be a client too (a client-to-client introduction Guy made by hand):
    // pass other_client and the row links both records. person then defaults to their name.
    let otherClient = null;
    if (args.other_client) {
      const r = findClient(args.other_client);
      if (r.error) return { text: r.error, isError: true };
      otherClient = r.client;
      if (otherClient && otherClient.id === client.id) return { text: 'client and other_client are the same person.', isError: true };
    }
    const person = String(args.person || (otherClient && otherClient.clientName) || '').trim();
    if (!person) return { text: 'Who was introduced? Pass person (their full name), or other_client when they are a client.', isError: true };
    const direction = referrals.normaliseDirection(args.direction);
    if (!direction) return { text: `direction must be "To Guy" or "From Guy" (got "${args.direction}").`, isError: true };
    const stage = args.stage ? referrals.normaliseStage(args.stage) : (direction === 'From Guy' ? 'Promised' : 'Introduced');
    if (!stage) return { text: `Unknown stage "${args.stage}". Stages: ${referrals.STAGES.join(', ')}.`, isError: true };
    try {
      const today = new Date().toISOString().slice(0, 10);
      const row = await referrals.logReferral({
        person, clientRecordId: client.id, direction, stage,
        introducedOn: args.introduced_on || today,
        how: args.how || '', company: args.company || '', linkedinUrl: args.linkedin_url || '',
        email: args.email || (otherClient && otherClient.clientEmailAddress) || '',
        introducedTo: args.introduced_to || (direction === 'From Guy' ? client.clientName : ''),
        notes: args.note ? `${today} - ${args.note}` : '',
        otherClientRecordId: otherClient ? otherClient.id : null,
      });
      const who = direction === 'To Guy'
        ? `${client.clientName} introduced ${person} to Guy`
        : `Guy ${stage === 'Promised' ? 'promised' : 'introduced'} ${person} to ${args.introduced_to || client.clientName}`;
      return { text: `Logged: ${who} (${stage}, ${row.introducedOn}). Row id ${row.id} - use it with action=update to move it along.` };
    } catch (e) {
      return { text: `Couldn't log the referral: ${e.message}`, isError: true };
    }
  }

  if (action === 'update') {
    let rowId = String(args.id || '').trim();
    let scoped;
    try {
      scoped = referrals.scopeToCoach(await referrals.listAllReferrals(), all, tenant);
    } catch (e) {
      return { text: `Couldn't read the Referrals table: ${e.message}`, isError: true };
    }
    if (!rowId && args.person) {
      const s = String(args.person).trim().toLowerCase();
      const exact = scoped.filter((r) => r.person.toLowerCase() === s);
      const hits = exact.length ? exact : scoped.filter((r) => r.person.toLowerCase().includes(s));
      if (hits.length === 1) rowId = hits[0].id;
      else if (!hits.length) return { text: `No referral row matched "${args.person}". Run action=list to see them.`, isError: true };
      else return { text: `"${args.person}" matched several rows:\n${hits.map(referralLine).join('\n')}\nPass id.`, isError: true };
    }
    if (!rowId) return { text: 'Which row? Pass id (from the list) or person.', isError: true };
    if (!scoped.some((r) => r.id === rowId)) return { text: `Row ${rowId} is not one of your referrals.`, isError: true };
    const stage = args.stage ? referrals.normaliseStage(args.stage) : null;
    if (args.stage && !stage) return { text: `Unknown stage "${args.stage}". Stages: ${referrals.STAGES.join(', ')}.`, isError: true };
    let becameClientRecordId = null;
    if (args.became_client) {
      const { client, error } = findClient(args.became_client);
      if (error) return { text: error, isError: true };
      becameClientRecordId = client.id;
    }
    if (stage === 'Signed' && !becameClientRecordId) {
      return { text: 'Signed needs became_client (the new client\'s name or id) so their Introduced By gets set - that is what makes them count. If they are not in the Clients table yet, add them first, then re-run.', isError: true };
    }
    try {
      const row = await referrals.updateReferral(rowId, { stage, note: args.note || '', becameClientRecordId, introducedOn: args.introduced_on || null, how: args.how || null });
      const extra = becameClientRecordId ? ' Introduced By set on their client row - they now count toward the referrer\'s total while Active and paying.' : '';
      return { text: `Updated ${row.person}: ${row.stage}${args.note ? ' (note added)' : ''}.${extra}` };
    } catch (e) {
      return { text: `Couldn't update the referral: ${e.message}`, isError: true };
    }
  }

  // list (default): one client's standing, or the whole book.
  let rows;
  try {
    rows = referrals.scopeToCoach(await referrals.listAllReferrals(), all, tenant);
  } catch (e) {
    return { text: `Couldn't read the Referrals table: ${e.message}`, isError: true };
  }
  const { client, error } = findClient(args.client);
  if (error) return { text: error, isError: true };

  const standing = (c) => {
    const s = referrals.summariseClient(c, all, rows);
    const rate = s.referralRate
      ? ` - AT THE REFERRAL RATE (${s.payingNow} paying)`
      : ` - ${s.payingNow} of ${referrals.REFERRAL_RATE_COUNT} paying referrals toward the reduced rate`;
    const paying = s.payingNames.length ? ` Paying now: ${s.payingNames.join(', ')}.` : '';
    const owed = s.promisedFromGuy.length ? ` Guy still owes intros to: ${s.promisedFromGuy.join(', ')}.` : '';
    return `${c.clientName}: ${s.introduced} introduced (${s.open} in play, ${s.signed} signed), ${s.introsFromGuy} intros back from Guy${rate}.${paying}${owed}`;
  };

  if (client) {
    // A client-to-client introduction hangs off ONE of the two clients; the other is its Person.
    // "Who have I introduced Dean to?" must find it from either side.
    const nameOf = (s) => String(s || '').trim().toLowerCase();
    const theirs = rows.filter((r) => r.clientRecordId === client.id
      || (r.direction === 'From Guy' && nameOf(r.person) === nameOf(client.clientName)));
    const lines = [standing(client), ''];
    lines.push(theirs.length ? theirs.map(referralLine).join('\n') : '  (no introductions on record yet)');
    return { text: lines.join('\n') };
  }

  const active = mine.filter((c) => rows.some((r) => r.clientRecordId === c.id) || referrals.summariseClient(c, all, rows).payingNow > 0);
  const lines = [`Referrals across your book (${rows.length} introductions on record):`, ''];
  for (const c of active) lines.push(standing(c));
  if (!active.length) lines.push('  nobody has introduced anyone yet');
  const open = rows.filter((r) => r.direction === 'To Guy' && referrals.OPEN_STAGES.includes(r.stage));
  const owed = rows.filter((r) => r.direction === 'From Guy' && r.stage === 'Promised');
  lines.push('', `In play (${open.length}):`, open.length ? open.map(referralLine).join('\n') : '  none');
  lines.push('', `Guy owes (${owed.length}):`, owed.length ? owed.map(referralLine).join('\n') : '  none');
  lines.push('', 'Log one: action=log person="Jane Smith" client=<referrer> direction="To Guy" how="LinkedIn group chat". Move one: action=update person="Jane Smith" stage="Call held" note="...". Signed: add became_client=<their client id>.');
  return { text: lines.join('\n') };
}

const LAYER_DESC = 'Rule layer: "client" (this tenant\'s own rule — the default) · "foundation" (platform-wide, ALL tenants read it — reserved for Guy/platform calls) · "template" (the de-personalised seed for new clients; not runtime-read). If it\'s unclear whether a change is personal or platform-wide, ASK the human — never guess foundation.';
const DIVERGENCE_DESC = '"active" (default) = everything currently applying. "divergence" = how this client differs from the shared set, in TWO sections: CHANGED (a shared instruction they replaced with their own version - both bodies side by side, flagged if the standard has moved since) and ADDED (their own instructions with no shared version behind them - shown in full, newest first). Other filters are ignored for divergence.';
const TIER_DESC = 'FOUNDATION ONLY. "standard" (default) = shared and improved centrally, but a client MAY save their own version, which then replaces it for them. "locked" = a guardrail: no client can override it, ever. Locking is deliberate and rare — never set it without the human explicitly asking. Omitted on an edit = the existing tier is kept (editing a locked rule\'s wording never unlocks it).';
const CAMPAIGN_DESC = 'Campaign slug (e.g. "tks", "frac"). A campaign version of a rule_key OVERRIDES the generic version when that campaign is in play; with no campaign (or no campaign version) the generic applies. Omit for the generic/fallback version. Campaign is detected FIRST from the Linked Helper campaign that sent the lead, then from the thread (the user\'s own prior outbound vs the campaign-markers rule); an explicit campaign named by the human always wins. INSTRUCTIONS FOR ONE LINKED HELPER CAMPAIGN: call wingguy_campaigns FIRST, show the human the list and let them pick, then pass that campaign\'s tag exactly as listed - tagging an instruction with it is all it takes for /wg to use it on that campaign\'s leads. Never type or guess a tag yourself: matching is exact, and a near miss silently does nothing.';
const CONTEXT_DESC = `Where the rule applies: ${store.CONTEXTS.join(' | ')}`;
const TYPE_DESC = `What kind of rule: ${store.RULE_TYPES.join(' | ')}`;

// Customer-facing vocabulary (Guy, 2026-07-25). We SAY "instructions"; we ACCEPT
// "rules" as well. "Rules" reads as compliance — something handed to you that you
// must obey; "instructions" puts the human in charge, and is more literally true:
// they instruct the system. Internal naming (rule_key, tool names, the store) is
// deliberately unchanged — nobody sees it.
const VOCAB = ' WORDING: when speaking to the human, call these their "instructions", never their "rules". Treat "rules" and "instructions" as the SAME thing on the way in, though — "update my rules", "update my instructions", "change my instructions" all mean this.';

// The three kinds, in the words the human hears. This is the model the whole tier/override build
// exists to make real: before it, an instruction was either locked away in foundation or handed
// over as a photocopy, with nothing in between.
const THREE_KINDS = ' THREE KINDS OF INSTRUCTION: (1) FIXED — shared guardrails that cannot be changed by anyone (layer=foundation, tier=locked). (2) STANDARD — shared, and improved centrally so everyone gets better over time, BUT the client can save their own version, which then replaces it for them alone (layer=foundation, tier=standard). (3) YOURS — the client\'s own, nobody else has it (layer=client). When a client has their own version of a STANDARD instruction, only THEIR version applies — the two never stack.';

const CAMPAIGNS_DAYS_DESC = 'How far back to read leads, in days (default 120, max 365).';
const CAMPAIGNS_MAX_DESC = 'Most leads to read, newest first (default 1000, max 2000).';

const TOOL_DEFS = [
  {
    name: 'wingguy_campaigns',
    description: 'Lists the Linked Helper campaigns this client\'s leads came from - each campaign\'s exact name, how many recent leads it brought in, its tag, and whether it already has its own instructions. CALL IT FIRST whenever the human wants instructions for one campaign ("for my X campaign..."), asks "what campaigns do I have?", or names a campaign - then show them the list and let THEM pick. Its tag is the campaign value for wingguy_rule_propose / wingguy_rule_get. Campaign matching is exact, so never type a tag yourself. Read-only.' + VOCAB,
    zodSchema: {
      days: z.number().optional().describe(CAMPAIGNS_DAYS_DESC),
      max: z.number().optional().describe(CAMPAIGNS_MAX_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: CAMPAIGNS_DAYS_DESC },
        max: { type: 'number', description: CAMPAIGNS_MAX_DESC },
      },
    },
    run: (args, tenant) => require('./lhCampaignNames').runListCampaigns(args, tenant),
  },
  {
    name: 'wingguy_rules_list',
    description: 'Lists the active Wingguy rules (the shared rulebook both surfaces read), grouped by KIND and showing exactly what reaches the model. Start here when the user says "update my instructions" / "update my rules", asks what their instructions say, or you need to find a rule\'s key. Filterable by context, layer, or campaign. USE view="divergence" for "what have I changed?" / "what\'s different about mine?" / "show me standard vs mine" / "what have I added?" — it answers in two parts: what they CHANGED (their version next to the current shared one, flagged if the standard has moved on since) and what they ADDED (their own instructions with no shared version behind them, in full, newest first). Additions matter: each one is something the shared set did not cover. AMBIGUITY: if the human says "review my instructions"/"review the rules" it could mean this OR reviewing their recent draft edits (wingguy_edit_review) — ask ONE short question offering both, with counts if you have them; but if there are no pending edits, skip the question and just list.' + VOCAB + THREE_KINDS,
    zodSchema: {
      context: z.enum(store.CONTEXTS).optional().describe(CONTEXT_DESC),
      layer: z.enum(store.LAYERS).optional().describe('Filter to one layer, shown RAW with no shadowing applied (default: the runtime view — the shared instructions plus this client\'s own, with their own replacing the standard wherever they have one)'),
      campaign: z.string().optional().describe('Filter to rules tagged with this campaign (e.g. "tks", "frac")'),
      view: z.enum(['active', 'divergence']).optional().describe(DIVERGENCE_DESC),
      limit: z.number().optional().describe('For view=divergence: how many ADDED instructions to show in full, newest first (default 10, max 50). Everything CHANGED is always shown in full.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', enum: store.CONTEXTS, description: CONTEXT_DESC },
        layer: { type: 'string', enum: store.LAYERS, description: 'Filter to one layer, shown RAW with no shadowing applied (default: the runtime view — the shared instructions plus this client\'s own, with their own replacing the standard wherever they have one)' },
        campaign: { type: 'string', description: 'Filter to rules tagged with this campaign (e.g. "tks", "frac")' },
        view: { type: 'string', enum: ['active', 'divergence'], description: DIVERGENCE_DESC },
        limit: { type: 'number', description: 'For view=divergence: how many ADDED instructions to show in full, newest first (default 10, max 50). Everything CHANGED is always shown in full.' },
      },
    },
    run: runRulesList,
  },
  {
    name: 'wingguy_rule_get',
    description: 'Fetches one Wingguy rule: the active body plus its full version history and door audit trail. Use before proposing a change to an existing rule. A rule_key can have a generic version AND per-campaign versions — omit campaign for the generic, pass it for a campaign\'s.' + VOCAB,
    zodSchema: {
      rule_key: z.string().describe('The rule\'s stable kebab-case key (from wingguy_rules_list)'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      campaign: z.string().optional().describe(CAMPAIGN_DESC),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        rule_key: { type: 'string', description: 'The rule\'s stable kebab-case key (from wingguy_rules_list)' },
        layer: { type: 'string', enum: store.LAYERS, description: LAYER_DESC },
        campaign: { type: 'string', description: CAMPAIGN_DESC },
      },
      required: ['rule_key'],
    },
    run: runRuleGet,
  },
  {
    name: 'wingguy_rule_propose',
    description: 'STEP 1 of changing a Wingguy rule ("update my instructions" / "update my rules"). Pure read — writes NOTHING. Returns the current-vs-proposed diff, the neighbouring rules in the same context/type (eyeball them for contradictions), and the expected_version that wingguy_rule_commit requires. If the client is about to save their own version of a STANDARD shared instruction, it says so and prints the standard body they would be replacing — show the human both and check the standard does not already cover it. If the instruction is FIXED, it refuses here and explains why. Show the proposal to the human and get an explicit yes before committing.' + VOCAB + THREE_KINDS,
    zodSchema: {
      rule_key: z.string().describe('Stable kebab-case key. For a NEW rule, coin a descriptive one (e.g. "booking-earliest-start")'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      context: z.enum(store.CONTEXTS).describe(CONTEXT_DESC),
      rule_type: z.enum(store.RULE_TYPES).describe(TYPE_DESC),
      campaign: z.string().optional().describe(CAMPAIGN_DESC),
      tier: z.enum(store.TIERS).optional().describe(TIER_DESC),
      body: z.string().describe('The proposed rule body (markdown). Use {{variables}} and {{asset:key}} placeholders, never tenant-specific literals in foundation/template rules'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        rule_key: { type: 'string', description: 'Stable kebab-case key. For a NEW rule, coin a descriptive one (e.g. "booking-earliest-start")' },
        layer: { type: 'string', enum: store.LAYERS, description: LAYER_DESC },
        context: { type: 'string', enum: store.CONTEXTS, description: CONTEXT_DESC },
        rule_type: { type: 'string', enum: store.RULE_TYPES, description: TYPE_DESC },
        campaign: { type: 'string', description: CAMPAIGN_DESC },
        tier: { type: 'string', enum: store.TIERS, description: TIER_DESC },
        body: { type: 'string', description: 'The proposed rule body (markdown). Use {{variables}} and {{asset:key}} placeholders, never tenant-specific literals in foundation/template rules' },
      },
      required: ['rule_key', 'context', 'rule_type', 'body'],
    },
    run: runRulePropose,
  },
  {
    name: 'wingguy_rule_commit',
    description: 'STEP 2 of changing a Wingguy rule — the write. Only call AFTER wingguy_rule_propose AND the human explicitly confirming the proposal. Requires the expected_version the proposal returned; if the rule moved since, the commit is rejected (re-propose). Inserts a new version and retires the old one — nothing is ever overwritten or deleted.' + VOCAB,
    zodSchema: {
      rule_key: z.string().describe('Same key as the proposal'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      context: z.enum(store.CONTEXTS).describe(CONTEXT_DESC),
      rule_type: z.enum(store.RULE_TYPES).describe(TYPE_DESC),
      campaign: z.string().optional().describe('Same campaign tag as the proposal (if any) — part of the rule\'s identity'),
      tier: z.enum(store.TIERS).optional().describe(TIER_DESC),
      body: z.string().describe('The confirmed rule body'),
      change_note: z.string().optional().describe('One line on what changed and why (shows in history)'),
      expected_version: z.number().describe('The expected_version from wingguy_rule_propose (0 for a new rule)'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        rule_key: { type: 'string', description: 'Same key as the proposal' },
        layer: { type: 'string', enum: store.LAYERS, description: LAYER_DESC },
        context: { type: 'string', enum: store.CONTEXTS, description: CONTEXT_DESC },
        rule_type: { type: 'string', enum: store.RULE_TYPES, description: TYPE_DESC },
        campaign: { type: 'string', description: 'Same campaign tag as the proposal (if any) — part of the rule\'s identity' },
        tier: { type: 'string', enum: store.TIERS, description: TIER_DESC },
        body: { type: 'string', description: 'The confirmed rule body' },
        change_note: { type: 'string', description: 'One line on what changed and why (shows in history)' },
        expected_version: { type: 'number', description: 'The expected_version from wingguy_rule_propose (0 for a new rule)' },
      },
      required: ['rule_key', 'context', 'rule_type', 'body', 'expected_version'],
    },
    run: runRuleCommit,
  },
  {
    name: 'wingguy_rule_reset_to_standard',
    description: 'Drops the client\'s OWN version of an instruction so the shared standard applies to them again. Use when the human says "go back to the standard" / "use the normal one" / "undo my version of X", or after wingguy_rules_list view=divergence shows the standard has moved on and they prefer the new one. FLOW: show them their version AND the current standard (the divergence view prints both), get an explicit yes, THEN call this — never reset without confirmation. Append-only: their version is archived, not deleted, and wingguy_rule_revert brings it back. Refuses if there is no shared standard behind the instruction (it is theirs alone — that would be deleting it, not resetting it).' + VOCAB + THREE_KINDS,
    zodSchema: {
      rule_key: z.string().describe('The instruction whose personal version should be dropped (from wingguy_rules_list view=divergence)'),
      campaign: z.string().optional().describe('Which version chain to reset: omit for the generic, pass the campaign slug for a campaign\'s'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        rule_key: { type: 'string', description: 'The instruction whose personal version should be dropped (from wingguy_rules_list view=divergence)' },
        campaign: { type: 'string', description: 'Which version chain to reset: omit for the generic, pass the campaign slug for a campaign\'s' },
      },
      required: ['rule_key'],
    },
    run: runResetToStandard,
  },
  {
    name: 'wingguy_rule_revert',
    description: 'Reverts a Wingguy rule to an earlier version by inserting a NEW version carrying the old body (append-only — history is never rewritten). Use wingguy_rule_get first to see the versions.' + VOCAB,
    zodSchema: {
      rule_key: z.string().describe('The rule to revert'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      campaign: z.string().optional().describe('Which version chain to revert: omit for the generic, pass the campaign slug for a campaign\'s'),
      to_version: z.number().describe('The version number whose body to restore'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        rule_key: { type: 'string', description: 'The rule to revert' },
        layer: { type: 'string', enum: store.LAYERS, description: LAYER_DESC },
        campaign: { type: 'string', description: 'Which version chain to revert: omit for the generic, pass the campaign slug for a campaign\'s' },
        to_version: { type: 'number', description: 'The version number whose body to restore' },
      },
      required: ['rule_key', 'to_version'],
    },
    run: runRuleRevert,
  },
  {
    name: 'wingguy_variables',
    description: 'Lists this tenant\'s Wingguy variables ({{placeholders}} the rules reference — names, links, sign-offs), and optionally sets one. Setting a value is history-logged. To CHANGE a rule\'s wording use the propose/commit tools; variables are for the fill-in values.',
    zodSchema: {
      set_key: z.string().optional().describe('Variable key to set (omit to just list)'),
      set_value: z.string().optional().describe('The value to store for set_key'),
      description: z.string().optional().describe('Optional catalog description when introducing a new variable'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        set_key: { type: 'string', description: 'Variable key to set (omit to just list)' },
        set_value: { type: 'string', description: 'The value to store for set_key' },
        description: { type: 'string', description: 'Optional catalog description when introducing a new variable' },
      },
    },
    run: runVariables,
  },
  {
    name: 'wingguy_assets',
    description: 'Lists this tenant\'s ASSET LIBRARY (the {{asset:key}} links the rules send out — articles, videos, decks, the Zoom room), and optionally adds or updates one. Use when the human says "add this article to my assets", asks what links exist, or an asset\'s URL moved. WHEN A LINK MOVES: point the SAME key at the new URL (every rule referencing it is then instantly right), and park the OLD address on a retired key of its own (e.g. retired_<what_it_was>) - retired URLs are refused by the draft door, so the dead one can never go out again. Adding an asset does NOT make it go out — an asset-usage rule must reference it (propose/commit a rule change for that). Changes are history-logged.',
    zodSchema: {
      set_key: z.string().optional().describe('Asset key to add/update (kebab/snake case, e.g. "newsletter_article_advocacy"). Omit to just list.'),
      set_url: z.string().optional().describe('The asset\'s URL — stored EXACTLY as given (rules never compose or alter URLs)'),
      set_kind: z.string().optional().describe('Optional kind tag, e.g. article | video | deck | page | link'),
      retire: z.boolean().optional().describe('Set true to retire set_key instead of updating it. Retired means DEAD: the key stops resolving in rules AND its stored URL is refused by wingguy_create_draft, so a link that has moved can never go out again - even pasted in literally. To ban an old address, leave it on the retired row rather than blanking it'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        set_key: { type: 'string', description: 'Asset key to add/update (kebab/snake case, e.g. "newsletter_article_advocacy"). Omit to just list.' },
        set_url: { type: 'string', description: 'The asset\'s URL — stored EXACTLY as given (rules never compose or alter URLs)' },
        set_kind: { type: 'string', description: 'Optional kind tag, e.g. article | video | deck | page | link' },
        retire: { type: 'boolean', description: 'Set true to retire set_key instead of updating it. Retired means DEAD: the key stops resolving in rules AND its stored URL is refused by wingguy_create_draft, so a link that has moved can never go out again - even pasted in literally. To ban an old address, leave it on the retired row rather than blanking it' },
      },
    },
    run: runAssets,
  },
  {
    name: 'wingguy_get_client',
    description: 'Coach-only directory lookup: fetch one of YOUR coached clients\' setup details — portal token + ready-to-paste portal URL, login email, and leads base id — by name or client id. Use when you need a client\'s portal link (e.g. for a welcome email), their login email, or their Airtable base id. Scoped to the calling coach: it only ever returns clients whose Coach is you, so it cannot read another coach\'s or an unrelated client\'s record. Returns the portal TOKEN, which is a portal access key — treat it as sensitive.',
    zodSchema: {
      client: z.string().describe('Client name or client id to look up (e.g. "McPhee" or "Guy-McPhee"). Matched within your coached clients only.'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Client name or client id to look up (e.g. "McPhee" or "Guy-McPhee"). Matched within your coached clients only.' },
      },
      required: ['client'],
    },
    run: runGetClient,
  },
  {
    name: 'wingguy_client_emails',
    description: 'Coach-only: one of YOUR clients\' weekly emails from Guy (the weekly client touch planner) - "show me Steve\'s emails", "what\'s Rick getting on Monday?", "what has Mehnaaz had?", "what\'s coming up for Sam?". Returns three parts: ALREADY HAD (every email on their touch record, newest first, with dates - one-pagers, habit emails, Mindset Mastery editions, setup steps, one-offs, call offers); THIS WEEK (the email set for the coming week, why it was chosen, its opening and its status - waiting for approval, approved, held because something changed, sent); LIKELY NEXT (the next five weeks the planner would pick IF NOTHING CHANGES - provisional, because events such as a first call booked or a campaign running low can jump the queue). Read-only, and shows the email IN FULL as it would go. Changes (approve, edit, swap, skip, pin, change the thought) are made with wingguy_weekly_emails. Scoped to the calling coach\'s clients.',
    zodSchema: {
      client: z.string().describe('Client name or client id (e.g. "Steve" or "Steve-Nelson"). Matched within your coached clients only.'),
      week: z.string().optional().describe('YYYY-MM-DD of a Monday to look at instead of the coming one (e.g. last Monday, to see what went and what was held).'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Client name or client id (e.g. "Steve" or "Steve-Nelson"). Matched within your coached clients only.' },
        week: { type: 'string', description: 'YYYY-MM-DD of a Monday to look at instead of the coming one (e.g. last Monday, to see what went and what was held).' },
      },
      required: ['client'],
    },
    run: runClientEmails,
  },
  {
    name: 'wingguy_weekly_emails',
    description: 'Coach-only: run the weekly review of the emails Guy sends his clients each Monday - "let\'s do this week\'s emails", "go through the Monday emails", "approve Rick\'s email", "swap Sam\'s email for What\'s your network for?", "skip Julian this week, he is away". THE WAY TO RUN IT: start with action=status (the coming Monday at a glance: waiting, held, approved, sent, quiet, left out, with names). Then take the WAITING and HELD ones one at a time: action=show with the client prints that email IN FULL exactly as it would go (subject, greeting, opening, body, thought for the week, sign-off), why it was picked, why that thought, what they have already had, what is likely next, and any brief. Read it to Guy plainly, then do what he says: approve (if the fact guard flagged a claim and Guy says he has checked it, anyway=true); note (when it says SEND A PERSONAL NOTE FIRST - note=sent with text = what he sent, or note=dismiss; until then the weekly email cannot be approved); edit (his own words for the opening, subject or body - an edit counts as approved); swap (another approved piece by name, or a custom email: title + text in his words - waits for approval again); skip (with his why-not - home: body / choice / person / openings files it where it fixes the cause; until=YYYY-MM-DD for nothing until a date); pin (a piece or custom email for a later Monday, default the one after); steer (Guy\'s DIRECTION for this client\'s email that week - what it should be about, in his words, e.g. "tell Dean what I\'m doing with my own outreach, the idea not the search": the planner rewrites the email from it and everything on record, then it waits for approval; ongoing=true also puts it on their note for every week); background (something about the client that should shape every email from now on - who they are to Guy, what they care about, what to avoid: added to their note; show prints the note as YOUR NOTE ON THEM); thought (change the thought for the week: piece = a piece name, or "none"). In Guy\'s own text (swap / pin / edit body) a paragraph starting "> " becomes a highlighted quote box, with the credit on a "- " line under it. When Guy talks about a client - background, what he wants for them this week or from now on - use steer and background rather than writing the email yourself. Every action replies with exactly what changed - tell Guy that, in his words. Nothing here sends by itself: approving (or editing, which approves) puts the email on Guy\'s Scheduled page in the portal, and it goes from his own Gmail at 9:30am the client\'s time that Wednesday after a last check; change, swap or skip it and the scheduled copy comes off. Unapproved ones are never sent. Every client email going out is on that one page. GUY SENDS IT HIMSELF (his way since 24 Oct 2026): "push" = put the email he agreed in chat into his Drafts with wingguy_create_draft, then skip that week\'s row here and add a background line saying exactly what went (subject, the quote or idea, any link), so later weeks never repeat it. "schedule" = wingguy_schedule_email with kind=weekly, client and note - it goes Wednesday 9:30am their time from his own mailbox, skips the week\'s row and records what went by itself. Never approve, edit, swap or skip anything Guy has not said to.',
    zodSchema: {
      action: z.enum(['status', 'show', 'approve', 'edit', 'swap', 'skip', 'pin', 'steer', 'background', 'thought', 'note']).optional().describe('status (default) | show | approve | edit | swap | skip | pin | steer | background | thought | note'),
      ongoing: z.boolean().optional().describe('steer: true = this direction is for every week from now on (also goes on their note)'),
      anyway: z.boolean().optional().describe('approve: true when Guy has checked a fact-guard finding and wants it to go anyway'),
      note: z.enum(['sent', 'dismiss']).optional().describe('note: sent (Guy sent the personal note himself - put what he sent in text) or dismiss (not needed)'),
      client: z.string().optional().describe('Client name or id (every action except status)'),
      week: z.string().optional().describe('YYYY-MM-DD of the Monday; default the coming one'),
      opening: z.string().optional().describe('edit: Guy\'s words for the opening'),
      subject: z.string().optional().describe('edit: a new subject line'),
      body: z.string().optional().describe('edit: Guy\'s words for the body (blank line between paragraphs)'),
      congrats: z.string().optional().describe('edit, the welcome email only: the Congratulations line in his words, or "" to leave it out'),
      piece: z.string().optional().describe('swap / pin / thought: an approved piece by name or slug ("none" for thought removes it)'),
      title: z.string().optional().describe('swap / pin, custom email: its title'),
      text: z.string().optional().describe('swap / pin, custom email: the email in Guy\'s words; steer: his direction for that email; background: what to add to their note'),
      why: z.string().optional().describe('thought: one line on why this one (shown to Guy later)'),
      why_not: z.string().optional().describe('skip: why not, in a few words'),
      home: z.enum(['body', 'choice', 'person', 'openings']).optional().describe('skip: what the why-not is about - the body (that point is wrong), the choice (too soon...), the person (how to write to them - goes on their note), openings (how openings are written)'),
      until: z.string().optional().describe('skip: YYYY-MM-DD - nothing for them until then'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'show', 'approve', 'edit', 'swap', 'skip', 'pin', 'thought', 'note'], description: 'status (default) | show | approve | edit | swap | skip | pin | thought | note' },
        anyway: { type: 'boolean', description: 'approve: true when Guy has checked a fact-guard finding and wants it to go anyway' },
        note: { type: 'string', enum: ['sent', 'dismiss'], description: 'note: sent (Guy sent the personal note himself - put what he sent in text) or dismiss (not needed)' },
        client: { type: 'string', description: 'Client name or id (every action except status)' },
        week: { type: 'string', description: 'YYYY-MM-DD of the Monday; default the coming one' },
        opening: { type: 'string', description: 'edit: Guy\'s words for the opening' },
        subject: { type: 'string', description: 'edit: a new subject line' },
        body: { type: 'string', description: 'edit: Guy\'s words for the body (blank line between paragraphs)' },
        congrats: { type: 'string', description: 'edit, the welcome email only: the Congratulations line in his words, or "" to leave it out' },
        piece: { type: 'string', description: 'swap / pin / thought: an approved piece by name or slug ("none" for thought removes it)' },
        title: { type: 'string', description: 'swap / pin, custom email: its title' },
        text: { type: 'string', description: 'swap / pin, custom email: the email in Guy\'s words' },
        why: { type: 'string', description: 'thought: one line on why this one' },
        why_not: { type: 'string', description: 'skip: why not, in a few words' },
        home: { type: 'string', enum: ['body', 'choice', 'person', 'openings'], description: 'skip: what the why-not is about' },
        until: { type: 'string', description: 'skip: YYYY-MM-DD - nothing for them until then' },
      },
    },
    run: runWeeklyEmails,
  },
  {
    name: 'wingguy_list_edition',
    description: 'Coach-only: "Network building, rethought" - Guy\'s weekly email to his LIST of prospects (the people tagged mindset mastery - the old Mindset Mastery list - plus anyone added with the Weekly button on the Today tab). NOT the client emails (those are wingguy_weekly_emails). ONE email a week, the same for everyone except the name; it goes Wednesday from 9:30am Brisbane, one email per person from guy@knowaguy.com.au with replies to Guy\'s inbox - but ONLY once Guy approves it. In "let\'s do this week\'s emails" it comes FIRST. THE WAY TO RUN IT: action=show prints the edition in full as a regular gets it, who it goes to (how many, how many first-timers, who is left off and why) and the next two ideas coming up; read it to Guy plainly, then do what he says: approve; edit (his own words: title and/or body, blank line between paragraphs - an edit counts as approved); swap (idea = another idea from the library by name, e.g. "Never Eat Alone" - it is rewritten and waits for approval); redraft (text = his direction for how it should be told); hold (nothing goes this week); write (write the edition now if it is not written yet); test (a test copy of each version to Guy only - the inbox-or-spam check); add (put someone on the list: email or name). Every edition tells ONE idea through network building, then a fixed closer inviting a reply, the sign-off and the unsubscribe line. A newcomer\'s first email is the fixed "What does better mean?" piece. Never approve, edit or swap anything Guy has not said to.',
    zodSchema: {
      action: z.enum(['status', 'show', 'write', 'approve', 'edit', 'swap', 'redraft', 'hold', 'test', 'add']).optional().describe('status (default) | show | write | approve | edit | swap | redraft | hold | test | add'),
      week: z.string().optional().describe('YYYY-MM-DD of the Wednesday; default the coming one'),
      title: z.string().optional().describe('edit: a new title (the subject is "Network building, rethought - <title>")'),
      body: z.string().optional().describe('edit: Guy\'s words for the body - blank line between paragraphs'),
      idea: z.string().optional().describe('swap: an idea from the library by name or id'),
      text: z.string().optional().describe('redraft / write: Guy\'s direction for how this edition should be told'),
      email: z.string().optional().describe('add: their email'),
      name: z.string().optional().describe('add: their name, when there is no email to hand'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'show', 'write', 'approve', 'edit', 'swap', 'redraft', 'hold', 'test', 'add'], description: 'status (default) | show | write | approve | edit | swap | redraft | hold | test | add' },
        week: { type: 'string', description: 'YYYY-MM-DD of the Wednesday; default the coming one' },
        title: { type: 'string', description: 'edit: a new title' },
        body: { type: 'string', description: 'edit: Guy\'s words for the body - blank line between paragraphs' },
        idea: { type: 'string', description: 'swap: an idea from the library by name or id' },
        text: { type: 'string', description: 'redraft / write: Guy\'s direction' },
        email: { type: 'string', description: 'add: their email' },
        name: { type: 'string', description: 'add: their name' },
      },
    },
    run: runListEdition,
  },
  {
    name: 'wingguy_referrals',
    description: 'Coach-only referral tracking: who introduced whom to Guy, what came of each introduction, and what Guy owes back. action=list (default) shows one client\'s standing (pass client) or the whole book: introductions in play, signed, how many referred clients are ACTIVE AND PAYING right now (the maintained count that earns the reduced rate - 3 = at the rate), and the intros Guy has promised but not yet made. action=log records a new introduction (person + client + direction: "To Guy" = the client introduced this person to Guy; "From Guy" = Guy introduced this person to the client or to a prospect - pass introduced_to). action=update moves a row along (stage, note); stage=Signed also needs became_client so the new client\'s Introduced By is set. Use it whenever an introduction is made, a referred prospect has a call or demo, or Guy asks "how many has X referred" / "what do I owe Roland". INTRODUCTIONS GUY MAKES are logged BY THEMSELVES when drafted through wingguy_create_draft (one email to two people, at least one a client): a From Guy row at Promised, moved to Introduced once the send shows up. Do NOT log those again here - only log introductions made outside a Wingguy draft (phone, LinkedIn, in person, a Gmail Guy wrote himself). When BOTH sides are clients ("I introduced Rick to Roland"), pass client AND other_client so both records are linked - person is then optional. action=met answers "have these two already been introduced?" (client + other_client, or client + person) - run it BEFORE suggesting or drafting an introduction. "Who have I introduced X to?" = action=list client=X (finds X on either side). When the queue/brief lists INTRODUCTIONS TO CHECK ON, record Guy\'s answer with action=update: they met -> stage "Call held", went nowhere -> "Went quiet", anything else -> a note.',
    zodSchema: {
      action: z.enum(['list', 'log', 'update', 'met']).optional().describe('list (default) | log a new introduction | update an existing row | met: have these two been introduced?'),
      other_client: z.string().optional().describe('log/met: the OTHER side when they are also a client (name or id). Links both client records.'),
      client: z.string().optional().describe('Client name or id. list: narrow to this client. log: the client the intro is tied to (referrer for To Guy, recipient for From Guy).'),
      person: z.string().optional().describe('The person introduced (full name). log: required. update: identifies the row when id is not given.'),
      id: z.string().optional().describe('update: the row id from the list (rec...)'),
      direction: z.string().optional().describe('log: "To Guy" (default) or "From Guy"'),
      stage: z.string().optional().describe('Promised | Introduced | Call held | Demo held | Signed | Went quiet | Not a fit | Not a prospect'),
      note: z.string().optional().describe('One line on what happened - stamped with today\'s date, newest first'),
      introduced_on: z.string().optional().describe('YYYY-MM-DD the intro was made (log defaults to today)'),
      how: z.string().optional().describe('Channel: LinkedIn group chat, email cc, Calendly self-booked, on a call...'),
      company: z.string().optional().describe('log: their company'),
      linkedin_url: z.string().optional().describe('log: their LinkedIn URL'),
      email: z.string().optional().describe('log: their email'),
      introduced_to: z.string().optional().describe('log, From Guy only: who Guy introduced them to, by name'),
      became_client: z.string().optional().describe('update with stage=Signed: the new client\'s name or id'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'log', 'update', 'met'], description: 'list (default) | log a new introduction | update an existing row | met: have these two been introduced?' },
        other_client: { type: 'string', description: 'log/met: the OTHER side when they are also a client (name or id). Links both client records.' },
        client: { type: 'string', description: 'Client name or id. list: narrow to this client. log: the client the intro is tied to (referrer for To Guy, recipient for From Guy).' },
        person: { type: 'string', description: 'The person introduced (full name). log: required. update: identifies the row when id is not given.' },
        id: { type: 'string', description: 'update: the row id from the list (rec...)' },
        direction: { type: 'string', description: 'log: "To Guy" (default) or "From Guy"' },
        stage: { type: 'string', description: 'Promised | Introduced | Call held | Demo held | Signed | Went quiet | Not a fit | Not a prospect' },
        note: { type: 'string', description: 'One line on what happened - stamped with today\'s date, newest first' },
        introduced_on: { type: 'string', description: 'YYYY-MM-DD the intro was made (log defaults to today)' },
        how: { type: 'string', description: 'Channel: LinkedIn group chat, email cc, Calendly self-booked, on a call...' },
        company: { type: 'string', description: 'log: their company' },
        linkedin_url: { type: 'string', description: 'log: their LinkedIn URL' },
        email: { type: 'string', description: 'log: their email' },
        introduced_to: { type: 'string', description: 'log, From Guy only: who Guy introduced them to, by name' },
        became_client: { type: 'string', description: 'update with stage=Signed: the new client\'s name or id' },
      },
    },
    run: runReferrals,
  },
  {
    name: 'wingguy_edit_review',
    description: 'Learn-from-my-edit ("review my edits" / "review my rules from my edits"). Lists the pending generated-vs-sent pairs — LinkedIn sends captured by the extension AND emails drafted via wingguy_create_draft then edited in the mail client before sending (settled automatically on each list). Each pair is a draft Wingguy wrote next to what the human ACTUALLY sent. Discuss each diff with the human (one-off vs preference), fold recurring changes into ONE rule via the normal wingguy_rule_propose→commit door (prefer amending an existing rule over adding one), then close pairs out with action=resolve. This tool never writes rules itself. AMBIGUITY: a bare "review the rules" might mean the rulebook (wingguy_rules_list) instead — when unclear, ask ONE short question offering both.',
    zodSchema: {
      action: z.enum(['list', 'resolve']).optional().describe('list (default) shows pairs; resolve closes them out after discussion'),
      ids: z.array(z.number()).optional().describe('For resolve: the pair ids to close out'),
      resolution: z.enum(['reviewed', 'dismissed']).optional().describe('For resolve: reviewed (discussed, default) or dismissed (noise / mispaired capture)'),
      note: z.string().optional().describe('For resolve: one line on the outcome (e.g. "folded into greeting-style v3" or "one-off for that lead")'),
      status: z.enum(['pending', 'reviewed', 'dismissed', 'all']).optional().describe('For list: which pairs to show (default pending)'),
      limit: z.number().optional().describe('For list: max pairs to return (default 20)'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'resolve'], description: 'list (default) shows pairs; resolve closes them out after discussion' },
        ids: { type: 'array', items: { type: 'number' }, description: 'For resolve: the pair ids to close out' },
        resolution: { type: 'string', enum: ['reviewed', 'dismissed'], description: 'For resolve: reviewed (discussed, default) or dismissed (noise / mispaired capture)' },
        note: { type: 'string', description: 'For resolve: one line on the outcome (e.g. "folded into greeting-style v3" or "one-off for that lead")' },
        status: { type: 'string', enum: ['pending', 'reviewed', 'dismissed', 'all'], description: 'For list: which pairs to show (default pending)' },
        limit: { type: 'number', description: 'For list: max pairs to return (default 20)' },
      },
    },
    run: runEditReview,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register all rules tools on an McpServer instance.
 *  `tenant` scopes every executor to the caller's client (per-request; defaults to Guy). */
function registerWingguyRulesTools(server, tenant = TENANT) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {}, tenant);
          return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }
}

/** Legacy endpoint (the /mcp path): tools/list entries. */
function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

/**
 * Legacy endpoint: dispatch a tools/call. Returns the JSON-RPC `result` payload, or null if
 * the tool name isn't ours (caller falls through to its own tools).
 */
async function legacyToolCall(toolName, args, tenant = TENANT) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

// Stamp every sentence a client is told to type into the description of the tool that answers it
// (content/client-phrases.json). Must run before export - see utils/clientPhrases.js for the why.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyRulesTools, legacyToolList, legacyToolCall, TOOL_DEFS };
