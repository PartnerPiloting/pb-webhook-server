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

- **Subject + body** should live in **Airtable** (or equivalent) for frequent copy changes — avoid long-term hard-coding.
- **Links** (Calendly, article/resource): **env** and/or Airtable.
- **Split:** sending **machinery** in code; **knobs** in env/globals; **people + copy** in Airtable.

## List source

- **Table:** Leads (single-tenant / Guy’s base).
- **Sort:** **Outbound Email Score Order** descending; take **top N** after filters (N capped by run config).
- **Skip** invalid / empty email addresses.

## Eligibility filters

**Field:** **`Scoring Status`** (Single select). This is **not** the same as numeric **Outbound Email Score** (used for sort + opt-out via **0**).

| `Scoring Status` value | CC email (this axis) |
|--------------------------|----------------------|
| **To Be Scored** | **Exclude** (always) |
| **Scored** | **Include only** if **Date Scored** is set **and** **≥ 60 days** ago |
| **Manually Excluded** | **Exclude** |
| **Failed – API Error** | **Exclude** |
| **Failed – Parse Error** | **Exclude** |
| **Skipped – Profile Too Thin** | **Exclude** |

Other rules (same as before):

| Rule | Action |
|------|--------|
| **Notes** non-blank | Exclude (already in conversation) |
| **Outbound Email Score** = **0** | Opt-out — **exclude** |
| **Outbound Email Sent At** non-empty | Exclude (already sent) |
| Invalid / empty email | Exclude |

## Idempotency & tracking

- **Never** send twice to the same lead for this campaign: use **`Outbound Email Sent At`** (Date/Time) on Leads — empty = not sent; set when send succeeds (and optionally campaign id later).
- Guard against overlapping cron runs (claim/lock pattern TBD in implementation).

## Technical stack (existing)

- **Gmail:** `services/gmailApiService.js`, OAuth env vars on Render.
- **Debug:** `GET /debug-gmail-oauth-env`, `POST /debug-gmail-send-test` (Bearer auth; test-only recipient) — do not use as production bulk API.

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
- **Suggested columns later:** e.g. max sends per run, dry-run flag, campaign enabled — exact names TBD when we implement. Per-day caps only if you need different limits on weekend vs weekday.

## Open / TBD

- **Outbound Email Settings** column list + types.
- Timezone for “Saturday/Sunday morning.”
- Final rules for **edge cases** (Notes with only punctuation, etc.).
