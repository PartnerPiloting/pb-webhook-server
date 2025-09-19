# Daily Post Scoring – Operations Guide (Plain English)

This guide explains what runs daily for post scoring, which records are selected from Airtable, the URLs and parameters (in very plain English), the limits, and what the process does end-to-end. Use it to run manually, adjust parameters, and verify results.

## What gets picked from Airtable
- Table: Leads (per client base)
- Primary view used: "Leads with Posts not yet scored"
- Extra guard: We also make sure the field `Date Posts Scored` is blank (unless a forced re-score is requested)
- Fallback (if the view is missing): Select records where
  - `Posts Content` is not empty
  - `Date Posts Scored` is empty
  - If the field `Posts Actioned` exists: it must be empty or false
- Optional targeting: You can explicitly pass a list of Airtable record IDs to process only those records.

## The endpoints to run it
Base URL (Render): `https://pb-webhook-server.onrender.com`

- Multi-tenant (all active clients): `POST /run-post-batch-score`
- Single-client simple: `POST /run-post-batch-score-simple?clientId=<client-id>`

You can pass parameters via query string or JSON body (both are supported for most values).

## Parameters in plain English
- `limit`: Maximum number of leads to fetch per client. Example: `limit=100`
- `dryRun` (or `dry_run`): If `true`, don’t write any changes to Airtable; just simulate and log. Default: `false`
- `verboseErrors`: If `true`, include detailed error diagnostics in the response. Default: `false`
- `maxVerboseErrors`: How many detailed errors to include when `verboseErrors=true`. Example: `maxVerboseErrors=20`
- `table` (or `leadsTableName`): Override the Leads table name if it’s not the default.
- `markSkips`: If `true`, update skip reasons in Airtable when posts can’t be processed. Default: `true` (behavior may vary per client config)
- `clientId` / `client_id`: Process only this client (multi-tenant route also supports narrowing to one client)
- `clientName` / `client_name`: Resolve client by name instead of ID (server will look up the ID)
- `ids`: Leads to target explicitly. Two options:
  - Query string: comma-separated Airtable record IDs
  - JSON body: `{"ids": ["recA", "recB"]}`

## Example requests
- All clients, up to 100 leads each (live):
```
curl -X POST "https://pb-webhook-server.onrender.com/run-post-batch-score?limit=100"
```

- Dry run (no Airtable writes), show detailed errors:
```
curl -X POST "https://pb-webhook-server.onrender.com/run-post-batch-score?limit=50&dryRun=true&verboseErrors=true&maxVerboseErrors=25"
```

- Single client (live), limit 25:
```
curl -X POST "https://pb-webhook-server.onrender.com/run-post-batch-score?clientId=guy-wilson&limit=25"
```

- Single-client simple endpoint, target exact IDs:
```
curl -X POST "https://pb-webhook-server.onrender.com/run-post-batch-score-simple?clientId=guy-wilson&limit=2" \
  -H "Content-Type: application/json" \
  -d '{"ids":["recXXXX1","recXXXX2"]}'
```

## Limits and behavior
- Batch chunk size: Leads are processed in chunks of 10 per client.
- AI timeout: Gemini call timeout is around 120 seconds.
- Retries: JSON parsing and response repairs are attempted; AI call errors are categorized.
- Safety: `dryRun=true` prevents any writes. `verboseErrors=true` returns more diagnostics.
- Scheduling: Runs daily via Render Cron (see below). You can also trigger manually.

## What the scoring actually does
For each selected lead:
1) Read `Posts Content` (JSON string or array). If it’s a string, repair minor JSON issues and parse it.
2) Update `Posts JSON Status` to "Parsed" or "Failed" based on the parsing result.
3) Load “Post Scoring Attributes” and “Post Scoring Instructions” (from the client base) to build the AI prompt.
4) Ask Gemini to score each post and return a JSON array of scores + reasons.
5) Normalize URLs, detect reposts vs originals, and keep the original post fields.
6) Pick the highest-scoring post.
7) Write back to Airtable:
   - `Posts Relevance Score` (top post’s score)
   - `Posts AI Evaluation` (full JSON array of all evaluated posts)
   - `Top Scoring Post` (formatted summary: date, URL, score, content, rationale, and repost info if applicable)
   - `Date Posts Scored` (timestamp)
   - Optionally clear `Posts Skip Reason` if marking skips.
8) If no posts or parsing failed, mark skip (and reason if allowed) and set `Date Posts Scored`.
9) On AI error, store an error JSON in `Posts AI Evaluation`, set date, and classify the reason (e.g., SAFETY_BLOCK, QUOTA, TIMEOUT, AUTH, AI_RESPONSE_FORMAT, MODEL_CONFIG, UNKNOWN).

## Daily schedule & where to look
- Scheduler: Render Cron Job
- Typical config (examples found in docs):
  - Endpoint: `POST /run-post-batch-score?limit=100`
  - Time: around 02:30 UTC daily (adjust to your needs)
- Logs:
  - Render service logs (primary runtime logs)
  - Server console shows: `apiAndJobRoutes.js: /run-post-batch-score endpoint hit`
  - Per-client execution logged via clientService under type `POST_SCORING`

## How to manually run and verify
1) Trigger a run (pick one):
   - All clients: `POST /run-post-batch-score?limit=100`
   - One client: `POST /run-post-batch-score?clientId=<id>&limit=25`
   - Safe test: add `&dryRun=true`
2) Watch logs in Render (or local dev logs) for errors and per-client summaries.
3) Spot-check Airtable for updated fields on a few leads:
   - `Date Posts Scored` is set
   - `Top Scoring Post` is populated
   - `Posts Relevance Score` reflects the best post
   - `Posts AI Evaluation` contains the full JSON array
   - `Posts JSON Status` is "Parsed"
4) If issues:
   - Use `verboseErrors=true` with a small `limit` to get detailed diagnostics.
   - Check whether `Posts Content` is malformed (look at `Posts JSON Status`).
   - Confirm client attributes/instructions are present.

## Notes & assumptions
- Token/cost budgeting for post scoring is primarily handled by model configuration and chunking; hard caps are not enforced here (lead scoring may have separate limits).
- If `Posts Actioned` doesn’t exist in a client base, the selector will ignore that condition.
- `table` override is available when the Leads table name differs from the default.

---
If you want this converted to HTML, copy this section into ChatGPT and ask for a clean HTML version. Or let’s add an HTML version alongside this file.