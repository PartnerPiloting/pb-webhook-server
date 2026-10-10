// config/wingguyThinking.js
// One answer to "how do we tell this model NOT to think before it answers".
//
// Wingguy's drafting and booking surfaces are latency-sensitive and run on small max_tokens budgets,
// so upfront thinking has been OFF since 2026-07-01: Sonnet 5 thinks by default and spent the whole
// budget thinking, returning empty turns ("(No response - try rephrasing)", "triage returned no JSON").
//
// Sonnet 5.5 (released 2026-09-29) rejects `thinking: { type: 'disabled' }` with a 400. Its lowest
// setting is `between_tools`: no thinking before the reply, only short progress notes between tool
// calls, which come back as thinking blocks and are replayed unchanged by the chat loop (it pushes
// response.content whole). `between_tools` is accepted ONLY by Sonnet 5.5 - every other model 400s
// on it - so the setting is picked per model id. That keeps the env-var rollback honest: set
// WINGGUY_DRAFT_MODEL_ID=claude-sonnet-5 (or claude-sonnet-4-6) on Render and the old `disabled`
// comes back with it, no code change needed.
function noUpfrontThinking(modelId) {
  return /^claude-sonnet-5-5/.test(String(modelId || '')) ? { type: 'between_tools' } : { type: 'disabled' };
}

module.exports = { noUpfrontThinking };
