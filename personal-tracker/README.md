# Personal tracker (commitments / open loops)

This folder is the home for a **personal system** (separate from webhook business logic) that helps **promises and follow-ups** not fall through the cracks.

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

1. Capture + simple list in DB + ChatGPT tools (manual dates / check-off).  
2. **Calendar** integration, then **daily briefing**.  
3. **Gmail** (and Fathom) ingestion; richer extraction.  
4. **Gates / gap prompts** (like the two-gate example) once basics are trusted.

## Next steps (when you’re ready to build)

1. Add a small Node (or reuse repo stack) service under this folder with health check + DB connection.
2. Initial migration: core tables + `jsonb` payload column(s).
3. Define **tool** endpoints the model may call; add ingestion jobs (cron or queue) for Gmail/Calendar/Fathom.
4. Second Render service with **root directory** = `personal-tracker` (or as we structure it), if we keep deploys separate from the main webhook app.

---

*Last updated: planning phase — edit this file as decisions change.*
