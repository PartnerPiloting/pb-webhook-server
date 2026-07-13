# Build item: expose rule "archive" (retire) on the Wingguy door

Status: SPEC - ready to build. Written 2026-07-13.
Origin: the Nissanka thread. A gate rule (`offer-times-only-after-agreed`) got saved into BOTH
foundation and Guy's client layer; asked to "just keep it in foundation," there was no way to
remove the client copy - the door can add and change rules but had no exposed "take this one out."

## TL;DR

The store ALREADY has soft-archive built (`retireRule`, append-only, history-logged). It is just
not wired to an MCP tool, so chat can't reach it. This build = expose it as `wingguy_rule_retire`,
with a confirm-first flow and a layer-aware permission posture. Small job.

Decision (settled with Guy 2026-07-13): **soft archive, not hard delete.** Reasons - it mirrors the
existing asset `retire` flag, it is reversible, and it keeps the append-only audit trail the whole
store is built around. Hard delete is the odd-one-out that breaks that invariant; rejected.

## Why it matters (not just cosmetic)

`renderRulesBlock` (wingguyRulesStore.js) keys rule identity by `layer|tenant_id|rule_key`, and the
runtime read is `foundation ∪ client` with **no cross-layer shadowing in v1**. So when the same
`rule_key` is active in foundation AND in a client layer, BOTH copies render into the prompt - the
rule appears twice. Costs: wasted prompt tokens, and divergence risk (improve the foundation copy
later and the client's stale duplicate keeps firing alongside it). Retiring the client copy makes
the foundation version show through cleanly.

## What already exists (do NOT rebuild)

- `store.retireRule({ tenantId, layer, ruleKey, campaign, createdBy, expectedVersion, changeNote })`
  - flips the live active row to `status='retired'`, sets `retired_at`, append-only (row stays).
  - version-conflict guarded: `expectedVersion` must equal the live version (>= 1).
  - writes a `wingguy_rule_history` row with `action='retire'`, `from_version=v`, `to_version=NULL`.
  - handles foundation (tenant-less) and client (tenant required) already.
- `'retire'` is already in `HISTORY_ACTIONS` and the history CHECK constraint.
- `runRuleGet` already prints "RETIRED (no active version)" when a rule has no active row, and lists
  the retire entry in the door history - so the read side already renders retired state correctly.

## What to build

### 1. `runRuleRetire` executor (wingguyRulesMcp.js)

```js
async function runRuleRetire({ rule_key, layer = 'client', campaign, expected_version, change_note }, tenant = TENANT) {
  const r = await store.retireRule({
    ...scopeFromLayer(layer, tenant),
    ruleKey: rule_key,
    campaign: campaign || undefined,
    expectedVersion: expected_version,
    changeNote: change_note || null,
    createdBy: `mcp:${tenant}`,
  });
  return { text: `Archived: "${r.ruleKey}" v${r.retiredVersion} is now retired (append-only - still in `
    + `history, re-activate any time with wingguy_rule_revert). `
    + `${layer === 'client' ? 'Any foundation version of this key now shows through.' : 'This affected EVERY tenant that reads foundation.'}` };
}
```

### 2. `wingguy_rule_retire` TOOL_DEFS entry

Both transports pick it up automatically from `TOOL_DEFS` (SDK + legacy). Schema:

- `rule_key` (string, required)
- `layer` (enum LAYERS, optional, default client) - reuse `LAYER_DESC`
- `campaign` (string, optional) - which version chain; reuse `CAMPAIGN_DESC`
- `expected_version` (number, required) - the live version, from `wingguy_rule_get`
- `change_note` (string, optional) - why it was archived (shows in history)

Description (the confirm-first + permission posture lives here, the same way the commit tool's
description carries "only after propose + explicit yes"):

> Archives (retires) an active Wingguy rule - the append-only "take this one out" for the door. The
> row is never deleted; it flips to retired, stays in history, and re-activates any time via
> wingguy_rule_revert. Requires the expected_version (the live version) from wingguy_rule_get. FLOW:
> first show the human the rule and confirm, THEN retire - never archive without an explicit yes.
> Client layer = self-serve (only affects this tenant, and lets any foundation version of the same
> key show through). Foundation layer = platform-wide: retiring it removes the rule for EVERY tenant
> - do this only on an explicit Guy/platform call, never to solve one client's problem.

No separate `propose` step (mirrors `revert`, which is also single-call): `expected_version` comes
from `rule_get`, and the confirm-first instruction lives in the description. The model shows the rule
and gets a yes before calling - same discipline as the rest of the door.

## Permission posture (layer-aware)

The line we already draw everywhere else in the store applies unchanged:

- **Client layer -> self-serve.** Retiring your own client rule only affects you. No approval.
- **Foundation layer -> gated.** It hits every tenant at once. Treated like foundation commits are
  today: "reserved for Guy/platform," confirmation in chat, layer logged prominently.

Note on hard enforcement: step-1 auth posture is "every caller is Guy" (see the header comments in
both files) - there are no per-person roles yet. So foundation-retire gating is SOFT today (the tool
description + the model asking), exactly like foundation-commit gating is soft today. Hard,
role-based enforcement (owner / VA / platform) lands with the step-3 per-person tokens, and
retire should be included in that same role check when it is built. This spec does not bring the
step-3 work forward; it just inherits the current posture.

## Edge cases

- **Retiring the only active version** -> the rule_key has no active row; `rule_get` shows
  "RETIRED (no active version)"; `rules_list` omits it. Correct and already handled.
- **Re-activation** -> `wingguy_rule_revert to_version=<n>` re-commits that body as a new active
  version. No new "unretire" verb needed; revert already covers it. Worth one line in the retire
  tool's success text (done above) so the path is discoverable.
- **Campaign chains** -> `campaign` selects which chain to retire; omit for the generic. A retired
  generic does not touch campaign-tagged versions of the same key, and vice-versa (separate chains).
- **Double-retire / stale version** -> `retireRule` throws on "no active rule" and on version
  conflict; surfaces verbatim in chat. No extra handling needed.

## Testing

Add to tests/wingguy-rules-store.test.js (fake pool, no real DB - existing pattern):

- retire flips status, writes a `retire` history row, blocks on version conflict, errors when no
  active version exists.
- client retire of a key that also exists in foundation: `renderRulesBlock` for that tenant drops
  from two copies to one (the foundation body), proving the duplicate-render fix.
- retire then `revert` re-activates.

## Out of scope

- Hard delete (rejected by design).
- Per-person role enforcement (step-3).
- A dedicated "unretire" verb (revert covers it).
- UI/portal surface - this is door/MCP only, matching every other rule action.

## Immediate cleanup this unblocks

Once shipped: archive the duplicate `offer-times-only-after-agreed` in Guy's CLIENT layer (v1),
leaving the FOUNDATION copy as the single source. Until then the duplicate is benign but renders
twice. (Alternatively, a one-off store-level delete now - but building this is the durable fix and
turns the cleanup into a normal chat action.)
