# LinkedIn Posts Ingestion: Apify → Webhook → Airtable (High-Level)

Goal: fetch recent LinkedIn posts for specified profile URLs (per client or all clients), then upsert into each client’s Airtable base. This document is intentionally high-level and ready for HTML conversion.

## Overview
- Trigger: API call starts an Apify Actor run against a list of LinkedIn profile URLs.
- Webhook: On success, Apify calls our `/api/apify-webhook` with the run data.
- Mapping: The webhook looks up which client the run belongs to, fetches the dataset, maps items → posts, and writes to that client’s Airtable.
- Multi-tenant: Each Apify run is associated with a client in the “Apify Runs” table (Master Clients base). This is how the webhook knows the tenant.

## Key Endpoints
- `POST /api/apify/run`
  - Starts an Apify Actor run.
  - Auth: `Authorization: Bearer ${PB_WEBHOOK_SECRET}`
  - Tenant: `x-client-id: <ClientId>` header OR `?client=<ClientId>` query (fallback for visibility/testing)
  - Body supports either `{ targetUrls: [...] }` or `{ input: { targetUrls: [...] } }`.
  - Modes:
    - `mode=webhook` (default): quick return; Apify calls our webhook when done.
    - `mode=inline`: waits for finish; fetches dataset and writes immediately.

- `POST /api/apify-webhook`
  - Called by Apify on run success. Auth: `Authorization: Bearer ${APIFY_WEBHOOK_TOKEN}`.
  - Extracts `runId` from payload → looks up client → fetches dataset → maps → upserts to Airtable.
  - Non-production only: allows `?client=` query to override client mapping for testing.

## How Client/Tenant Is Determined
- When a run is started via `/api/apify/run`, we save a record to the Apify Runs table with `runId → clientId`.
- The webhook receives the payload, extracts `runId`, then looks up the corresponding `clientId`.
- For temporary testing, you can pass `?client=Guy-Wilson` on the webhook URL in non-production to force the client.

## Webhook URL
- Default production: `https://pb-webhook-server.onrender.com/api/apify-webhook`
- Override via env: `APIFY_WEBHOOK_URL` (used when starting runs so Apify knows where to call back)

## Input Normalization
- We normalize LinkedIn URLs to the recent-activity path and extract public identifiers for better results with cookie-enabled actors.
- We reconcile returned post `profileUrl` to the exact canonical profile(s) requested to avoid slug mismatches.

## Data Mapping (Apify → PB Posts)
For each dataset item we derive:
- `profileUrl`, `postUrl`, `postContent`, `postTimestamp`
- `author`, `authorUrl`
- `likeCount`, `commentCount`, `repostCount`
- `imgUrl`
- `pbMeta.originLabel` = `ORIGINAL` or `REPOST - ORIGINAL AUTHOR: <url>`

These map to the expected input for `syncPBPostsToAirtable()`.

## Current Testing Plan (Client: Guy-Wilson)
1) Start a run for a small set of profile URLs using Guy-Wilson as the client.
2) Wait for webhook to ingest posts into the Guy-Wilson Airtable base.
3) Verify row counts and sample fields.

Quick local/staging test using query fallback for visibility:
- Start run:
  - Headers: `Authorization: Bearer ${PB_WEBHOOK_SECRET}`
  - Either header `x-client-id: Guy-Wilson` or query `?client=Guy-Wilson` on the URL
  - Body example:
```
{
  "targetUrls": [
    "https://www.linkedin.com/in/some-profile/recent-activity/all/"
  ],
  "mode": "webhook"
}
```

- The run will register in the Apify Runs table with `clientId = Guy-Wilson`.
- On success, Apify calls back to `/api/apify-webhook` (production by default). The webhook fetches the dataset and writes posts to the client’s Airtable.

## Cron Plan (Future)
- Create a daily cron or per-tenant schedule that:
  - Reads all target profile URLs from each client base.
  - Batches them and calls `/api/apify/run` per client with `mode=webhook`.
  - Optionally adds balancing rules (limits per day, per client) to control costs.

## Minimal Env Requirements
- `PB_WEBHOOK_SECRET` (to start runs)
- `APIFY_API_TOKEN` (to call Apify API)
- `APIFY_WEBHOOK_TOKEN` (to authenticate incoming webhooks)
- `APIFY_ACTOR_ID` (optional; defaults to `harvestapi~linkedin-profile-posts`)
- `APIFY_WEBHOOK_URL` (optional; defaults to production URL)

## Notes on Simplicity & Visibility
- For run starts, using `?client=...` is enabled as a fallback, but the preferred multi-tenant signal is `x-client-id` header. This keeps logs cleaner and avoids accidental sharing of links with the client baked into the URL.
- For webhook testing, `?client=` is accepted only when `NODE_ENV !== 'production'`. In production, the mapping must come from the saved run record.
