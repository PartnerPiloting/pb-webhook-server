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
const ACTOR = `mcp:${TENANT}`;

// ---------------------------------------------------------------------------
// Executors — shared by both transports; return { text, isError? }
// ---------------------------------------------------------------------------

function ruleLine(r) {
  const camp = r.campaign ? ` [campaign:${r.campaign}]` : '';
  return `- ${r.rule_key} (v${r.version}, ${r.layer}, ${r.context}/${r.rule_type}${camp})`;
}

function scopeFromLayer(layer) {
  // client rules belong to the wired tenant; foundation/template are tenant-less
  return layer === 'client' ? { layer, tenantId: TENANT } : { layer, tenantId: undefined };
}

async function runRulesList({ context, layer, campaign } = {}) {
  const rules = await store.getActiveRules({
    tenantId: TENANT,
    contexts: context ? [context] : undefined,
    layer: layer || undefined,
    campaign: campaign || undefined,
  });
  if (!rules.length) return { text: 'No active rules matched. (An empty store is expected until the Notion import runs.)' };
  const byLayer = {};
  for (const r of rules) (byLayer[r.layer] = byLayer[r.layer] || []).push(r);
  const parts = [];
  for (const [lyr, rows] of Object.entries(byLayer)) {
    parts.push(`${lyr} (${rows.length}):\n${rows.map(ruleLine).join('\n')}`);
  }
  return { text: `Active Wingguy rules for ${TENANT}:\n\n${parts.join('\n\n')}\n\nUse wingguy_rule_get for a rule's body + history.` };
}

async function runRuleGet({ rule_key, layer = 'client', campaign }) {
  const found = await store.getRule({ ...scopeFromLayer(layer), ruleKey: rule_key, campaign: campaign || undefined });
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
    lines.push(`# ${rule_key} (ACTIVE v${active.version}, ${active.layer}, ${active.context}/${active.rule_type}${active.campaign ? `, campaign:${active.campaign}` : ''})`);
    lines.push('', active.body, '');
  } else {
    lines.push(`# ${rule_key} — RETIRED (no active version)`, '');
  }
  lines.push(`Versions (${versions.length}):`);
  for (const v of versions) {
    lines.push(`- v${v.version} ${v.status}${v.change_note ? ` — "${v.change_note}"` : ''}${v.created_by ? ` (by ${v.created_by})` : ''} ${v.created_at || ''}`);
  }
  if (history.length) {
    lines.push('', `Door history (${history.length} recent):`);
    for (const h of history) {
      lines.push(`- ${h.created_at || ''} ${h.action} ${h.from_version != null ? `v${h.from_version}→` : ''}${h.to_version != null ? `v${h.to_version}` : ''} by ${h.actor || '?'}`);
    }
  }
  return { text: lines.join('\n') };
}

async function runRulePropose({ rule_key, layer = 'client', context, rule_type, campaign, body }) {
  const prop = await store.proposeRule({
    ...scopeFromLayer(layer),
    ruleKey: rule_key,
    context,
    ruleType: rule_type,
    campaign: campaign || undefined,
    body,
  });
  const lines = [
    `PROPOSAL for ${prop.isNew ? 'NEW rule' : `rule (currently v${prop.currentVersion})`} "${prop.ruleKey}"`,
    `Scope: ${prop.layer}${prop.tenantId ? ` / ${prop.tenantId}` : ' (platform-wide — every tenant reads this)'} · ${prop.context}/${prop.ruleType}${prop.campaign ? ` · campaign:${prop.campaign}` : ''}`,
    '',
  ];
  if (!prop.isNew) {
    lines.push('--- CURRENT body ---', prop.currentBody || '(empty)', '', '--- PROPOSED body ---', prop.proposedBody, '');
  } else {
    lines.push('--- PROPOSED body (new rule) ---', prop.proposedBody, '');
  }
  if (prop.neighbours.length) {
    lines.push(`Neighbours in ${prop.context}/${prop.ruleType} (check for overlap/contradiction — this IS the v1 conflict check):`);
    for (const n of prop.neighbours) lines.push(`- ${n.rule_key} (v${n.version}, ${n.layer}): ${String(n.body).slice(0, 160)}${String(n.body).length > 160 ? '…' : ''}`);
    lines.push('');
  } else {
    lines.push('No neighbouring rules in this context/type.', '');
  }
  lines.push(
    `To commit after the human confirms: wingguy_rule_commit with expected_version=${prop.expectedVersion} (and the same scope + body).`,
    'Do NOT commit without showing this proposal to the human and getting an explicit yes.',
  );
  return { text: lines.join('\n') };
}

async function runRuleCommit({ rule_key, layer = 'client', context, rule_type, campaign, body, change_note, expected_version }) {
  const r = await store.commitRule({
    ...scopeFromLayer(layer),
    ruleKey: rule_key,
    context,
    ruleType: rule_type,
    campaign: campaign || undefined,
    body,
    changeNote: change_note || null,
    createdBy: ACTOR,
    expectedVersion: expected_version,
  });
  return {
    text: `Committed: "${r.ruleKey}" is now v${r.version} (${layer}${r.tenantId ? `/${r.tenantId}` : ''}).` +
      `${r.previousVersion ? ` v${r.previousVersion} retired (still in history — revert any time).` : ' First version.'}`,
  };
}

async function runRuleRevert({ rule_key, layer = 'client', campaign, to_version }) {
  const r = await store.revertRule({
    ...scopeFromLayer(layer),
    ruleKey: rule_key,
    campaign: campaign || undefined,
    toVersion: to_version,
    createdBy: ACTOR,
  });
  return { text: `Reverted: "${r.ruleKey}" v${r.version} now carries the v${to_version} body (append-only — nothing was deleted).` };
}

async function runVariables({ set_key, set_value, description } = {}) {
  if (set_key !== undefined && set_key !== null && String(set_key).trim()) {
    await store.setVariable({ tenantId: TENANT, varKey: set_key, value: set_value ?? null, description, actor: ACTOR });
  }
  const vars = await store.getVariables({ tenantId: TENANT });
  if (!vars.length) return { text: 'No variables in the catalog yet (they arrive with the Notion import / de-personalisation pass).' };
  const lines = vars.map((v) => `- ${v.var_key} = ${v.value == null ? '(unset)' : JSON.stringify(v.value)}${v.required ? ' [required]' : ''}${v.description ? ` — ${v.description}` : ''}`);
  return { text: `Wingguy variables for ${TENANT}:\n${lines.join('\n')}` };
}

// ---------------------------------------------------------------------------
// Definitions — one source of truth for names/descriptions/schemas
// ---------------------------------------------------------------------------

const LAYER_DESC = 'Rule layer: "client" (this tenant\'s own rule — the default) · "foundation" (platform-wide, ALL tenants read it — reserved for Guy/platform calls) · "template" (the de-personalised seed for new clients; not runtime-read). If it\'s unclear whether a change is personal or platform-wide, ASK the human — never guess foundation.';
const CAMPAIGN_DESC = 'Campaign slug (e.g. "tks", "frac"). A campaign version of a rule_key OVERRIDES the generic version when that campaign is in play; with no campaign (or no campaign version) the generic applies. Omit for the generic/fallback version. Campaign is detected from the thread: scan the user\'s own prior outbound for a campaign\'s marker phrases (see the campaign-markers rule); an explicit campaign named by the human always wins.';
const CONTEXT_DESC = `Where the rule applies: ${store.CONTEXTS.join(' | ')}`;
const TYPE_DESC = `What kind of rule: ${store.RULE_TYPES.join(' | ')}`;

const TOOL_DEFS = [
  {
    name: 'wingguy_rules_list',
    description: 'Lists the active Wingguy rules (the shared rulebook both surfaces read). Start here when the user says "update my rules", asks what the rules say, or you need to find a rule\'s key. Filterable by context, layer, or campaign.',
    zodSchema: {
      context: z.enum(store.CONTEXTS).optional().describe(CONTEXT_DESC),
      layer: z.enum(store.LAYERS).optional().describe('Filter to one layer (default: the runtime view — foundation + this tenant\'s client rules)'),
      campaign: z.string().optional().describe('Filter to rules tagged with this campaign (e.g. "tks", "frac")'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', enum: store.CONTEXTS, description: CONTEXT_DESC },
        layer: { type: 'string', enum: store.LAYERS, description: 'Filter to one layer (default: the runtime view — foundation + this tenant\'s client rules)' },
        campaign: { type: 'string', description: 'Filter to rules tagged with this campaign (e.g. "tks", "frac")' },
      },
    },
    run: runRulesList,
  },
  {
    name: 'wingguy_rule_get',
    description: 'Fetches one Wingguy rule: the active body plus its full version history and door audit trail. Use before proposing a change to an existing rule. A rule_key can have a generic version AND per-campaign versions — omit campaign for the generic, pass it for a campaign\'s.',
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
    description: 'STEP 1 of changing a Wingguy rule ("update my rules"). Pure read — writes NOTHING. Returns the current-vs-proposed diff, the neighbouring rules in the same context/type (eyeball them for contradictions), and the expected_version that wingguy_rule_commit requires. Show the proposal to the human and get an explicit yes before committing.',
    zodSchema: {
      rule_key: z.string().describe('Stable kebab-case key. For a NEW rule, coin a descriptive one (e.g. "booking-earliest-start")'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      context: z.enum(store.CONTEXTS).describe(CONTEXT_DESC),
      rule_type: z.enum(store.RULE_TYPES).describe(TYPE_DESC),
      campaign: z.string().optional().describe(CAMPAIGN_DESC),
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
        body: { type: 'string', description: 'The proposed rule body (markdown). Use {{variables}} and {{asset:key}} placeholders, never tenant-specific literals in foundation/template rules' },
      },
      required: ['rule_key', 'context', 'rule_type', 'body'],
    },
    run: runRulePropose,
  },
  {
    name: 'wingguy_rule_commit',
    description: 'STEP 2 of changing a Wingguy rule — the write. Only call AFTER wingguy_rule_propose AND the human explicitly confirming the proposal. Requires the expected_version the proposal returned; if the rule moved since, the commit is rejected (re-propose). Inserts a new version and retires the old one — nothing is ever overwritten or deleted.',
    zodSchema: {
      rule_key: z.string().describe('Same key as the proposal'),
      layer: z.enum(store.LAYERS).optional().describe(LAYER_DESC),
      context: z.enum(store.CONTEXTS).describe(CONTEXT_DESC),
      rule_type: z.enum(store.RULE_TYPES).describe(TYPE_DESC),
      campaign: z.string().optional().describe('Same campaign tag as the proposal (if any) — part of the rule\'s identity'),
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
        body: { type: 'string', description: 'The confirmed rule body' },
        change_note: { type: 'string', description: 'One line on what changed and why (shows in history)' },
        expected_version: { type: 'number', description: 'The expected_version from wingguy_rule_propose (0 for a new rule)' },
      },
      required: ['rule_key', 'context', 'rule_type', 'body', 'expected_version'],
    },
    run: runRuleCommit,
  },
  {
    name: 'wingguy_rule_revert',
    description: 'Reverts a Wingguy rule to an earlier version by inserting a NEW version carrying the old body (append-only — history is never rewritten). Use wingguy_rule_get first to see the versions.',
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
];

// ---------------------------------------------------------------------------
// Transport adapters
// ---------------------------------------------------------------------------

/** SDK server (the /mcp2 path): register all rules tools on an McpServer instance. */
function registerWingguyRulesTools(server) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {});
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
async function legacyToolCall(toolName, args) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {});
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

module.exports = { registerWingguyRulesTools, legacyToolList, legacyToolCall, TOOL_DEFS };
