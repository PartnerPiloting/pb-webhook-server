# Corporate Captives (CC) — weekend Gmail outreach

Living spec. Update this doc when rules change.

## Purpose

Send personalized individual emails from **Guy Wilson &lt;guyralphwilson@gmail.com&gt;** (Gmail API + OAuth on Render) to a variable number of leads per weekend. **Corporate Captives** is informal vocabulary for the *kind* of recipient — **no** dedicated Airtable segment field is required.

## Relationship to "Hi All"

- **Hi All** = people you have **spoken with**; sent (e.g. **Friday**) as **one BCC** newsletter.
- **CC outreach** = **individual** sends to leads **not** in active conversation.
- **Intended non-overlap:** Hi All audience should not match CC recipients because CC excludes leads with **Notes** non-blank (and similar rules). Watch edge cases (e.g. spoken with but Notes still empty).

## Volume & timing

- Target **~100 Saturday morning** and **~100 Sunday morning** (define "morning" as a **time window**, not a single burst).
- **Spread sends** within the window with **jitter**; use **light content variants** (not only `[Name]`) to reduce "identical blast" signals.
- **Configurable cap:** max sends per run via **env** and/or Airtable table **`Outbound Email Settings`** (single row recommended). **Which calendar days** send is usually **Render cron** (add jobs for extra weekdays later); the table holds **limits / flags**, not the only copy of "Saturday vs Sunday" forever.
- **Phase 1:** support **small test caps** (e.g. 3–5) before full volume.

## Template & configuration

- **Subjects:** **`Email Subject 1`**, **`Email Subject 2`**, **`Email Subject 3`** — code picks **one at random** (non-empty fields only).
- **Body:** single **`Email Body`** with **`{{FirstName}}`**; links in the body (or env later if you prefer).
- **Split:** sending **machinery** in code; **knobs** in **Outbound Email Settings**; **people** on **Leads**.

## List source

- **Table:** Leads (single-tenant / Guy's base).
- **Sort:** **Outbound Email Score** descending (ties broken by Airtable record id); take **top N** after filters (N capped by run config).
- **Skip** invalid / empty email addresses.

## Eligibility filters

**Field:** **`Scoring Status`** (Single select). This is **not** the same as numeric **Outbound Email Score** (used for **sort** + opt-out via **0**).

| `Scoring Status` value | CC email (this axis) |
|--------------------------|----------------------|
| **To Be Scored** | **Exclude** (always) |
| **Scored** | **Include only** if **Date Scored** is set (value itself is not age-gated; see **Min Days Since Lead Added** below) |
| **Manually Excluded** | **Exclude** |
| **Failed – API Error** | **Exclude** |
| **Failed – Parse Error** | **Exclude** |
| **Skipped – Profile Too Thin** | **Exclude** |
| **Any other / new status** | **Exclude** until explicitly allowed in code |

Other rules:

| Rule | Action |
|------|--------|
| **Notes** | Exclude if **not** "empty": treat as empty only if **blank**, **whitespace-only**, or **`.`** only |
| **First Name** | **Skip** lead if missing/blank |
| **Outbound Email Score** | **0** = opt-out — exclude; **blank** = **skip**; also used to **order** eligible leads (highest first) |
| **Outbound Email Sent At** non-empty | Exclude (already sent) |
| Invalid / empty **Email** | Exclude |

**Outbound Email Settings (eligibility knobs):**

| Field | Action when set |
|--------|------------------|
| **`Min Outbound Email Score`** | Require **Outbound Email Score** **strictly greater** than this number (e.g. `7` → only **8+**). Blank = no extra floor beyond “not 0 / not blank”. |
| **`Min Days Since Lead Added`** | Require the lead’s Airtable **`createdTime`** to be at least **N** **Brisbane** calendar days before **today** (replaces the old fixed “60 days after Date Scored” rule). Blank = no minimum age on created time. |

## Idempotency & tracking

- **Never** send twice to the same lead for this campaign: use **`Outbound Email Sent At`** (Date/Time) on Leads — empty = not sent; set when send succeeds (and optionally campaign id later).
- Guard against overlapping cron runs (claim/lock pattern TBD in implementation).

## Technical stack (existing)

- **Gmail:** `services/gmailApiService.js`, OAuth env vars on Render.
- **Debug:** `GET /debug-gmail-oauth-env`, `POST /debug-gmail-send-test` (Bearer auth; test-only recipient) — do not use as production bulk API.
- **Dry-run preview (HTML):** `GET /admin/corporate-captives-dry-run-preview` — **Bearer** auth or browser **`?secret=`** (same value as `PB_WEBHOOK_SECRET`); optional `clientId`, `limit`. **No sends**, **no Airtable updates**; open in browser to see rendered **Email Body** + subject pool. Skips inter-send delay (preview only).
- **Send run (JSON):** `GET` or `POST /admin/corporate-captives-send-run` — same auth; optional `clientId`, `limit`. Sends up to **Max Sends Per Run** (or `limit`) via Gmail HTML; sets **`Outbound Email Sent At`** on success. **No-op** if **Outbound Email Enabled** ≠ Yes or **Dry Run** = Yes. Skips leads without a valid **guest booking link**. **Cron / schedule:** [CC-OUTREACH-CRON-SETUP.md](./CC-OUTREACH-CRON-SETUP.md).
- **Local harness:** `npm run test:cc-outreach` — offline unit checks (filters, sort, template). Optional: `CC_OUTREACH_LIVE=1` hits Airtable + builds preview HTML (needs env like production).

## Airtable field names (Leads) — confirmed

| Use | Field name |
|-----|------------|
| Email | **Email** |
| First name (greeting) | **First Name** |
| Conversation / exclude if active | **Notes** |
| Pipeline status | **Scoring Status** |
| When scored | **Date Scored** |
| Sort (desc) + opt-out at 0 | **Outbound Email Score** |
| Already sent | **Outbound Email Sent At** |

## Outbound Email Settings (Airtable)

- **Table name:** **`Outbound Email Settings`** (in **My Lead–Guywilson** base). One record is enough to start.
- **Primary row label:** **`Name`** = e.g. **`Default`** (or any single label).

| Field | Type | Purpose |
|--------|------|--------|
| **`Max Sends Per Run`** | Number | Cap per cron run. |
| **`Dry Run`** | Single select **Yes** / **No** | **Yes** = no Gmail, no **`Outbound Email Sent At`** updates. |
| **`Outbound Email Enabled`** | Single select **Yes** / **No** | **No** = job exits immediately. |
| **`Min Seconds Between Sends`** | Number | Floor spacing; code adds random jitter on top. |
| **`Email Subject 1`** | Single line | Subject pool (see below). |
| **`Email Subject 2`** | Single line | Subject pool. |
| **`Email Subject 3`** | Single line | Subject pool. |
| **`Email Body`** | Long text | One body for all; placeholder **`{{FirstName}}`**. Links live in the body. |
| **`Min Outbound Email Score`** | Number | Eligible only if score **>** this value (see above). |
| **`Min Days Since Lead Added`** | Number | Eligible only if Airtable record **created** at least **N** days ago (Brisbane; see above). |
| **`Email Body (Owner)`** / **`Email Body (Employee)`** | Long text | Optional variant bodies; if blank, **`Email Body`** is used. |

**Subject choice:** each send **randomly picks one** of **Subject 1 / 2 / 3** that is **non-empty**. If only one is filled, every send uses that one.

## Guest booking link (self-serve scheduling)

Each outreach email includes a **signed guest booking link** so the lead can book a 30-minute call directly on Guy's calendar without back-and-forth.

### How it works

1. **Link construction:** The outreach code mints a signed token per lead (name, email, LinkedIn, expiry) using `signGuestBookingToken` and `GUEST_BOOKING_LINK_SECRET`. The link is `https://pb-webhook-server.onrender.com/guest-book?t=TOKEN&guestTz=TIMEZONE`.
2. **Lead clicks:** They see a date/time picker in their timezone. Weekends and AU public holidays are filtered out. Earliest bookable day is **tomorrow** (no same-day bookings).
3. **Lead books:** `POST /api/guest/book` checks the slot is free, creates a Google Calendar event (with Zoom link, LinkedIn URLs, any notes), and sends a calendar invite to the lead. Event **title** is **`{Lead} and {Host} 1st meeting`** (e.g. `Jane Smith and Guy Wilson 1st meeting`). Optional prefix via **`GUEST_BOOK_EVENT_SUMMARY_PREFIX`** on Render (e.g. `[CC outreach]`).
4. **Guy gets notified:** An email is sent to Guy immediately with who booked, when, their notes, and a link to the calendar event.
5. **Errors:** If booking fails, the lead sees a detailed diagnostic on screen (not a generic "Error"). The server logs the failure under `[guest-book]` in Render logs.

### Key files

| File | Purpose |
|------|---------|
| `routes/guestBookingRoutes.js` | `/guest-book` page, `/api/guest/availability`, `/api/guest/book`, all debug endpoints |
| `services/guestBookingToken.js` | Sign/verify tokens (`GUEST_BOOKING_LINK_SECRET`, min 16 chars) |
| `services/guestBookingEventBuilder.js` | Airtable Client Master lookup, calendar event text |
| `services/calendarOAuthAvailability.js` | Free/busy slots, host vs guest timezone windows |
| `services/calendarOAuthService.js` | `createGuestMeeting`, `assertPrimarySlotFree` |
| `services/guestBookingDayFilter.js` | Weekend + AU public holiday filter |
| `services/guestTimezoneAliases.js` | "Sydney" → `Australia/Sydney`, etc. |
| `services/guestBookError.js` | Error serialization, detailed reports, `[guest-book]` logging |
| `services/guestBookingAirtable.js` | Update lead email in Airtable if changed |

### Pre-send audit

Before sending a batch, run the audit to verify every link will work:

```
GET /debug-guest-book-audit?secret=PB_WEBHOOK_SECRET&leads=[...]
```

- Pass leads as URL-encoded JSON array: `[{"name":"Jo","email":"jo@x.com","li":"https://linkedin.com/in/jo","guestTz":"Sydney"}, ...]`
- Returns a plain-text report per lead: token validity, timezone resolution (flags fallbacks), availability count, sample slots, event preview, and the actual link.
- Ends with a **book + delete** calendar probe to confirm the full path works.
- Omit `leads` for built-in test samples (Sydney, Melbourne, Brisbane, Perth).

### Post-send monitoring

**Immediate:** Guy gets an email every time someone books.

**Mid-week check:** After a weekend batch, scan for failures:

```
GET /debug-guest-book-weekly-check?secret=PB_WEBHOOK_SECRET&days=4
```

- Pulls Render logs for the last N days (default 4, max 7).
- Filters for `[guest-book]` entries.
- If **any failures found**: emails Guy a summary with timestamps and error details.
- If **no failures**: returns JSON `{ failures: 0 }`, no email (add `&alwaysEmail=1` to force).
- Can be called manually (browser/curl) or wired into the outreach process as a follow-up step.

**Phase 1 (first few batches):** Run both audit (before) and weekly check (after). Read the reports.

**Phase 2 (confident):** Skip the audit. Rely on the booking notification emails and the weekly check. If weekly check returns zero failures, everything worked.

### Other debug endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /debug-guest-booking-url?secret=...&name=...&li=...&email=...` | Mint a link and redirect to booking page (browser test) |
| `GET /debug-guest-book-harness?secret=...` | Full book + delete on server (no local env needed) |
| `GET /debug-guest-book-pipeline?secret=...&mode=airtable\|calendar\|full` | Step-by-step probe (Airtable, OAuth, calendar) |

### CORS

The server's own origin (`https://pb-webhook-server.onrender.com`) is in the CORS allowed list. This was a bug that blocked all browser bookings until fixed.

## Open / TBD

- **Outbound Email Settings:** any further columns (e.g. separate URL fields if not using links in body).
- Timezone for "Saturday/Sunday morning."
- Final rules for **edge cases** (Notes with only punctuation, etc.).
- Wire weekly check into outreach batch as automatic follow-up step.
