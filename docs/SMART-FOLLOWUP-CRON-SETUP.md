# Smart Follow-Up Sweep Cron Setup

When the web-triggered Rebuild gets stuck (Render can stop background work after returning 202), a cron job can pick it up and run the sweep.

## Option A: HTTP Cron (Recommended)

Hit the cron endpoint from an external scheduler (e.g. Render Cron Job, cron-job.org, etc.).

**Endpoint:**
```
GET https://pb-webhook-server.onrender.com/api/cron/smart-followup-sweep
Authorization: Bearer <PB_WEBHOOK_SECRET>
```

**Query params (optional):**
- `clientId` – Client ID (default: `Guy-Wilson`)

**Behavior:**
- If status is not `running`, returns `{ ok: true, skipped: true }`.
- If status is `running` and not stuck (progress or <2 min), returns `{ ok: true, skipped: true }`.
- If stuck (0 progress for 2+ min, or running >20 min), runs the sweep and returns `{ ok: true, processed, created, updated }`.

**Render Cron Job setup:**
1. Create a Cron Job in Render.
2. Schedule: `*/5 * * * *` (every 5 min) or `*/10 * * * *` (every 10 min).
3. Command: `curl -s -H "Authorization: Bearer $PB_WEBHOOK_SECRET" "https://pb-webhook-server.onrender.com/api/cron/smart-followup-sweep"`

## Option B: Node Script (Standalone)

Run the script locally or via a Render Cron Job that runs the app.

**Command:**
```bash
node scripts/smart-followup-sweep-cron/index.js
```

**Environment:**
- `SMART_FUP_CRON_CLIENT_ID` – Client ID (default: `Guy-Wilson`)
- Same env as main app: `AIRTABLE_API_KEY`, `MASTER_CLIENTS_BASE_ID`, etc.

**Render Cron Job setup:**
1. Create a Cron Job in Render.
2. Schedule: `*/5 * * * *` or `*/10 * * * *`.
3. Command: `node scripts/smart-followup-sweep-cron/index.js`
4. Build command: same as main service (e.g. `npm install`)

**Note:** If using the Node script, the cron job must have access to the same env vars and codebase as the app.
