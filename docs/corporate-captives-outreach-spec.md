# Corporate Captives (CC) — weekend Gmail outreach

Living spec. Update this doc when rules change.

## Purpose

Send personalized individual emails from **Guy Wilson &lt;guyralphwilson@gmail.com&gt;** (Gmail API + OAuth on Render) to a variable number of leads per weekend. **Corporate Captives** is informal vocabulary for the *kind* of recipient — **no** dedicated Airtable segment field is required.

## Relationship to “Hi All”

- **Hi All** = people you have **spoken with**; sent (e.g. **Friday**) as **one BCC** newsletter.
- **CC outreach** = **individual** sends to leads **not** in active conversation.
- **Intended non-overlap:** Hi All audience should not match CC recipients because CC excludes leads with **Notes** non-blank (and similar rules). Watch edge cases (e.g. spoken with but Notes still empty).

## Volume & timing

- Target **~100 Saturday morning** and **~100 Sunday morning** (define “morning” as a **time window**, not a single burst).
- **Spread sends** within the window with **jitter**; use **light content variants** (not only `[Name]`) to reduce “identical blast” signals.
- **Configurable cap:** max sends per run via **env** and/or Airtable table **`Outbound Email Settings`** (single row recommended). **Which calendar days** send is usually **Render cron** (add jobs for extra weekdays later); the table holds **limits / flags**, not the only copy of “Saturday vs Sunday” forever.
- **Phase 1:** support **small test caps** (e.g. 3–5) before full volume.

## Template & configuration

- **Subjects:** **`Email Subject 1`**, **`Email Subject 2`**, **`Email Subject 3`** — code picks **one at random** (non-empty fields only).
- **Body:** single **`Email Body`** with **`{{FirstName}}`**; links in the body (or env later if you prefer).
- **Split:** sending **machinery** in code; **knobs** in **Outbound Email Settings**; **people** on **Leads**.

## List source

- **Table:** Leads (single-tenant / Guy’s base).
- **Sort:** **Outbound Email Score Order** descending; take **top N** after filters (N capped by run config).
- **Skip** invalid / empty email addresses.

## Eligibility filters

**Field:** **`Scoring Status`** (Single select). This is **not** the same as numeric **Outbound Email Score** (used for sort + opt-out via **0**).

| `Scoring Status` value | CC email (this axis) |
|--------------------------|----------------------|
| **To Be Scored** | **Exclude** (always) |
| **Scored** | **Include only** if **Date Scored** is set **and** **≥ 60 days** ago (**Brisbane** calendar date vs today) |
| **Manually Excluded** | **Exclude** |
| **Failed – API Error** | **Exclude** |
| **Failed – Parse Error** | **Exclude** |
| **Skipped – Profile Too Thin** | **Exclude** |
| **Any other / new status** | **Exclude** until explicitly allowed in code |

Other rules:

| Rule | Action |
|------|--------|
| **Notes** | Exclude if **not** “empty”: treat as empty only if **blank**, **whitespace-only**, or **`.`** only |
| **First Name** | **Skip** lead if missing/blank |
| **Outbound Email Score** | **0** = opt-out — exclude; **blank** = **skip** |
| **Outbound Email Score Order** | **blank** = **skip** |
| **Outbound Email Sent At** non-empty | Exclude (already sent) |
| Invalid / empty **Email** | Exclude |

## Idempotency & tracking

- **Never** send twice to the same lead for this campaign: use **`Outbound Email Sent At`** (Date/Time) on Leads — empty = not sent; set when send succeeds (and optionally campaign id later).
- Guard against overlapping cron runs (claim/lock pattern TBD in implementation).

## Technical stack (existing)

- **Gmail:** `services/gmailApiService.js`, OAuth env vars on Render.
- **Debug:** `GET /debug-gmail-oauth-env`, `POST /debug-gmail-send-test` (Bearer auth; test-only recipient) — do not use as production bulk API.
- **Dry-run preview (HTML):** `GET /admin/corporate-captives-dry-run-preview` — same Bearer auth; optional `clientId`, `limit`. **No sends**, **no Airtable updates**; open in browser to see rendered **Email Body** + subject pool. Skips inter-send delay (preview only).

## Airtable field names (Leads) — confirmed

| Use | Field name |
|-----|------------|
| Email | **Email** |
| First name (greeting) | **First Name** |
| Conversation / exclude if active | **Notes** |
| Pipeline status | **Scoring Status** |
| When scored | **Date Scored** |
| Sort key (desc) | **Outbound Email Score Order** |
| Numeric score; 0 = opt-out | **Outbound Email Score** |
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

**Subject choice:** each send **randomly picks one** of **Subject 1 / 2 / 3** that is **non-empty**. If only one is filled, every send uses that one.

## Open / TBD

- **Outbound Email Settings:** any further columns (e.g. separate URL fields if not using links in body).
- Timezone for “Saturday/Sunday morning.”
- Final rules for **edge cases** (Notes with only punctuation, etc.).
