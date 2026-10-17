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

// Drop the model's thinking blocks from history a caller RESENDS on a later turn (2026-10-17, Alex
// Solti on Ben Flintoff). Those blocks carry a signature bound to the exact system prompt they were
// made under, and Wingguy rebuilds the system prompt from scratch every turn (rules, the lead's Portal
// record, recent posts, today's date). Turn 1 scored and enriched Ben's record, so turn 2's prompt
// differed and Anthropic refused the whole request: 400 "Invalid signature in thinking block ... The
// system prompt differs from the one this block was created with". Previous turns' thinking is not
// needed for the next answer, so it goes. The in-flight tool loop inside ONE turn still replays
// response.content whole, which is what between_tools requires - only history from outside the turn
// is cleaned. (The alternative is the thinking-binding-controls-2026-08-01 beta header with
// prefix_mismatch_behavior=drop_block; stripping here needs no beta and keeps the cache prefix stable.)
function stripThinkingBlocks(history) {
  if (!Array.isArray(history)) return [];
  return history.map((m) => {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    const content = m.content.filter((b) => !(b && (b.type === 'thinking' || b.type === 'redacted_thinking')));
    return { ...m, content };
  });
}

module.exports = { noUpfrontThinking, stripThinkingBlocks };
