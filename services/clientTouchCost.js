// services/clientTouchCost.js
//
// WHAT A MONDAY BUILD COSTS - the tokens and estimated US$ of every Claude call the weekly client
// touch planner makes while it builds a week (the deep client briefs, the call digests, the
// openings, the thoughts for the week, the personal notes and custom emails, the fact guard).
// All of it runs on Guy's own server key (ANTHROPIC_API_KEY - the Wingguy key in "Guy's Individual
// Org", paid from his US$100/month Max credit), never on a client's key.
//
// One meter per build. Every call goes through `meter.wrap(llm)`, which adds up response.usage per
// model. Before a call the caller asks `meter.check(estimate)`: when the build would go past its
// budget (US$10 by default, CLIENT_TOUCH_BUILD_BUDGET_USD), it throws BudgetError and the build stops
// and tells Guy, rather than quietly spending more (Guy, 22 Oct 2026: "a few dollars a week").
//
// Prices are Anthropic's first-party list prices per million tokens (cached 6 Oct 2026). Cache reads
// are charged at the cache price; an unknown model is priced as Sonnet so nothing reads as free.

const PRICES = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};
const FALLBACK = PRICES['claude-sonnet-5-5'];
const DEFAULT_BUDGET_USD = 10;

class BudgetError extends Error {
  constructor(message, spent) { super(message); this.name = 'BudgetError'; this.spent = spent; }
}

function priceOf(model) {
  return PRICES[String(model || '').trim()] || FALLBACK;
}

/** US$ for one usage block. Pure. */
function costOf(model, usage = {}) {
  const p = priceOf(model);
  const input = (Number(usage.input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0) * 1.25;
  const read = Number(usage.cache_read_input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  return (input * p.input + read * p.cacheRead + output * p.output) / 1e6;
}

/** A rough token count for text about to be sent (4 characters a token). Pure. */
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function budgetUsd() {
  const v = Number(process.env.CLIENT_TOUCH_BUILD_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGET_USD;
}

/**
 * A meter for one build. `wrap(llm)` returns an llm whose messages.create records usage (and checks
 * the budget first, from the request's own size). `summary()` = { calls, inputTokens, outputTokens,
 * usd, byModel, byPurpose, budgetUsd, stopped }.
 */
function createMeter({ budget = budgetUsd() } = {}) {
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byModel: {}, byPurpose: {}, stopped: null };

  function add(model, usage, purpose = 'other') {
    const usd = costOf(model, usage);
    const inTok = (Number(usage.input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0);
    const outTok = Number(usage.output_tokens) || 0;
    totals.calls += 1; totals.inputTokens += inTok; totals.outputTokens += outTok; totals.usd += usd;
    for (const [bucket, key] of [[totals.byModel, model || 'unknown'], [totals.byPurpose, purpose]]) {
      const b = bucket[key] || (bucket[key] = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
      b.calls += 1; b.inputTokens += inTok; b.outputTokens += outTok; b.usd += usd;
    }
    return usd;
  }

  /** Throws BudgetError when a call of this estimated size would take the build past its budget. */
  function check({ model, inputTokens = 0, outputTokens = 2000 } = {}) {
    if (totals.stopped) throw new BudgetError(totals.stopped, totals.usd);
    const p = priceOf(model);
    const next = (inputTokens * p.input + outputTokens * p.output) / 1e6;
    if (totals.usd + next > budget) {
      totals.stopped = `the build stopped at US$${totals.usd.toFixed(2)} - the next Claude call would take it past the US$${budget.toFixed(2)} limit`;
      throw new BudgetError(totals.stopped, totals.usd);
    }
  }

  /** An llm that meters every call. `purpose` labels the calls in the report. */
  function wrap(llm, purpose = 'other') {
    if (!llm) return null;
    return {
      messages: {
        create: async (params) => {
          const text = [params.system, ...(params.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))].join('\n');
          check({ model: params.model, inputTokens: estimateTokens(text), outputTokens: Math.min(Number(params.max_tokens) || 4000, 6000) });
          const resp = await llm.messages.create(params);
          if (resp && resp.usage) add(params.model, resp.usage, purpose);
          return resp;
        },
      },
    };
  }

  function summary() {
    const round = (o) => ({ ...o, usd: Math.round(o.usd * 10000) / 10000 });
    return {
      calls: totals.calls, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
      usd: Math.round(totals.usd * 10000) / 10000,
      byModel: Object.fromEntries(Object.entries(totals.byModel).map(([k, v]) => [k, round(v)])),
      byPurpose: Object.fromEntries(Object.entries(totals.byPurpose).map(([k, v]) => [k, round(v)])),
      budgetUsd: budget, stopped: totals.stopped,
    };
  }

  return { add, check, wrap, summary };
}

/** One plain line for Guy: "Claude cost this build: US$1.84 (212,400 tokens in, 18,300 out, 41 calls)". Pure. */
function costLine(s) {
  if (!s) return '';
  const n = (x) => Number(x || 0).toLocaleString('en-AU');
  const base = `Claude cost of this build: US$${Number(s.usd || 0).toFixed(2)} (${n(s.inputTokens)} tokens in, ${n(s.outputTokens)} out, ${n(s.calls)} calls) on your own server key`;
  return s.stopped ? `${base} - STOPPED: ${s.stopped}` : base;
}

module.exports = { createMeter, costOf, estimateTokens, costLine, budgetUsd, BudgetError, PRICES };
