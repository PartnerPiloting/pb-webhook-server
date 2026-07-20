# Rescore Feature — Build Plan

Status: **planned, not built** · Drafted 2026-07-20

Lets a client re-run scoring over people they've *already* scored, on demand, after they change their scoring attributes — so they can tune attributes and see the effect. Instant (not via the nightly cron), cost-governed by a per-client credit allowance, and reviewable with a before/after report.

---

## Why (the problem)

- Onboarding clients start on Guy's default attributes to see the system work, then customise them.
- Scoring only ever runs once per lead: a lead comes in as `Scoring Status = "To Be Scored"`, gets scored, flips to `"Scored"`, and is never looked at again ([batchScorer.js](../batchScorer.js) `fetchLeads`, filter `{Scoring Status} = 'To Be Scored'`).
- So a client's tuned attributes only affect **new** leads; their existing network stays judged by the old attributes.
- Re-importing the same people through Linked Helper does **not** rescore them (it's an upsert; existing connections aren't reset to "To Be Scored") — and would waste LinkedIn/ban-risk budget on a purely internal operation. Rescore needs no new LinkedIn data; it re-runs the AI over the profile already stored in `Profile Full JSON`.

## Settled decisions (from 2026-07-20 discussion)

- **Instant, on-demand** — a dedicated rescore path, separate from the scheduled scoring cron, so the tune→see→adjust loop is fast. (The cron approach kills the feedback loop.)
- **Credit allowance** governs cost (not the LH throttle, not the cron): **1500 credits to start, +200/month**, **1 credit = 1 lead rescored**. Justified as "covers a full last-3-months rescore (~900 at peak) plus room to experiment first." Cost to Guy: ~$12 initial + ~$1.60/mo per client — negligible.
- **Scope by recency of scoring** — "rescore everyone scored in the last 1 / 2 / 3 months" (off `Date Scored`, counting back from today), plus a cheap **test sample** for iterating. Bounded by credits.
- **Home = the Settings screen** (where attributes are edited) — that's where the intent is born.
- **Reporting** — onscreen **old → new → delta** with a summary line and threshold-crossings highlighted; per-attribute breakdown on **drill-down** (not dumped for every lead); **CSV** export for full detail.
- **Gated rollout** — per-client enable flag, Ashley (Ashley-Knowles) as first guinea pig, then widen.
- **Low blast radius** — rescore only overwrites the client's own score column using data already in their base; no messages, no LinkedIn, nothing external. Safe to test live behind a flag.

### Two distinct actions (added 2026-07-20)
The feature is **two modes**, differing by whether they persist:
1. **Test (preview) — non-destructive.** Runs the new attributes over a **stratified sample** and shows before/after, but does **NOT write** the scores back. The safe experimentation loop: tweak attributes → preview → repeat, without scattering intermediate scores across the base. Still debits credits (real AI work), just doesn't commit.
2. **Rescore & apply (commit) — destructive.** Rescores the real scoped set (**last 1/2/3 months**) and **writes** the new scores. This is what updates the scores that flow into Top Scoring Leads → the client selects high scorers → pushes to Linked Helper. The "apply for real" action.

Both spend credits; only #2 changes stored data. Engine impact: `scoreRecordsNow(...)` needs a **`persist: false` (dry-run) mode** for the preview that skips the Airtable write and returns the computed scores for display.

## Measured facts that shaped this (real prod data, 2026-07-20)

- Scoring runs on **Gemini 2.5 Pro** (`gemini-2.5-pro-preview-05-06`; no `GEMINI_MODEL_ID` env set → code default).
- **~3,400 tokens per lead** (avg over 7,209 real scorings) → **~$8 per 1,000 leads** on Pro (~1¢/lead). Flash would be ~4× cheaper but is a quality tradeoff, not in scope.
- **Busiest client-month ever ≈ 300 scored** (Matthew-Bulat); active clients sit 200–300/mo. So 1500 credits is comfortably generous.
- Ashley's base for reference: 333 ingested, 123 connected, 291 scored.

---

## Architecture

### Reuse the existing scorer
The scoring guts are `scoreChunk(records, clientId, clientBase, runId)` ([batchScorer.js:312](../batchScorer.js)) — hand it Airtable lead records, it scores with Gemini and writes results back, returning `{ processed, successful, failed, tokensUsed }`. Only coupling: two module globals (`BATCH_SCORER_VERTEX_AI_CLIENT`, `BATCH_SCORER_GEMINI_MODEL_ID`) currently set only inside the HTTP `run()` handler.

**Plan:** export a thin reusable entrypoint from batchScorer, e.g.
`scoreRecordsNow({ records, clientId, clientBase, dependencies })` that sets those globals then runs `scoreChunk` over the set in `CHUNK_SIZE` batches. No rewrite of the scorer.

### Before/after capture
`scoreChunk` overwrites `AI Score` / `AI Profile Assessment` / `AI Attribute Breakdown` in place and returns only totals. So, around the call:
1. **Read** old `AI Score` + `AI Attribute Breakdown` for the target records first (hold in memory / job snapshot).
2. Run the scorer.
3. **Read** the new values back.
4. Compute per-lead deltas + threshold crossings for the report.

No change to `scoreChunk` itself needed.

### Sync vs job (a decision — see below)
Small rescores (sample, ≤~1 chunk) finish in seconds and can be a synchronous request. A full 3-month commit (~900) is ~25 Gemini calls = minutes, too long to hold an HTTP request. **Recommended:** run every rescore as a **foreground job with progress polling** (reuse the portal's existing progress-poll pattern) — small ones finish in one poll, big ones show a progress bar. Uniform, no Phase-2 re-architecture.

---

## Data model changes

### Master `Clients` table (base appJ9XAZeJeK5x55r) — credits + gate
- `Rescore Enabled` (single-select Yes/No) — per-client gate, like `Thanks for Connecting` / `Wingguy Enabled`.
- `Rescore Credits Granted` (number) — initial 1500.
- `Rescore Credits Consumed` (number) — running total of leads rescored.
- `Rescore Credits Start` (date) — when the allowance began (for monthly accrual).

**Available credits (computed, no cron):**
`available = Granted + floor(monthsSince(Start)) × 200 − Consumed`
**No accrual cap** — unused monthly credits pile up indefinitely (decided 2026-07-20). Read via `clientService` (add `rescoreCredits*` fields, like `launchDate`). Field rollout via the idempotent `scripts/add-*-field.js` pattern → run on prod (Render job).

### Leads table
No new field required for the instant path (we score records directly, not via a flag). Snapshot of old score is held for the report, not persisted.

---

## Phase 1 — the usable core (target: a weekend or two)

**Backend**
1. `batchScorer`: export `scoreRecordsNow({ ..., persist })` wrapper (init globals + chunked `scoreChunk`). `persist: false` = preview mode: compute + return scores but skip the Airtable write (needs a no-write path — either a `scoreChunk` dry-run flag, or score-then-don't-update). `persist: true` = commit.
2. `clientService`: read the new credit fields → expose `rescoreEnabled`, `rescoreCreditsAvailable()` (computed), plus a `debitRescoreCredits(clientId, n)` helper (increment Consumed).
3. New route module `routes/rescoreRoutes.js` (gated on `Rescore Enabled`, per-client base like `topScoringLeadsRoutes`):
   - `GET /api/rescore/status` — enabled? credits available? (for the panel)
   - `GET /api/rescore/estimate?months=3` (or `sample=N`) — count leads in scope (`{Scoring Status}='Scored'` AND `Date Scored` within window), return count + est. cost + whether it fits credits.
   - `POST /api/rescore/run` — takes `mode=preview|commit`. **preview** = stratified sample, `scoreRecordsNow({persist:false})`, return before/after for display, debit credits, **no write**. **commit** = scoped set (last N months), `scoreRecordsNow({persist:true})`, write new scores, debit credits, return before/after + summary. (Foreground job + progress if large.)
   - Enforcement: reject if scope count > available credits (or offer to trim to what fits).
4. Add `Rescore Enabled` + credit fields to master `Clients` (script + Render job). Seed Ashley: `Rescore Enabled = Yes`, `Granted = 1500`, `Start = today`.

**Frontend — Settings screen rescore panel**
5. Scope selector: **Last 1 / 2 / 3 months** + **Test sample** (default **50**, user-choosable **up to 100**; drawn as a **stratified sample** — roughly equal slices from low / mid / high score bands, NOT top-N — so every band is represented by construction regardless of base shape, and each band has enough leads (~16 at the default) to read the pattern. Tuning movement shows most in the mid tier).
6. **Credits meter** ("1,500 credits left") + live count/cost line ("Rescore 291 people · ~$2.30 · 291 credits").
7. **Two clearly separate actions**: **Test on a sample** (preview — "changes nothing") and **Rescore & apply** (commit — "writes new scores → Top Scorers → Linked Helper"). Each → progress → **results table**: per lead `old → new → Δ`, sorted by biggest movers, threshold crossings flagged, with a summary line ("47 rescored · 9 up · 3 into top tier · 2 dropped out"). Preview clearly labelled non-destructive.
8. Guard: block run when scope exceeds credits (offer to trim); disable while running.

## Phase 2 — depth
- **Per-attribute drill-down** — click a lead → old-vs-new per attribute (data already produced by scoring; snapshot old breakdown).
- **CSV export** — full per-lead + per-attribute detail.
- **Async job + richer progress** for very large commits (if not already done in P1).
- **Buy-more / tier** — extra credits as an Advanced-tier perk / paid add-on.
- **Accrual cap** tuning.

---

## Guardrails / safety
- **Credit enforcement must be correct before exposing** — the one real guardrail. With a hard cap, worst case per client ≈ $12 of tokens even with a buggy client. Debit by *leads actually scored*, check-before-run.
- **Rescore overwrites current scores** — surface this in the UI so no one is surprised their old assessment changed. Reversible by rescoring again.
- **Gated, guinea-pig first** — Ashley behind `Rescore Enabled`, watch cost/behaviour, then widen.
- Cloud-only testing (per [[feedback_testing_workflow]]): validate via prod one-off jobs / staging.

## Decided (2026-07-20)
1. **Run mode:** **job + progress** for every rescore (small ones finish in one poll; big "last 3 months" commit shows a progress bar). Chosen so the headline 3-month commit works day one.
2. **Accrual cap:** **none** — unused monthly credits pile up indefinitely.
3. **Per-attribute drill-down:** **Phase 2** — ship old→new→delta first; add the click-in attribute breakdown right after (data's already there).
4. **Test sample:** default **50**, choosable **up to 100**, drawn as a **stratified sample** (equal-ish from low / mid / high bands, not top-N) so every band is represented by construction; ~16/band at the default is enough to read the pattern.
5. **Who triggers:** **clients themselves (self-serve)** — but only those with the `Rescore Enabled` gate on. **Ashley-Knowles is the first/guinea-pig client.** (Optionally keep it to Ashley only for the very first shakedown while credit enforcement is proven, then widen.)

## Rough sizing
Biggest feature discussed this session — not a tweak. Three real pieces: the on-demand engine (small wrapper, low risk now that `scoreChunk` is confirmed reusable), the credits subsystem (simple but must be correct on top-up + no-overspend), and the reporting UI. Phase 1 ≈ a weekend or two at Guy's pace; Phase 2 a further chunk. Nothing exotic — assembling existing parts (scorer, Airtable field patterns, portal UI + progress patterns).
