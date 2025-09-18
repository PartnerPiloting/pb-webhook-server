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

## Notes & assumptions
- The multi-tenant route processes clients sequentially for isolation and logs execution results per client.
- The batch scorer currently filters by `Scoring Status = "To Be Scored"`; adjust the Airtable view/workflow so leads enter this state before the daily run.
- The scorer uses client-specific attributes via the prompt builder; ensure each client’s attribute tables are maintained.

---
If you want this converted to HTML, copy this section into ChatGPT and ask for a clean HTML version. Or we can add an HTML version alongside this file.
