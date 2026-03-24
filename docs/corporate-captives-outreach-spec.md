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
- **Configurable cap:** max sends per run/day via **env** and/or **Airtable global parameters**.
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

| Rule | Action |
|------|--------|
| **Notes** non-blank | Exclude (already in conversation) |
| **Scoring status** = **To Be Scored** | Exclude (always) |
| **Scoring status** = **Scored** | Include **only** if **Date Scored** is **≥ 60 days** ago |
| **Date Scored** empty while status is **Scored** | Exclude until Date Scored is set |
| Other scoring statuses | Eligible on this axis (other filters still apply) |
| **Outbound Email Score** = **0** | Treat as **opt-out** for this campaign — exclude |
| Already sent this campaign | Exclude (requires **sent** + **sent date** fields on lead) |

## Idempotency & tracking

- **Never** send twice to the same lead for this campaign: maintain **sent flag** and **sent date** (and optionally campaign id later).
- Guard against overlapping cron runs (claim/lock pattern TBD in implementation).

## Technical stack (existing)

- **Gmail:** `services/gmailApiService.js`, OAuth env vars on Render.
- **Debug:** `GET /debug-gmail-oauth-env`, `POST /debug-gmail-send-test` (Bearer auth; test-only recipient) — do not use as production bulk API.

## Open / TBD

- Exact Airtable **field names** for scoring status, Notes, Outbound Email Score Order, Outbound Email Score, Date Scored, sent fields.
- Airtable **globals** shape for caps and template references.
- Timezone for “Saturday/Sunday morning.”
- Final rules for **edge cases** (Notes with only punctuation, etc.).
