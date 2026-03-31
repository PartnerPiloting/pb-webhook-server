# Corporate Captives (CC) outreach — Render cron setup

The send job is **HTTP-triggered**. It returns **202** immediately and runs in the **web service** background (Gmail sends + Airtable updates). Use a **Render Cron Job** (or any scheduler) to call the URL on your chosen schedule.

**Do not** add this to `render.yaml` as a second definition — this repo keeps crons in the **Render Dashboard** only (see comment in `render.yaml`).

## Endpoint

```
GET https://pb-webhook-server.onrender.com/admin/corporate-captives-send-run
```

**Auth (pick one):**

- **Bearer (recommended):** same secret as `PB_WEBHOOK_SECRET` on the web service.
- **Query:** `?secret=...` — works for simple GET crons, but the secret can appear in access logs; prefer Bearer when possible.

**Optional query params:**

| Param | Purpose |
|--------|--------|
| `clientId` | Airtable client id (default: `Guy-Wilson`) |
| `limit` | Hard cap on sends this run; if omitted, uses **Max Sends Per Run** from **Outbound Email Settings** |

## Render Cron Job

1. **Dashboard** → **New +** → **Cron Job** (same account as `pb-webhook-server`).
2. **Repository:** same repo as the web service (or a minimal repo is fine if you only run `curl`).
3. **Schedule:** cron expression in **UTC** (Render standard). Examples below.
4. **Command** (shell):

```bash
curl -sS -H "Authorization: Bearer $PB_WEBHOOK_SECRET" "https://pb-webhook-server.onrender.com/admin/corporate-captives-send-run"
```

5. **Environment:** add **`PB_WEBHOOK_SECRET`** with the **same value** as the production web service (or attach the **same env group** the web service uses).

6. **Region:** same as the web service is fine (cron only issues HTTP; the real work runs on the web service).

### Example schedules (Brisbane `Australia/Brisbane` = UTC+10 all year)

Convert your desired **local** time to **UTC** and set the cron in UTC.

| Goal (Brisbane) | Approx. UTC | Cron (minute hour dom mon dow) |
|-----------------|-------------|---------------------------------|
| Sat 07:00 | Fri 21:00 | `0 21 * * 5` (Friday UTC) |
| Sun 07:00 | Sat 21:00 | `0 21 * * 6` (Saturday UTC) |

Adjust hour/minute if you want a different “morning” window. For two weekend windows, create **two** cron jobs (one per line above) or combine with care.

### Overlap and 409

Only **one** CC send run can run at a time per server instance. A second trigger while a run is active returns **409** with `CC outreach run already in progress`. Space cron triggers so a large run (many sends × delays) can finish before the next trigger, or accept occasional skips.

## What actually runs (Airtable + code)

The job **no-ops** when:

- **Outbound Email Enabled** ≠ **Yes**
- **Dry Run** = **Yes**
- Today’s **Brisbane** calendar date is listed in **Outbound Blackout Dates**

Otherwise it sends up to the cap, with jitter between messages. Details: [corporate-captives-outreach-spec.md](./corporate-captives-outreach-spec.md).

## Manual check (Windows)

Use `curl.exe` (not PowerShell `Invoke-WebRequest` if it times out):

```bash
curl.exe -s -H "Authorization: Bearer YOUR_SECRET" "https://pb-webhook-server.onrender.com/admin/corporate-captives-send-run"
```

Expect JSON with `runId` and **202** from the server (Render may still show the cron run as success if `curl` got a response).

## Report email

On completion (or crash), a text report is emailed to `CC_OUTREACH_REPORT_EMAIL`, then `GMAIL_FROM_EMAIL`, then a default — see `sendOutreachReport` in `routes/apiAndJobRoutes.js`.
