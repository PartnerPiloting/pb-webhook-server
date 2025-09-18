# Operations Runbook — Post Scoring (Plain English)

This is the practical, non-technical guide to how our daily “post scoring” workflow runs, where to click/call things, and how to verify it worked. Each subtopic links to the specific API route we use under the hood so you always know “what URL does this?”.

## 1) Pick Who To Track — Profiles List
- Purpose: Keep a clean list of LinkedIn profiles per client (who we watch).
- Where it lives: Each client’s Airtable base (Leads/Contacts table with profile URL field).
- Outcome: A list of profile URLs we’ll fetch posts for.

## 2) Fetch Posts — Start A Run
- What it does: Tells our collector to pull latest posts for the selected profiles.
- Route: `POST /api/apify/run`
- Who it’s for: One client at a time.
- When we use it: Manually for pilots; scheduler uses it daily.
- Copy/paste example (replace placeholders):

```
curl -sS -X POST "$BASE_URL/api/apify/run?client=$CLIENT_ID" \
  -H "Authorization: Bearer $PB_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUrls": [
      "https://www.linkedin.com/in/PROFILE_1/recent-activity/all/",
      "https://www.linkedin.com/in/PROFILE_2/recent-activity/all/"
    ],
    "mode": "webhook"
  }'
```

### 2b) Filter Leads & Kick Off Scraping (Automatic)
- What it does: Automatically picks eligible leads for a client (from Airtable), then fetches their recent posts in batches until today’s post target is met.
- Route: `POST /api/apify/process-client`
- When we use it: This is the daily driver we schedule for each client; you can also run it manually for a single client.
- Inputs: Client only (it reads target profiles directly from the client’s base).
- Options: `?debug=1` (show picked batches/URLs); body `{ "maxBatchesOverride": 1 }` (cap daily batches).
- Copy/paste example:

```
curl -sS -X POST "$BASE_URL/api/apify/process-client" \
  -H "Authorization: Bearer $PB_WEBHOOK_SECRET" \
  -H "x-client-id: $CLIENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"maxBatchesOverride": 1}'
```

### 2c) Run All Clients (Automatic)
- What it does: Iterates all active clients and runs the same per-client batching logic for each.
- Route: `POST /api/apify/process`
- When we use it: After the pilot is stable; use in a daily cron.
- Options: `?debug=1`; body `{ "maxBatchesOverride": 6 }` to cap per-client.
- Copy/paste examples:

All active clients:
```
curl -sS -X POST "$BASE_URL/api/apify/process" \
  -H "Authorization: Bearer $PB_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxBatchesOverride": 6}'
```

Single client via same path:
```
curl -sS -X POST "$BASE_URL/api/apify/process?client=$CLIENT_ID" \
  -H "Authorization: Bearer $PB_WEBHOOK_SECRET"
```

## 3) Callback Ping — “It’s Done”
- What happens: When the collector finishes, it pings our server to say results are ready.
- Route: `POST /api/apify-webhook` (called by the collector; you won’t call this yourself).
- Safety: Secured by a secret token; also mapped to the correct client automatically.

## 4) Store Results — Save Into The Right Client
- What we do: Convert raw results into our standard post format and save into that client’s Airtable.
- Where it ends up: The client’s Airtable (Posts or equivalent table) — ready for scoring.
- How tenant is chosen: We record each run with its client; webhook looks up the mapping.

## 5) Record Metadata — Runs & Health
- Why: So we can see what ran, when, status, and post counts.
- Helpful routes:
  - `GET /api/apify/runs/client/:clientId?limit=5` — recent runs for a client
  - `GET /api/apify/runs/:runId` — details for a specific run

## 6) AI Scoring — Surface What Matters
- What it does: Assigns a relevance score so the best posts float to the top.
- When it runs: After posts are saved; can be batched or triggered as part of a workflow.
- Outcome: A ranked list per client.

## 7) Serve To UI — Review & Follow Up
- Where to look: The “Top Scoring Posts” view in the dashboard.
- What you’ll see: The highest‑scoring posts for each client, ready for action.

## 8) Monitor & Control — Daily Care
- What we watch: Daily job success/failure, counts, and any anomalies.
- What we can do: Pause the daily schedule, re‑run a single client, or retry a failed job.
- Handy checks:
  - Webhook health (dev): `GET /api/_debug/apify-webhook-config`
  - Apify run start (manual): use the curl example in Step 2

---

## Quick Reference — Parameters & Secrets (Plain English)
- Client: Pick which client you’re fetching for (e.g., `Guy-Wilson`).
- Profiles: The LinkedIn profiles you want posts from.
- Secret to start runs: `PB_WEBHOOK_SECRET` (used in the Authorization header).
- Secret to accept callbacks: `APIFY_WEBHOOK_TOKEN` (used by the collector when calling us).
- Apify token: `APIFY_API_TOKEN` (lets us talk to the collector’s API).

## What Changes In Production
- The callback points at our production server by default.
- We schedule the daily run and watch it closely for the pilot client first.
- Once stable, we expand to all clients on a schedule.

## Troubleshooting — First Moves
- No posts arrived:
  - Check recent runs: `GET /api/apify/runs/client/:clientId?limit=5`
  - If a run exists, open its details with `GET /api/apify/runs/:runId`
  - If no run exists, try Step 2’s curl again with a single known profile.
- Webhook token missing: Dev‑only config check at `GET /api/_debug/apify-webhook-config`
- Wrong client got the posts: Confirm you started the run with the intended client; runs are mapped at start time.
