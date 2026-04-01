# Personal tracker (commitments / open loops)

This folder is the home for a **personal system** (separate from webhook business logic) with **two parallel high-level goals** (same backend/MCP where possible, different tools and data shapes):

1. **Open loops / commitments** — don’t miss promises, triage, daily briefing, calendar-aware nudges.  
2. **Coaching / client context** — quickly get aligned on dense client emails, draft replies, call plans, and resource ideas; **remember** the thread next time via persisted data (not chat memory alone).

It lives inside `pb-webhook-server-dev` so you only ever open **one** Cursor project and one git repo.

## What it should do (high level)

- Pull signals from **Gmail**, **Google Calendar**, and **Fathom** (details depend on what Fathom exposes).
- Keep a **small structured core** (e.g. what’s open, due dates, links to sources) plus **flexible JSON** for things you add over time (“from now track xyz”) without new database columns every time.
- **ChatGPT in the browser** is the main UI; it talks to **your backend** through **tools** (e.g. MCP or HTTP actions), not directly to the database.

## How the database fits in

- The database is the **source of truth**. You normally **don’t** edit it by hand.
- **Day-to-day:** you chat; the assistant calls **safe, narrow APIs** (list / add / update / snooze / done).
- **Structural changes** (new tables, migrations, tool contracts): done **in code here** (and reviewed), not by the model altering production schema freely.

## Stack we agreed fits well

- **Render** for hosting (you already use it).
- **Postgres** (e.g. Render Postgres or Neon) with **JSONB** for evolving attributes — **not** SQLite on the default ephemeral web disk unless we add persistent disk.
- Optional later: summaries in **Airtable** for human-friendly views; primary flexible store still **Postgres + JSONB** if you want strong queries.

## Folder purpose

- **This directory** (`personal-tracker/`): app code, migrations, and notes for this feature will accumulate here.
- **Rest of repo**: existing `pb-webhook-server-dev` behaviour and endpoints stay as they are unless we deliberately integrate.

## Secrets and accounts (you will still do these)

- Create/set **Google OAuth** app and scopes where needed.
- Put **`DATABASE_URL`** and other secrets in **Render** (or `.env` locally if you use one — never commit secrets).
- In **ChatGPT**, attach/configure **MCP** (or equivalent) pointing at the deployed URL and auth.

## How we evolve this doc (before code)

- **Discuss in Cursor** when product ideas come up (nags, gates, what “done” means).
- **Then update this README** with the decisions so build work isn’t lost in chat history.
- **ChatGPT** is fine for brainstorming; **this file** is the durable spec for implementation here.

## Lanes (one system, different rules)

| Lane | Role |
|------|------|
| **Triage** | What to do today — ordering, snooze, dismiss; inbox/calendar are inputs. |
| **Commitments** | Promises — who/what/when, sources, don’t drop; stricter than ideas. |
| **Ideas** | Quick capture — low friction, triage later; separate from commitments in briefings. |
| **Coaching / clients** | Per-client profile and touchpoints — prep, reply drafts, call talking points, resources; **saved** so the next session starts warm. |

## Parallel objective — coaching / client context (high level)

**Problem today:** Long, detailed client emails (e.g. implementation dumps, catalogues of assets) sit unread because full digestion takes too long — so you delay and carry guilt.

**Target behaviour (with MCP + DB):** In ChatGPT you can ask, in one flow, to **analyse** the thread (paste at first; later pull from Gmail), **draft a short acknowledgment** (you edit/send), **suggest what to say on the upcoming coaching call**, and **suggest books or YouTube** that nudge the client toward the paradigm you want (e.g. buyer/outcome vs. exhaustive product detail). The assistant uses **Calendar** when available: *meeting soon → brief email now, deeper redirect on the call* (or the inverse if a long gap would feel like silence).

**Memory (“next time”):** Continuity requires **persisted** records — client profile, **summaries** of touchpoints (email/Fathom), and decisions — loaded via tools on the next call. Relying only on ChatGPT chat history is **not** enough.

**Implementation notes:**

- **Same MCP server** can expose both **open-loop** tools and **coaching** tools; keep **data and prompts** separated so coaching content doesn’t pollute todo logic.  
- **Link analysis:** optional and **shallow** in v1 (email body + a few key URLs if needed); crawling whole sites is slow and low ROI early on.  
- **Resources:** prefer a **small curated list** you maintain plus model suggestions; **verify** titles/links before sending.  
- **Privacy:** client content is sensitive; tight access, retention, and logging discipline.

**Illustrative client pattern (Matthew):** University professor; large prompt library / lead-magnet catalogue; tends to go **very deep** in updates while the coaching aim is to **shift toward what sells** (clarity, one offer, one audience). The system should tag that pattern over time and keep briefings **high-signal**, not a repeat of his full inventory.

## ASH Client Interaction OS (MCP layer spec — imported)

Source: **ASH Client Interaction Operating System (MCP Layer Spec)** (`ASH_Client_Interaction_OS.pdf`). This is the **canonical coaching shape** for the client lane; implementation here should align with it.

**Purpose:** A repeatable system that improves **call quality**, **client outcomes**, **conversion**, and **consistency**.

**Core loop**

1. **Prep** — before the call (brief, cheat sheet).  
2. **Execute** — the live call (human; OS supports, doesn’t replace).  
3. **Debrief** — structured update after behaviour signals.  
4. **Reinforce** — follow-up (e.g. concise email) so direction sticks.

**Principle:** Optimise for **decisions, patterns, and direction** — **not** raw notes.

**Client record (data model)**

| Field | Role |
|--------|------|
| `name` | Client identifier |
| `summary` | Compressed story / context |
| `patterns` | Recurring behaviours (e.g. overbuilder) |
| `current_direction` | What we’re steering toward now |
| `last_shift` | Last meaningful change in stance or focus |
| `risks` | What might derail (e.g. revert to building) |
| `commitments` | Client-related commitments (see open question below vs global open loops) |
| `metrics` | Trackable signals (define per client when we build) |
| `last_updated` | Freshness |

**MCP-style commands (names from spec)**

| Command | Role |
|---------|------|
| **`PrepClient`** | Output a **short call brief**: current pattern, last shift, risk, key question, your role, constraint. |
| **`PostCallUpdate`** | Update the structured `Client` record from **behaviour signals** (post-call debrief). |
| **`GenerateFollowUpEmail`** | Produce a **concise, reality-based** follow-up email after the call. |

**`PrepClient` output shape (from spec):** pattern, last shift, risk, key question, your role, constraint.

**Call cheat sheet template (from spec)** — single-screen anchor for Execute:

- **OBJECTIVE** — e.g. drive conversations  
- **WATCH FOR** — e.g. overbuilding  
- **KEY QUESTION** — e.g. how many conversations?  
- **REFRAME** — e.g. not a content problem  
- **CONSTRAINT** — e.g. no new assets  

**Example in spec (Matthew):** Pattern **Overbuilder**; risk **reverting to building**; key question **how many conversations?**; role **reduce not expand**.

**Summary line from spec:** This system converts **scattered notes** into **structured insight** and **scalable coaching**.

**Map to our earlier coaching ideas:** Analyse email + calendar-aware reply vs call depth + books/YouTube fits **Prep / Reinforce**; persisting touchpoints fits **`PostCallUpdate`** and the `Client` record; **GenerateFollowUpEmail** matches **follow-up after calls** (and can complement ad-hoc “reply to Matthew’s dump” flows).

**Open questions (to resolve when building)**

- **`Client.commitments` vs global “promises” lane:** Same underlying table with a client link, a separate field only for coaching promises, or both — pick one rule so nothing falls between cracks or duplicates.  
- **`metrics`:** What you want to count first (e.g. conversations/week, assets shipped, call frequency).  
- **“ASH” acronym:** Not spelled out in the PDF; expand in this doc when you want it on paper.

## Daily rhythm (target workflow)

- **During the day:** work as usual; optional quick capture via chat (“note: …”, “I promised …”).
- **Once daily (optional twice):** open ChatGPT → **briefing** from stored state + **Calendar** for “when”.
- **Per item:** act, snooze, or dismiss; system updates so noise stays low.

## Calendar vs Gmail (source of truth)

- **“When”** for meetings: prefer **Google Calendar** over parsing email alone.
- **Daily digest** can look at **tomorrow** (e.g. evening run) for prep / reminders.

## Example: reschedule thread → two gates (simpler than all-in-one AI)

Inspired by real threads (e.g. contact reschedules; you reply and move the meeting).

1. **Gate A — Calendar**  
   If the **rescheduled event** isn’t reflected on your calendar (right person / time), **nag to fix calendar** (re-book, accept invite, etc.).  
   Optional escape: “handled outside Google Calendar” for edge cases.

2. **Gate B — Pre-meeting “re-anchor” email**  
   **Only after** Gate A looks OK: check whether a **scheduled send** (or equivalent) exists to them **morning of the day before** (or confirm manually if Gmail API is ambiguous).  
   - If satisfied → **no noise**.  
   - If not → prompt: **schedule now** / **remind again** / **forget (I’m not doing it)**.  
   Cap snoozes so nothing nags forever.

**Linking** email + calendar + draft/scheduled send across names (“Maarten” / “Marty”) needs **entity matching**; start with **rules + optional confirm** before trusting full auto-silence.

## Build phasing (keep v1 smaller)

**Open loops track:**  
1. Capture + simple list in DB + ChatGPT tools (manual dates / check-off).  
2. **Calendar** integration, then **daily briefing**.  
3. **Gmail** (and Fathom) ingestion; richer extraction.  
4. **Gates / gap prompts** (like the two-gate example) once basics are trusted.

**Coaching track (can trail or overlap):** implement **ASH** shape — `Client` record + tools **`PrepClient`**, **`PostCallUpdate`**, **`GenerateFollowUpEmail`**; touchpoint storage; cheat sheet generation; then Gmail pull for threads when ready.

## Spike (live now): ChatGPT → **Leads** row contact lookup (tenant base)

**Goal:** Ask ChatGPT for a **Lead’s** **email, phone, LinkedIn profile URL, location** by **person name** (e.g. Matthew Bulat). Uses the same **Leads** table and **`findLeadByName`** logic as inbound email / Fathom flows — **not** the Master `Clients` roster row.

**Endpoint (same deploy as pb-webhook server):**

`GET https://pb-webhook-server.onrender.com/coaching/client-contact-lookup?name=<First+Last>&clientId=<MasterClientId>`

- **`name`** — Lead’s **First + Last** as stored in Airtable (same rules as `inboundEmailService.findLeadByName`: hyphens, “Last, First”, etc.).
- **`clientId`** — Your row on **Master `Clients`** (`Client ID`), e.g. the ID for Guy Wilson’s tenant **unless** you set **`COACHING_LEADS_CLIENT_ID`** (or **`COACHING_LEADS_CLIENT_NAME`**) on Render so ChatGPT can omit it.
- **`clientName`** (optional) — Match Master `Client Name` if you prefer not to use `clientId`.
- **`company`** (optional) — Helps disambiguate when several leads share the same name.

**Auth:** `Authorization: Bearer <PB_WEBHOOK_SECRET>` (same secret as `/debug-render-logs`).

**Response:** `tenantClientId`, `matchType` (`unique` | `narrowed` | `ambiguous` | `none`), `lead` when unique/narrowed, `matches[]` otherwise. Lead fields come from **Leads**: **Email**, **Phone**, **LinkedIn Profile URL**, **Location**, **Company**.

**Code:** `services/coachingClientLookupService.js` (resolves tenant → calls `findLeadByName`), route in `routes/apiAndJobRoutes.js`. Optional Master-only contact field constants remain in `CLIENT_CONTACT_LOOKUP_FIELDS` for future use.

**Your next step after deploy:**

1. **(Optional)** In Render → your web service → **Environment**, set **`COACHING_LEADS_CLIENT_ID`** to your Master **Client ID** so ChatGPT does not need to send `clientId` every time.
2. **Custom GPT:** Create or edit a GPT → **Actions** → **Import** `personal-tracker/openapi-coaching-lead-lookup.yaml` (or paste its contents).
3. Set **Authentication** to **API key** (or Bearer, depending on UI): paste **`PB_WEBHOOK_SECRET`** as the token (same value you use for debug log access — **never** put it in the YAML file or chat).
4. **Test** in the GPT: *What is Matthew Bulat’s email?* — If it fails, use **Preview / test** on the action or run `curl.exe` with your secret (see spike section above).

**MCP** can come later; Custom GPT Action is the quickest test.

## Next steps (when you’re ready to build)

1. Add a small Node (or reuse repo stack) service under this folder with health check + DB connection.
2. Initial migration: core tables + `jsonb` payload column(s).
3. Define **tool** endpoints the model may call; add ingestion jobs (cron or queue) for Gmail/Calendar/Fathom.
4. Second Render service with **root directory** = `personal-tracker` (or as we structure it), if we keep deploys separate from the main webhook app.

---

*Last updated: planning phase — edit this file as decisions change.*
