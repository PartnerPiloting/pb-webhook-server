# Daily Lead Scoring – Operations Guide (Plain English)

This guide explains the daily lead scoring process: what gets selected from Airtable, the URLs and parameters (in very plain English), the limits, and what the process does end-to-end. Use it to run manually, adjust parameters, and verify results.

## What gets picked from Airtable
- Table: `Leads` (per client base)
- Primary selector: records where `Scoring Status` equals "To Be Scored".
- Data prerequisites used by the scorer:
  - `Profile Full JSON` must exist and parse to an object
  - The combined "About/Summary/Description" text should be at least ~40 characters (otherwise the record is skipped)
- Optional targeting: You can score a single lead via its record ID.

## The endpoints to run it
Base URL (Render): `https://pb-webhook-server.onrender.com`

- Multi-tenant (all active clients): `GET /run-batch-score`  
  - Accepts a `limit` and optional `clientId` to scope to one client
- Single lead: `GET /score-lead?recordId=<airtable-record-id>`  
  - Requires header `x-client-id: <client-id>` to resolve the correct client base

## Parameters in plain English
- `limit`: Maximum number of leads to fetch per client for batch scoring. Example: `limit=200` (defaults to 500 at the route layer; the batch runner defaults to 1000 if not provided).
- `clientId`: Process only this client (multi-tenant route supports narrowing to one client).
- `recordId`: When using `/score-lead`, the Airtable record ID of the lead to score.
- Header `x-client-id`: When using `/score-lead`, identify the client base for that lead.

## Example requests
- All clients, up to 200 leads each:
```
curl "https://pb-webhook-server.onrender.com/run-batch-score?limit=200"
```

- Single client only (e.g., `guy-wilson`), limit 100:
```
curl "https://pb-webhook-server.onrender.com/run-batch-score?clientId=guy-wilson&limit=100"
```

- Score one specific lead by record ID for a client:
```
curl "https://pb-webhook-server.onrender.com/score-lead?recordId=recXXXX" \
  -H "x-client-id: guy-wilson"
```

## Limits and behavior
- Batch chunk size: Leads are processed in chunks of `BATCH_CHUNK_SIZE` (default 40).
- AI timeout: Generative model call timeout is controlled by `GEMINI_TIMEOUT_MS` (default 900000 ms = 15 minutes) to accommodate large batches.
- Safety settings: Model is configured with safety categories set to not block (scoring prompts are non-sensitive).
- Result parsing: Scorer expects a JSON array; it repairs/removes code fences and validates shape.
- Skips and failures:
  - If profile text is too short (< ~40 chars): sets `AI Score` to 0, clears assessment/breakdown, marks `Scoring Status` to "Skipped – Profile Too Thin" and sets `Date Scored`.
  - If AI fails (timeout, block, parse error): marks `Scoring Status` to a failure reason and sets `Date Scored`.
- Cost control: Requests are grouped; per-client execution logs record tokens used and status.

## What the scoring actually does
For each selected lead:
1) Load `Profile Full JSON` from Airtable and parse it. Compute an "about" text from `about`/`summary`/`linkedinDescription`.
2) If missing critical fields, log a warning; if text is under ~40 chars, skip with zero score.
3) Build a client-specific system prompt from "Lead Scoring Attributes" and rubric configuration.
4) Send a chunk of slimmed leads to the Gemini model and receive structured JSON for each lead with:
   - `positive_scores`, `negative_scores`, `attribute_reasoning`, `contact_readiness`, `unscored_attributes`, optional `ai_excluded` and `exclude_details`.
5) Compute final score using the rubric: percentage, earned points, and denominator.
6) Write back to Airtable per lead:
   - `AI Score` (percentage rounded to 2 decimals)
   - `AI Profile Assessment` (natural-language summary)
   - `AI Attribute Breakdown` (JSON string describing attribute points and reasoning)
   - `Scoring Status` ("Scored" on success, otherwise specific failure/skip state)
   - `Date Scored` (ISO date)
   - `AI_Excluded` (boolean) and `Exclude Details` (string), if applicable

## Daily schedule & where to look
- Scheduler: Render Cron Job named something like “Daily Batch Lead Scoring”.
- Typical config seen in repo docs/scripts:
  - Endpoint: `GET /run-batch-score?limit=100` (or a client-scoped variant)
  - Time: set in Render (check the Render service for the current cron time)
- Logs:
  - Render service logs (primary runtime logs)
  - Batch runner produces structured per-client summaries and updates a per-client execution log (status, counts, tokens, duration)

## How to manually run and verify
1) Trigger a run (pick one):
   - All clients: `GET /run-batch-score?limit=100`
   - One client: `GET /run-batch-score?clientId=<id>&limit=100`
   - Single lead test: `GET /score-lead?recordId=<recId>` with `x-client-id` header
2) Watch logs for client summaries and any chunk errors.
3) Spot-check Airtable on a few leads:
   - `Scoring Status` becomes "Scored" (or an explicit skip/failure reason)
   - `AI Score` is set
   - `AI Profile Assessment` is populated
   - `AI Attribute Breakdown` contains a JSON breakdown
   - `Date Scored` is set
4) If issues:
   - Confirm `Profile Full JSON` exists and parses; ensure the about/summary text has enough length
   - Try scoring the single lead via `/score-lead` to isolate errors
   - Check Render logs for JSON parse or timeout messages

## Which model scores - Gemini or Claude (the SCORING_PROVIDER switch)

Since 21 Oct 2026 the scorer has two model paths behind one environment variable. Both paths build
the same prompt (promptBuilder), parse the same JSON, and run the same computeFinalScore. Only the
model call differs, plus one rescale step on the Claude path.

| Variable | Default | What it does |
|---|---|---|
| `SCORING_PROVIDER` | `gemini` | `gemini` = Gemini via Vertex (config/geminiClient.js, GEMINI_MODEL_ID). `claude` = Claude via api.anthropic.com (config/anthropicClient.js, ANTHROPIC_API_KEY). Anything else means gemini. |
| `SCORING_CLAUDE_MODEL_ID` | `claude-haiku-5-5` | Model used on the Claude path. Must be a model served by api.anthropic.com - the Max-plan API credit does not cover Vertex or Bedrock. |
| `SCORING_CLAUDE_SCALE` | `1.45` | Multiplier applied to every positive attribute's points on the Claude path (see below). |
| `SCORING_CLAUDE_OFFSET` | `0` | Points added after the multiplier. Normally stays 0. |
| `SCORING_CLAUDE_MAX_TOKENS` | `32000` | Output cap per call. A chunk of 10 leads uses about 9,000. Only raise it if BATCH_CHUNK_SIZE goes up. |
| `SCORING_CLAUDE_EFFORT` | `low` | Haiku 5.5 effort. Medium was measured worse and dearer, leave it. |

All of these are read on every call, so there is nothing to change in code. The seam lives in
`config/scoringProvider.js`; batchScorer.js and singleScorer.js both go through it. Reconnect
triage, summaries and the Start Here help keep their own Gemini/OpenAI clients - this switch is
scoring only.

### What the scale means

Haiku 5.5 ranks leads as well as Gemini 3.5 Flash, but it awards roughly two-thirds of Gemini's
points on every positive attribute - it reads each attribute's score band from the bottom where
Gemini reads from the top. Prompt wording does not move it (two rounds tried, 21 Oct 2026). So the
prompt is left alone and each positive attribute's points are multiplied by SCORING_CLAUDE_SCALE,
rounded to a whole number and capped at that attribute's maxPoints, before the final score is
computed. Doing it per attribute keeps the AI Attribute Breakdown adding up to the AI Score that
is shown. Negative scores (penalties) are not scaled. On the Gemini path nothing is scaled.

The scale is a fit, not a law: 1.45 put Haiku within the day-to-day noise of Gemini on 120 leads
across three clients (see the PR that introduced it for the numbers). If a client's floor starts
firing noticeably more or less often than before, this is the first knob - Rescore preview on a
sample, compare, adjust by 0.05 steps, redeploy.

### How to flip production to Claude

1. In Render, env group **AI Service Configuration** (`evg-d3o7ur9r0fns73bvo4kg`, shared by prod,
   staging and the cron jobs): add `SCORING_PROVIDER=claude`. ANTHROPIC_API_KEY is already there.
2. Redeploy the prod web service `srv-cvqgq53e5dus73fa45ag` (POST a deploy, or the Render dashboard's
   Manual Deploy). Changing an env group does **not** redeploy on its own. The nightly scoring runs
   through this web service (the fire-and-forget cron just calls it), so no cron needs a redeploy.
3. Check the first log lines of the next scoring run: `Attempting to score N leads with Claude` and
   `Calling Claude. Using Model ID: claude-haiku-5-5 ... (scale 1.5, offset 0, effort low)`.
4. Make sure auto-reload is on in the Anthropic Console with a small purchased balance. When the
   monthly credit runs out the API refuses calls, and scoring would fail every chunk until the next
   credit. Failures land as `Scoring Status = Failed - API Error` and an admin alert, same as a
   Gemini outage.

### How to roll back to Gemini

Set `SCORING_PROVIDER=gemini` (or delete the variable) in the same env group and redeploy the same
service. Nothing else changes: the Gemini client, model and credentials are untouched by the flip,
and leads already scored keep their scores either way.

### Failure handling on the Claude path

- Transient errors (429 rate limit, 529 overloaded, 5xx, network blips, the call timeout) retry with
  the same 5s / 10s backoff as Gemini, after the SDK's own four retries.
- If the model returns a different number of results than leads in the chunk, the chunk is retried
  once before the orphaned leads are marked failed (seen once in 360 on Haiku).
- Token counts appear in the usual `TOKENS FOR BATCH CALL (Claude)` block.
- A key or billing failure (401, "credit balance is too low") is not retried; it fails the chunk and
  alerts, so check the Console balance first.

## Notes & assumptions
- The multi-tenant route processes clients sequentially for isolation and logs execution results per client.
- The batch scorer currently filters by `Scoring Status = "To Be Scored"`; adjust the Airtable view/workflow so leads enter this state before the daily run.
- The scorer uses client-specific attributes via the prompt builder; ensure each client’s attribute tables are maintained.

---
If you want this converted to HTML, copy this section into ChatGPT and ask for a clean HTML version. Or we can add an HTML version alongside this file.
