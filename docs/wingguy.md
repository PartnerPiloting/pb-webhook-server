# Wingguy — Product, Build & GTM (living doc)

> **How to use this doc.** This is the single source of truth for **Wingguy** — the
> productised LinkedIn outreach + booking + post-call service (Chrome extension +
> multi-tenant calendar/email + the rules/second-brain). It is **weekend / after-hours
> paced** — Guy is in a sales push by day, so this progresses slowly and must never
> disrupt the day-to-day setup. At the start of each session, read the **"You are here"**
> section at the bottom first. At the end of each session, update it. Companion to
> [`ash-extension-plan.md`](ash-extension-plan.md) (the original vision/brief).
>
> **⚠ Scan-first (so this big doc doesn't grow duplicates):** before adding *anything* new, skim the
> **🗺 Topic map** directly below and **Ctrl-F the topic across the whole doc** — themes recur here at
> different dates. Append to / cross-link the existing home (with a dated note) rather than starting a
> fresh, disconnected entry. Don't trust "I landed on it and that's the whole story" — check the map.
>
> **🔁 Session self-audit (this is YOUR job, Claude — no human reads this doc, so no one else will do it).**
> The human owns ground-truth + priorities; YOU own keeping this doc clean. Run this every session:
> 1. **Before adding** — do the scan-first check above (Ctrl-F the topic everywhere).
> 2. **When something changes a decision** — edit the **✅ Canonical current state** block *and* add a dated
>    JOURNAL entry. **Never just append and let the canonical block drift** — that's the whole failure this
>    structure exists to prevent.
> 3. **Drift check** — confirm the canonical block still matches the newest JOURNAL entries + **▶ You are
>    here**; reconcile any mismatch (the canonical block wins as "now", the journal explains "why/when").
> 4. **Stale claims** — mark them `STATUS: SUPERSEDED → <section>` *at the stale spot*, don't only fix it
>    elsewhere (a partial/grep read must see the correction where it lands).
> 5. **Volatile build-status** stays in **▶ You are here** + memories ONLY — never copy it into the
>    canonical block. Update **▶ You are here** at session end.
> Flag to the human only what needs ground-truth (did X actually ship/work, is this number still right) —
> the mechanical hygiene is yours to just do.
>
> **Working rhythm (decided 2026-06-09):** THIS doc (in git) is home base — NOT any single
> chat. Start a **new, focused chat per area** ("Nylas spike", "de-personalise rules",
> "Phase 0 recon", etc.); open it with *"where are we on Wingguy"* and Claude reads
> this doc to orient. Claude updates + commits this doc at the end of each session. Chats are
> disposable; the doc accumulates. Don't reload old mega-chats as working context.

---

## 🗺 Topic map — where each theme lives (skim before adding; Ctrl-F by section title)

> Listed by **section title** (Ctrl-F to jump — line numbers drift as the doc grows). **⚠ = the topic
> recurs in several places; read them together before editing, and add new thinking to the cluster
> (with a date), not as an orphan.** Status/most-current state always lives in **▶ You are here** (bottom)
> + the linked memories.

- **Orientation:** One-line vision · Iron rules (do not break) · ▶ You are here (read first each session) ·
  Terminology trap — "recall_" ≠ Recall.ai.
- **Product surfaces & UX:** Panel surfaces · Booking-from-the-panel · Post-call email workflow · Post-call
  follow-up agent (scope proven) · Discovery & onboarding (chips / keyword / page) · Existing extension recon ·
  Free-Claude wedge + the ONE-CONNECTOR design.
- **⚠ AI model, accounts & who-pays — TWO surfaces, read together** (panel = Guy's API key / his COGS;
  connector-cockpit = the *client's own Claude* / ~$0 to Guy): AI / model layer · AI cost economics ·
  Cost-bearing vs AI-hosting · Simple cost summary · Model per job (Claude draft / Gemini score) · Client AI
  requirement = Claude · BYO API key feasibility · Claude-in-Chrome vs custom extension · Free-Claude wedge ·
  +$50 Wingguy upsell · 100-client P&L. *(The early "clients need no AI account" line is panel-only — see the
  scope clarifier on "AI / model layer".)*
- **⚠ Pricing & delivery** (canonical = "Pricing + delivery model"; refinements scattered): Pricing + delivery
  model · Pricing snapshot · roadmap Phase 6 · +$50 Wingguy upsell · Economics — path to ~100 · 100-client P&L.
- **Rules / second-brain engine (= "Wingguy", the Postgres brain):** Data architecture — two stores ·
  Rules de-personalisation · Rules editing UX · Rules integrity (code gates, LLM proposes only) · Where each
  thing lives — code vs rule vs variable; graceful boundary + flag-to-queue (2026-06-21) · Gated
  extension — two kinds of mess · Stickiness vision · Where this sits vs frontier · Keeping Wingguy directives
  in Wingguy (not the client's general Claude memory).
- **Naming & terminology:** Naming the second brain (✅ Wingguy chosen) · name-variant policy (in Naming +
  Discovery) · Terminology — "the Portal" not Airtable · Terminology trap — "recall_".
- **Calendar / email / transcript infra:** Middleman (Nylas) · "Catch 1" · Provider notes · Pricing snapshot ·
  Transcript layer deep-dive · Fathom API — live verification + back-to-back · Speaker reconstruction on
  transcript ingest (single-speaker / no-diarisation paste path — **spec'd, NEXT BUILD**) · Wiring Claude into
  the backend + AI-provider audit (2026-06-19). *(Live status → ▶ You are here +
  memory `project_recall_to_fathom_migration`.)*
- **Architecture & build process:** Environments & deploy flow · Implementation roadmap (7 phases) · De-risking
  spikes · What actually paces the build · Scope reality check · Key code anchors · Chrome extension —
  fork-and-run-two, distribution, cost caps, scope & client lifecycle (2026-06-21) · Extension — panel data model,
  cost/quality model, commercial model & voice seed (2026-06-22).
- **GTM / market / scaling:** Target market + go-forward · Strategy handoff · Competitive position · Scaling to
  ~50 (intro-mesh; NO recurring meetings) · Ideal client = frequency-of-use · Onboarding = activation ·
  Sequencing the reveal · VA model + cost · Guy's time ~3 days/wk · LinkedIn analogy (renting a solved network).

---

## ✅ CANONICAL CURRENT STATE — read this first; trust it over the journal

> **How this doc works now (2026-06-18, restructured for an AI reader).** This block is the
> **deduplicated, present-tense truth** — trust it for *what is decided / true now*. The short reference
> sections that follow (vision · iron rules · terminology trap · environments) are stable. Everything from
> the **═══ JOURNAL ═══** divider down is the **dated decision journal** — provenance only; read it for
> *why* a thing was decided or *what it superseded*, **never to reconstruct current state** (that's how
> status goes stale). **Volatile build-status is NOT restated here** — it lives in exactly one place,
> **▶ You are here** (bottom) + the linked memories. **Discipline: when a decision below changes, edit
> THIS block AND add a dated journal entry — don't just append and let this drift.**

**What Wingguy is.** Productised LinkedIn outreach + booking + post-call follow-up, sold as a done-with-you
managed service to a non-technical niche (insurance brokers, financial planners, time-starved fractionals).
Moat = accumulated per-client tuned state + integration wiring + the "I know a Guy" relationship — NOT
novelty or rules-as-text.

**Two data stores (user-facing names).** **the Portal** = Airtable (leads/records; swappable→Postgres
later). **Wingguy** = Postgres (rules/prompts/accumulated knowledge = the "second brain"). The agent reads
Wingguy (how to act) + reads/writes the Portal (the records).

**Two product surfaces, one backend (key non-obvious distinction).**
- **Extension panel** — no-thinking VA flow; backend calls the AI **on Guy's key (his COGS)**.
  Clients need no AI account for *this* surface. **★ UX SHAPE (2026-06-26): an AI-Blaze-style FULL-SCREEN takeover
  fired by ONE typed trigger (`/wg`/aliases) from inside the LinkedIn composer; auto-detects phase + campaign
  template; draft shown highlighted → "insert highlight" → human edits → human clicks Send → on Send the whole
  thread full-replaces to Airtable.** ("fixed-button" is SUPERSEDED — there IS a refine chat box, the free-text
  watch-spot, kept on-rails by instruction-rules per "Out-of-scope use".) Detail ↓ journal "Extension UX lock
  (2026-06-26)".
- **Connector / cockpit** — the **client's own Claude** via **ONE remote MCP connector**; runs on the
  **client's** AI (~$0 to Guy) = the free→paid wedge. This is why "clients need no AI account" is panel-only.

**AI / model.** Standardise on **Claude** now behind a swappable seam: **Claude = drafting** (voice),
**Gemini = scoring + summaries** (cheap, high-volume). Connector surface needs the client's own Claude account
(framed as a product requirement, like "requires Chrome").
**★ Model-tier policy (2026-06-22).** Drafting defaults to **Claude Sonnet**, escalating to **Opus** only when
the *code* flags a heavy case up front (transcript involved / deep thread / post-call email) OR the human taps
"sharpen" — NOT Opus-on-everything (the wired `CLAUDE_MODEL_ID` default IS `claude-opus-4-8`, so Sonnet-default
is a lever to *set*, not leave). **CORRECTION — "Gemini Flash = scoring" is STALE:** verified 2026-06-22 that the
prod summary/scoring model defaults to **`gemini-2.5-pro-preview-05-06` (2.5 PRO), not Flash** (no
`GEMINI_MODEL_ID`/`RECALL_SUMMARY_MODEL` override on the service's env vars; env groups not enumerable via the API;
Guy's read = "pretty sure it's Pro"). Immaterial for summaries (pennies), but **⚠ verify + likely switch to Flash
before SCALING lead-scoring** (high-volume → ~10× lever). Detail ↓ journal "Extension — panel data model, cost/
quality model, commercial model & voice seed (2026-06-22)".
**Provider end-state (audited 2026-06-19): three providers, three different jobs — nothing to migrate.**
**Gemini** = high-volume scoring + meeting summaries + follow-up prep (stays). **OpenAI** = the portal's
**Start Here** help-Q&A (embeddings RAG + cheap `gpt-4o-mini` escalation) + topic layout — **live, and its
embeddings have NO Claude equivalent**, so it can't move to Claude; keep it (cheap, peripheral). **Claude** =
drafting/reasoning (speaker reconstruction now, post-call email later) — **wired into the backend 2026-06-19**
(`config/anthropicClient.js`, plain API key, model env-switchable `CLAUDE_MODEL_ID`=`claude-opus-4-8`, gated by `SPEAKER_RECONSTRUCTION_ENABLED`;
volatile status → ▶ You are here; "let sleeping babies lie" confirmed with evidence, journal 2026-06-19).

**Pricing (canonical).** $150/mo basics · **+$50 = Wingguy** → $200 full self-serve · **$300 = done-for-you**
(Mr Busy + VA). Tier by **service level (DIY vs done-for-you), not feature**. Referral: maintain **3 active
paying** referrals → $150 drops, **$50 floor** stays (conditional, grace window; $300→$50 tied to VA
self-sufficiency). Separate **one-time setup** from recurring. **No contractual lock-in** (protect only
months 1-3). ~100-client steady-state ≈ **AUD ~$265k/yr, ~78% margin** *(planning ballpark)*.
**Extension/Wingguy commercial model (2026-06-22, stickiness-first):** flat **$50/mo** (the +$50 Wingguy tier)
after a **500-action free trial** (≈ a month for a typical user; ~$5-8 AI cost on Sonnet); **simple daily action
cap ~150/day (≈3,000/mo) as a runaway backstop — NOT metered billing** (metering would make clients ration →
starve the moat). Price is a **demand/stickiness lever, not cost-recovery** — start **$50 (penetration), grandfather
early adopters, raise to ~$100 for later cohorts.** Detail ↓ journal "Extension — panel data model, cost/quality
model, commercial model & voice seed (2026-06-22)".

**Architecture (locked).** Additive only — Guy's single-tenant setup untouched until he flips flags ·
calendar+email multi-tenant via **Nylas** middleman (hosted auth) behind a **thin adapter** (Google = Guy's
current adapter) · connector auth = a **bolt-on managed provider** (**WorkOS AuthKit** the lead pick), not
hand-rolled OAuth · rules in **Postgres, versioned/append-only, single conflict-checked write-door** (LLM
proposes, code writes, curated categories) · **LinkedIn read+send stay human-at-the-glass** (never headless
send) · build `dev`→staging→main behind off-by-default flags (exception: Fathom backend-only work runs on
`main`, guarded by design + kill-switch).

**Capture / transcript.** Migrating **Recall.ai → Fathom** (Fathom = client-owned capture + "ready" webhook;
capture cost stays the client's). `recall_*` names = the **source-agnostic store**, NOT Recall.ai. Back-to-
back **splitter is required** (calendar-anchored + speaker-transition; serial cut, overlap accepted).
*Live status → ▶ You are here + memory `project_recall_to_fathom_migration`.*

**GTM.** ICP = **frequency-of-use** (relationship-building is their daily job), not job title. **Wingguy
manufactures its own demand** (powers Guy's outreach → loads the pipeline with right-fit people → results =
the demo → referrals via the Champion mechanic). Scale to ~50–100 via three levers: product self-improves +
**productised onboarding** + a **Wingguy-seeded intro-mesh (NO recurring meetings)**. **Onboarding IS the
business; its #1 job = activation, not rapport.** Website = credibility + conversion (NOT lead-gen);
WordPress = single source of truth with a public/Private per-page flag.

**Open questions (unresolved).** (1) **Cross-person craft portability** — does craft live in portable rules
or non-portable chat-memory? → the clean-Claude spike (Spike 0) answers it. (2) **First-run bar for
skeptics** vs "let them train it". (3) Multi-tenant refactor **paused** for the sales push (memory
`project_paused_refactor_state`).

**Backlog — flagged, not yet spec'd.**
- **Connection follow-up worklist ("where am I up to") — aka "Thanks for Connecting"** *(flagged 2026-06-18;
  design settled 2026-06-19; ✅ **v1 BUILT + VERIFIED LIVE 2026-06-20** — portal tab + backend route + per-client gate on `main`,
  Guy-first; auto-resolve webhook + extension auto-advance still v2. Volatile status → ▶ You are here)* — replace Guy's
  manual scan of LinkedIn recent-connections with a generated worklist of *where he's up to + what's still
  outstanding*. New connections already land in the **Portal (Airtable leads table) with a connection date**;
  the feature = **flag each lead actioned / not-actioned** (status-tick) and surface the not-yet-actioned ones
  as a worklist (sorted by connection date). The loop: click a lead → opens their LinkedIn profile → human
  writes the thanks-for-connecting note → (later) the extension does the magic + advances to the next. **Guy-
  first** (validate the loop on his own daily friction) **then client-facing** (every client has the same
  pain; in-portal + easy = they'll actually do it, unlike a manual scan).
  - **VERIFIED 2026-06-19 (ingestion backbone already exists + is multi-tenant — we are NOT building ingestion,
    only a view + a status to tick on top):** Linked Helper fires `POST /lh-webhook/upsertLeadOnly?client=CLIENT_ID`
    (`routes/webhookHandlers.js:29`) on connect; resolves the client's own Airtable base and upserts the lead.
    Connection date is captured to the **`Date Connected`** field (+ a `Days Since Connected` formula already
    exists; `services/leadService.js:118`); email is written too (`routes/webhookHandlers.js:219`); connection
    state lives in **`LinkedIn Connection Status`** (`Connected`/`Candidate`/`Pending`). So the queue is just:
    *Connection Status = Connected, sorted by Date Connected desc, where <tick-field> is blank.*
    **STATUS: SUPERSEDED 2026-06-20 (live data) → the queue keys off `{Date Connected}` presence ALONE, NOT
    `{LinkedIn Connection Status}`** — that status field's `Connected` value is stale; live connections land as
    `Candidate` with a fresh Date Connected. Blank Date Connected = not connected; set = connected. See ▶ You are
    here + [[reference_connected_means_date_connected_set]].
  - **WRINKLE (verified 2026-06-19):** the generic **`Status`** field is auto-clobbered to `"In Process"` on
    EVERY webhook upsert → useless as a "have I dealt with this person" signal. The worklist needs its **own
    dedicated field** (candidate: the currently-unused `Conversation Stage`, or a new `Thanks Status`).
  - **DESIGN SETTLED 2026-06-19** (detail + provenance ↓ journal *"Connection follow-up worklist / 'Thanks for
    Connecting' — design"*): **inbox-zero** worklist, **oldest-first** (oldest = closest to the LH window deadline).
    Two views — **Outstanding** (the draining queue, **bounded by a lookback limit** — only connections from the
    last ~N days, configurable, default ≈ the LH window (~14); solves the **cold-start flood** (without it, day-1
    shows every historical connection ever) AND keeps the queue bounded forever; this is a **harmless display
    filter, NOT the dropped mirrored-window** — if it's slightly off LH's value nothing breaks, auto-resolve still
    comes from the webhook. No separate bulk-clear needed — the lookback shrinks launch to a couple weeks Guy can
    eyeball-clear) + **All recent** (status-badged, reconcile against LinkedIn).
    Row = name (links to their LinkedIn profile) · headline/company · "connected X days ago" (free from `Date
    Connected`, zero config) · primary one-tap button + secondary. Optimistic remove + undo toast; live "N to
    thank" count badge (the motivator); real "all caught up" empty state. **Status set (locked):** *Outstanding*
    (blank) → **Messaged** (Guy's manual tick — he personally reached out via AI Blaze) · **Let go (LH sent)** (left
    to the LH automated sequence; auto-resolved). "Keeper" = cricket idiom (*let it go through to the keeper* = don't
    play at it), i.e. = "Let go", NOT "nurture". **(2026-06-21: "Let go" RENAMED to "Skipped" at Guy's request —
    cleaner/clearer. Airtable metadata API can't rename a select choice, so the app writes "Skipped" via record
    `typecast` (auto-creates the option) + maps legacy "Let go"→"Skipped" on read; stale "Let go" choice is cosmetic.
    New bases get "Skipped" from the start. Also this session: Date Connected is the left column + an Oldest/Most-recent
    sort toggle + a user-selectable window dropdown.)** Both done-states leave the queue → inbox-zero behaviour identical.
  - **AUTO-RESOLVE via LH message-sent webhook (preferred path):** Guy confirmed LH can fire a webhook at any
    campaign stage. When Guy DOESN'T personally message, LH sends its automated first message after the window and
    **pings our webhook → row auto-resolves to "Let go (LH sent)"**. When Guy DOES message, LH detects the
    correspondence and *suppresses* its send (the "filter out of my list" rule) → no ping → Guy hand-ticks
    **Messaged**. The two paths can't collide. **Reuse the ONE existing webhook** (`/lh-webhook/upsertLeadOnly`,
    likely a thin sibling like `/lh-webhook/messageSent` or an `event=` flag — same client-routing + same
    profile-URL→`Profile Key` matching) so clients configure only one webhook. This **replaces** the earlier
    mirrored-window + date-lapse idea (no duplicated window value, no drift). **Caveat (the only fly):** the **$8 LH
    tier caps webhooks at 20/day** (counts firings, not endpoints — reuse does NOT save budget); connection events
    already consume some today, message-sent is the *only new* consumption. **But it's self-throttling** (Guy,
    2026-06-19): #3 fires ONLY for *let-go* leads — working the window properly with AI Blaze suppresses LH's send
    on most, so the draw is **inversely proportional to engagement**. Worst case = **3 firings per lead lifecycle**
    (1: into Airtable on extraction · 2: on connect · 3: on message-out). #1+#2 already fit today's volume; #3
    shrinks the harder you work the list. So the cap really only bites a *disengaged* user (lets everyone fall to
    automation — getting little value anyway), whose fix is a clean ~$12 LH upgrade. Net: keep message-sent
    **optional** but treat the cap as a natural ceiling mapping to daily connection volume, not a real blocker —
    and a confident upsell line, not a hedge.
  - **Naming + placement (DECIDED 2026-06-20):** portal tab **"Thanks for Connecting"** (says exactly what you do;
    fits existing widths; beats "Connections"/"New Connections"/"Follow-ups" which are ambiguous or clash),
    subtitle **"Welcome your recent connections"**, icon a handshake/wave. Placed **after "Top Scoring Leads"**
    (last working tab, before the Settings/Start-Here utility tabs).
  - **Still open:** (C) v1 note = freehand (Guy uses AI Blaze externally) vs portal AI-suggested draft — lean
    freehand v1, AI draft is the later extension hook; (D) scope = **Guy-first then portal** (agreed in spirit);
    extension auto-advance = **v2** (v1 = manual tick). Needs its own dedicated tick-field (see WRINKLE above).
- **Speaker reconstruction + confirm on transcript ingest** *(flagged 2026-06-18; spec'd 2026-06-19; ✅ BUILT 2026-06-19 — shipped to `main` behind `SPEAKER_RECONSTRUCTION_ENABLED`, default OFF, awaiting cloud test — volatile status → ▶ You are here)* — non-Zoom captures (e.g.
  **Zoom Notes / Tactiq** recording a **Teams or Google Meet** call as a fallback when a guest's own tech
  fails) arrive with **NO diarisation — every line tagged as the host**, so who-said-what (the things that
  matter: intros + their *direction*, who-knows-whom, commitments) is unreliable even though both sides'
  words are captured. Proposed flow: **source dropdown** on import → **single-speaker detection** on ingest
  → **AI reconstructs** speakers from content (topic anchors + conversational logic) → **human-in-the-loop
  confirm card** (the critical step: *"the transcript was a bit dodgy and I've done my best — may not be
  quite right, can you check it?"*; user confirms/corrects intros & recognition lines in chat) → store
  **only the human-confirmed version** as canonical. Clean multi-speaker transcripts are read first and
  **pass straight through** — the confirm step fires only when reconstruction was actually needed. Principle:
  **ground truth can't be automated** — the person who was in the room is the only reliable source for the
  high-stakes lines; AI detects + reconstructs, the human confirms direction, and **that division IS the
  feature.** Every multi-tenant tenant hits this on any non-Zoom call. Implementation = an import-flow change
  in pb-webhook-server (detect → reconstruct → confirm card → store confirmed). **Now spec'd (2026-06-19): always show the confirm
  card + single-speaker detection in plain code (NO AI) + reconstruct only on detection-or-demand + free-text
  correction that propagates across the mislabelled stretch + surface only the high-stakes lines + regenerate
  the summary off the corrected version; reconstruction model = Claude `claude-opus-4-8` (a reasoning job, not
  Gemini-Flash scoring); gated on wiring Claude into the backend first.** Detail + provenance ↓ journal
  **"Speaker reconstruction on transcript ingest (paste path) — single-speaker / no-diarisation"**; lives
  next to the universal-paste seam (transcript layer item 5).

## The one-line vision

Turn the personalised LinkedIn outreach + booking + post-call workflow into a near
one-click panel that works identically for Guy, "Mr Busy", and Mr Busy's VA — built
once, sold as a done-with-you service. The moat is accumulated per-client tuned state,
not the prompt.

## Iron rules (do not break)

- **Additive only.** Everything is built *alongside* the working single-tenant setup.
  Guy's daily flow (Google calendar, `/api/calendar/quick-pick-message`, Claude-chat
  post-call drafting) keeps working untouched until *he* chooses to switch.
- **Staging-gate before main** for anything wide or frontend (house style).
- **LinkedIn read + send stay human-at-the-glass.** The panel may *fill* the message
  box; the human still clicks Send. Never scrape-and-send headless.

---

## ⚠ Terminology trap — "recall_" ≠ Recall.ai (read this before touching transcript code)

Two different things share the word "Recall" — keep them distinct or you (and Claude) will get confused:
- **Recall.ai** = a *recording service* (a bot that joins calls and captures transcripts). It is ONE
  capture **source**; **Fathom** is the other.
- **`recall_*` names** = historical **labels on the transcript STORE + lookup**, named that way because
  Recall.ai was the first source. They are **source-agnostic** — they hold/serve transcripts from BOTH
  Recall.ai and Fathom: Postgres `recall_meetings` / `recall_meeting_leads` (the "tank"); the MCP tool
  `recall_latest_transcript` + `GET /recall-review/api/latest-transcript-by-email` (the "tap" — finds the
  latest meeting for a lead, regardless of source); the `recall-review` frontend page.

**Model:** ONE Postgres store (tank). Recall.ai and Fathom are two pipes filling it. The chat's "I had a
meeting with X" lookup is a tap drawing from the tank — it does NOT care which pipe filled it. "Switch
Recall off, Fathom on" = close the Recall.ai pipe, open the Fathom pipe; tank + tap unchanged. **Decision
(2026-06-13): do NOT rename `recall_*` now** (pervasive: DB tables + ~dozen files + the live MCP connector
Guy's chat binds to; risky mid-migration). Revisit only after Recall.ai is retired, as its own staged job.

## Environments & deploy flow (confirmed via Render API, 2026-06-07)

**Branch-per-environment, each auto-deploys on push.** (`render.yaml` is STALE — it claims
staging tracks `feature/clean-service-boundaries`; ignore it. Render dashboard is the real
source of truth.)

| Service | Branch | Role |
|---|---|---|
| `pb-webhook-server` | `main` | Production backend |
| `pb-webhook-server-staging` | `staging` | Staging backend |
| `pb-webhook-server-dev` | `dev` | **Dev backend — our build sandbox** |
| `pb-webhook-server-hotfix` | `hotfix` | Hotfix |
| `ash-backend` | `main` | Separate ASH service — **investigate, may be relevant** |
| `ash-attributes-api` | `master` | Separate ASH service |

Crons follow the same convention (prod crons → `main`, staging crons → `staging`).
Frontend mirrors it on Vercel: `pb-webhook-server.vercel.app` (prod) /
`pb-webhook-server-staging.vercel.app` (staging).

**Chosen build approach: dev environment + env-var feature flags, promoted up.**
1. Build on the **`dev`** branch → deploys to `pb-webhook-server-dev` (private sandbox,
   zero risk to staging/prod).
2. Gate each feature behind an **env-var flag, default OFF** (we already gate on
   `ENVIRONMENT`), so when it reaches `main` production behaviour is unchanged until flipped.
3. Promote **`dev` → `staging` → `main`** as each small piece proves out.
4. **Standing discipline (slow-pace hazard):** periodically merge `main` *into* `dev` so dev
   doesn't drift while it sits between weekend sessions — keeps the eventual promotion clean.

═══════════════════════════ JOURNAL — provenance below (read for *why*, not current state) ═══════════════════════════

## Decisions locked so far (from the 2026-06-07 planning conversation)

### Calendar + email go multi-tenant via a middleman, behind a thin interface
- Guy will **not** hold OAuth credentials himself (OAuth maintenance is the nightmare to
  avoid for a solo operator). A **middleman holds each tenant's connection** and refreshes
  it; Guy's code just asks plain questions ("what's free?", "create event", "send email").
- **Chosen middleman: Nylas** (start on the free sandbox). One connect gives a tenant's
  **calendar AND email** (Gmail or Outlook) through one API. Use **hosted auth** so Nylas
  is the Google-verified app and Guy avoids Google's restricted-scope security review.
- Wrap it behind a **thin internal interface** (≈ "get busy times", "create event",
  "send/read email"). Today's Google code becomes the **Google adapter** behind that
  interface; Nylas is a second adapter. Swapping providers later is then contained.
- **Guy's own setup is safe:** either keep him on the Google adapter, or connect his own
  Google through Nylas's sandbox. His choice, no rewrite either way.

### Why this feature needs the middleman (not just a booking link)
- The "show live free slots → pick → paste-able message with the times in it" feature
  must *read* the calendar in real time. A plain booking link can't do that. So a
  middleman that exposes availability is required (this ruled out the link-only option).

### "Catch 1" (unattended calendar access) — largely dissolved by Fathom
- The only thing today that touches the calendar **unattended** is the Recall auto-join
  poller (`services/recallAutoJoinService.js`), which watches the calendar every 2 min to
  dispatch a recording bot. That's why the server currently needs headless calendar access.
- **Moving to Fathom removes this from Guy's server**: Fathom watches each user's *own*
  calendar and auto-joins itself → multi-tenant "for free", provider-agnostic, no
  per-tenant robot-login to maintain. **Residual to verify:** the back-to-back split /
  attendee-matching step may still need a small server-side calendar read; confirm whether
  Fathom's own data can supply attendees instead. See [[project-recall-to-fathom-migration]].

### Booking-from-the-panel = mostly reuse, not rebuild
- The portal already has a chat-based **"Smart Booking Assistant"** that auto-generates the
  paste-able message: `linkedin-messaging-followup-next/app/calendar-booking/page.tsx`
  (calls `/api/calendar/quick-pick-message`; has a `READY TO COPY:` delimiter + copy
  button; availability is already timezone-aware).
- **New work for the panel is small:** (1) content script reads the LinkedIn URL/name off
  the profile and feeds the existing endpoint; (2) add an **"Insert into LinkedIn"** button
  next to the existing Copy button. Copy already exists as the graceful fallback.
- **Panel type: injected DOM panel** (not Chrome's native side panel). **STATUS: SUPERSEDED 2026-06-26 →
  FULL-SCREEN takeover (AI-Blaze model), not an adjustable-width side panel** — roomy, not cramped; still an
  injected overlay but full-bleed + transient (opens on trigger, closes on Insert). See journal "Extension UX
  lock (2026-06-26)".

### Panel surfaces (front doors the content script must handle)
The panel isn't only for LinkedIn *profile* pages. Distinct surfaces, same engine:
- **Profile page** — booking message / outreach draft (reuse Smart Booking Assistant).
- **Messaging screen** — reply to an inbound message: read the visible thread + the
  other party's name/headline/profile, draft a reply in Guy's voice (lettered quick-picks
  + free-form), approve → insert into the "Write a message…" box + Airtable upsert
  (status → in-conversation, log exchange, set follow-up). Send stays Guy's click.
  *(Surfaced 2026-06-08 from a real Josiah-Roche reply; see Voice reference example 1.)*
- **Post-call (not page-anchored)** — agent-backed chat that drafts the follow-up email
  (see post-call decision below).

**Insert requirement — preserve line breaks.** LinkedIn's composer flattens
clipboard-pasted newlines into one block (this is why manual copy-paste loses Guy's
line-per-sentence formatting every time). The "Insert into LinkedIn" path must write to
the composer DOM directly and emit LinkedIn-style soft breaks (`<br>` / simulated
Shift+Enter) so formatting is preserved. The Copy fallback can't guarantee this (it goes
through LinkedIn's paste handler). *(Surfaced 2026-06-08.)*

### Roles / access
- The **VA acts as Mr Busy**: logged into *his* LinkedIn and *his* calendar sessions
  (so "whose calendar" is answered by whose session it is). For the **ASH portal**, the VA
  should have **their own login authorised as a seat on Mr Busy's subscription** (audit
  trail + revocable) rather than sharing Mr Busy's password.

### Post-call email workflow is preserved — same engine, second front door
> **STATUS: REFINED 2026-06-22 → delivery surface changed.** Post-call drafting for clients now runs in the
> **connector / Claude chat on the CLIENT'S own Claude (their cost)**, NOT "an agent-backed chat *in the panel*
> on Guy's key" (the line below). Same capability + same engine, cheaper surface — and it keeps the
> transcript-deep/post-call work (and its cost) off the extension. See journal "Back-test results, model decision
> & the surface/cost split (2026-06-22)".
- Guy keeps doing "just had a call with X, pull the transcript + lead info, draft an email"
  in **Claude chat** (his power-user cockpit). Not going away.
- For the VA, the **same engine** (transcript + lead-data + drafting tools) sits behind an
  **agent-backed chat in the panel** (Claude Agent SDK / API) with the **per-tenant tool
  connections** wired server-side. Drafts shown first; send-as-Mr-Busy via Nylas only on
  the approve-click (matches Guy's "show first, push on go-ahead" rule).

### Provider notes
- **Nylas** chosen. **Aurinko** = clean Plan B (gateway model, good pricing). **Unipile**
  adds LinkedIn/WhatsApp under one API — fine for email/calendar, but do **not** use it to
  *send on LinkedIn* (violates the iron rule; ban risk).

---

### AI / model layer (clients need no AI account; model is swappable)
> **★ Scope clarifier (2026-06-18 — prevents a real mix-up):** the "clients need no AI account / AI is
> Guy's COGS" model below describes the **EXTENSION PANEL** surface (VA no-thinking flow; backend calls
> the AI on Guy's key). It is **NOT** the whole story. The later **connector / cockpit** surface (the
> *client's own Claude*, the free→paid wedge) runs on the **client's** AI account at **~$0 to Guy**.
> **Two surfaces, two cost models** — read this together with *"Free-Claude wedge + the ONE-CONNECTOR
> design"*, *"Client AI requirement = Claude"*, *"+$50 Wingguy upsell"*, and *"Keeping Wingguy directives
> in Wingguy"*. Don't quote the COGS line as if it also covers the connector.
- **Clients never need Claude, ChatGPT, Copilot, or any AI account.** They use the panel;
  the panel calls Guy's backend; the backend calls the AI **server-side on Guy's API key**.
  AI cost is Guy's COGS (already inside the $150/$300 pricing), invisible to the client.
- Two distinct "Claudes": (1) **engine** = the model powering drafting/qualifying,
  server-side, Guy's choice; (2) **cockpit** = the claude.ai chat Guy personally uses with
  MCPs — just his tool, not part of the product.
- **Only the backend touches the AI.** Extension → backend only; rules DB = model-agnostic
  text. So the model lives behind one seam.
- **Decision:** use Claude now (known, strong, existing cockpit), but put the AI call behind
  a **thin interface** (same adapter discipline as calendar/email) so GPT/Gemini are a
  contained swap later (prompts re-tune per model). Don't build a multi-model router early —
  just leave the seam. The post-call **agent** chat (Agent SDK) is the only more
  Claude-shaped piece; MCP underneath is going cross-vendor and is abstractable.
  *(Surfaced 2026-06-08 — Guy's lock-in concern.)*

### AI cost economics (Guy bears it — but it's small + cappable)
Guy carries the AI cost as COGS (clients have no AI account). Concern: heavy panel use
could be substantial. **Reality (ballpark — MUST validate with real metering):**
- Draft a LinkedIn message: ~1-2¢ on a quality model, ~0.3¢ on a cheap one.
- Qualify a lead: a fraction of a cent. Post-call email from a transcript: ~4-5¢ (bounded, one per meeting).
- A *heavy* client (~50 drafts/day + a few calls) ≈ **$10-30/month of AI vs $150-300 revenue** → ~5-15% COGS. Works.

**The real risk is *unbounded* usage** (regenerate-spam, giant pastes, looping agent chats,
premium model for everything), not normal volume. Controls:
1. **Right model per job** (cheap for qualify/routine, better only for final drafts/email) — biggest lever.
2. **Prompt caching** the rules/system prompt (~90% off repeated input).
3. **Metering + per-client fair-use caps + alerts** — bounds exposure by design.
4. **Tiered pricing maps to usage** ($150 vs $300 allowances / overage).
5. **Batch the qualifier overnight** (~50% cheaper).

**Action:** instrument **token-cost-per-client** from the proving step (alongside
time-per-lead) so pricing is set on real numbers, not estimates. Pressure valve for
outliers/power-users: optional **BYO API key**.

**BYO-key horsepower caveat:** the key doesn't change the model (Guy's code picks the
model), so a *same-provider* key = same quality. The real "lower horsepower" risks are on
the client's *account*: (1) low **rate-limit/usage tier** → throttling under load (most
likely); (2) possible **model/priority-capacity** gating on basic accounts; (3)
**downgrade pressure** if the paying client wants a cheaper model. Must be a key for the
*same provider/model* or quality genuinely drops. → Keep BYO-key outlier-only; Guy bearing
the cost (metered + capped) gives all clients **uniform, controlled** horsepower, which is
the better product. *(Surfaced 2026-06-08 — Guy's cost concern.)*

**Pricing model — charge for usage (better than BYO-key):** meter each client and bill for
consumption while keeping Guy's key/model → client bears cost **and** keeps uniform
horsepower (beats BYO-key's account-tier throttling + quality variance). Stripe already in
repo (`billingRoutes.js`, `config/stripeClient.js`, `services/invoicePdfService.js`) →
metered billing is incremental; same metering serves caps + billing.
**Catch:** (1) variable bills fight the "effortless/predictable" promise Mr Busy buys;
(2) per-use pricing makes clients *ration* usage → starves the accumulated-usage moat.
**Sweet spot:** flat subscription + **generous included allowance** (predictable for ~95%,
encourages free use → feeds moat) + **overage only for true outliers** (caps the tail).
Set allowance from real metered data; map to $150/$300 tiers. Pure pass-through metering →
reserve for power users/agencies. *(Surfaced 2026-06-08.)*

### Post-call follow-up agent — scope proven by a real session (2026-06-08)
Guy ran his nightly post-call workflow in Claude chat for 4 leads (James, Mirko, Michelle,
Tim). This IS the "second front door" agent; the session shows exactly what the client
version must do. Capabilities exercised: identify lead (name OR pasted calendar invite) →
look up Airtable record/email (reconcile email discrepancies) → pull transcript from Recall,
**fall back to Fathom-in-Gmail when Recall missed it (2 of 4 tonight)** → synthesise the call
(hook, situation, next-call date cross-checked vs calendar) → apply canonical Follow-Up Email
Rules (self-corrected when a draft drifted; knew stage-gated link rules + asset usage gates) →
pick + label assets from a library (Vimeo/Gamma/LinkedIn, canonical URLs) → adapt voice per
persona (peer vs prospect vs deferring; golden paragraph + variants) → check Guy's calendar +
book a slot + create invite → update Airtable follow-up date → push Gmail draft (HTML spec,
links plain-text to avoid redirect wrap, BCC tracker, copy pairs) → create scheduled-reminder
self-emails → reason about strategy ("newsletter?") with rule-based push-back → flag ops
issues (Recall miss, persona mismatch).

**Why it works tonight (= what the client version needs):**
1. **Guy's expert judgment in the loop** — he steered constantly ("leave out the
   think-of-people bit", "too early for a Zoom 1", "take a punt and book it"). A VA/Mr Busy
   lacks this → agent must encode judgment in rules, be self-checking, and **flag
   uncertainty** rather than silently send (it already did much of this — encouraging). Mr
   Busy reviews standouts.
2. **Accumulated rules + asset library + voice** (Guy's Notion). New client has none → plan's
   "cold start = seed then diverge": fork Guy's master rules+assets, then tune. **This is the
   spine AND the real moat** — draft quality comes from here, not the agent (agents commoditising).

**New builds beyond what's already decided:** (a) rules + asset library as **per-tenant
versioned data** (plan §6/§7) — the spine; (b) the agent wired server-side (Claude Agent SDK)
with per-tenant connections (Fathom transcript + Nylas email/calendar + lead data + rules);
(c) a **confidence/flagging layer** so a non-expert can trust it.

**Sequencing (honest):** deepest surface — build the simpler panel (booking / LinkedIn reply)
first to prove the model; build the per-tenant rules/asset spine in parallel; post-call agent
comes after. **Guy keeps using it as-is (his Notion + MCPs) throughout — zero disruption.**
Cost: token-heavy surface (long transcripts + multi-tool loops + redrafts) → where
metering/caps matter most. Transcript: tonight argues hard for the Fathom migration +
per-tenant transcript redundancy/fallback.

### Pricing + delivery model (2026-06-08)
**★ CRYSTALLISED PRICING (2026-06-08 — Guy's model, ties the whole night together):**
- **$150/mo** = start-off / basics (scoring etc.) — get them going.
- **+$50/mo** = the full kit (post-call agent + side panel + everything shown tonight) → full
  stack **$200/mo**. The +$50 IS the progressive-reveal tantalise.
- **Maintain 3 active (paying) referrals → the $150 drops off; the $50 stays** (full kit for
  **$50/mo**, covering processing + now-lighter coaching; profit came from the 3). **Conditional/
  ongoing:** if a referral churns and isn't replaced (after a **short grace window**), they revert
  to $200. Turns referrers into ongoing advocates; Guy only waives while 3 paying clients fund it.
  Frame clearly upfront so the $50→$200 bounce never feels like a surprise penalty.
- **$300/mo = Mr Busy + VA, done-for-you from day one** (heavy VA coaching, strategy/structure
  setup, he does his own calls — more Guy-time, platter service). **Same referral deal: maintain 3
  → drops toward $50** — but tie the drop to the **VA being self-sufficient** (lines up with the
  time to get 3 referrals), else $50 won't cover perpetual high-touch.
- *Solves at once:* affordability (solo gets the magic at $200 → $50), referral exposure (the
  $50 floor ≠ $0, stays cost-covered), no-lock-in (carrot not contract), progressive reveal,
  setup recovery (the $200 pre-referral phase).
- **Cost reality:** if the post-call agent runs on the **client's own Claude** (their cost), Guy
  bears only **side panel + batch** ≈ **$5-35/mo even heavy** → $50 floor easily covers it. (Holds
  only while post-call stays on their Claude; if Guy runs it himself — e.g. Mr Busy consistency —
  that cost returns, still covered at $200/$300. Keep a light cap vs pathological spam.)
- **Guardrails:** (a) "3 on board" = 3 **converted, paying** subs, NOT intros; (b) **conditional**
  — maintain 3 active, with a grace window to replace a churned one; (c) tie **Mr Busy's $50 to VA
  self-sufficiency**, not just count.
- **Big-picture (on-brand):** steady-state per *advocate* = $50, so the model runs on **referral
  flow** (ASH's self-propagating-network premise). Only advocates who brought 3 paying reach $50 →
  Guy always net ahead; most clients sit at $200/$300. Thin $50 long-tail → health = new entrants
  + volume of advocates.

- **Tier by SERVICE LEVEL, not by feature (refined 2026-06-08 — supersedes "agent = $300 only").**
  Don't paywall the agent behind $300 — paywall the *done-for-you wrapper*.
  - **Foundation (~$150) = self-serve:** full tool **incl. the post-call agent**; client does
    the work themselves (what one-man-bands want); we run the AI on a **fair-use allowance**
    (solo volume is low → cost is a few $/mo; overage or BYO-key for heavy users).
  - **Advanced ($300) = done-for-you:** managed onboarding, VA-operable, white-glove, support;
    we run the AI, cost baked in. Mr Busy pays for *not touching it*, not for the feature.
  - **No cannibalisation:** cheap tier = you do the work yourself (+ maybe a key), which Mr Busy
    won't → tiers self-select by behaviour (DIY vs done-for-you = the Type 1 / Type 2 split).
  - Simple to explain: "Do it yourself for $150, or we do it for you for $300." One-man-bands
    get tonight's magic at $150 — not "too bad you can't have it".
- **Onboarding is high-touch even for self-serve → flat $150 too cheap for the full stack
  (refined 2026-06-08).** The agent + extension needs real Guy-time to explain + set up, even
  for a one-man-band. **Fix: separate ONE-TIME setup from RECURRING.** Charge a **one-time
  setup/onboarding fee** for the full stack (pays for the setup labour, filters tyre-kickers,
  improves cash flow); keep the monthly sustainable for a solo. Shape: basics $150/mo (light
  setup); full self-serve = setup fee + monthly (~$150-300); done-for-you = higher monthly +
  bigger setup fee.
- **Guy's setup time is HIS bottleneck (his own "Mr Busy" problem)** — can't hand-hold 30
  clients. → (a) recover setup cost now while onboarding is manual; (b) **productise
  onboarding** over time (guided setup, auto-fork master rules into the new instance,
  one-click Nylas/Fathom connect) so per-client setup time shrinks and it scales.
- **One-man-band: amortise, don't front-load (refined 2026-06-08 — Guy's preference).** A big
  upfront setup fee (~$1,500) scares off the price-sensitive solo. Instead bundle setup +
  ongoing AI into a flat **~$200/mo** — absorbable, recurring revenue, and value-aligned
  because onboarding is *gradual* (spread the WORK over time, not just the cost). **Progressive
  reveal:** start them on basics/booking/extension, build trust, then unveil the post-call
  agent ("wouldn't you love this too?") once hooked — strong upsell, and it **maps onto the
  build order** (sales motion = roadmap). Same upskill-over-time motion as Mr Busy's VA on $300.
  **Guardrail (refined 2026-06-08 — NO contractual lock-in).** Guy: skip the 12-mo term — it
  contradicts the moat philosophy (earn the stay via accumulated value + clean export, never
  trap; a lock breeds churn-the-moment-they-can). Real commitment = their sunk time + visible
  results + accumulated tuned state; realistic churn = only going-out-of-business. So protect
  ONLY the **early window (~months 1-3)** where stickiness is lowest AND setup least recovered:
  a modest upfront slice / higher first month / small deposit so early exit isn't underwater.
  After that, rely on natural stickiness. Spread onboarding labour to match payments.
  Sanity-check $200 covers amortised setup + AI + margin over realistic lifetime.
- **Referral reward exposure ("refer 3 → fees waived")** — great growth engine (Champion Model),
  but protect two edges: (a) **define what "free" waives** = the *service fee/margin*, NOT hard
  costs → keep a **floor covering AI cost** (or move free accounts to BYO-key / a usage cap) so a
  heavy free user never bleeds Guy; (b) **gate the reward so setup is recovered first** (kicks in
  after a min active period / once setup recouped) — in practice 3 referrals takes longer than
  clients expect, so usually past the risk window, but don't rely on timing. **Network view:** one
  waived fee for 3 new paying clients = a great trade (net +2); exposure is only timing + cost
  floor, both fixable. Optional sharpener: discount ladder, or "free while your referrals stay
  subscribed" (vs a permanent waiver that piles up free-but-costly accounts).
- **Worst-case cost of a "free" (referred-3) client (estimate, 2026-06-08):** AI dominates;
  Nylas ~$2 + hosting ~$2 are rounding error. Heavy free user, *unprotected*: drafts ~$16 +
  qualify ~$5 + post-call agent ~$15-30 (token-heavy; ~5× on a premium model) ≈ **~$40-80/mo**.
  Typical free user ~$15-35/mo. (+~$20 only if Guy provides Fathom; per-tenant model = they
  connect their own.) **Caps it to ~$0-ceiling:** the agreed floor/usage-cap/BYO-key on free
  accounts. Truly unbounded only if pathological → that's what the cap is for. **Context:** that
  client brought 3 paying clients ($450-900/mo new revenue) → a $40-80 free account is <10% of
  what they generated; hugely net-positive. Instrument real per-client token cost to confirm.
- **Mr Busy (VA) not the worry — they'll pay $300.** Focus the pricing care on the one-man-band.
- **Panel beats Claude-chat for *clients*** — counterintuitively MORE consistent: it enforces
  rules + approve-flow + uncertainty-flagging; raw chat lets a non-expert VA wander off-script
  and needs each client to wire their own MCPs/accounts (non-starter for Mr Busy). Panel
  connects once, can still feel like a chat. Claude chat stays Guy's power-user cockpit.
- **Realism (after the live example):** tech clearly doable (an agent just did the whole chain)
  → remaining risk is product, not tech. Staged: booking/reply panel soon; full post-call agent
  later, gated on the per-tenant rules/asset spine. Expect "good enough, VA reviews + approves"
  first; Guy-level nuance as each client's rules accumulate. Target = "drafts so good they just
  approve," not full autonomy.

### Cost-bearing vs AI-hosting — keep them separate (2026-06-08)
Guy's question: client brings own ChatGPT/Copilot wired to our tools → client bears cost?
TRUE on cost, BUT that's the BYO-AI path already set aside for clients — it kills the product:
- **Effortless gone:** each client wires MCP into their own AI + own accounts (Airtable/Gmail/
  Fathom). Mr Busy won't.
- **Consistency gone:** different model (GPT/Copilot vs tuned Claude) degrades rules/voice.
- **Control gone:** no rule-enforcement, caps, approve-flow, or flagging in raw chat → VA drifts.

**Separate the two questions:** WHO RUNS the AI vs WHO PAYS.
- Default: **Guy runs it** (his key/model, behind the panel = consistent / effortless / controlled).
- **Client bears the cost via PRICING** ($300 tier / usage allowance + overage), not via BYO-AI.
- Same money outcome, none of the BYO mess. → client pays (via the bill) = yes; client
  BYO-AI-chat wired to our stuff = no (it's the effortless/consistency trap).

### Claude-in-Chrome vs our custom extension (2026-06-08)
Option: clients use Anthropic's Claude-for-Chrome (their own Claude sub) on LinkedIn instead
of us building/maintaining a custom extension → no build for us + client bears cost.
**Functionally worse for the Mr-Busy/VA goal:**
- No fixed UI / lettered quick-picks → every action is a free-form conversation (slower, not
  the no-thinking click path a VA needs).
- General agent operating LinkedIn = slower + less consistent than a purpose-built content
  script (e.g. the formatting-preserving insert becomes hit-or-miss).
- Lose our guardrails (rule-enforcement, caps, seat-auth, metering); built on Anthropic's
  consumer product which can change/gate.
**Advantages:** no extension to build/maintain; flexible; fast to start (good for piloting).
**Cost reality check:** Claude-for-Chrome needs a premium sub (~$100-200/mo Max-tier) + usage
caps per client → likely MORE expensive for the client than us running API (cents/draft) +
charging margin. Cost-shift is real but probably a worse deal. *(Verify current pricing.)*
**DECISION (2026-06-08): custom extension is THE path; Claude-in-Chrome ruled out as a
build/product target.** Too weak functionally for the VA goal and no real cost win — effort
is better spent on our own extension, which returns the fast/consistent one-click flow that
*is* the product. Brains live in our backend, so it costs nothing to leave Claude-in-Chrome
as an optional power-user door, but we **don't design for it, support it, or pitch it.** No
investment there.

### BYO API key feasibility (custom extension backend) (2026-06-08)
Model: per-tenant "your API key" field; backend runs OUR prompt/model but bills the client's
key (unlike Claude-in-Chrome, quality/consistency preserved; cost ~off us). **Feasible — tech
is easy.**
**Real hurdles are non-technical:**
- Setup friction: an Anthropic *API* account is a developer/billing console, not a consumer
  sub → Mr Busy won't create it himself. Mitigation: white-glove onboarding (we set it up on
  his card once, ~15 min) → viable even for non-technical clients.
- Even then: we store/secure their keys (liability); we inherit their account health (billing
  lapse / rate-limit cap → product breaks → our support ticket); low starting rate limits →
  throttling; client gets a SECOND variable bill (Anthropic) on top of our fee → cuts against
  "simple/predictable"; we make no usage margin.
**Where it fits:** cost-conscious / higher-volume / techy clients, or a "BYO-key = lower
subscription" tier. Not the effortless default.
**Recommendation — offer BOTH (cheap to support):** backend switch "tenant has own key? use
it : use ours." Default = we run it + flat fee w/ generous allowance (effortless, one
predictable bill, we keep control + margin); BYO-key = optional lower-fee tier. Don't choose —
offer both.

### Simple cost summary (2026-06-08) — stop treating cost as a blocker
- The AI cost is **small either way**; it is NOT a blocker. Done worrying about affordability.
- "Tonight's workflow is free because it runs in their own Claude" = only true IF each client runs
  it on their OWN Claude/ChatGPT account (BYO / their-own-AI path) — which carries setup friction +
  quality variance + no control, and **Mr Busy won't do it himself.** Not an automatic free lunch —
  a choice with strings.
- Two options per workflow, both affordable: **(a) they run it (their AI)** → ~$0 to Guy but BYO
  tradeoffs (ok for techy DIY solo, not Mr Busy); **(b) Guy runs it (his key)** → small cost
  (tens of $/mo even heavy), recovered via pricing, full control + consistency.
- Guy already bears **side panel AI + overnight batch** → small, fine.
- **The remaining decision for the post-call agent is control-vs-zero-cost, NOT affordability.**

### Model per job — extension drafting = Claude, scoring = Gemini (decided 2026-06-08)
- **Claude** → all **drafting** (booking message, LinkedIn reply, post-call email): voice
  consistency across surfaces (all sound like Guy), quality on customer-facing output, matches the
  "powered by Claude" brand.
- **Gemini Flash (already wired)** → **scoring/qualifying** batch: cheap, high-volume, voice
  irrelevant. Right-model-per-job — don't pay Claude prices for yes/no classification.
- **Not rip-and-replace:** keep existing Gemini scoring, ADD a Claude drafting path.
- Cost delta small (draft ~1-2¢ Claude vs ~0.3¢ Gemini; heavy user ~$16 vs ~$3/mo) — quality worth
  it. This is a **Claude API key on Guy's backend** (or tenant BYO key) — distinct from the *client's
  own chat-Claude* that runs the post-call agent (same model, different billing path). All behind the
  swappable seam.

### Client AI requirement = Claude, not Copilot (decided 2026-06-08)
Client can use Copilot/ChatGPT for everything else, but **this project runs on Claude** (their own
Claude account for the project; Max = Standard confirmed, no tier/connector issue). Frame as a
normal **product requirement** (like "requires Chrome"), NOT a concession. Why:
- **Consistency/quality (main reason):** tune/build/test/support ONE model; a solo can't maintain a
  Copilot variant too.
- **Copilot ≠ drop-in:** its extensibility model differs from Claude connectors → "support Copilot"
  is potentially a large hidden integration project, not a toggle.
- **Consistent with "model behind one seam, standardise on Claude now."**
- Small cost: a Copilot-shop client adds a ~$20 Claude login (done-for-you: the VA uses it, Mr Busy
  barely notices; self-serve: one extra login) → folds into "their cost". Bonus: separate account =
  doesn't touch their Copilot quota.
- **Door not shut forever:** the seam allows adding Copilot later for a big client — just don't build
  for it now.
- **Tailwind, not just a constraint (sales angle):** Claude's best-in-class reputation makes "you'll
  need Claude" a *reason to lean in*, not a hurdle — Guy is the guide introducing them to the best
  tool (one-man-band may even shift their other work across). Honest hedge: the requirement does NOT
  ride on Claude staying #1 — the seam means Guy can move if leadership shifts. Reputation tailwind
  now + protected later.

### Rules de-personalisation — Guy's master → per-tenant (design, 2026-06-09)
**Confirmed:** rules live in **Postgres on Render** (NOT per-client Notion). Notion = human/doc
tool, not a runtime DB (slow, rate-limited); Postgres = cheap, fast, versioned, tiny data;
**clients never need Notion** — rules served from Guy's Postgres via the backend.

**Refinement (2026-06-21) — Guy is a tenant too; he migrates off Notion as well, eventually.** The earlier
"Guy keeps his Notion + MCPs throughout — zero disruption" line was about *not breaking the day-to-day during
the build*, NOT a permanent Notion-for-Guy / Postgres-for-clients split. **End state: Notion is a legacy
SOURCE we migrate FROM — Guy included.** Every tenant (Guy = tenant 0) keeps their brain in Postgres under the
governed write-door, not Notion. The one Notion→Postgres conversion (below) produces BOTH Guy's own tenant-0
instance AND the de-personalised shippable template **in the same pass** (extract a rule → decide template-vs-
Guy-private → seed the right place). **Additive / prove-before-switch (iron rule):** Guy's daily cockpit keeps
reading Notion until the Postgres path is proven for his own flow, THEN his cockpit re-points (Notion→Postgres
via the connector) — his working setup never breaks mid-migration. **Storage is the trivial part**; the real
work is the **editor** (see "Rules editing UX") + that **one-time migration, which only Guy ever has** (clients
start from the template, never from their own Notion). Cost is a non-issue (flat-rate Postgres, tiny data).

**Reframe (shrinks the job):** de-personalise ≠ genericise. Clients buy *Guy's method*, so the
**strategy stays — it's the product.** De-personalising = strip Guy's **identity**, keep his
**approach.** Three kinds of "personal", handled differently:
1. **Identity tokens → variables.** `{{host_name}}`, `{{signoff}}` (Guy = "(I know a) Guy"),
   `{{zoom_link}}`, `{{phone}}`, `{{linkedin}}`, `{{timezone}}`, `{{spelling/locale}}` (AU spelling/
   AEST), `{{tracking_email}}`, `{{booking_link}}`, `{{target_audience}}`. Rule text references the
   variable, never the literal; a per-tenant profile table fills them at runtime.
   **The variable catalogue = the new-client onboarding form.**
2. **Assets → per-tenant asset library.** Guy's Vimeo/Gamma/newsletter → `{{asset:...}}`; each client
   supplies their own; **carry over the usage-gates + stage-rules as structure** (e.g. "explain live
   first", "always include advocacy article", "don't double the CTA").
3. **Voice → seed-then-diverge.** Golden-paragraph *structure* transfers; Guy's exact words ship as
   the starting example; each client tunes via approved edits (accumulated state = moat). v1 needs a
   good *de-identified starting* voice, not a perfect per-client one.

**Conversion = plan's "one manual step" (Notion → master v1), best as a Claude-assisted pass:**
feed Guy's Notion rules → Claude extracts each rule, flags every personal token **AND implicit
personalisation** (the hard part — e.g. "two or three new business owners a day", "the people I'm
talking to"), proposes a variable for each, outputs de-identified master + variable catalogue →
Guy reviews → seeds Postgres (versioned rows). Obvious tokens (signature) are easy; the sneaky ones
hide in assumptions. **Proof step (do first):** de-personalise ONE section to validate the approach
before converting everything.

### Rules editing UX — edit-as-you-go primary; screen for visibility/history/settings (2026-06-09)
Not either/or — both, split by job (maps onto the Dialogue/Commit/History layers):
- **PRIMARY = edit-as-you-go (Dialogue→Commit).** Client reacts to a wrong draft in the flow
  ("shorter", "don't use that link here", "drop that paragraph") → system proposes a rule change →
  conflict-check → confirm → commit. Non-expert-friendly, low-friction (→ more tuning → moat), and
  how rules actually emerge (cf. last night's "leave out the think-of-people bit"). Every change
  routes through the **one conflict-checked write-door** → non-expert can't create contradictions.
- **A SCREEN = visibility + history + settings, NOT raw bulk editing.** (a) See the active rules
  (trust / not a black box); (b) history + one-click revert (the versioned lineage); (c)
  settings/onboarding = the variable catalogue (name, signoff, assets, timezone, links). Avoid a
  free-form "edit 200 rules" grid for clients — overwhelms + bypasses conflict-checking.
- **Guy's "left = current / right = change" is exactly the Commit-layer confirm/diff view** — used
  at the *moment of change*, reachable from the flow OR the screen. Not a standing edit-all page.
- **Persona:** a richer "review & curate all rules" editor is more a Guy/admin (master-maintenance)
  tool; clients need edit-in-flow + view/revert. **MVP:** settings/onboarding screen (early) +
  edit-in-flow + simple read-only rules+history view; rich management UI later.

### Rules integrity = code; LLM proposes only; categories curated not free (2026-06-09)
**Integrity layer MUST be deterministic code; the LLM may interpret/propose but NEVER writes.**
- **Code (mess-prevention):** schema + constraints (categories, statuses, version#, one-active-
  version-per-rule, append-only), the **single Commit write-door** (writes only on confirmed
  proposal; bumps version; flips old→retired), the **History** append-only audit, and the
  **category taxonomy**.
- **LLM (interpretation only):** the **Dialogue** step (what did they mean, which rule, does it
  conflict) → outputs a *structured proposal* → code validates → human confirms → **code writes.**
- Without the code gate: contradictions, near-duplicates, orphaned versions, broken lineage. (= the
  plan's "one write-door" principle.)
**Categories = the scoping structure (correct).** Two axes likely: **context** (booking / reply /
post-call / follow-up) + **type** (formatting / voice / scheduling / asset-usage / qualifying). Lets
the drafter load only relevant rules and confines conflict-checking to within-category. The taxonomy
is part of the code-enforced schema.
**Refinement — don't let clients freely CREATE categories:** free creation → sprawl + near-duplicate
categories that **break conflict-checking** (two categories meaning the same thing aren't compared).
→ ship a **curated master taxonomy**; if new categories allowed at all, gate them like rules ("we
already have one that means this?"); **v1: fixed set, no client-created categories** (add gated later).

### Where each thing lives — code vs rule vs variable; the graceful boundary + flag-to-queue (2026-06-21)
Worked through with two real cases (Guy's Gmail follow-up habit; the complicated-name ingestion bug). Sharpens
the multi-tenant content model (see the three-layer note in **▶ You are here** + **Rules de-personalisation**).
Read with **Keeping Wingguy directives in Wingguy** (the connector-editing sibling) and **Discovery &
onboarding** (proactive chaining = a rule type).

**1. Not every "rule" is a Wingguy-rule.** Two different things wear the word "rule":
- **Data-integrity / plumbing** (name parsing, ingestion, dedup) = **CODE** — fixed, identical for all tenants,
  lives in the repo, the client cannot (and must not) change it. The complicated-name fix is this; Guy did it in
  Claude Code, which is the tell.
- **Method / judgment** (greet by first name, no price in email #1, follow-up timing) = a **WINGGUY RULE** —
  tunable, in Postgres, client-editable through the write-door.
- Plus a third home: **identity / preference** (name, signoff, links, which follow-up channel) = a **VARIABLE /
  per-tenant setting** (the onboarding/variable catalogue).

**2. Surface-tells-the-bucket heuristic** (sort per item without agonising — you usually pick the right surface
by instinct):
- Reached for **Claude Code** → it's **code** (fixed, all tenants).
- You'd phrase it as **"from now on, when X, do Y"** in plain English → **tunable rule** (template default,
  client-editable).
- It's **"my name / my link / which tool I use"** → **variable / setting** (per-tenant config).

*Worked example — Guy's "save a Gmail/Outlook reminder when they say they'll book" habit splits across all
three:* the *capability* to set a provider-agnostic reminder = **code** (the email/calendar adapter); *when to
offer it* = a **tunable chaining-rule** shipped as a default the client can retime or switch off ("people may
not want that"); *which follow-up channel they use* (portal follow-up vs email reminder vs both) = a
**per-tenant setting**.

**3. The graceful boundary — when a client asks for something past the tunable surface.** A client may sit in
their own Claude ("Claude can do anything") and say "fix this." Two readings, handled differently:
- **"Fix THIS record"** (one wrong name in their Portal) → **in scope, Claude just does it** (Portal write,
  reversible, tenant-scoped). This is where "Claude can do anything" is correctly true.
- **"Fix this — it keeps happening"** (the ingestion bug) → that's the **code bucket; the connector has no tool
  for it.** Right behaviour = **fix the visible record + be honest the systemic part is the setup team's +
  escalate** — NOT silently ignore, NOT hallucinate a fix (the dangerous one: cheerful "done!" while the names
  keep arriving wrong). For escalation to be a real action and not a dead end, the connector needs a **"flag an
  issue to the operator" tool**. It **can't break anything** — there is no tool to touch ingestion code, so the
  worst case is a benign "I've flagged it" (same safety as "out-of-scope blocked by design"). **Upside:** a
  client-noticed bug becomes a report Guy fixes **once in code → fixed for every tenant** — the product
  self-improves from 30 sets of eyes. (Generalises the post-call agent's existing "flag ops issues" behaviour.)

**4. Flag to a QUEUE, not Guy's inbox (the channel design).** The real axis is **interrupt-and-obligate (inbox)
vs capture-and-review (queue)** — an email implies a promised reply; a queue is signal on Guy's terms.
- **Default = silent capture to a triage queue** (Airtable table / portal admin view) Guy scans when he chooses;
  this IS the cross-tenant bug feed (dedup + counts → spot patterns, fix once).
- **Claude owns the client acknowledgment, not Guy** — "I've logged that for the team," never "Guy will reply."
  Decouples *client feels heard* from *Guy must respond* (most people want acknowledgment, not a personal reply).
- **Claude is the first-line filter** — reading the rules it can *explain the reason in the moment* (handles
  "maybe it was done deliberately") and deflect misunderstandings / dedupe before anything reaches Guy.
- **In the queue, "intended — dismiss" is a one-click, no-reply outcome** (an email feels like it demands a
  written explanation back; a queue item doesn't).
- **Email reserved for rare genuine urgency — and even then a digest**, not per-event pings.
- **Why it's load-bearing, not cosmetic:** an exposed "email Guy" button rebuilds the hand-holding treadmill the
  whole low-touch model exists to avoid → it **doesn't scale to ~100 clients on ~3 days/week**;
  queue-plus-Claude-deflect does. (Protects the scaling model + Guy's time constraint.)

### Rules edit-authority — who may change which layer (2026-06-30)
> Sharpens the three-layer model (**Rules de-personalisation**) + the flag-to-queue note above with an explicit
> *who-edits-what* matrix, prompted by the VA case.
- **Foundation layer = Guy / platform ONLY.** A change here hits every tenant — never client-editable.
- **Client layer = the client's own.** A one-man-band edits **their own** layer freely (edit-as-you-go from the chat
  is fine for them) — but **never the foundation.**
- **A VA edits NOTHING — flags only.** Operating ≠ authoring; the operator never mutates the voice/brand (that's how
  quality drifts). The VA's doubts and the brain's misses go to the **suggestion queue**; the principal/Guy author
  the change.
- **★ Guy is the two-hat case** — platform owner **and** client-zero. Editing rules from the chat, he must know
  **"is this *mine* or *everyone's*?"** Right now (client-zero) the two are fused, so it doesn't bite; with real
  clients, an in-chat tweak Guy *thinks* is just his own voice could silently **move the floor under all tenants.**
  The "edit from the chat" convenience that's perfect solo becomes a liability at scale → exactly why the controlled
  write-door exists.

### Stickiness vision + the reconciliations that protect it (2026-06-09)
**Signal:** Guy himself is astonished/reliant (an hour for previously-impossible work last night) =
real product-market fit + the best sales proof (show, don't pitch).
**Flywheel (right kind of moat):** easy → used more → more accumulated state (rules/history/tuned
voice) → better results → more reliance → stickier; leaving = abandoning a tuned asset. Earned, not
trapped (still offer clean export).
**Reconciliation 1 — client extension vs no-free-categories:** clients *wanting* to extend drives
stickiness, BUT the thing that makes it sticky (it works beautifully) is the same thing that breaks
if they create unchecked mess. So **guardrails PROTECT stickiness, not oppose it.** Give clients the
power/feeling of extending — channeled through the gated, conflict-checked door so it stays clean.
**Reconciliation 2 — "so good I don't edit" = END STATE of a TUNED instance.** A new client starts
from the de-identified seed and edits MORE early; **every early edit = the moat being built** (their
tuned state accumulating) until they too stop editing. Pitch = "great day one, transformative as it
learns you" — NOT "perfect out of the box" (over-promising disappoints week one).
**Expansion — "extend to other areas" = real land-and-expand platform upside,** but **nail the wedge
first** (LinkedIn outreach + post-call); let clients PULL you into adjacent comms once the core is
solid. Don't let "it can do anything" dilute the wedge.
**Net:** the discipline (gated extension, curated taxonomy, seed-then-diverge) is not a brake on the
vision — it's the mechanism that keeps the flywheel spinning. Vision + guardrails = same project.

### Can gated extension be done without mess? Yes — two kinds of mess (2026-06-09)
**Structural mess** (orphaned versions, dupes, broken lineage, unvalidated writes) = the
*unrecoverable* kind → **prevented HARD and easily** by standard code: append-only versioned table,
single write-door, constraints. Bread-and-butter; nothing destroyed (append-only = safety net).
**Semantic mess** (two rules subtly contradict) = harder, but tamed + recoverable:
- **Categories shrink it** — check a new rule only against the handful in the same context+type, not
  all 200.
- **LLM is good at the bounded task** ("does this contradict these few?"), built suspicious-by-default.
- **Human confirm** (left/right diff) before commit; **revertible** (append-only) → a slip isn't
  permanent (surfaces in odd drafts → spot → roll back).
- → doesn't need to be perfect; "good enough + always recoverable" is enough.
**Easy path (don't build the clever checker first):** **v1** = schema + write-door + append-only +
curated categories + confirm-step-that-shows-same-category-rules + one-click revert (safe from day
one, human eyeballs neighbours). **v2** = add the LLM auto-conflict-checker on top.
**Caveat:** only genuinely non-trivial/ongoing bit = conflict-checker quality at scale + category
discipline — tuning/enhancement, never catastrophic (worst case = fix + revert).
**Note:** the prior decisions (integrity-in-code, categories, append-only/versioned) are exactly what
make this easy — Guy's been building toward "no mess" all along.

### Where this sits vs the frontier (2026-06-09; ref: OpenAI/Thrive self-improving Tax AI)
**Validation:** OpenAI's published blueprint (self-improving *harness*, not the model; human
corrections captured as structured data → evals → improvement loop) is the **same category** as our
rules design (versioned Postgres rules; corrections-in-flow → Dialogue→Commit→History). Converging on
the same architecture independently = strong signal we're at the right altitude. Ahead of the broad
SMB/solo market (most use raw ChatGPT).
**Behind the frontier (honest, and OK):** theirs is more automated (corrections→evals→Codex
auto-improves harness *code*); ours is human-in-the-loop at the *rules* level (safer, fits our lower
risk profile). No **evals/measurement layer** yet (a real gap to close later). Theirs is shipped +
measured; ours designed (single-tenant runs for Guy).
**Trajectory (LATER, v3+ — don't chase now):** (1) add an **evals layer** that turns corrections into
*measured* tests/regressions; (2) eventually a Codex-style loop that improves harness code. Keep v1
human-in-the-loop; don't let the shiny frontier pull off the wedge.
**Guy's structural edge:** the Thrive project needed FDEs + the client's tax experts to bridge domain
knowledge. **Guy collapses that** — he's domain expert + first user + (with Claude) builder, zero
coordination overhead; his nightly use IS the correction loop. Plus per-tenant accumulated-state moat
> a single enterprise deployment.
**Caution:** "ahead of the curve" isn't the prize — *shipping* is. Risk = staying in elegant-
architecture mode. The edge only pays off when it runs for real clients → value is in execution now.

### Naming the "second brain" — OPEN (not decided, 2026-06-09)
Goal: a **proper-noun name** with personality (Claude-style) for the **second-brain / accumulated-
knowledge entity** (the asset they own + brag about), NOT a flat feature label ("the rules" /
"Guy's rules"). Must work in conversation: *"I'll teach [Name]" / "[Name] already knows that."*
**Strategic bonus:** a droppable, intriguing name = **referral fuel** (peers ask "what's that?") →
feeds the network model. Use **one shared product name** (recognisable when dropped), optional
personal nickname on top.
**Shortlist (with flags):**
- ~~**Remi**~~ ← **RULED OUT (2026-06-09): direct collisions in our space** — itsremi.ai (AI CRM/sales
  assistant, same niche), remio.ai ("AI assistant powered by your experience" = our second-brain
  positioning), AND Google's "Remy" AI agent looming. Great name = already taken by others incl. Google.
- **The Vault** ← now the lead metaphor — accumulated *edge*, secure & growing (= stickiness story); a
  metaphor doesn't collide the way human names do.
- **Cortex** — brainy/ownable but a bit cold/techy.
- ~~**Wingman**~~ ← **RULED OUT (2026-06-09): heavily taken incl. direct same-space collisions** —
  Wingman/Clari Copilot (sales call-recording + summaries + CRM = ~our post-call agent), Emergent's
  "Wingman" autonomous agent, Pentagon CDAO Wingman, multiple dating-coach apps. Plus gendered.
- AVOID: **Sage** (Sage accounting) · **Echo** (Amazon/Alexa) · **Remi/Remy/Remio** · **Wingman** (above).
**Also ruled out (screened 2026-06-09):** **Kith** (Kith AI Lab / Kith Build agent builders + fashion
brand) · **Nous** (Nous Group — 750-person Aussie consultancy w/ AI practice; + Nous AI/Labs/Research)
· **Knack** (no-code AI app builder). **Constraint added: name must be SHORT + daily-natural** — used
constantly ("save to ___", "my ___"); a tagline like "I know a Guy" is too long for daily use.
**Meta-conclusion: short REAL English words are saturated in AI/software** — ~6 screened (Remi,
Wingman, Kith, Nous, Knack, Sage/Echo), all taken, several in-space. The real-word shelf is bare.
**→ DECISION: coin a word.** Coining = the only path that's short + daily-natural + ownable (get the
trademark + domain because it's novel), and it becomes "a thing" like Claude (cf. Xero/Canva/Vimeo/
Twilio). Bake in the "I know a Guy" essence (knowing / your people / insider); 2-syllable, warm, sits
in "save to ___ / my ___".
**Coined descriptive-root batch ALSO all taken (screened 2026-06-09):** Kin (mykin.ai "AI that knows
you" — bullseye), Memora (consultant meeting-recall + memory app — bullseye), Kenley (AI for advisory
& financial services — our exact market), Kindra, Kova. → **the personal-AI / second-brain / memory
space is the most saturated naming battlefield in tech; descriptive roots (kin/ken/mem/know) are all
colonised** (and descriptive = legally weakest mark anyway).
**REAL FIX: go abstract/fanciful** — a coined word with NO literal tie to knowing/memory (cf. Spotify/
Vercel/Figma/Xero/Stripe — none describe the product). More available AND strongest trademark class;
the BRAND gives it meaning.
**DECISION (2026-06-09): PARK naming — it's NOT on the critical path** (launch-time decision; build
doesn't need it). Use placeholder **"the Brain" / "second brain"** in code+docs now. Run a proper
abstract-coinage + **real domain/trademark clearance** (IP Australia) exercise near launch — not
eyeball-screening in chat. Guy's brand call.
**✅ CHOSEN: "Wingguy"** (Guy's coinage = wing + guy; brand-tied to "I know a Guy"). Survived first-pass
screen (no exact product/trademark found). **Framing (Guy's call, and a good one): it's a CULTURE/term
spread by word-of-mouth — like "I know a Guy" — NOT a defended product SKU.** That dissolves most
collision/trademark worry. Two mechanics confirmed: (1) **Guy sets pronunciation by voice** ("Wing-guy")
→ on-paper ambiguity is moot; (2) **the agent resolves any variant** ("wingguy"/"wing guy"/"wing-guy"/
typos) automatically — it's an LLM, not a rigid parser, so no magic command word.
**Variant policy (decided 2026-06-18):** *spellings of the chosen name* — WG, Winguy (one g), wing guy,
wing-guy, typos — **accept silently** (just the brand written loosely). **"Wingman" is the deliberate
exception:** it's the **ruled-out, competitor-colliding** name (see the struck-through Wingman entry below —
Clari Copilot's "Wingman" etc.), so do **NOT** silent-alias it. **Serve the request anyway**, but **gently
sign back as Wingguy** ("yep, that's me — I go by Wingguy") to train the brand. Reject both extremes:
*silent-accept* trains users into a rival's mark (the exact "default into that" to avoid); *deaf/ignore* is
bad UX and teaches nothing. Correct **lightly/occasionally — never nag every turn**; spoken form already
disambiguates (nobody says "Wing-guy" and "Wingman" alike), so this mostly matters for typed shorthand.
**ONE ACTION (cheap, do soon):** grab **domain + handles** (wingguy.com/.ai + socials) so the term has a
home and no one parks on it.
**Monitor only (low priority):** a *direct* sales/assistant competitor branding "Wingguy/Wingy" (low
odds; file a basic trademark later only if it ever matters). "the Brain" remains internal shorthand for
what it IS; "Wingguy" is the name.
**Next:** run a dedicated **naming pass** — generate candidates AND pre-screen each against web +
trademark collisions (so options are warm *and* available); + The-Vault-style metaphors. Then check
IP Australia (our class) + domain before committing. Guy's brand call.

### Data architecture — two stores, two names (decided 2026-06-09)
| Store | Holds | User-facing name |
|---|---|---|
| **Airtable** (RETAINED — not migrating) | Leads + client/operational data (records) | **the Portal** |
| **Postgres** (migrated FROM Notion) | Rules, prompts, accumulated knowledge | **Wingguy** |
- **Wingguy = the second brain** (rules/prompts/tuned knowledge in Postgres). "the Brain" was just the
  placeholder — Wingguy *is* the brain.
- The agent **reads Wingguy** (how to act) + **reads/writes the Portal** (the records).
- Two crisp user actions: **"teach/update Wingguy"** → rules (Postgres); **"save to the Portal"** →
  record (Airtable).
- Why right: leads = relational/high-volume operational data → Airtable fine, no reason to move.
  Rules/prompts = versioned/append-only/integrity-critical/runtime-queried → Postgres (Notion is bad
  at this). Right store per data type, not migration for its own sake.
- **Discipline:** keep the boundary clean — leads stay in Portal/Airtable, rules stay in Wingguy/
  Postgres; don't let one bleed into the other.

### Terminology — user-facing "the Portal", not "Airtable" (decided 2026-06-09)
User-facing language = **"the Portal"** (their workspace), NEVER "Airtable". Two reasons: (1)
non-technical / ownable ("your portal") for clients; (2) **future-proof** — Airtable is a swappable
backend (→ Postgres later); "the Portal" is the stable abstraction so language + mental model don't
change if the store does (same behind-a-seam discipline as calendar/email/LLM).
**Composed vocabulary:** **Wingguy** (the assistant/second brain) → saves to **your Portal** (workspace).
e.g. "Wingguy drafted it and popped it in your portal." Agent resolves any phrasing ("update the portal"
/ "save to my portal") → the actual write (Airtable today).
**Internal hygiene:** in code/docs stay technically precise — "Portal UI writes to the Airtable store
(→ Postgres later)" — so the friendly abstraction never blurs the real data flow. User-facing = portal;
engineering = exact.

## Voice reference — golden examples (for the drafter)

Real Guy-approved examples to seed/tune the drafter (canonical prompt still lives in
Notion). Style = Australian spelling, simple " - " dash, short sentences each on its own
line, "recommend" not "sell", sign-off "(I know a) Guy". Tone = warm peer-to-peer,
generous, low-pressure; build value/credibility before a soft, time-bound CTA.

**1. Inbound reply → Guy's approved response (2026-06-08; lead: Josiah Roche, fractional SEM)**

Lead's message: *"For sure Guy. I mainly do fractional stuff around SEM"*

Guy's reply (he loved this one):
> Good to hear back, Josiah.
> SEM is exactly the kind of thing the people I'm talking to need - a lot of them are working with small business owners who are flying blind on Google Ads.
> I'm speaking with two or three new business owners and fractional professionals a day, so there's plenty of scope to point work your way.
> Worth a quick Zoom in the next week or so to see where we might collaborate?
> (I know a) Guy

Why it works: warm open → mirrors the lead's value onto the network's need → specific
credibility/scarcity ("two or three a day") → collaboration framing, not selling → soft
time-bound CTA → sign-off.

## Pricing snapshot (checked 2026-06-07)

| Provider | Entry | Per extra account | Free tier | Fit |
|---|---|---|---|---|
| **Nylas** (calendar-only) | $10/mo, 5 accts | $1.50/acct/mo | Sandbox up to 5 | **Best for our scale** (~$48/mo at 30 clients) |
| Nylas (calendar + email) | $15/mo, 5 accts | $2/acct/mo | Sandbox | Use this — unifies cal + email |
| Cronofy | $819/mo entry | $0.69/acct | Dev tier (eval only) | Only worth it at large scale |
| Cal.com Platform | $299/mo, 500 bookings | $0.50–0.99/booking | — | Full booking system; more than we need |

---

## Key code anchors (so future sessions find things fast)

- **Slot read (Google):** `services/calendarOAuthAvailability.js` → `getOAuthPrimaryBatchAvailability()` (the only `freebusy.query` for booking).
- **Create / check event (Google):** `services/calendarOAuthService.js` → `createGuestMeeting`, `assertPrimarySlotFree`, `createTestEvent`.
- **Auth chokepoint:** `services/gmailApiService.js` → `getGmailOAuthClient()` (single OAuth helper for cal + Gmail).
- **Unattended calendar toucher (catch 1):** `services/recallAutoJoinService.js`.
- **Guest self-serve booking page + flow:** `routes/guestBookingRoutes.js`; event text in `services/guestBookingEventBuilder.js`.
- **Smart Booking Assistant (message generator + chat UI):** `linkedin-messaging-followup-next/app/calendar-booking/page.tsx` (endpoint `/api/calendar/quick-pick-message`).
- **Existing Chrome extension scaffold (verify what it already does):** `chrome-extension/` (`content-linkedin.js`, `content-portal.js`, `background.js`, `popup.js`).

---

## Scope reality check (read before feeling daunted by the roadmap)
Yes, tonight the scope grew from "a Chrome extension" to **a multi-tenant platform** (provider
abstraction, post-call agent, rules engine, billing/referral, onboarding automation). But:
- Most of that is **scope multi-tenant always implied** (per-tenant connections, seats, billing) —
  revealed and named, not newly invented.
- It's **de-risked**: a lot already exists (the post-call agent *ran tonight*; Smart Booking
  Assistant / `quick-pick-message`; Stripe; the extension scaffold; isolated calendar code) → much
  is *productise*, not *build-from-zero*.
- The **roadmap is the destination, not one commitment.** Ship the smallest useful slice first
  (Phase 2 booking panel + line-break insert for Guy), let each phase stand alone. Value arrives
  early; nothing in prod changes until Guy flips it.
- Honest: it's a multi-month, weekend-paced, solo effort. The discipline is phasing + additive +
  "prove for Guy first", not trying to do it all at once.

## What actually paces the build (Claude does the coding)
The **coding time largely collapses** (Claude writes it) — for a solo, that's most of the raw
hours gone. But elapsed time is then **gated by non-coding things, not typing speed:**
- **Guy's decisions + review** (weekend-limited) — only he can set rules/voice/pricing/tradeoffs.
- **Real-world testing** — connect real Nylas/Fathom/Stripe, eyeball bookings/LinkedIn-insert on
  staging (cloud-test loop has latency; needs Guy to look).
- **External setup needing Guy's hands** — accounts, Fathom migration, onboarding a real 2nd tenant.
- **Iterative integration** — LinkedIn DOM + multi-system bugs = test-fix-test cycles (faster, not zero).
**Accelerators:** pre-decide + capture decisions (like tonight → fewer blocks); smallest-useful-slice
first (short test loop); let Claude run + self-check a scoped phase, Guy verifies in the real world.
→ Effort drops a lot; elapsed time ≈ "as fast as Guy can decide + look", not a weekend, not a year.

## Target market + go-forward (decided 2026-06-09)
- **ICP = heavy-usage, outreach-is-their-whole-business people — i.e. people like Guy.** Structural,
  not preference: the product creates value through *usage* (accumulated state, flywheel, off-script
  retention). Heavy users hit the magic + stick; occasional users never accumulate enough to feel it.
- **This ICP also dodges the project's biggest risk** (craft portability/retention): people-like-Guy
  use it enough, **train it themselves** (build their own craft → don't need Guy's transplanted
  perfectly), and are most likely to stick. Market instinct = risk reduction.
- **Dividing line = usage intensity, NOT DIY-vs-not.** Mr Busy looks "occasional" but becomes a heavy
  user *by proxy* via a VA → keep as a deliberate **second wave** (more sales/VA effort). Genuine
  poor-fit = peripheral AND won't delegate → let them self-select out, don't spend energy converting.
- **GTM flywheel — Wingguy triggers the load:** the real constraint is *finding enough right people*;
  the product is a tool for *finding the right people*, so it manufactures its own demand. Loop:
  **Wingguy powers Guy's outreach → loads the pipeline with right-fit people he meets (his ICP) → his
  visible results = the demo → they become customers (+3 referrals via the Champion mechanic) → who use
  Wingguy → repeat.** Compounds twice: better Wingguy → more right people load in AND higher conversion.
  Self-selects for the right segment.
- **Build sequencing: start with what benefits GUY first (Fathom etc.), gradually progress.** Aligned:
  Fathom = highest-value connector; keeps Guy (primary user + craft engine) compounding. **Building for
  Guy's own use does NOT require solving craft-portability yet** — that only gates onboarding the *next*
  person → he can move cleanly on his own setup now. (Caveat: Fathom needs the Recall lookup-chain
  rewritten — see Strategy handoff.) Fathom work = its own next chat.

## Strategy handoff (2026-06-09) — reweights the build (from a parallel live-workflow chat)
A parallel strategy chat (sitting IN the workflow) converged with this doc on the hard parts and
reweighted the rest. Deltas:
- **Moat = integration (wiring) + cross-person craft, NOT the rules.** Correction to earlier "rules =
  moat": rules are the **portable substance** (~70-80% config, de-personalisable). Defensibility = the
  connected ecosystem a non-tech person can't assemble + accumulated craft. The product doesn't exist
  until the data is wired + interacting.
- **Transcript = the highest-value connector → prioritise it.** Calendar/email are low-moat (bare
  ChatGPT does them, prove nothing). The transcript is the one input the public chat box can't have →
  source of voice/tone/human-ness + the fastest "this isn't the AI I already have" moment. Make the
  transcript feed (Fathom) the bulletproof connector + lead a new client's onboarding with a
  transcript-grounded draft. (NOTE: Recall→Fathom rewrite of the lookup chain — email-keyed,
  no-date-filter — must happen BEFORE templating old logic into tenants. Build side agrees.)
- **Onboarding IS the business, not a setup step.** If integration is the moat, getting non-tech
  clients across the integration line — fast, repeatable, low marginal effort — is the core product.
  Reweights Phase 7 from "nicety" to central (sequence still needs ≥1 manual integration first).
- **Build-spec priority (difficulty = reverse of obvious):** (a) per-tenant data wiring (transcript
  first) → (b) interpreter/guardrail layer [= our Dialogue/Commit/gated-extension] → (c) templated
  rules (the easy part).
- **NEW unsolved problem — cross-person CRAFT portability.** Two learning curves: per-person (= data,
  ports fine) and cross-person craft (better at the craft generally, from watching Guy) which may live
  in **Claude chat-memory that does NOT port.** Seed-then-diverge only seeds *explicit rules* → a new
  tenant may start craft-naive. Needs a design answer (e.g. seed craft via curated exemplars/
  transcripts). Treat as explicit open question, not "it ports."
- **NEW north-star metric:** **days from onboard → first OFF-SCRIPT use** (client reaches for it
  unprompted) = retention has engaged; likely a transcript task. Sharper than time-per-lead.
- **First-run bar vs "let them train it" (tension):** "great day one, editing = moat-building" assumes
  editing is welcome. But burned skeptics (James Clements — churned competitor "Relevance" for too many
  tweaks; call 19 Jun) CHURN on tweak-count. So the FIRST output for a high-stakes prospect may need a
  higher bar than seed-then-diverge gives → consider Guy hand-tuning first outputs for skeptics.

**OPEN QUESTIONS (decide before/at build):** (1) **Sequencing** — transcript-first (wow/differentiation)
vs panel-first (ease/wedge)? Likely: build simple panel for Guy's proof, but lead a *new client's*
onboarding with the transcript. (2) Where does craft live — rules (portable) or memory (not)? The
clean-Claude test (added as top spike) answers it. (3) First-run bar for skeptics vs train-it-yourself.

## De-risking spikes — prove the unknowns BEFORE building around them (2026-06-08)
**SPIKE 0 (do FIRST — added 2026-06-09, gates the whole tenant-template job):** the **clean-Claude
portability test.** Open a memoryless Claude (none of Guy's accumulated context), wire it to test
connectors, load the Notion rules, run a real task ("prep me for this call, draft the follow-up").
The gap between that output and Guy's loaded-environment output = how much magic is **portable text vs
unportable accumulated context** → turns "70-80% portable" from guess to fact, sizes tenant template
(2-week vs 2-month), and directly answers the craft-portability open question. Cheap; do before Nylas.
Guy's hard-won lesson: avoid "did all the work, then found that bit doesn't work." Fix = cheap
throwaway **spikes** on the *unproven* pieces first (hours each vs weeks wasted). Do these at the
very front (Phase 0/0.5), before committing architecture. Pattern: Claude writes the minimal test,
Guy runs it against a real account + observes. Fail fast and cheap.

**Spike these — priority = risk × how much depends on it:**
1. **Nylas (TOP — whole multi-tenant connection + cost story rides on it).** Sandbox: connect one
   Google AND one Outlook; free/busy query; create event; send + read email; confirm hosted-auth
   avoids Google's verification ordeal. Proves the calendar/email abstraction is real.
2. **LinkedIn content-script (the extension's fragile core).** Minimal script: read the open
   profile/thread, and **insert a multi-line message with line breaks preserved**. Proves
   read + insert work on the live DOM.
3. **Post-call agent on the client's OWN Claude (underpins the self-serve "their cost" model).**
   NOT testing Claude's *reasoning* (proven tonight) — it tests the **wiring**, the real unknown
   because today's tools are **single-tenant/hardcoded to Guy** (`DEFAULT_CLIENT_ID="Guy-Wilson"`,
   baked-in base IDs). **Lighter de-risk (Guy's preference — no synthetic 2nd Claude needed):**
   (a) **inventory** Guy's current connectors = the clean-slate recipe (see below); (b) the planned
   **Max→Standard downgrade IS the tier-test for free** — if Guy's workflow survives on Standard, a
   Standard client can run it too; (c) **code-review** the custom MCP servers for multi-tenancy
   (how much "make it tenant-aware" work); (d) **fold the real "another person's Claude reaches
   their data" proof into onboarding tenant #1** — BUT only after (c) confirms the servers *can* be
   multi-tenant, else fix before a client's watching. **Load-bearing:** self-serve "their cost"
   pricing depends on this; fallback = Guy-run (his cost) → changes economics.
   **⚠ Before downgrading Max→Standard:** verify Standard supports the *connectors/MCP* (not just
   usage) — else it breaks Guy's OWN nightly workflow.

**Current Claude MCP wiring — the clean-slate recipe (what I can see active 2026-06-08; cross-check
Guy's connector settings for exact auth):** Google Calendar (availability + create events) · Recall
(`recall_latest_transcript`) · Notion (rules + follow-up rules + asset library) · Gmail (draft/send/
search) · Airtable (Leads base) · **inmail-pipeline (custom — the one most likely hardcoded to Guy →
main multi-tenant work)** · scheduled-tasks (reminders/schedule-send). Standard connectors just
re-point at the client's accounts; the custom MCP is the piece to make tenant-aware.
4. **Fathom (underpins transcript capture/migration).** Pull a transcript + attendee/speaker data
   via API/webhook for one account; check it can replace the calendar-read for attendee matching.

**Don't bother spiking (known tech — design, not feasibility):** Postgres versioned rules table,
Stripe basics, seat/auth model, encrypted credential storage.

**Honest:** spikes kill the big "fundamental doesn't work" surprises (the ones that burn); they
don't catch every integration/scale wrinkle — still hugely worth it.

## Existing extension recon — FOLD IN, don't rebuild (Phase 0, done 2026-06-08)
There's already a real working extension: **`chrome-extension/` "Network Accelerator – LinkedIn
Quick Update" v1.0.0** (MV3; content scripts on LinkedIn + portal; background SW → `/api/linkedin/*`).
**Decision: the new build EXTENDS this — NOT a new extension.** **[MECHANIC REFINED 2026-06-21 →
still fold-in/REUSE this code, but by *forking into a parallel `wingguy-extension/` folder* run
side-by-side with the old installed one, NOT by editing the installed extension in place (so Guy's
daily flow can't break during the long build); decommission the old when the new is proven. End state
remains ONE extension. See journal "Chrome extension — fork-and-run-two, distribution, cost caps,
scope & client lifecycle (2026-06-21)".]** Hard plumbing already present:
- **Multi-tenant auth already exists** — portal broadcasts `clientId` + `portalToken` (+ devKey,
  environment) to the extension (`AUTH_BROADCAST`); calls use `x-client-id` / `x-portal-token`
  headers. → the per-tenant identity / **seat foundation (Phase 4) is largely already here.**
- **LinkedIn conversation scraping** (`content-linkedin.js`, 1341 lines) = Guy's "save the whole
  LinkedIn discussion to the portal".
- **Lead lookup by LinkedIn URL** (`/api/linkedin/leads/lookup`) — same lookup the booking panel needs.
- **Quick-update to portal** (`/api/linkedin/leads/{id}/quick-update`, `parseRaw`).
- **Remote-config selectors** (`/api/extension-config`) — selectors served from backend → update
  server-side when LinkedIn changes layout, no re-publish. **Directly de-risks the LinkedIn-DOM
  fragility we flagged** (already solved). May soften spike #2.
- **URL resolution** (internal LinkedIn URL → real `/in/` profile).
**Evolves (not rebuilt):** today = **clipboard-capture + button/popup** (Ctrl+A/Ctrl+C); add the
**injected side panel** (adjustable width), **direct page read**, **drafting (booking/reply) +
line-break-preserving insert**, and calendar/agent — all reusing existing auth + scraping + lookup +
portal plumbing.
**Impact:** shrinks Phase 2 (extension MVP not greenfield); Phase 4 (multi-tenant seats) gets a
running start.

**✓ VERIFIED 2026-06-22 (Phase-0 auth recon — the runway is clear, the fork inherits the auth layer):**
- **Identity = a per-client token.** `Portal Token` is a field on each client's **Master Clients Airtable record**
  (`clientService.js:133`) — a stable client-specific secret, NOT an expiring JWT. Portal stores `portalToken` +
  `clientCode` in `localStorage`; `content-portal.js` broadcasts them (`AUTH_BROADCAST`) → `background.js` stores in
  `chrome.storage.local` → every `/api/linkedin/*` call carries **`x-client-id` + `x-portal-token`** (+ optional
  `x-dev-key`) (`background.js:137`).
- **Backend gate:** `authenticateUserWithTestMode` (`middleware/authMiddleware.js:240`) resolves token →
  `getClientByPortalToken` → `req.client`.
- **★ Three reuse wins (we get these FREE):** (1) our **"central off-switch" already exists** — the middleware has a
  built-in **`status !== 'Active'` → 403** (`authMiddleware.js:258`), so flipping a client inactive kills the panel,
  no new code; (2) **tier gating exists** — `requireServiceLevel` (`authMiddleware.js:205`) maps onto $150/$200/$300
  + the $50 Wingguy tier; (3) **`features.*` flags** (the `thanksForConnecting` pattern) are how you'd gate
  "extension enabled".
- **Notes (not blockers):** token is long-lived (revoke = rotate the field / flip status); the extension needs the
  portal open at least once to sync creds; `/api/extension-config` serves DOM selectors from an Airtable table but
  is **GLOBAL, not per-client** (per-tenant chips = a small extension); **no per-client action-counter exists yet**
  (net-new, as expected — rides the same per-client + gate pattern).
- **`ash-backend` / `ash-attributes-api`:** NOT referenced anywhere in the extension/auth path → separate Render
  services, off the critical path, **not a blocker.**
- ⇒ **Net-new backend work = the drafting-agent endpoints + the action-counter/cap (+ optional per-tenant config).**
  Nothing in the auth/identity layer blocks the fork.

## Chrome extension — fork-and-run-two, distribution, cost caps, scope & client lifecycle (2026-06-21)
Planning/discussion only (no code). Guy is ready to start the extension; this settles *how* we start
plus four operational questions. Read with **Existing extension recon** (above), **AI cost economics**,
**Cost-bearing vs AI-hosting**, **BYO API key feasibility**, **Claude-in-Chrome vs our custom extension**,
and **Free-Claude wedge + the ONE-CONNECTOR design**.

**Build mechanic — FORK into a parallel extension, keep the old one running (refines "Existing extension
recon").** End state = **ONE** extension. But the new build is large and Guy's daily flow depends on the
current `chrome-extension/`, so we do NOT edit the live one in place. Instead: **copy `chrome-extension/`
→ a new folder (e.g. `wingguy-extension/`)**, change `name` in the manifest, build the product in the
copy. The old folder stays byte-for-byte untouched = **zero disruption**. **Two extensions installed
side-by-side for a while**; when the new one is proven, **decommission the old** (remove the unpacked
folder). Consistent with "fold in, don't rebuild" — we still reuse all the existing auth/scraping/lookup/
portal plumbing; we just reuse it by *copying*, not by mutating the installed extension.
- **Coexistence gotcha:** both content-scripts match `https://www.linkedin.com/*` and inject UI → running
  both at once **double-injects** (two buttons/panels colliding). The fork must **namespace its DOM
  ids/classes** (e.g. `wingguy-*`) and be **visually distinct** (colour/label) so they never clash or get
  confused during the dual-run. Unpacked extensions get separate IDs + isolated `chrome.storage` → no
  shared-state collision.

**Distribution — unpacked now, "Unlisted" Web Store for client rollout.** Today's install = **Load
unpacked / developer mode** (per `chrome-extension/README.md`) → **skips Google's review entirely**,
exactly right for build + dogfood + early trusted clients. Caveat for *wider rollout*: unpacked has
friction at scale (Chrome's recurring "disable developer-mode extensions" nag; managed/corporate Chrome
may block unpacked; **no auto-update** → hand each client a new folder to reload). End-state for
non-technical clients = **Chrome Web Store "Unlisted"** (not publicly discoverable, share by link, gives
auto-update + kills the dev-mode nag; far lighter than a public listing). Not needed until rollout — stay
unpacked through the build.
- **Web Store review risk (LinkedIn extension) — LOW given our design (2026-06-22).** Two separate gates: **Google's
  review** (judges permissions / honesty / single purpose / data disclosure) and **LinkedIn's own terms** (dislikes
  *scraping* + *automated* actions). Our **human-at-the-glass** design lands on the safe side of both: we **read the
  page the user is actively viewing** and help them draft — **they click send** = a *personal productivity
  assistant* (an accepted category), NOT a scraper / auto-connector / background crawler / bulk-harvester (the risky
  kind that gets rejected + LinkedIn-targeted). Helped further by the **already-minimal permissions** (`storage`,
  `activeTab`, linkedin.com + own server only) and the AI running server-side. **To-dos at distribution:** frame it
  as a personal assistant (avoid "scrape"/"automate" wording), keep permissions minimal + justified, add a privacy
  policy. **Honest:** Google review can be inconsistent / LinkedIn extensions get an extra look, so not a guaranteed
  first-pass — but queries are usually wording/permissions, fixable on resubmit. **Backstop: the Web Store is a
  convenience, NOT a requirement — the unpacked/dev-mode install needs ZERO review, ever, so a rejection is never
  fatal** (just a clunkier install). Stay unpacked through build/trial; only seek Unlisted at non-technical rollout.

**Who pays for the AI — reaffirm "Guy's key as COGS" for the panel; clarify what "their key" actually
means (consolidates the 06-08 cost decisions).** Guy floated "hook the client's extension into *their*
Claude via a key." Clarified the conflation:
- The client's **Claude.ai subscription ($20+/mo chat) has NO API key** and cannot be plugged into the
  extension.
- "A key" = a **separate Anthropic developer/API account**, billed **per-token**, NOT their flat sub.
  Reaching their *flat sub* is only possible via the **MCP connector into their claude.ai** — and that's
  the **cockpit/chat surface, not the fixed-button panel**.
- Three real options for the panel: (1) **Guy's key = COGS** [doc default — small ~$5-35/mo, recovered in
  $150/$300, uniform quality + full guardrails]; (2) **BYO API key** in Guy's backend [client bears
  per-token cost, but must create a dev account + Guy custodies the key + inherits their billing/rate-limit
  health → operational hurdles, not technical]; (3) **MCP connector** [their flat sub, ~$0 to Guy, but
  different surface]. Architecturally any key lives in the **backend** (extension → backend → AI), **never
  in the extension** (browser-exposed + bypasses guardrails). **Lean = option 1 with a usage cap (below);
  BYO-key stays the outlier pressure-valve.**

**Usage caps — yes, and they're what makes "Guy pays" safe (refines "AI cost economics" caps line).**
Because all AI runs **through Guy's backend**, every use is counted and stoppable — Guy holds the dial (he
wouldn't with a client's own key).
- **Cap in client-facing units (drafts/actions), NOT tokens.** "20 drafts/day" is understandable +
  sellable; "80k tokens" is meaningless to a client. **Meter tokens underneath** as Guy's instrument panel
  so allowances are set on real cost.
- **Not all actions cost the same** (a LinkedIn reply is tiny; a post-call email off a 90-min transcript is
  big). **Start simple** = one "actions" allowance set with margin; **split out the heavy actions**
  (transcript emails) only if the numbers later show they move the bill.
- **Watch-then-enforce:** no cap on day 1 (small, trusted client count) — just watch the metered numbers;
  **add the cap before wider rollout.**

**Out-of-scope use — prevented by design, not policed (crystallises "Panel beats Claude-chat").** The panel
is **fixed-button, not an open chat** → there's literally no door for "write my kid's essay"; the buttons
ARE the menu and only carry the jobs Guy builds. Reinforced by: the **backend only has code paths for Guy's
jobs** (no path = can't happen), **instruction-rules** on any free-text ("you help with LinkedIn outreach +
post-call follow-up; decline the rest"), and **full visibility** of everything passing through. Only
watch-spot = wherever free typing is allowed (e.g. "reply in your own words") — instruction-rules keep that
on-rails.

**Inactive / non-paying clients — central server-side off-switch.** The extension is a **remote control with
no brains** — every action calls Guy's server, which checks "is this client active?" first. So:
- **Idle-but-paying** = nothing to do; costs follow usage → an idle client costs ~$0 (the cap covers the
  binge end; inactivity is the harmless end).
- **Stops paying** = flip the client **inactive on the server** (single switch, ties to the existing
  **Stripe** billing — failed payment can flip it, manually or auto). Panel goes dead (buttons remain,
  return a polite "account paused"), **no AI runs → no cost**, instantly. **Never touch their machine.**
  Their accumulated/tuned state stays server-side → **reversible in one click** if they return (pick up
  where they left off, nothing to reinstall). Graceful "paused" beats a silent break. Same per-client gate
  pattern already used for `features.thanksForConnecting`.

## Extension — panel data model, cost/quality model, commercial model & voice seed (2026-06-22)
Big working session (discussion + live verification; no extension code yet). Continues the 06-21 extension design.
Read with **Chrome extension — fork-and-run-two** (above), **AI cost economics**, **Rules de-personalisation**,
**Pricing + delivery model**, and **Claude-in-Chrome vs our custom extension**.

### Panel data model — foreground draft / background capture
- **Foreground vs background split (the key architecture).** The panel's *foreground* job = **draft the next
  message** (the high-value thing); message-archiving + contact reconcile happen **silently in the background**,
  non-blocking. This dissolves the "how long to ingest all messages" worry — the full ingest is housekeeping you
  never wait on.
- **Messages.** You click into the thread + read the recent ones (normal LinkedIn UX, foreground); the extension
  takes the **full snapshot to the Portal in the background**. **Full-snapshot-REPLACE, never delta-merge** (Guy:
  "copy all + upload = known-right"; delta-merge risks silently missing some). Because YOU open the thread, the
  script mostly reads what your click already loaded → lowest LinkedIn footprint.
  - **★ CAPTURE TRIGGER = the Send click (pinned 2026-06-26; was the vague "when you work a lead").** The human
    clicks LinkedIn Send (iron rule intact — never headless); Wingguy detects the send (**button click AND
    Enter-to-send**), waits a beat for the just-sent message to render, then full-replace snapshots the whole thread
    to Airtable. Timing slop is harmless *because* it's full-replace, not delta. Kills Guy's current copy-first chore.
- **Contact details.** Silent reconcile vs the Portal; **speak only on a mismatch** ("differs from the Portal —
  here's what/when") = the existing self-healing identity work given a voice. Match → silence.
- **Unified profile view = Portal record + the LIVE page.** On landing, auto-assemble About (auto-expand "see
  more"), contact, messages, and **recent posts** (a NEW source — authentic-hook material for drafts), clickless.
  **Portal = the durable RECORD, not a cache to trust as current** — re-read fresh + replace at the moment you act;
  the re-pull is **human-triggered when you work a lead**, not a background crawl on every glance (footprint + the
  human-at-the-glass iron rule). *(Corrects the earlier "first-visit hydrate → warm forever" framing — wrong for
  messages, which keep growing.)*
- **Restraint.** Auto-expanding the page you're already on is fine; the thing to avoid is the extension *driving*
  LinkedIn's UI in the background across many profiles (ban risk).

### Summary-not-raw transcript (cost mechanism — ALREADY BUILT, verified live)
- The summary is generated once at ingest on **Gemini** and stored in `recall_meetings.summary_json` (+
  `summary_generated_at`); raw stays in `transcript_text`; it is **cached** (a re-request returns the stored copy —
  `recallSummaryService.js:84`). So "pay the big read once, cheaply; draft off the one-pager forever after" is real,
  not to-build.
- **The drafter reads the SUMMARY by default; pulls the RAW only on shortfall.** Code selects raw up front when:
  no/empty summary · summary flagged unreliable (reconstruction-pending) · a deep action type configured to need it
  · the user explicitly asks for specifics/a quote. Otherwise it's **on-demand escalation** — the agent drafts off
  the summary and calls a "fetch full transcript" tool only if the summary lacks what the task needs. Raw = the
  expensive exception. (Pulling raw + using Opus tend to fire together — both mean "this is a heavy one.")
- **Cost:** 60 transcripts/mo ≈ **<$5/mo even on Pro, ~$0.60 on Flash** (once-each + cached). Immaterial.

### Cost / quality model
- **The real cost driver is DRAFTING, not summaries** — specifically the **agentic multi-tool flows** (Tony-style:
  check calendar → reconcile Airtable → build invite), which re-send growing context across tool-call rounds, so
  they cost more than a single draft. Ballpark per complete flow: ~$0.50–1.50 Opus, ~$0.15–0.40 Sonnet+caching.
  Single drafts: cents. *(Verified the capability live — the Tony booking landed on the real calendar and Tony
  accepted.)*
- **Two decisive levers:** **prompt-caching** the rules/voice (the big repeated chunk; most valuable on the
  multi-round flows) + **model-per-job** (Sonnet-default, Opus-escalation).
- **Model routing = CODE decides up front from facts** (transcript involved / deep thread / post-call email), NOT
  the AI judging its own difficulty; PLUS a human **"sharpen" button** (you review every draft anyway). **Start
  all-Sonnet + button; add code auto-routing later from BACK-TEST evidence.** (Same escalation shape as summary→raw.)
- **Quality nervousness (real, valid):** Guy runs Opus-on-everything today and loves it; production = Sonnet+summary.
  **De-risk by TESTING, not faith** — back-test the real threads three ways (**Opus+full vs Sonnet+full vs
  Sonnet+summary**) and see where (if) it drops; treat the two downgrades (model, context) as **independent**. The
  architecture is **not a cliff**: any draft is one tap (or one code-flag) from Opus / from raw, and you review every
  one → cheap-by-default, great-where-it-matters.

### Back-test results, model decision & the surface/cost split (2026-06-22)
**Back-test run (real):** Opus (me) vs **actual Sonnet** subagents vs Guy's sent messages, on 5 real threads
(templated / objection / wit / genuine-no / take-a-punt). **DECISION (Guy): Sonnet-default + a manual "sharpen"
(→Opus) button + code auto-route the heavy/witty.** Evidence:
- **Sonnet holds as the default on BOTH templated voice AND judgment** — Luke (templated hook) ≈ Opus; Rayn
  (genuine-no) correctly gracious + didn't push; Maria correctly took-a-punt-and-booked. The bulk of volume is
  safe on Sonnet → cost model **validated, not assumed**.
- **Misses cluster into THREE fixable things — only one needs Opus:** (1) **confabulation** (Sonnet invented
  "no dues, no pitch nights") → fix by **grounding** real network facts + "state only what's given, don't
  invent" (helps every model; key pre-build catch); (2) **dropped softeners** (Maria omitted Guy's "if not, let
  me know" easy-out on a proactive booking) → **rule:** "when you book proactively, always leave an easy out";
  (3) **wit / register-match edge** (Tony's playful "nice hustle") → Sonnet matched the register but the wit was
  thinner → the genuine **Opus** case → auto-route + the "sharpen" button.
- **Added case — hook-selection (Subbu, 2026-06-22):** given a profile whose About + featured content + every recent
  post centre on one passion (his "AI Balance Sheet" newsletter on AI cost/value), the draft still reached for a
  **safe career-fact hook** ("recently gone fractional + value-advisory background at ServiceNow/SAP/Oracle") instead
  of his **passion/featured content** — which Guy's own AI Blaze rule says to check FIRST. Lesson: the
  **"passion/values/featured-first" hook rule must be actively enforced/grounded**, or the drafter defaults to
  generic-but-safe. (A grounding rule + a sharpen/auto-Opus candidate.)

**★ Surface/cost split — the resolution (Guy, 2026-06-22).** The transcript-deep / post-call work does NOT
belong on the extension at all. Natural flow: **once a call has happened (a transcript exists) the work moves to
EMAIL — done in CLAUDE CHAT with MCP (the connector/cockpit) → the CLIENT'S OWN Claude → their cost.** So:
- **Extension surface (Guy's key, Sonnet-default, cheap):** PRE-call LinkedIn — outreach, replies, booking.
  Touches transcripts rarely; when it does (a reply referencing the last call), **the SUMMARY satisfies** — raw
  is essentially never needed here.
- **Connector/chat surface (client's own Claude, THEIR cost):** POST-call — the follow-up email + deep
  transcript synthesis (the Ashley join-email flow: pulls transcript + Gmail + standing rules + the OS/Manifest,
  makes real judgment calls like "join-handoff, not Zoom-1 follow-up → skip the Manifesto/advocacy links").
  Heavy + low-volume + on their dime — Guy already does it well there on Opus.
- **★ REQUIREMENT (Guy, 2026-06-22): the post-call / connector MCP ALWAYS works on the FULL transcript, never the
  summary.** Verified current behaviour — `latest-transcript-by-email` returns the whole `transcript_text`
  (recallWebhookRoutes.js:819), not `summary_json` — and it's a *deliberate requirement*: everything available,
  highest fidelity, and since it's the client's cost there's no reason to downgrade. **The summary-default
  optimisation is EXTENSION-ONLY and must never touch the post-call flow.**
- **What this dissolves:** the post-call **quality** nervousness AND the post-call **cost** exposure both move
  OFF the extension / Guy's key onto the client's Claude. Raw-transcript handling in the extension ≈ not needed
  (summary-default is plenty) → the **summary-vs-raw test drops from "must-do before build" to "nice-to-confirm."**
- **Refines the "second front door":** post-call drafting for clients runs in the **connector (their Claude)**,
  NOT an agent-backed chat *in the panel on Guy's key* (the earlier framing). Same capability, cheaper surface.
  *(One honest dependency: assumes clients — incl. a VA — run post-call in their own Claude via the connector,
  which needs their Claude account = the connector surface by design.)*

### Why the extension trails Claude-Chat — three levers BEYOND model choice (2026-06-30)
> The model axis is already settled above (Sonnet-default / Opus-escalate). But comparing real Claude-Chat outputs
> (Christopher, Vicki) against `services/wingguyChat.js` showed the chat-quality gap is **not only** the model —
> three other levers, all cheap:
- **Data-reach (the "timeline touch"):** Claude Chat lists the meetings *around* a slot ("1:45 Daniel / 2:30
  Michelle (ends 3:15) / 3:30 ← slots in / 4:00 JB"). The extension **can't** — `check_availability` hands the model
  a `meetingCount` (a number) + free gaps, **not the named neighbouring meetings.** `services/wingguyCalendar.js`
  already *fetches* those events and then discards their names down to a count. **Fix = pass the day's real events
  through** (+ one line in the brief allowing the model to show them). Small; the data's already in hand.
- **"Permission to elaborate":** `wingguyChat.js` tells the agent to **"keep chat replies short"** (~line 257). That
  muzzles the proactive/presentational coda *even on Opus*. Loosen it so it may present richly **when useful** (a
  clash, a booking summary) while staying terse on routine turns.
- **A touch is only real if a tool backs it (the Vicki coda):** the chat offered "check if she's in Airtable by
  LinkedIn URL → log her as an **On The Radar** lead." The agent has **no Airtable tool** (its tools: availability,
  booking, time-check, message-draft). In the extension, **it can only honestly offer what it has a tool for** →
  this is a small **new tool** to build, not a model setting. (The calendar slot-drop it offered it *can* already
  back via `check_availability`.)
- **Net:** model + thinking/token settings buy the *voice*; these three buy the *touches*. Expect "~90% of
  Claude-Chat", not a byte-identical twin (the chat has its own scaffolding we don't control) — 90% is the right
  place to stop for a client-facing booker.

### Who-pays — CORRECTED — and the commercial model
- **CORRECTION to the 06-21 note:** the heavy agentic work lives in the **EXTENSION** (beside LinkedIn), NOT the
  connector. So it runs on **Guy's backend → Guy's key**. A client's **consumer Claude sub canNOT power a
  button-panel** (no API; only the *chat-connector* can use a consumer sub). So for the panel it's realistically
  **(a) Guy's key, billed via pricing**, or **(b) client BYO API key (outlier only)** — *not* "runs on their Claude."
- **Decision: NO metered billing** (messy + makes clients ration → starves the moat). Instead **flat $50/mo on Guy's
  key**, kept profitable by **Sonnet-default + caching**, protected by a **simple daily action cap (~150/day ≈
  3,000/mo) as a runaway backstop** — a safety limit, NOT a billing meter (needn't be cost-accurate).
- **"Action" = one AI-WRITTEN output you asked for** (a reply / an email / a times-offer-with-draft), including
  redos. **NOT counted:** background reads (profile auto-load) and deterministic clerical steps (calendar / Airtable
  / portal writes). *Count the writes, not the reads, not the clerical.*
- **Cap = 3,000/mo, NOT 1,000.** 1,000 (~45/day) would throttle genuine heavy users = your stickiest/best; 3,000
  (~150/day) only catches non-human runaway and still sits under $50 on Sonnet (~$30–48 at the ceiling). 1,000 is
  valid ONLY as a deliberate paid *tier* with a graceful upgrade path.
- **Free trial = 500 actions** (≈ a month for a typical user; reached in ~3–4 weeks at ~20/day; ~$5–8 AI cost on
  Sonnet). Consider a **~60-day backstop** so dabbler trials don't linger. A heavy user burning it in ~10 days = the
  **best conversion moment**, not a problem.
- **Usage-counter UX:** **no standing counter in normal paid use** (a visible meter makes people ration → kills the
  heavy use you want); **show "X of 500" during the TRIAL** (motivating + sets up the sale); **a gentle one-off
  warning near the cap** only; keep the **full metering in the backend** (Guy's instrument), invisible to clients.
  **★ Operator/admin view (Guy, 2026-06-22):** Guy DOES want to see **actions used today** (and cumulative) for his
  own gauge of daily volume — so surface a **per-day actions counter on the operator/admin side**, just NOT on the
  client-facing UI. Same data, two audiences: hidden from the client (no intimidation, no relevance), visible to Guy.
- **Pricing strategy = stickiness-first.** At this cost level price is a **demand/positioning lever, not
  cost-recovery** (you profit at $50 and $100). Start **$50 (penetration)**, **grandfather early adopters**, **raise
  to ~$100 for later cohorts.** Stickiness is **earned by quality + accumulated state, not bought by price** — the
  PMF signal is Guy's own reliance on it.

### Claude-in-Chrome — re-confirmed OUT (today reinforces it)
Re-examined in light of the cost discussion; stays ruled out as a build/product target (see "Claude-in-Chrome vs our
custom extension"). Everything designed this session — rules-in-backend, summary/raw selection, Sonnet/Opus routing,
caps, metering, per-tenant isolation, the formatting-preserving insert — **lives in Guy's backend, which
Claude-in-Chrome bypasses**; adopting it throws away every control lever. Its one pull (client's Claude sub → $0 to
Guy) is handled better by **$50 + caps + Sonnet** (cheap *with* control) and by the **connector** for the genuine
"use their Claude" case (the chat surface). Stays an optional power-user door; not built-for / supported / pitched.

### Voice seed + back-test methodology (from a real message corpus)
Guy pasted ~20 real LinkedIn threads + his AI Blaze prompt templates → the literal seed of the Wingguy voice/rules
store (raw stays in Guy's tenant; de-identified → the shippable template).
- **Templated beats** (his AI Blaze flow): acknowledge → recommend-hook (ONE *interpreted* profile detail tied to
  "easy to recommend") → vision (refer-each-other / "I reckon you'd fit it well") → open door ("Worth a quick Zoom in
  the next couple of weeks?") → sig "(I know a) Guy". Plus classify **employee / consultant-owner / both** → different
  base message.
- **Implicit judgment rules extracted** (NOT in his prompts — the gold): **take-a-punt-and-book** (decide a near slot
  vs ping-pong) · **reframe-the-objection-as-a-fit** (Ranya "we don't do startups" → "a plus, not a mismatch") ·
  **gentle scarcity** to move a staller · **match-the-counterpart's-register** (breezy Liam vs formal Cecile) ·
  **grace + humanity** on cancellations/glitches.
- **★ Methodology correction (Guy):** ground truth is **Guy's JUDGMENT, not his sent history.** Some sent messages
  were rushed — he preferred *my* draft on Rayn (my "genuine no → cheer-and-stop" rule was over-fitting one hurried
  message; his real preference = warm + a light, genuine door-open). So the bar = **his considered best, not his
  rushed average** — which IS the product (deliver his best every time). Tuning signal = his **preference on drafts**
  (edit-as-you-go → the write-door), not mining history; weight his considered/AI-Blaze messages as match-targets,
  treat rushed manual ones as candidates to judge.
- **Transcript context-sufficiency check** = a first-class rule: detect **cold** (draft off profile + thread) vs
  **warm/post-meeting** (pull the transcript first). The Hrishekesh thread (months-deep, calls, ASH signup) is the
  proof case; the lookup exists (`latest-transcript-by-email`), the new part = the intelligence to know *when* to reach.
- **Back-test = the go/no-go** for the Sonnet+summary downgrade AND the rule-extraction engine (divergences = unwritten
  rules to confirm via the write-door).

### Reference example — the full booking flow the extension must do (Ranya, 2026-06-22)
Guy pasted ONLY the LinkedIn thread into his Claude cockpit; it ran the entire booking orchestration unaided. This
is the clearest concrete spec of the **extension's drafting-agent architecture** (the next big design question) — and
it's a **PRE-call booking flow (no transcript) → the EXTENSION surface** (Guy's key, agentic, Sonnet-default), NOT
post-call/connector. End-to-end, the agent:
- **Read the thread** → caught that Ranya said "Mon morning works" and gave a new email.
- **Calendar clash-check** — Mon 29 Jun 10:00 clear; **flagged the back-to-back run** (10:00→12:30, no breathing room)
  and offered to re-slot.
- **Airtable reconcile** — new `ranya@realbusinessmatters.com.au` ≠ on-file `ranya_salem@hotmail.com` → moved new to
  primary, archived old to **Alt Emails**, logged the booking in Notes (= the self-healing identity work, live).
- **Built the calendar invite from the Notion spec** (guest-first title, Zoom room, her LinkedIn + Guy's details in
  the body); sent to the new address.
- **Flagged, didn't guess** — left her "In Process" status + 29 Jun follow-up date as-is and surfaced them for Guy.
- **Drafted the one-line LinkedIn confirmation** on request.

**For the extension:** same capability, but the thread is **auto-read off the page** (no paste), the agent runs
**server-side, per-tenant** (calendar + Airtable + Notion + Gmail wired to the client), drafts shown first, human
clicks send. This is the worked brief to design the drafting-agent against. *(Pairs with the Tony booking example
above — both verified live on Guy's real data.)*
- **Cost (this is cheap, not a worry):** an agentic booking flow ≈ **15–25¢ each on Sonnet** (~50¢–$1 on Opus) —
  the multi-tool context re-sends are the cost, tamed by **prompt-caching**; the tool results (calendar / Airtable /
  Notion) are **small text, NO transcript** (the expensive transcript input lives in the post-call flow, on the
  client's Claude). And it's **bounded by meetings actually booked** (~tens/month), so all the booking orchestration
  for a heavy user ≈ **~$8/mo on Sonnet** — comfortably inside $50. *(Ballpark — confirm with metering.)*

### Campaign first-message templates + the authoring model (2026-06-24)
Refines the extension's "first message" function + the client-facing side of template authoring. Read with **Rules
editing UX**, **Rules de-personalisation**, and the panel functions above.

**The first "thanks for connecting" message = a per-client LIBRARY of campaign templates** (a general one + per-
campaign ones — e.g. Guy's `\tks` general and `\frac` fractionals; "each client sets up many"). These templates ARE
content in the per-tenant Wingguy rules store. In the extension, Guy's **AI Blaze shortcodes become labelled
quick-pick buttons** (no codes to memorise). **Also confirmed an extension function:** **save a reminder draft**
(with notes + a suggested schedule date) to the client's **Gmail/Outlook**.

**Template SELECTION (decided 2026-06-24; ★ REFINED 2026-06-26 → keyword AUTO-detect, human override).** *The
2026-06-26 refinement promotes the "soft-default sweetener" below from optional-later to the DEFAULT mechanism:*
each template carries **detection keywords**, matched against **the on-screen profile + the connection-request note
that went out**; first match wins, **default = general** if none match, **human overrides** via the template pill in
the full-screen CONTEXT header. **The rejection of LH-campaign-threading (next sentence) STILL stands** — keyword
detection reads what's already on screen, it does NOT thread the campaign through Linked Helper. (Live proof: Benjamin
Chambers' headline "Fractional COO" → keyword "fractional" → auto-picks `\frac`.) Detail ↓ journal "Extension UX lock
(2026-06-26)". *Original 2026-06-24 reasoning, still valid for why we don't auto-TRACK campaigns:*
We will NOT thread the campaign
through Linked Helper → lead record → auto-select: too much build + ongoing maintenance + a permanent wrong-template
failure mode, and it loads the client to keep it tagged. Instead **the human at the glass picks the template** by
reading the profile + the connection-request message — exactly what Guy does today with `\tks`/`\frac` (everything
needed to decide is already on screen). **Soft-default sweetener (optional, later):** the panel reads the on-screen
profile + connection message and *suggests* the likely template (one-line "use when…" on each button) with **"general"
as the safe fallback**; the human confirms/overrides. No campaign-tracking infrastructure — the AI is reading the
profile to draft anyway, so proposing the template is the same read. Drops the VA-training load from "recognise cold"
to "confirm a guess."

**Authoring model — do NOT rebuild AI Blaze for clients (decided 2026-06-24).** Split by who:
- **Heavy prompt-craft = admin/Guy-side.** The classification + style + substitution logic (the `\tks` "monster") is
  Guy's craft, baked into the engine. Guy builds the **master library** (AI Blaze or a simple admin editor); it
  **ships to clients as their starting templates** (seed-then-diverge). Clients never write that.
- **Client side = light.** Start from a shipped template → give a campaign a name + their angle/example → **tune by
  reacting to drafts in the flow** (edit-as-you-go → the write-door) as the PRIMARY path, not a form. The client
  screen is a **"manage my templates"** view (see / name / enable-disable / "use when" hint / light edits), **NOT a
  raw prompt IDE** (matches "Rules editing UX": the screen = visibility/settings, not bulk authoring).
- **Sequencing:** white-glove first (Guy sets up each client's templates at onboarding); a self-serve client
  authoring screen is a later "productise it" step. **v1 may need NO client-facing builder** — just the pick-buttons,
  conversational tuning, and Guy doing setup.

### Extension core function = an intelligent conversation engine; the LH boundary + triage model (2026-06-24)
**The truest description of what the extension IS — supersedes the earlier "set of buttons" framing.** Refines the
campaign-template entry above. (Front-of-funnel; distinct from the post-call "second front door" which is the
connector/chat.)

**The Linked Helper ↔ extension boundary (the funnel):**
- **LH sends the connection request.** On acceptance, LH waits a **configurable delay (Guy set it to 14 days)** before
  sending its OWN *standard* thanks-for-connecting — and **LH suppresses that automated message if a message has
  already been sent.** That 14-day gap is the **human's runway.**
- **During the window the human TRIAGES new connections** (= the existing **"Thanks for Connecting" worklist**: the
  portal queue of recent connections, oldest-first, ~14-day lookback):
  - **Worthwhile (most)** → send a **personalised** thanks-for-connecting via the extension → **pre-empts LH's
    standard one** (far more effective).
  - **Meh** → leave them → LH's standard message handles them after 14 days.
  - **Not worth it** → ignore entirely.
- **Worklist = WHO to action (portal); extension = HOW (open profile → pick campaign template → send).** Same
  triage-and-personalise phase, two surfaces.

**The extension's two phases:**
1. **Proactive first touch** — triage + the personalised thanks-for-connecting (campaign-template library, human-picks
   + soft default).
2. **Conversation engine** — once a lead *comes back / engages*, the extension is **ONE intelligent engine that reads
   the ENTIRE conversation, works out where things stand, and decides the next move**, then drafts it for approval:
   warm reply → offer Zoom times; question/objection → answer/reframe; picks a time → book + confirm; needs to move →
   reschedule gracefully; etc. The discrete "draft reply / book / confirm" items are **moves the one engine picks
   between by reading the thread**, not separate features.

**The decision logic ("when they say X, do Y") = the encoded judgment from Guy's real examples** — mostly standard,
**shipped as a standard template, client-tunable** (rules-store + seed-then-diverge). Only the **thanks-for-connecting**
needs the per-campaign *library*; booking / reply / reschedule are **universal** single templates.

**Scope confirmations (2026-06-24):** extension starts **post-connection** (LH owns the invite + the cold/automated
sequence); **intros/matchmaking are OUT of the extension** — done in Claude chat via the MCP / email.

**Why this design is strong (hard-won, and it holds up):** it spends Guy's scarcest resource — personal attention —
only on worthwhile leads while LH cheaply catches the long tail; the **LH-suppress-if-already-messaged linchpin** means
the two systems never collide and **nothing is dropped** (skip a lead → LH handles it) → forgiving + sustainable for a
busy person or a VA; the triage discipline also **naturally bounds the AI cost** (the expensive personalised engine
runs only on the triaged subset, not every connection); and what's productised is the **judgment** (who to personalise,
what to say, when to push for a Zoom) — the moat, not the software. The triage instinct is a **teachable skill** Guy
will train clients on.

### Extension UX lock — one trigger, full-screen AI-Blaze-style takeover, keyword auto-detect, on-Send capture (2026-06-26)
Design session (no code) — Guy walked through his **live AI Blaze flow** (two screenshots banked). **This is the chosen
shape for the whole extension surface**; it supersedes the "teal launcher + adjustable side-panel + human-picks-template"
framing of Slice 1 / Option A. Read with **Extension core function = an intelligent conversation engine** (above),
**Panel data model — foreground draft / background capture**, **Campaign first-message templates**, and the
**▶ You are here** 2026-06-26 block.

**The model = "Wingguy replaces AI Blaze" for this purpose.** Guy's current first-touch flow IS AI Blaze: in LinkedIn's
"Write a message…" box he types a shortcode (`\tks` general thanks, `\frac` fractional) → AI Blaze takes over the **full
screen** (roomy, not cramped) → shows the drafted message as a **highlighted block** + a refine chat box + a model
selector (his says "Sonnet") → **"Insert highlight into page"** drops *only the highlighted text* into the composer → he
edits in the box → he clicks Send. He loves the look; the only problem is it's a *general* tool. Wingguy reproduces this
look exactly but purpose-built.

**Five locked decisions (each revises/refines an earlier entry — marked at source):**
1. **One typed trigger, with aliases** (`/wg` / `\wingguy` / a small set so no one must remember one exact code), fired
   **from inside the LinkedIn composer** (exactly like `\frac`). REVISES the teal launcher button. Bonus: triggering
   from the box captures the caret → feeds the already-solved cursor-insert directly, so the "click in the box first"
   step disappears.
2. **Full-screen takeover, not the adjustable-width side panel** (SUPERSEDES "Panel type: injected DOM panel… width
   adjustable" in *Booking-from-the-panel*). Still an injected overlay — just full-bleed + transient (opens on trigger,
   closes on Insert).
3. **Keyword auto-detect of the campaign template** (PROMOTES the "soft-default sweetener" in *Campaign first-message
   templates* from optional-later to the default). Each template carries **detection keywords**, matched against **the
   on-screen profile + the connection-request note that went out**; first match wins, **default = general**, **human
   overrides** via the template pill in the CONTEXT header. NOT the rejected LH-campaign-threading (reads what's already
   on screen) — that rejection still stands. Live proof: Benjamin's "Fractional COO" → "fractional" → `\frac`.
   **★ NOTE SOURCE RESOLVED (2026-06-26, Guy's screenshot):** the connection-request note is the **FIRST message in the
   LinkedIn thread** (Benjamin's May 30: *"I'm building a network of **Fractional** Professionals…"*) — which the
   extension **already scrapes** (`scrapeOpenThread()`). So NO Airtable dependency to read the note; the profile headline
   ("Fractional COO") is a free belt-and-braces fallback (match either → same answer). **Concrete first-test rule
   (locked):** *first message contains "fractional" → `\frac`, else `\tks` (default).* One keyword on `\frac`, none on
   `\tks` (catch-all).
4. **Highlight-and-insert** — draft shown highlighted; **only the highlighted text inserts** (copy AI Blaze's "Insert
   highlight into page"). Cleaner than our `stripMetaCommentary()` backstop: the model's surrounding chatter never
   reaches the composer by construction.
5. **On-Send → Airtable capture** (PINS the vague "background, when you work a lead" trigger in *Panel data model* to
   **the Send click**). Human clicks Send (iron rule intact); Wingguy detects the send (button click AND Enter), waits a
   beat for the sent message to render, then **full-replace** snapshots the whole thread to Airtable. Eliminates Guy's
   copy-first chore; timing slop harmless because full-replace.

**Why purpose-built matters — a live demo in the screenshot.** AI Blaze, fed Benjamin Chambers' thread where the
conversation had **moved on to rescheduling the meeting to Friday**, still drafted the **original first-touch opener**,
then got confused ("Note: this is actually the message already sent Jun 9 — want something else?"). That blindness to
conversation-state is exactly the job Wingguy's conversation engine does (read the thread → place it → draft the *right*
move). The general tool's failure = the purpose-built win.

**The unified runtime (both phases, one screen):** `/wg` → full-screen → read page + thread → **(a)** no live reply yet →
**thanks-for-connecting**, keyword-pick the template (override available); **(b)** they've replied → **conversation
engine**, read where it stands and pick the move (warm reply / answer objection / offer Zoom times / book a picked time +
confirm / reschedule gracefully), offering a VA a couple of **reply ideas**. Same screen, same insert + send + capture tail.

**Build sequencing (decided 2026-06-26 — Guy's call):** build the **thanks-for-connecting full-screen screen FIRST** —
the no-tools phase — because it proves the *entire new shell* (typed trigger · full-screen overlay · keyword auto-detect ·
highlight-and-insert · on-Send→Airtable capture) on the easy path. Test against Guy's **two real templates already
installed** (`\tks`, `\frac` in `config/wingguyTemplates.js`); only new template work = **adding detection keywords** to
each (the first-test rule above). **★ Keywords-as-CONFIG now, editor-SCREEN later (clarified 2026-06-26):** the template
*editor* UI (AI Blaze's Label/Shortcut/prompt-body screen) is a SEPARATE, later piece — the client-facing "manage my
templates" surface (2026-06-24 Authoring model; Postgres rules store = Slice 3). We do NOT need it to test: detection
keywords are just a field hand-added to the seeded config. Don't read "build the thanks screen first" as "build the
editor first." Then the conversation/booking engine (Slice 2, calendar tools) slots into the *same proven screen*,
de-risked by the one-tool calendar spike already planned. *(This is what the OLD Slice 1 becomes once re-skinned into the new shell —
backend draft path already works; the work is the UX shell + auto-detect + capture.)*

### Slice 2 — booking engine design (2026-06-26 design pass; codebase-verified)
Design pass (no Slice-2 code yet) after the thanks-for-connecting loop proved out. Read with **Extension core function =
an intelligent conversation engine**, **Reference example — the full booking flow (Ranya)**, and **Booking-from-the-panel**.
**★ Headline: Slice 2 is MOSTLY REUSE, not new backend.** A codebase audit found the booking infrastructure already
exists and (crucially) every calendar endpoint authenticates on **`x-client-id` alone — which the extension already
sends** — so the panel can call them with the headers it has.

**Reusable today (all `/api/calendar/*`, in `routes/apiAndJobRoutes.js`; availability in `config/calendarServiceAccount.js`):**
- `GET /availability?leadLocation=` → timezone-aware free slots (`days[]` each with `freeSlots[{time, display, leadDisplay}]`);
  timezone resolved from the lead's location (rules + Gemini fallback).
- `POST /quick-pick-message` `{selectedSlots[], context}` → a **ready-to-paste "here are some times" message** in the
  lead's timezone (the "I've got these times in mind" message Guy sends today).
- `POST /chat` `{message, messages[], context}` → the **Gemini booking brain** (timezone rules, least-busy-day bias);
  returns a message + optional `action:setBookingTime`.
- `GET /lookup-lead?query=` (URL/email/name) → lead record incl. **email** (needed for the invite); `PATCH /update-lead`
  → writes location/email/phone; `POST /extract-profile` → parse a raw paste.

**Genuinely missing (the only real build):**
- **Calendar invite CREATION is not server-side.** Today the Next.js UI just opens a **prefilled Google Calendar URL**
  (`calendar-booking/page.tsx`) for a human to confirm + send. No `POST /create-event`.
- **No booking→Airtable status/Follow-up-Date sync** on a confirmed meeting (update-lead only does location/email/phone).

**The design (booking as a move inside the same `/wg` reply panel):**
- **One-tool calendar SPIKE (build first, pure reuse, NO new backend):** in reply mode, a **"Suggest times"** action →
  `availability` (leadLocation from the profile/record) → pick a few slots → `quick-pick-message` → drafted times message
  in the panel → insert → send. Proves calendar-in-extension end-to-end with zero backend work.
- **Then "confirm a picked time":** detect the lead chose a time → **reuse the prefilled-Google-Calendar-URL approach**
  (open it for Guy to confirm + send — human-at-the-glass, NO new backend) rather than building server-side create-event
  first → optionally `update-lead`/Follow-up-Date. Server-side auto-create + RSVP polling = later automation, not now.
- **Decide-the-move** (auto-offer vs a manual "Suggest times" button) starts **manual**; folding it into the conversation
  engine's auto-routing is a later step.

**Open decisions for Guy (flagged, not yet locked):** (1) slot selection = **auto-pick a few** vs an in-panel picker
(lean auto-pick first, picker later); (2) invite = **prefilled GCal URL (human confirms, no backend)** vs server-side
auto-create (lean prefilled-URL interim — less build, keeps the iron rule); (3) the lead **email** for the invite comes
from the Airtable record via `lookup-lead` (confirm that's reliably populated). **Single-tenant notes:** Brisbane TZ +
one shared Google service account are hardcoded defaults (fine for Guy; revisit at multi-tenant).
**★ MULTI-TENANT TIDY-UP BACKLOG for booking (flagged 2026-06-26, build later — the current code already isolates these
so it's not a rewrite):**
- **Invite LAYOUT = a per-tenant invite template.** The `/book` endpoint assembles the invite (title/description) inline
  with a minimal body. Make it a **template** keyed per tenant, with **Guy's set layout as the shipped default** (he's
  asked — it includes the lead's **LinkedIn URL**, his details, guest-first title — sourced from his Notion invite spec,
  the Ranya example). Same seed-then-diverge model as the message templates; lives in the per-tenant store (Postgres).
  *(✅ CAPTURED + IMPLEMENTED as the single-tenant default 2026-06-26, `ae7c630a`, from Guy's real Ranya invite: title
  `{Lead} & {Coach}`; 3-line body `Zoom: <room>` / `<Lead>: <lead LinkedIn>` / `<Coach>: <coach LinkedIn> | <phone>`;
  reminders 20-min popup + 1-day email. New booking prefs hold Guy's values — `coachLinkedIn`, `coachPhone`, `reminders`;
  lead LinkedIn comes from the scraped `profile.profileUrl`. Nylas shape PROVEN via the write test incl. reminders
  (create + delete HTTP 200). The per-tenant TEMPLATE SYSTEM, tunable in Postgres, is still the multi-tenant job — this
  just makes Guy's invites correct now + banks the seed.)*
- **Conferencing = a per-tenant setting, NOT a hardcoded room.** Today `yourZoom` is a fixed-room default in
  `wingguyBookingPrefs.js`. Real tenants split two ways: **(a) fixed personal room** (Guy) vs **(b) a fresh link per
  meeting** (auto-generated). (b) = Nylas conferencing auto-create (`conferencing.autocreate`, grant needs the provider
  linked) or the client's own Zoom/Meet. So model it as `{ mode: 'fixed'|'autocreate', url? }` per tenant.
  **Provider-agnostic (confirmed in discussion 2026-06-26):** because everything routes through Nylas, a client on
  **Microsoft Outlook** connects + reads/writes **identically** to Google (proven on Guy's Google; Outlook is designed-for —
  verify on the first real Outlook grant). Per-meeting auto-link is cleanest on the calendar's **native** tool — **Teams**
  for Outlook, **Meet** for Google; a per-meeting **Zoom** link specifically needs the client's Zoom linked to Nylas (extra
  step). No architectural wall — just the unbuilt `autocreate` mode.
- **Client booking onboarding — envisioned flow (2026-06-26).** A new client's setup = **(1) connect their calendar in one
  click** (Nylas hosted auth → their own Google/Outlook login → grant stored; Guy never touches their credentials); **(2)
  inherit Guy's proven defaults** (preferred times, invite layout, reminders — seed-then-diverge); **(3) make it theirs** —
  own name/LinkedIn/phone, own hours/prefs, conferencing mode — ideally set **conversationally** ("start me at 9, skip
  Fridays, here's my Zoom") + a light settings screen, never code. **Delivery: white-glove first** (Guy does it with them on
  an onboarding call) **→ productise** into a guided "connect → tune → go" wizard. Foundations proven (Nylas connect+write;
  settings behind seams); **NOT built = the self-serve connect flow + per-tenant settings storage** (= the multi-tenant build).

### Risks surfaced by real runs — calendar source-of-truth, email re-poisoning, day-of-week (2026-06-30)
> From running real threads through Claude-Chat vs Wingguy (Christopher Walters). Bugs/risks to design against — not
> all fixed yet.
- **Calendar source-of-truth mismatch:** Wingguy reads availability via **Nylas**; Guy's Claude-Chat reads via the
  **Google Calendar** connector. They can see **different events** → the same slot showed "clear" in one and
  "clashes (Dean & Guy Results)" in the other. **Pick ONE authoritative availability source per tenant** and make
  both front doors read it; otherwise clash answers contradict.
- **Client-zero conflation:** the clash-check runs against **Guy's** calendar because Guy is the lead's coach here.
  Multi-tenant must check the **client's** calendar — the design question is hidden while Guy tests on himself.
- **Email source-poisoning (re-introduces a fixed error):** the wrong address (`chris_d_walters@yahoo…`) lives on the
  lead's **LinkedIn profile**, so any profile re-sync **re-overwrites** the corrected gmail → the invite bounces
  again. **Corrections must be source-protected** (sticky over re-pulls), and a booking *move* must **re-invite the
  corrected address and drop the bounced one** — not just "the calendar has gmail somewhere."
- **Day-of-week labelling bug:** Wingguy reported "**Wednesday** 2 July" for a date that's a **Thursday** (and a
  stale event was titled "Rebooked for **Friday**", never a Friday) → day-of-week is being derived/stored wrong
  somewhere; looks systematic. Verify the day-name derivation in the booking/clash path.
- (Static personal Zoom-room collision also hit — already addressed by the **per-client Zoom** work; cross-ref, not
  re-logged.)

## Discovery & onboarding — teaching tenants what's possible (2026-06-14)

From a strategy/workflow chat. Closes a real gap: the doc is deep on *what* the system does but near-silent on *how a new tenant discovers it*. Sits directly under "Onboarding IS the business" — discovery is the front of onboarding.

**Problem.** An agentic, type-what-you-want surface has no visible menu. A new tenant (esp. Mr Busy's VA) opens the panel or talks to Wingguy and doesn't know what's available → under-uses it or freezes. Discovery must be *built*; it is not automatic.

**Three tiers — loud → quiet, matched to how fast the need decays after week one:**
1. **Contextual chips = DISCOVERY ("didn't know I could do that").** The *page* decides what shows. On a LinkedIn profile: Add to Portal / Draft connect-follow-up / Book a Zoom. On a messaging thread: Draft reply / Pull transcript / Save to Portal / Make intro. Max 3-4. **Design for the fade:** track which chips a tenant has used; once learned, retire it and promote an undiscovered one → the strip teaches, then gets out of the way.
2. **"Wingguy" keyword = RECALL ("what were my options again?").** Always-there menu-on-demand, scoped to the current surface; one-tap lines, not a tutorial. ★ Same word as the product name → the trigger is just summoning it by name ("Wingguy, what can I do here?"). Keyword and brand unify; LLM resolves variants, so no rigid magic command.
3. **"What's possible?" page in the Portal = REFERENCE/ONBOARDING.** Worked examples, not a feature list: what it does / the exact phrase to say / what comes back. People learn an agentic system from one full round-trip, not an inventory.

**Two architectural seams (both already consistent with doc principles):**
- **Extension renders the chips; the backend/MCP does the work.** The extension is the only layer that knows the page and can draw on it; MCP tools are deaf/blind to the UI. Exposing a tool as MCP does NOT make it a chip — chip-to-context is mapped explicitly. Build the extension once to (a) detect page type, (b) look up a chip set from **config**. Adding/changing chips = editing config, not code; per-tenant chip config (broker vs fractional = different default chips + language) → multi-tenant is a setting, not a fork. Same config-driven, behind-a-seam discipline as calendar/email/LLM.
- **Proactive chaining = a Wingguy RULE TYPE, not a CLAUDE.md thing.** The conversational equivalent of a chip: after finishing a task, Wingguy offers the obvious next step ("Done — save to the Portal and book the next meeting?") → tenant discovers a capability at the moment it matters. Home = Wingguy rules (per-tenant, versioned, conflict-checked) as a context-scoped "next-step/chaining" behaviour in the existing taxonomy — never hardcoded. Canonical chain to seed: transcript → follow-up email → save to Portal → book next meeting. **Reveal-vs-enforce split (= existing "integrity in code, LLM proposes only"):** chaining *offers/reveals* (soft, rule-level); hard guarantees that must fire every time (BCC tracker, link-redirect handling) stay in code, never a chaining rule.

**Net:** chips teach unasked (page-driven), the Wingguy keyword reminds on demand, the Portal page explains in depth — and both chips and chaining are per-tenant config/rules, not forks. Discovery is the first surface of "Onboarding IS the business".

## Implementation roadmap — single-tenant-Guy → full product (2026-06-08)

Principles: **additive** (Guy's live setup untouched); build on `dev` behind **off-by-default
flags** → staging → main; **prove each piece for Guy before multi-tenant**; simpler surfaces
before the deep post-call agent; **rules/asset spine before/with the agent**. Phases overlap
where noted. Treat as proposal — reconcile against reality each session.

**Phase 0 — Recon & foundations (read-only + seams)**
- Read existing `chrome-extension/` scaffold (env-aware) — record what's wired (likely shrinks Phase 2).
- Investigate `ash-backend` (main) + `ash-attributes-api` — what runs there, where new work belongs.
- Confirm dev→staging→main; establish env-var feature-flag pattern (off in prod).
- Introduce a **tenant/owner ID through the data model** — additive, default = Guy-Wilson (no behaviour change).

**Phase 1 — Provider abstractions (zero behaviour change for Guy)**
- Define thin interfaces: calendar (get-busy, create-event), email (send, read), and the **LLM call** (swappable model).
- **Google adapter** = wrap the existing ~4 calendar funcs + Gmail; prove Guy's booking byte-for-byte unchanged on staging.
- **Nylas adapter** on free sandbox (hosted auth); connect Guy's own Google via Nylas; parity test (availability, create-event, send/read email).
- Per-tenant connection/grant storage (encrypted).

**Phase 2 — Custom extension MVP for Guy (booking + reply), single-tenant**
- Content scripts: read LinkedIn profile + messaging thread (name, URL, headline, thread).
- **Injected** side panel (adjustable width / drag handle), not native Chrome panel.
- Booking surface: reuse Smart Booking Assistant / `quick-pick-message`; slots in panel; **Insert (line-break-preserving)** + Copy fallback; Airtable upsert on approve.
- Messaging-reply surface: read thread → draft (lettered quick-picks + free-form) → insert + Airtable upsert.
- Dynamic lettered options driven by qualifier verdict. Prove the whole panel for Guy first.

**Phase 3 — Rules + asset spine (the moat) [can overlap Phase 2]**
- Rules → Postgres, **versioned/append-only** (proposed/active/retired, lineage, one-click revert).
- Asset library as data: URLs, labels, stage-gates, usage gates ("explain live first").
- Three layers: **Dialogue** (propose + conflict-check), **Commit** (single write-door, confirmed only), **History** (separate append-only audit).
- Seed Guy's **master v1** from Notion (the one genuinely manual step).
- Wire extension drafting (and later the agent) to read rules/assets from the spine.

**Phase 4 — Multi-tenant enablement**
- Server-side **seat/access model**: gate on "authorised seat on an active subscription" (not user=subscriber); VA = own seat on Mr Busy's sub.
- **Per-tenant fork** of master rules + assets at signup (seed-then-diverge; master updates seed new clients only, never auto-push).
- Onboard a 2nd tenant end-to-end (first real one-man-band).

**Phase 5 — Transcript migration (Fathom) + post-call agent**
- Fathom per-tenant capture (each connects own) + **fallback/redundancy** (Recall missed 2/4).
- Resolve residual server-side calendar read for attendee-matching / back-to-back split (Fathom data vs calendar).
- Post-call agent, **two delivery modes**:
  - *Self-serve* = client's own Claude wired to our tools (MCP connectors) + their rules/data (their AI cost). Mostly = expose tools multi-tenant + connect-onboarding.
  - *Done-for-you* = Guy-run agent (Claude Agent SDK) + per-tenant connections + **confidence/flagging layer** so a non-expert can trust it.

**Phase 6 — Billing / pricing / metering (Stripe exists)**
- Tiers: $150 basics, +$50 full kit ($200), $300 done-for-you.
- **Conditional referral reward:** track 3 *active paying* referrals → waive $150; churn past grace → revert; $300→$50 tied to VA self-sufficiency.
- Usage metering + light cap (vs spam) + **BYO-key switch** ("tenant key? use it : ours").
- **Instrument token-cost-per-client** from day one.

**Phase 7 — Productize onboarding + scale**
- Guided setup; auto-fork master rules; one-click Nylas/Fathom connect; seat invites.
- Clean export (anti-lock-in). Drive down per-client setup time (Guy's own bottleneck) so it scales past a handful.

**Throughout:** Guy's single-tenant setup stays unchanged; nothing flips on in prod until he chooses.
**Dependencies:** Spine (P3) underpins multi-tenant (P4) + the agent (P5). Billing (P6) can trail. P2 & P3 can run in parallel.

---

## Transcript layer deep-dive (2026-06-15)

A live-workflow recap chat (Render cost cleanup + storage/strategy review). **Correction (2026-06-15):** this
chat initially failed to notice the Fathom ingest + splitter + `google|nylas` calendar adapter were **already
built & dry-run-proven on 2026-06-13** (see the dated entries below). Items 1–7 here remain valid strategy/cost;
item 8's old "forward sequence" was stale and has been replaced with the real go-live list. Problem → finding/decision:

1. **Storage worry is dead.** Transcript *reads* come from Postgres (`recall_meetings.transcript_text`), never the recorder. All transcripts total ~4 MB; Postgres is a **flat instance charge** (~$10.50/mo, `basic_256mb`, NOT metered by storage), 63 MB used of a 15 GB disk. 100 clients of transcripts ≈ a few hundred MB → bill barely moves. Airtable was never viable (100k-char field cap; longest transcript already 79k chars). So "rules + transcripts in Postgres for 50–100 clients" costs effectively nothing extra.

2. **The real DB growth was `recall_webhook_events`** — the raw Recall webhook firehose (33 MB = 8× all transcripts; Recall streams hundreds of chunk-events per meeting). Did a one-time prune; committed `scripts/prune-recall-webhook-events.js` (dry-run default, `--commit`, `RETENTION_DAYS=30`). **Decided NOT to cron it** — flat-rate Postgres = no cost pressure; run manually if it ever balloons. Becomes moot post-Fathom (one "ready" event, not a stream).

3. **Capture-model shift (the core change).** Recall = *our server* injects a live bot, real-time chunk stream. **Fathom = the client's Fathom captures** (bot or bot-free, their setup) and fires a **post-event "transcript ready" webhook** → our server pulls the finished transcript + attendees via API. Responsibility moves to the client; we become a downstream consumer; trigger is **per-client**; short processing delay (mins) — fine for our use.

4. **Who pays + Fathom tiers (corrected).** Fathom's **Public API & webhook is on EVERY tier, including Free** (confirmed from Guy's pricing-page screenshots — an earlier automated read wrongly said Team-gated). Free = unlimited transcripts. So accessing a client's transcript **never depends on their tier**. Requiring clients to be paid is a *business choice* (better AI summaries / commitment), not a technical gate. Capture cost stays the client's, never ours.

5. **Multi-source, not Fathom-only.** Build **one normalized-transcript shape + a thin source-mapper per provider**. Ship Fathom API + **universal paste** (`insertImportedMeeting` already exists). Add others (**Fireflies** = strongest alt API; Otter weak/enterprise-gated) **only when a paying client needs it** — build the seam, not all the plugs. Paste = universal fallback → sales pitch becomes "keep your tool", not "switch to Fathom". **⚠ Blind spot of this paste path (flagged 2026-06-18):** cross-platform captures (Zoom Notes/Tactiq → Teams/Meet) arrive with **no diarisation** (all lines = host) → needs single-speaker detection + AI reconstruction + a **human-confirm step**. See journal **"Speaker reconstruction on transcript ingest"** + the canonical Backlog block.

6. **Identity is multi-tenant + multi-provider (correction).** "Identity from calendar, not recorder" is solved **for Guy only** (single-tenant, Google). Multi-tenant needs *each client's* calendar across **Google AND Outlook** → the **same Nylas layer**. The transcript matcher should read attendees **through Nylas**, not Google Calendar directly. Delivery decoupling: **ingestion ships independent** (paste/API lands it); calendar identity is **enrichment that trails per tenant**, with graceful fallback to name-only matching. Nylas cost ≈ **$1.50–2/connected account/mo** (per-client, **our** cost vs Fathom = client's), ~$153/mo at 100 clients — <1.5% of revenue.

7. **Build-env decision: main is OK here.** Backend-only, additive, single-user (Guy) → **main acceptable** (avoids env-swap friction Guy dislikes). Protection comes from the **design, not the environment**: additive (new route → existing store, Recall untouched) + **kill switch** (`FATHOM_INGEST_ENABLED`) + **parallel-run** (Fathom shadows Recall until trusted). **One guardrail:** gate any *schema change* on the `staging` Postgres schema first (it already exists in the same DB). Retire Recall only after Fathom earns trust — no big-bang cutover.

8. **Status (corrected 2026-06-15) — the pipeline is already BUILT (2026-06-13), not pending.** `services/fathomIngestService.js` + `services/fathomSplitService.js` + the `google|nylas` `services/calendarProvider.js` are committed, additive, kill-switched (`FATHOM_INGEST_ENABLED` off), and dry-run-proven — including the **Nylas multi-tenant calendar path on Guy as client #1** (split a 93-min lump into 3 segments, all leads matched by email Nylas supplied). **Remaining = go-live only:** (a) store Nylas creds on Render; (b) build the trigger (lean poll → Fathom webhook later); (c) one real write-path test (`FATHOM_INGEST_ENABLED=true`, ingest one meeting, confirm row, delete); (d) switchover (Fathom on / Recall off, reversible).

---

## Fathom API — live verification + back-to-back finding (2026-06-12, session 2)

Ran the read-only Fathom check against Guy's real account. Two big outcomes: STEP 1 is
effectively already done, and the back-to-back lumping is a **confirmed** problem (not
dissolved by Fathom, as session 1 had hoped).

**0. Reconciliation — the Fathom read path ALREADY EXISTS in production.** The migration's
"STEP 1: prove Fathom API returns transcript + attendee data" is effectively complete — it's
shipped and running:
- `services/smartFollowUpService.js` → `fetchFathomTranscripts(email, fathomApiKey)` calls
  `https://api.fathom.ai/external/v1/meetings` (`X-Api-Key`, `include_transcript=true`,
  90-day window), then **filters by `calendar_invitees[].email` == lead email** — email-keyed
  matching already implemented. Powers **Smart Follow-Up** + **Meeting Prep** (`docs/MEETING-PREP-FEATURE-HANDOVER.md`).
- `services/clientService.js` loads a per-client **"Fathom API Key" from Airtable Client Master**
  (so the key is NOT an env var — it's in Airtable; that's why it isn't on Render/in env).
- `scripts/fathom-inspect.js` = existing read-only diagnostic probe (same purpose).
- ⇒ "no ASH code written yet" was stale re: the Fathom *read path*. The ASH **ingest/platform**
  (landing Fathom into the `recall_meetings` store) is still unbuilt — that's the real STEP 2.

**1. Live shape confirmed (every meeting reliably carries what ingest needs).** Per-line
transcript `{ timestamp, speaker.display_name, text }`; `title`; scheduled + recording
start/end (duration derivable); `calendar_invitees[]` (name, email, email_domain, is_external);
a rich **`default_summary`** ("Enhanced" markdown + timestamped share links) + `share_url`.

**2. One unreliable field — and it's non-load-bearing.** `speaker.matched_calendar_invitee_email`
is often **null** for the external lead (and `invitee.matched_speaker_display_name` too). Doesn't
matter, because we don't need it: **lead-link** routes through `is_external` invitee **emails**
(reliable), **speaker labels** use `display_name` (reliable). Treat the per-line email match as a
bonus, never a dependency. Notes: one person can appear as **multiple invitee emails** (try ALL
external); **near-empty transcripts exist** (e.g. a 2-line capture) → degrade gracefully.

**3. ★ BACK-TO-BACK LUMPING — CONFIRMED PROBLEM (the headline).** Tested against the 11 Jun trio
(Tom Butler 11:00 → Alfred Lee 11:30 → Hrishekesh Shinde 12:00), all in Guy's Zoom **Personal
Meeting Room** (`/j/9892817976`). Fathom produced **ONE recording** (`154133762`), labelled
*"Tom Butler"* (first call only):
- window **11:01 → 12:34 = 93 min**; transcript **1202 lines** spanning `00:00:02`–`01:33:13`;
- distinct speakers = **Guy + all three leads** (Tom, Alfred, Hrishekesh);
- **Alfred & Hrishekesh have NO own recording, are NOT invitees, and have NO email anywhere in
  Fathom** — they exist only as spoken-name labels inside the transcript.
- ⇒ Same failure shape as Recall (PMI room reuse). Fathom keys recordings to the *room session*,
  not the calendar event. **The splitter is required, not dissolved.** (Corrects session-1's
  optimistic read — the 10-meeting sample simply hadn't exposed a true same-room back-to-back.)

**4. SOLUTION (decided) — calendar-anchored Fathom splitter, reusing the existing skeleton.**
`services/recallAutoSplitService.js` already does back-to-back splitting for Recall: reads the
coach's Google Calendar for the recording window, detects multiple events, handles no-shows,
cuts into one child transcript per appointment linked to the right lead. **Reuse that skeleton.**
The one adaptation: Recall cuts on participant **join/leave presence** events (Fathom doesn't
provide these) → the Fathom splitter cuts on **calendar-event windows + speaker-name transitions**,
using **absolute line time = `recording_start_time` + line `timestamp`** to place each line in its
event's window, then snapping the boundary to where the external speaker changes (Tom→Alfred→Hrishekesh).

**4b. SPLIT SPIKE — PROVEN on the real 93-min lump (read-only, 2026-06-12).** Ran the algorithm
against recording `154133762`. Speaker-transition detection found all three handovers precisely
(first-speaks 11:01:48 / 11:34:55 / 12:04:07 vs scheduled 11:00 / 11:30 / 12:00) **despite every
call running ~5 min over** — segment 1 even ended on Guy's own handover line ("But Alfred, why don't
you tell us a bit about yourself…"). A time-only cut would have mis-sliced; the speaker-snap fixed it.
The only "leakage" was **participant overlap** — Tom stayed talking into Alfred's slot (39 lines),
Alfred into Hrishekesh's (20) — because this was a rolling **group intro**, not isolated 1:1s. Not a
boundary error; Fathom simply has no "left the call" signal (Recall had leave-events). Boundary
detection itself: clean.

**4c. DECISION — overlap accepted; serial cut only (2026-06-12, Guy).** Do NOT build leave-detection
or spillover-stripping. A few (even 5-10) minutes of the previous person's tail at the end of a
segment is fine: each segment is majority-correct and every line is speaker-labelled, so it's obvious
when reading/analysing. Purpose is call analysis + follow-up drafting, not forensic precision. ⇒ the
Fathom splitter is just: order meetings from calendar → cut at each speaker-transition → done. Fewer
moving parts, more robust. (A clean back-to-back where one person leaves before the next joins would
show ~zero leakage anyway; the group-intro case tested here is the hard end and the cut still held.)

**5. This promotes two things from "nice-to-have" to REQUIRED for back-to-back users:**
- **Calendar read is load-bearing** — without it you can't even know there were N meetings, let
  alone where to cut. Google today → **Nylas per-tenant** for multi-tenant (the doc's flagged residual).
- **Airtable name-fallback is load-bearing** — this is the case that proves it. Alfred & Hrishekesh
  have no email in Fathom at all; the only way to turn a spoken "Alfred Lee" into a lead+email is the
  calendar event's attendee, or — where the calendar isn't wired — **Airtable by name** (with a
  confidence flag; flag-don't-guess on ambiguity).

**6. Bonus decision to weigh at ingest time (OPEN):** Fathom already returns a polished
`default_summary` → consider using it **directly** instead of regenerating via
`services/recallSummaryService.js` (AI-cost saving). Decide when wiring ingest.

**Run note (for future read-only checks):** the Fathom key lives in Airtable Client Master, and
Airtable creds live in the Render env group **"Authentication & API Keys"**. A local read-only run
= source those creds (Render API), let `scripts/fathom-inspect.js` resolve the Fathom key from
Airtable itself. No env-var sync needed.

---

## Speaker reconstruction on transcript ingest (paste path) — single-speaker / no-diarisation (2026-06-18)

> **Origin:** a real Guy call (Alicia Rieniets / Alisdair, 18 Jun 2026). Meant to be Zoom; the guest
> couldn't get Zoom working so they jumped to **Teams**. **Zoom Notes** auto-captured it anyway (its
> bot-free feature records Zoom, Teams AND Google Meet — a genuinely useful fallback), **but with no
> speaker diarisation**: the whole transcript came through labelled as the host, and the auto-generated
> notes **reversed the key introductions** (read "Guy to introduce Alicia to Bill Lang / Robeline" when
> in fact Alicia was introducing Guy to both, and Guy was introducing Alicia to his son Tom). Gist was
> fine; the things that matter (intros + direction, who-knows-whom, commitments) were not trustworthy.
> **This is the universal-paste path's blind spot**, distinct from the Fathom back-to-back *lumping*
> problem above — see transcript-layer item 5 (universal paste / `insertImportedMeeting`).

**The problem.** Capture tools that record *across* platforms (Zoom Notes / Tactiq → Teams/Meet) export
**without diarisation — every line tagged as the host.** Both sides' words are present, but who-said-what
is unreliable. Storing that silently means the high-stakes lines (intro direction, recognition, commitments)
are quietly wrong. **In multi-tenant this is not an edge case** — every tenant will hit it on any non-Zoom
call, and a non-expert VA/Mr Busy can't eyeball-correct it the way Guy can.

**Proposed flow (NOT yet spec'd — discuss before building):**
1. **Source dropdown on the import front-end** — user picks the transcript source (Fathom / Zoom Notes
   (Tactiq) / other) so the parser knows the format + quirks to expect. *(Ties into the existing
   "thin source-mapper per provider" seam — item 5.)*
2. **Single-speaker detection on ingest** — automatically detect when a transcript arrives with only one
   speaker label, instead of storing it silently.
3. **AI reconstruction** — when single-speaker (or otherwise dodgy) is detected, rebuild speakers from
   content using topic anchors + conversational logic.
4. **Human-in-the-loop confirm step (the critical one)** — after reconstruction, surface a card: *"The
   original transcript was a bit dodgy and I've done my best to fix it — it may not be quite right. Can you
   check it first?"* User confirms/corrects the key points **in chat** (especially intros + their direction,
   and recognition lines like "I know her"). **Only the human-confirmed version is stored as canonical.**
5. **Pre-read / let-it-through path** — if the incoming transcript already has clean speaker labels, read it
   first and pass it through **without** forcing the confirm step. The confirm step fires *only* when
   reconstruction was actually needed.

**Underlying principle.** Ground truth can't be automated — the person who was in the room is the only
reliable source for the high-stakes lines. AI does **detection + reconstruction**; the human **confirms
direction**. That division is the feature.

**Fit with what exists (verified in code 2026-06-19).** The universal paste path is **more built than this
note implied**: `services/recallImportService.js` → `importTranscript()` already takes a **`source`** param
(tactiq | fathom | other) with a per-source cleaner (`normalizeTranscript`), links the lead by email with
graceful warnings, and **generates a Gemini summary inline so the user lands on a fully-populated review page**
(`recall-review`). So this is **not build-from-scratch** — the gap is the trust layer on top.

**Spec refinements (2026-06-19 — discussed + locked; this is now the chosen NEXT BUILD):**
- **Always show the confirm card; reconstruct on detection-or-demand.** Don't auto-run a heavy speaker-rebuild
  on every paste — rebuilding an already-clean transcript risks *introducing* errors. Instead a cheap
  **single-speaker detection runs every time (plain code — count distinct speaker labels, NO AI)**;
  reconstruction auto-fires only when detection flags it; a **"run another pass" button** is the manual
  escalation when detection passed but the human still spots something off (Guy's original instinct).
- **Free-text correction, the human's words win.** The confirm card is NOT read-only — Guy types the fix in
  plain language ("no, Alicia introduced me, not the other way round"); AI applies it and re-renders. A single
  correction usually reveals a **systematic swap**, so the AI **propagates the fix across the whole mislabelled
  stretch**, not just the one line.
- **Surface only the high-stakes lines, not the whole transcript** (cf. [[feedback_avoid_overwhelming_lists]]):
  intro direction, who-knows-whom, commitments. The Alicia failure was the *summary* reversing intro direction
  — so reconstruction must re-derive the summary/direction and **regenerate the summary off the corrected
  transcript** afterwards (garbage-in was the root cause).
- **AI vs no-AI split** (decides where cost lands): **NO AI** → paste, format-clean, lead-link-by-email,
  single-speaker detection, store. **AI** → summary (today, Gemini), speaker reconstruction (new), high-stakes-
  line extraction (new), the re-run button. The expensive rebuild only ever runs on flagged transcripts —
  low-volume + human-gated by design; the *decision* to spend on AI is itself free (the detection is plain code).
- **Model = Claude, not Gemini Flash.** Reconstruction + getting intro *direction* right is a *reasoning* job,
  not the cheap classification Flash is for. Per the canonical "Claude drafts / Gemini scores" seam this is the
  Claude lane: use a strong model (**`claude-opus-4-8`**; `claude-sonnet-4-6` the cheaper step-down), **adaptive
  thinking**, and **stream** for long (90-min) transcripts. Cost is a non-issue (rare, one-per-meeting,
  human-gated). Keep Gemini Flash for the high-volume scoring.
- **Prerequisite: wire Claude into the backend first** (none today). See journal **"Wiring Claude into the
  backend + AI-provider audit (2026-06-19)"**. This feature is the first concrete consumer of that seam.

Orthogonal to the Fathom splitter (that solves *lumping* of well-diarised recordings; this solves *missing
diarisation* on pasted ones). **STATUS: spec'd 2026-06-19 → NEXT BUILD, gated on wiring Claude; no code yet.**

---

## Wiring Claude into the backend + AI-provider audit (2026-06-19)

> Origin: planning the speaker-reconstruction build (section above) surfaced that the reconstruction step needs
> a *reasoning-grade* model — which raised "is Gemini Flash enough?" (no), "what's involved in adding Claude?",
> and "we run three AI providers — should we consolidate?". All planning; no code this session.

### Claude is not yet wired — and it's a SMALL job (much less than Gemini was)
- **Today:** Gemini runs via **Vertex AI** (`config/geminiClient.js`) — needs GCP project + location + a
  **service-account JSON secret file** on Render + a fiddly dated model string (`gemini-2.5-pro-preview-05-06`).
  That auth setup is exactly what made Gemini a faff. OpenAI is wired via a plain API key
  (`config/openaiClient.js`). **No Claude client exists.**
- **Adding Claude is easier than Gemini was**, because the hard part (Vertex auth) simply isn't there:
  1. **One env var** — `ANTHROPIC_API_KEY` (same shape as OpenAI). No cloud project / location / key file.
  2. **One package** — `npm install @anthropic-ai/sdk`.
  3. **A tiny `config/anthropicClient.js`** mirroring the Gemini one but shorter (no project/location/creds).
  4. The call: `client.messages.create({ model, max_tokens, messages })`.
- **One new account:** an Anthropic **API/developer** account at console.anthropic.com + a card (separate from
  any claude.ai chat sub). ~10 min — the only genuinely new setup.
- **Model IDs are clean/stable** (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`) — none of
  Gemini's dated-preview-string pain. Make the model **env-switchable** (like `RECALL_SUMMARY_MODEL`).
- This is the **first concrete Claude wiring behind the long-planned "swappable seam"** (see "AI / model
  layer"). The bigger later Claude surface (post-call email drafting) reuses the exact same client.
  **Effort: an afternoon**, most of it the one-time account/billing.

### Provider end-state — three providers, three jobs, nothing to migrate
Audited what actually calls AI in the live code:
- **Gemini (Vertex)** — high-volume **lead scoring** (`batchScorer`/`singleScorer`), **meeting summaries**
  (`recallSummaryService`), **Smart Follow-Up / Meeting Prep** (`smartFollowUpService`), outbound-email
  scoring, email parsing. The cheap workhorse. **KEEP** — the canonical seam already wants Gemini for scoring.
- **OpenAI** — powers the portal's **"Start Here" help assistant**: a per-topic **Q&A chat** (`/api/help/qa`,
  called from `start-here/page.tsx`) doing **embeddings retrieval + `gpt-4o-mini` escalation**, plus a topic
  **layout formatter** (`generateLayout`). **Live + user-facing, NOT dead code** (verified: routes mounted,
  frontend calls them, gated on by default). Critically the core is **embeddings, which Claude has NO
  equivalent for** — so it *can't* move to Claude (would need Voyage or similar). Cheap + peripheral. **KEEP.**
- **Claude** — NEW drafting/reasoning (speaker reconstruction now, post-call email later). **ADD.**
- **Decision: do NOT consolidate to one.** Three feels messy, but they're three genuinely different jobs, one
  of which (embeddings) Claude literally cannot do. "Let sleeping babies lie" — confirmed with evidence, not vibes.
- **Aside worth remembering:** the help-Q&A RAG is the closest *existing* thing to the future "Wingguy reads
  the knowledge base" idea — a **prototype to learn from**, not legacy to rip out (ties to the website section's
  "WordPress = single source of truth, Wingguy reads it via authenticated REST").

---

## Website + content strategy, and the one-connector / auth path (2026-06-17)

> Origin: JB's onboarding call (2026-06-17, 09:30). JB was blunt about Guy's public WordPress
> site — *"it worried the shit out of me… I thought I'd signed up for an MLM… felt hokey and
> disjoint… if I'd seen it before I talked to you I'd never have talked to you."* That triggered
> a rethink of what the website is FOR, how it relates to the Portal + Wingguy, and (downstream)
> how a client's own Claude connects to Wingguy. **Planning only — no code this session.**

### Website's job = credibility + conversion, NOT lead-gen (2026-06-17)
- Old vision (SEO/inbound lead-magnet → a sellable asset) is **dead by reality vote** — Guy's proven
  funnel is outbound LinkedIn → discovery call → relationship. Age 74 + wants cash flow now, not a
  slow-compounding saleable property. Stop asking the site to *generate* demand.
- **New job:** catch people Guy has *already* reached out to, and don't lose them. (1) don't turn them
  off (no weird/stale/MLM-vibe stuff); (2) confirm he's a real, substantial operator; (3) give genuine
  value (the visit itself demonstrates the help); (4) make the next step (the call) easy.
- **One-line test for every page:** *would this make a skeptical, intelligent prospect who already
  heard from Guy relax — or reach for the back button?* (= "would JB relax, or bounce?")
- JB is **proof, not just opinion:** he became a client only because he talked to Guy BEFORE seeing
  the site. One high-signal target-profile data point > a vote count. "MLM" is a **silent killer** —
  bouncers never tell you, so "no other complaints" is NOT reassurance.
- **Calibration (Guy):** not panicked, not bleeding many sales — a **low-burn, compounding** fix, built
  slowly between sales work. Act, don't drop everything.

### Content lives once, surfaces twice — WordPress as the source of truth (2026-06-17)
- **The inversion to fix:** Guy's *credible, valuable* material (Portal "Start Here" → "Perspective &
  Leadership": *Play a Different Game, The Evaporation Problem, The Science Behind a Small Network…,
  The Champion Model*) is **trapped behind the Portal login**, while the *MLM-smelling* stuff is what's
  public. Backwards for the funnel.
- **Model: one source, two surfaces.** WordPress = single source of truth; **visibility = a per-page
  flag**: public (credibility/prospects) / hidden-but-Portal-readable (Wingguy reads via authenticated
  REST API) / both. Author once in WordPress; Portal + Wingguy *consume* it. No duplicate "AI knowledge
  base" — the published pages ARE the knowledge base; edits propagate live.
- **The cut line solves three things at once:** worldview/"why" content → **public** (builds authority,
  gives nothing away); operational machinery/"how" (the IP JB worried was exposed) → **Private**
  (WordPress Private status = gated, Wingguy still reads it, public can't). Match protection to
  sensitivity: *unlisted* = obscure-not-secure (fine for drafts); *Private* = real gate (IP).
- Portal "Start Here" stays **lean + operational** ("how to use it this week"); the growing essay
  *library* belongs on the website (a publishing surface, not onboarding). This also answers Guy's
  "how do I expand Perspective & Leadership without it getting too big" — it **graduates to the site**.

### Surfacing content: pull (reactive) vs push (worldview) (2026-06-17)
- Two classes, two delivery modes:
  - **Reactive** (task-tied) = **pull**: the user's action is the trigger (Follow-Up Manager → *The
    Evaporation Problem*).
  - **Worldview** (foundational, e.g. *The Science Behind a Small Network*) = **push**: it has **no
    natural trigger** — nobody types anything that surfaces it. Don't make it wait for one.
- **Wingguy manufactures the trigger** for worldview content: (a) offer the question as a **suggested
  prompt/chip** ("Why is Wingguy targeting so few people? →"); better (b) **let the idea ride on the
  action's justification** — when Wingguy makes the small-network move it explains it in one line, essay
  as optional deep-dive. The justification IS the trigger; the user never has to know to ask.
- **Don't bet on full readership.** Busy people won't read long essays. Essays earn their keep two
  other ways: (1) **existence = credibility** (an 8-second skim signals depth); (2) **reservoir** —
  Wingguy distils each into one-line hits delivered in-context. Full essay = opt-in for the curious 10%.
  ⇒ the website essays *are* Wingguy's knowledge base, also published for credibility. Same asset.

### Build complexity — simple MVP; the real work is editorial (2026-06-17)
- v1 = three small things on top of what already exists (content store + backend + users + extension):
  **(1)** a **tagging pass** (reactive vs worldview + a one-line distillation per essay) — editorial;
  **(2)** a few **suggestion chips** fired by context/stage; **(3)** inline one-liner + a link out.
  Degrades gracefully — ~80% of value from the dumb version. Personalisation/adaptive-depth = optional
  polish, resist first.
- **"Don't re-serve consumed content" = the EASY part:** one per-user record `(user, content_id,
  surfaced_at, clicked?)`; skip on push if engaged. Rule = "don't *push* what they've consumed" (keep it
  revisitable); track *surfaced/clicked*, don't model "truly absorbed".
- **Link vs seeded-chat = layer by depth, don't choose:** inline distillation (first) → "read the full
  piece" static link (first; credibility) → "Ask Wingguy about this" **seeded chat** (Phase 2 — pre-load
  the page as context; right medium because worldview invites "yeah but my situation?").
- Genuine complexity is **editorial** (chunk/distil/tag each essay), not engineering — and it's
  distillation of stuff Guy already wrote, one piece at a time (fits the slow pace).

### Free-Claude wedge + the ONE-CONNECTOR design (2026-06-17)
- Reframes the already-locked **"Client AI requirement = Claude"** decision from defensive ("like
  requires Chrome") to a **growth wedge**: start on **free Claude** → hooked → upgrade. The right buyer
  (AI believer, values their time, sees a good demo) is easy to sell.
- **Free Claude is more capable than feared (checked 2026-06-17):** DOES support connectors / remote MCP
  (incl. **one** custom connector), Sonnet 4.6, web search, memory, file creation. Binding limits =
  **usage** (~15–40 msgs / 5-hr window — third-party figure), the **1-custom-connector cap**, **no
  Opus**. ⇒ upgrade trigger = **volume** (you outgrow free *because it's working*) — the honest wedge,
  not paywalled basics.
- **★ Design unlock: deliver Wingguy as ONE remote MCP connector** (the server exposes all tools —
  availability / draft / transcript / follow-up / portal / teach-rule / fetch-article — behind a single
  connector). Fits free's 1-connector cap → a free user tastes the **real connected** experience.
- **A bonus, not a difficulty:** the architecture already funnels everything through one backend; "one
  connector, many tools" is MCP's natural shape; and **we've already shipped an MCP server**
  (`mcp-recall-transcript`, currently **stdio/local**). Only real work = make it **remote +
  multi-tenant** (hosted, per-tenant isolation) — the core multi-tenant build we owe anyway.
- **Scope guard:** the connector is the **cockpit / client's-own-Claude** surface (chat; techy/DIY/
  free-tier taste). It does **NOT** replace the fixed-button **extension panel** (the no-thinking VA
  flow). Two surfaces, one backend brain.

### Connector auth — no OAuth nightmare; bolt-on provider; free at our scale (2026-06-17)
- Guy's scar = **Google-verification OAuth** (restricted-scope review, brand checks, expiring
  third-party tokens). That flavour is **already outsourced to Nylas** and is NOT coming back.
- **Claude's connector UI today supports only authless OR OAuth** — **no** user-pasted API key / bearer
  / custom header (open feature request `anthropics/claude-ai-mcp` #112). So "paste a key" isn't
  available yet.
- The OAuth the connector needs is **"log into YOUR app, Wingguy"** — *you* are the authority: no
  external review board, no approval queue, no Google. And **you don't hand-build it** — bolt on a
  managed provider that does the MCP OAuth 2.1 dance (DCR / RFC 8707). **Same move as Nylas, one door
  over.**
- **Recommended provider: WorkOS AuthKit** (MCP-native; **free to 1,000,000 MAU**). Backups: **Scalekit**
  ("drop-in OAuth for MCP servers"), **Stytch Connected Apps** (free to 10k). Clerk (50k free) / Auth0
  (~25k free) also fine. **At ~30 clients every option is $0** — cost is a non-issue for years.
- **Who logs in = the CLIENTS (+ their VAs)**, each as themselves, into Wingguy — can be **"Sign in with
  Google"** (no new password). Guy sets it up **once** (landlord installs the door). The bill counts
  logged-in clients (~30) → free.
- **Two doors, don't conflate:** (1) *log into Wingguy* → the auth provider; (2) *connect calendar/email*
  → **Nylas**. Different specialists.
- **Persistence: log in once, set-and-forget.** Silent background token refresh; clients re-auth only on
  deliberate disconnect, an account security event (password reset), or long-term total inactivity — a
  daily user never hits it. Keeping the connection alive = the provider's job (kills the old "tokens
  silently die" failure).
- **Free-taste shortcut:** the free/demo connector can be **authless** (non-private magic — distil
  articles, draft from pasted text, score a pasted profile) → zero auth, fastest "wow"; add the bolt-on
  login only when the connector reaches **private** per-client data.

### Keeping Wingguy directives in Wingguy, not the client's general Claude memory (2026-06-18)
**The worry:** client sits in their *own* Claude (the connector/cockpit surface), so when they tune a
Wingguy behaviour ("from now on greet leads by first name", "never put price in the first email") that
instruction could land in **their personal Claude memory** instead of in Wingguy — where it'd be invisible
to us, not shared across their staff/VA, not under our schema, and just clutter in their pile (the original
"memory filling up" fear). This is the same Layer-2-vs-Layer-3 split: *vendor base rules (ours, baked in)* →
*client org tuning (theirs, shared)* → *personal memory (theirs, private)* must stay as **layers, not one
bucket**.
- **You CAN'T technically forbid it.** Claude's native memory is Anthropic's, lives in the client's own
  Claude, outside our reach. Building a wall to *prevent* leakage is unwinnable — don't try.
- **★ The reframe that wins instead: make Wingguy DEAF to general memory.** Wingguy's behaviour is driven
  **only** by what's in its own store (the Postgres rules — see "Data architecture"). The server-side
  context is built **solely** from our store; it never reads the client's personal Claude memory. The
  instant that's true, a leaked copy in general memory is **inert** — Wingguy doesn't look there, so it has
  zero effect on behaviour. The question flips from the hard one ("stop leaks" — unwinnable) to the easy one
  we already own ("make sure the real changes land in Wingguy").
- **Own the save-path with a tool.** This is the existing `teach-rule` tool / the one conflict-checked
  **Commit write-door** (see "Rules editing UX" + "Rules integrity = code"). A Wingguy behaviour change is
  only *real* when that tool writes it to the tenant's slice. The leak-vs-save problem reduces to: keep that
  write-door solid (already designed).
- **Tool description does the routing.** The lever that makes Claude route a "from now on…" to the tool
  instead of native memory is an **assertive tool description** that claims the territory, e.g.: *"Use this
  whenever the user wants to change how Wingguy handles scoring, emails, templates, or any Wingguy
  behaviour. Always persist Wingguy configuration here — never store it in conversation memory."* Claude
  leans hard on tool descriptions for routing; this is the single biggest bias lever.
- **Self-reinforcing, so policing isn't needed.** A rule saved to Wingguy *takes effect*; one muttered into
  general memory *doesn't* (deaf design) → clients learn the difference without us policing. Worst case of a
  leak = a harmless no-op, not a corruption.
- **One habit to train at onboarding:** the verbal tell — *"to change how Wingguy works, say 'Wingguy, from
  now on…'"* — nudges Claude toward the tool. Even when forgotten, the deaf-to-memory design makes the
  failure mode benign.
- **Concrete to-do:** (a) ensure the server-side Wingguy context is assembled **only** from our store, never
  attempting to read the client's Claude memory; (b) make the `teach-rule`/Commit tool's description
  aggressively claim ownership of Wingguy config. Those two close the issue.

---

## Competitive position & the scaling model to ~50 clients (2026-06-17)

### Competitive position — own the niche the giants won't serve (2026-06-17)
- **The components are commoditised, and that's fine.** AI drafting, LinkedIn automation,
  call-recording→CRM, lead scoring — all crowded and getting cheaper (the naming search hit
  Clari/Wingman, Remi, etc.). Wingguy is **NOT first or alone** at "AI helps with outreach +
  follow-up." Don't claim "market-leading" in the broad sense — it's false and a search proves it.
- **The differentiation is the PACKAGING, not any single capability:** a high-touch, done-with-you,
  per-client-tuned managed service that stitches the WHOLE loop (outreach → call → follow-up → book →
  CRM) into one accumulating assistant, for a specific **non-technical niche** (brokers / financial
  planners). Rare for a *structural* reason — **it's deliberately un-VC-friendly**: needs a human in the
  loop, doesn't scale to millions, nobody funded wants to hand-hold 30–50 one-man-bands.
- **Reframe the claim:** not "lead the market" (wrong goal for cash-flow-now + ~50 clients) but **own a
  niche the market leaders structurally refuse to enter.** Category-of-one in a corner no one big will
  fight for — a *better* place to stand for Guy's goals than market leadership.
- **Moat = depth + trust + early, NOT novelty** (novelty is copyable): accumulated per-client tuned
  state + the relationship ("I know a Guy") + being early + niche focus.
- **Wildcard to watch (don't ignore): does the platform eat the product?** Claude/ChatGPT are getting
  agentic + connector-rich (this very build rides Claude connectors). A techy user could approximate
  slices. **Defence holds** — the buyer is non-technical *by definition* and won't assemble it; the
  tuned state + done-for-you wrapper is exactly what raw Claude doesn't give them. Watch, don't fear.

### Scaling to ~50 without it killing Guy — three levers; a self-assembling intro-mesh is the third (2026-06-17, refined)
- **The binding constraint is Guy's time** (his own "Mr Busy" problem — see bottleneck notes above).
  Scaling = trend *per-client* Guy-time toward zero. Three levers, all required:
  1. **Product self-improves** → less coaching over time (the accumulated-state flywheel). *(have)*
  2. **Onboarding productised** → setup shrinks (guided setup, auto-fork rules, one-click connects). *(have)*
  3. **★ Client intro-mesh (Wingguy-seeded), NOT a community Guy runs** → support + retention + referrals
     trend toward **self-sustaining**. *(NEW)* Flips retention & growth from **Guy-powered to self-powered**.
- **★ HARD CONSTRAINT (Guy, 2026-06-17): NO recurring meetings.** Guy ran weekly networking meetings for
  years (in-person AND online) + did enormous manual matchmaking — it's a **grind he refuses to return to**.
  So the third lever is explicitly **NOT** a central community he hosts/moderates (that earlier framing is
  superseded). It's a **mesh he seeds and steps out of**: 1:1 introductions, members expected to build their
  own groups. **Separate the grind from the gift** — shed the *labour* (meetings, chasing, facilitation);
  keep the *introduction itself* (high-value, low-labour — literally the "I know a Guy" brand).
- **THE lever that keeps it light: Wingguy is the matchmaker; Guy just approves.** The old "enormous work"
  was three jobs — *spot* who should meet, *draft* the intro, *manage* follow-through. Wingguy takes the
  first two (Portal network data → **suggest matches**; drafting engine → **write the double-opt-in intro**);
  Guy is left with a one-click judgment call. Load drops from *facilitate* to *approve a draft*. Built on
  existing rails (drafting + Portal data) — not new infrastructure.
- **Other lightness levers:** (a) **double opt-in** intros (ask A, then B, then connect — templated; avoids
  bad-match cleanup that ADDS load); (b) **pay-it-forward norm** baked into the deal — every client is
  expected + equipped (by Wingguy) to make their OWN intros → the mesh grows without Guy (the Champion
  mechanic pointed at *connections*, not just sales); (c) **async "who should you meet" nudges** replace the
  meeting — Wingguy surfaces 1–2 worth-meeting people; they request → Wingguy drafts → done; (d) **find
  natural connectors, don't manufacture them** — most people WON'T build a group (fine); spot the few who
  love it (Wingguy can see who intro's most) + amplify them.
- **The belonging trade (resolved — a GOOD trade for THIS buyer):** a mesh has weaker *emotional* belonging
  than a hosted community → thinner "tribe" moat. But that's a moat **this buyer barely values** (time-poor
  brokers/planners want results + hours back, not a tribe). We swap it for **economic/relational
  stickiness**, and the weight is carried elsewhere:
  - **The real moat (accumulated tuned state) is untouched** — community was always only the *second* moat.
  - **The mesh creates its own rational lock-in:** *"this is where my next valuable connection comes from."*
    To leave = abandon the tuned asset + unplug the connection pipe + re-train a new tool (triple switching cost).
  - **The one thing belonging does better — organic word-of-mouth — is already covered** by the deliberate
    **Champion referral mechanic** (don't lean on tribe-buzz for growth).
  - **Cheap recovery of some belonging:** a *very light* shared-identity layer — a name for the network +
    the occasional "X & Y met through this and did Z" success note. Buys belonging with **zero meetings**.
- **Honest cautions:** (1) **don't bet the scaling relief on clients becoming group-builders** — rare;
  design so the **mesh delivers value to passive nodes too** (a client who never builds a group but gets
  good intros is still getting value + still sticky). (2) **Keep the wedge:** v1 = ONE mesh in the
  homogeneous niche; "network of networks / facilitating across other groups" = LATER expansion (don't build
  the cathedral before the chapel fills).

---

## Economics, time-load & targeting — the path to ~100 clients (2026-06-17, session 2 cont.)

> Continues the competitive/scaling thread above — unit economics + how Guy actually runs ~100
> clients on ~3 days/week. **Planning only — no code.**

### Ideal client = FREQUENCY-OF-USE, not job title (2026-06-17)
- Stickiness predictor is **behaviour, not title:** *"is consistent outreach / relationship-building a
  recurring, valued part of their week that they struggle to do reliably?"* High-frequency use → deep
  accumulated state → sticky → "don't take it away."
- **Bullseye:** insurance brokers, financial planners — relationship-building IS the daily job.
- **Fractionals split** (not one segment): (a) **time-starved fractional who values consistency** = GREAT
  target — "busy" is a *feature* (pain = "I never get round to it"); (b) **fractional for whom outreach is
  peripheral** = weak — low frequency → thin state → less value/mo → price-sensitive + churnable.
- **Scoring implication:** filter on *frequency-of-use intent*, not just "broker = yes". Keep the core ICP
  tight; let the right fractionals in but don't let the adjacent segment dilute the wedge.
- **Cheapest retention = not signing the wrong-fit client.** Selection is half the stickiness battle.

### What actually drives results — friction-removal, the right outreach, NOT prose polish (2026-06-30)
> The honest causal model under the stickiness thesis. Sharpens **Stickiness vision** + **ACTIVATION is the
> real job** with what results actually come from — and the give-first strategy that produces them.

**Value = friction-removal, not eloquence.** The barrier for a busy operator was never "my messages aren't good
enough" — constructing a thoughtful personalised message per person is mentally expensive, so it doesn't get done,
or gets done in bursts then stops. The AI makes the task cost ~nothing → it happens **consistently** → consistency
is the real results channel. It also raises the quality **floor** (a tired human at 9pm sends generic; the AI sends
consistently-personalised regardless of operator state) — for a busy operator the floor + low variance beat peak
eloquence.

**Results-driver hierarchy (honest order):** targeting/list → offer/reason-to-care → credibility →
persistence/consistency → **then** message craft. Eloquence is a *second-order* lever on the COLD reply rate;
strongest at (a) clearing the spam / "delete-on-sight" filter via genuine personalisation and (b) converting
ALREADY-ENGAGED threads (reply-handling is far more quality-sensitive than the opener). The quality jump Guy *feels*
reading an Opus draft exceeds the jump the *recipient* feels — felt-quality ≠ results-quality.

**★ Mis-attribution is the trap + measure to beat it.** Believing "the magnificent messages win" risks
under-investing in what moves the needle more — targeting, offer, the strategy/coaching layer, and consistency (the
VA's real gift). Fix by making results **attributable**: track reply + booking rate per client vs a baseline.
Payoffs: (1) learn where lift truly comes from (eloquence vs consistency vs coaching); (2) "your reply rate went
X→Y since we started" is the strongest stickiness lever — **attributed results stick; ambient quality doesn't.**
(Distinct from the AI eval/regression "measurement" gap noted ~line 895; this is outreach-results attribution.)

**Give-first thesis — why it's the first-order lever.** Reach out based on "what they DO / how I could promote
them", NOT "what they HAVE" (extractive). It works *because Guy's business is structurally reciprocal* (a
mutual-referral network) — so give-first is **congruent with the real offer, not a manipulation tactic**; that
congruence is why it doesn't read as a trick. Three tensions to hold: (1) **AI-at-scale knife-edge** — give-first
inverts into a *tell* if it goes formulaic → raises the stakes on "interpret, don't parrot / real details only"
(the give-first bet and the grounding discipline are the same bet); (2) **must go somewhere** — give-*first* with a
credible two-way frame + gentle ask, not give-*only* that converts nobody; (3) **slower, compounding,
less-attributable funnel** → a client-expectation job ("this builds, it doesn't spike") — the thing most likely to
wobble an impatient client in week 3. This is where evangelism energy belongs, above prose polish — the prose only
*expresses* the intention; intention + targeting is what wins.

### Onboarding = relationship investment, delegated; ACTIVATION is the real job (2026-06-17)
- Reframe: onboarding time isn't pure cost — it **builds the trusted relationship** that itself drives
  retention. Investment with a return, not overhead.
- **Delegate the labour, keep the brand:** a people-skilled VA carries the bulk; Guy **drops in briefly**
  for the high-value touch. **Anchor trust to "Guy's system / Wingguy", NOT the individual VA** → a VA
  change is a new face, not a lost relationship (kills relationship-layer key-person risk). Same
  "separate the grind from the gift" principle as the intros.
- **The catch: relationship is the WRAPPER, activation is the ENGINE.** "Don't take this away from me"
  only fires for clients who *actually use it + get results*. A warm relationship with an unactivated
  client still churns. ⇒ onboarding's #1 job = **drive USE to felt-value**, not rapport. Measure "using
  it + getting results in the first weeks", not "did they enjoy onboarding".
- **"Onboarding is cheap" is TRUE — but conditional on low churn.** Heavy onboarding is justified by the
  stickiness it produces; heavy onboarding + leaky retention = the worst quadrant.

### Sequencing — stage the REVEAL, but don't drag out ACTIVATION (2026-06-17)
- **Reveal (sales comms):** do NOT tantalise with Wingguy on day one. Get them solid on the basics
  (LinkedHelper + core workflow) first, build trust, then "talk turkey" about Wingguy as the +$50 upgrade
  (= the documented progressive-reveal). ✓
- **BUT separate reveal from activation.** The basics (LinkedHelper) are the **LEAST sticky** part —
  anyone can run LinkedHelper. **Wingguy is the moat.** So the most *churnable* window is the early,
  basics-only phase, before the stickiness engine is on.
- ⇒ **Activate Wingguy as soon as the basics are bedded, not as late as you can get away with.** The
  stickiness clock only starts when Wingguy starts; every extra month basics-only = moat not building +
  more replaceable. Several months of relationship-rich involvement is good (trust + activation), but bias
  Wingguy *live* to the earlier side of that window.

### The +$50 Wingguy upsell — penetration price, near-pure margin (2026-06-17)
- Consistent with the doc's existing **+$50 progressive-reveal**; Guy confirming it, anchored on the
  Wingguy/Claude layer.
- **$50 easily converts the right buyer** (below the deliberation threshold for someone who values time +
  saw a demo). Conversion risk ≈ 0. The real issue is the **opposite: $50 is UNDER-priced vs value.**
- **The under-pricing is a deliberate, good choice:** low price = **penetration** → max take-rate → max
  accumulated state (moat) + more mesh nodes + more referrals. AND **near-pure margin** — the Wingguy
  cockpit runs on the **client's own Claude** (the free→paid wedge), so it costs Guy ~$0 → the $50 is
  almost all profit.
- **Moves:** (1) charge it, **don't bundle** into base (keep low-friction entry + the reveal moment);
  (2) treat $50 as a **launch/penetration price** — **grandfather early adopters at $50** (reward + they
  generate proof), **charge later cohorts more** once value is proven; (3) **the framing flips** — "+$50
  add-on" now, but Wingguy becomes the **lead** attraction later (the real differentiator).

### VA model + cost (2026-06-17, checked)
- A people-skilled full-time VA carries onboarding + continuation tasks (LinkedHelper top-ups, admin); Guy
  drops in. **2026 rates:** PH direct hire experienced FT (160h) ~USD $700–1,200/mo → **AUD ~$1,100–1,850**;
  via managed agency ~USD $1,200–2,500 → **AUD ~$1,850–3,800**. Planning number **~AUD $1,500–2,500/mo**
  direct (~AUD $20–30k/yr).
- **Capacity (honest):** one good VA covers **~50–80** clients at light steady-state touch *with
  productised onboarding*; **100 on one VA only if onboarding is genuinely light** — else budget
  **~1.5–2 VAs** by 100. Productised onboarding decides one VA vs two.
- **Economics trivial:** ~AUD $2k/mo across 100 = **~AUD $20/client/mo** (<15% of revenue). **Key-person
  risk:** document SOPs so knowledge isn't in one head + a 2nd VA can slot in.

### Client-side VA operating model — the principal's VA drives Wingguy (2026-06-30)
> New delivery shape, distinct from **VA model + cost** above (that's GUY's VA scaling GUY's ops). Here the
> **client's own VA** operates Wingguy on the client's behalf. Surfaced by a real case: Paul Faye (Perth client,
> too busy to act on the system) + his VA April. Planning only — no code.
- **★ The real competitor is the client's TIME, not another tool.** Paul stalled not because the system's bad but
  because he has no time — his own words ("not your fault, not the system's"). A great tool a busy principal must
  drive himself has a built-in activation failure. **The VA *is* time** → the VA model attacks activation/churn
  head-on (sharpens **ACTIVATION is the real job**).
- **Three-role split:** **VA operates · the AI voices · the principal approves BY EXCEPTION.** The brain supplies
  the voice, so the VA needn't write well or "be" the principal; the principal is the quality gate, not the author.
- **Don't rebuild the bottleneck.** The premise is "principal too busy" — a gate that needs him on every message
  puts the bottleneck back. The busier the principal, the more the VA+brain must run WITHOUT him → higher bar on
  (a) the brain's voice and (b) the VA's judgment about *when to escalate*. LinkedIn (low stakes, templated) is safe
  to run nearly unattended; **post-meeting email is where principal-time creeps back** (higher stakes, bespoke) —
  design to minimise it.
- **Governance = the same flag-to-queue, with a person-split:** the VA edits **no rules** — she flags; the principal
  (or Guy) authors rule changes centrally. (See **Rules edit-authority** under **Where each thing lives**.)
- **The fork — walk the light side first:** (a) **client supplies their own VA** (Paul→April) = light for Guy (sell
  tool + playbook + train the VA); (b) **Guy supplies the VAs** = becomes a BPO/agency — heavier, later. Don't drift
  into (b) by accident.
- **Lighthouse + pricing:** busy principals *with VAs* are a tight, talkative network → "I finally have a VA who
  sounds like me and books meetings" is the referral line. Treat **Paul+April as a proof asset**, and **price the
  VA-operated version as a premium / done-with-you tier — NOT the $50 self-serve add-on** (it delivers outcomes, not
  a tool).
- **Open question (2026-06-30):** at ~10 clients, does each bring their own VA, or does Guy provide the VA layer?
  The answer sets how much to standardise the VA workflow vs the tool.

### VA trust architecture — AI-as-author is a TRUST feature, not just quality (2026-06-30)
> Extends **Client-side VA operating model** above. Why a principal lets a VA touch their outreach at all.
- **The delegation unlock.** A reputation-sensitive principal won't hand outreach to a VA's own judgment ("will they
  say the wrong thing in MY name, to MY network?"). The AI defuses it: the VA isn't exercising taste — the AI
  (carrying the principal's voice) constructs; the VA operates the machine. What the principal trusts shifts from
  **"the VA's writing/judgment"** (scary) to **"my own system, run consistently"** (easy to grant).
- **★ This expands the market, not just efficiency.** It makes a delegation most principals would *never otherwise
  do* psychologically possible → you reach reputation-conscious people who'd hand outreach to "my AI, operated by a
  VA" but never to a VA alone. Bonus: VA turnover is low-risk — a new VA presses the same buttons, the voice never
  changes (the client-side view of "anchor trust to the system, not the individual VA").
- **Flip-side — it raises the stakes on AI reliability.** The same design that makes it trustworthy (the VA doesn't
  second-guess the output) removes the human author who'd *catch a bad one*. A button-presser sends the
  day-of-week error, the bounced email, the off-tone line. So the trust model is only as strong as the AI's
  grounding **plus** the principal's by-exception gate → the real-run bugs (see **Risks surfaced by real runs**) are
  load-bearing in the VA world, not cosmetic.

### 100-client steady-state P&L (2026-06-17, planning ballpark)
- **Assumptions:** 100 clients, base **$150/mo**, Wingguy **+$50** at **70%** take, **1.5 VAs**
  (~USD $2,000/mo). Revenue at face-value "$" (USD); VA converted from AUD. *(If client prices are AUD,
  read the net as AUD directly.)*
- **Revenue:** base 100×$150 = $15,000 + Wingguy 70×$50 = $3,500 → **$18,500/mo**.
- **Costs:** VA −$2,000; Guy's AI (panel + scoring; Wingguy runs on client Claude = ~$0) −$700; infra
  −$300; Stripe ~3% −$550; misc −$300 → **~−$3,850/mo**.
- **Net ≈ $14,650/mo (USD) ≈ AUD ~$22k/mo ≈ AUD ~$265k/yr, ~78% margin.**
- **★ Key insights:** (1) **take-rate barely moves the top line** — 60% vs 80% = only ~$1k/mo (because
  $50 ≪ $150 base) → **don't agonise over take-rate**; the levers are **base price + client count**; $50
  is a *penetration/moat* price, not a revenue driver. (2) **Wingguy is near-pure margin AND protects the
  whole $18.5k** (stickiness + coaching-delivery layer). (3) **The fat margin is pre-Guy's-time** — only
  holds if onboarding is productised + VA carries support, else the hidden cost is Guy's hours. (4) **This
  is steady-state** — excludes the cost of *getting to* 100 (acquisition + building the machinery).
- **Swing factors:** referral-floor ($50) clients pull revenue down (but each brought 3 payers = system
  ahead); $300 done-for-you push it up (but cost more time); churn = the quiet tax (re-onboarding).

### Extension AI cost — per-client estimate + why the tiers cover it (2026-06-30)
> Grounds the panel-AI line item. Current rates (checked 2026-06-30 via claude-api): **Opus 4.8 $5/$25 per MTok
> in/out; Sonnet 5 $3/$15 standard ($2/$10 intro through 2026-08-31); Sonnet 4.6 now legacy**; cache-read ~10% of input (the big instruction block is cached, so the agent loop is
> cheap). The extension runs on **Guy's** API key (`wingguyChat.js` → `getAnthropicClient`), not the client's Claude.
- **Unit costs (Opus, cached):** a single message draft ≈ **~$0.10**; a full booking flow
  (availability→propose→confirm→book→confirm) ≈ **~$0.50–0.75** — matches the back-test figures.
- **Per active VA-run client/month** (~120 openers + ~60 replies + ~12 bookings): **~$28 all-Opus, ~$20 with
  openers on Sonnet 5.** Scaled: light/passive ~$7–12; typical active ~$15–30; very aggressive all-Opus up to ~$40.
- **★ Cost tracks the tier on its own.** The $300 VA tier absorbs even the heaviest case (~13% of revenue, covered
  ~8×). The $50 solo tier is naturally LIGHT — the one-man band bought it *because* they're too busy to drive heavy
  volume → low usage → covered comfortably. The cost driver (volume) and the expensive tier (VA) coincide; no
  usage-metering needed — the segmentation self-aligns price and cost.
- **Backstops for the rare heavy-$50 outlier** (a non-busy solo grinding it; margin compresses but stays positive):
  (1) **keep openers on Sonnet 5** — the high-volume templated case where Sonnet is proven fine, the single biggest
  cost lever; (2) the **per-client usage cap**.
- **P&L correction:** the existing 100-client P&L treats Wingguy as ~$0 (runs on client Claude). For the *extension*
  that's wrong. Budget **~$1,000–1,500/mo** at ~70 Wingguy clients (vs the ~$700 "Guy's AI" line) — still a small
  slice, margin stays high, and the cost lands in the tier ($300 VA) that covers it.

### Sonnet 5 (launched 2026-06-30) resets the model choice — swap now, back-test to replace Opus (2026-06-30)
> Confirmed on Anthropic's official model docs + launch coverage. Model ID `claude-sonnet-5`; **$3/$15 standard,
> $2/$10 intro through 2026-08-31**; 1M context, fast latency, adaptive thinking, effort defaults to `high`.
> Sonnet 4.6 is now **legacy**. Sonnet 5 is "close to Opus 4.8 at lower prices" (Anthropic) — closes most of the
> benchmark gap at 40–60% lower cost.
- **Swap 4.6 → Sonnet 5 now (unconditional).** Strict upgrade at the same price (cheaper on intro); 4.6 is legacy.
  Covers the templated openers + background tier — pure win, low risk. Code: `WINGGUY_DRAFT_MODEL_ID` /
  `MODEL_ID` in `services/wingguyChat.js` (currently defaults to `claude-sonnet-4-6`).
- **★ Opus decision is now RE-OPENED — Sonnet 5 may replace it for client-facing too.** We chose Opus for
  client-facing only because Sonnet *4.6* fell short on voice/judgment — a premise Sonnet 5 changes. **But the
  benchmarks measure agentic/coding, NOT voice** (a real voice test found intelligence-rank ≠ copywriting), so
  **back-test Sonnet 5 vs Opus on Guy's real voice + booking-judgment threads before moving client-facing off
  Opus.** Holds → collapse to ONE model (Sonnet 5 everywhere: ~40% cheaper → ~$17/active client, faster, simpler);
  doesn't → keep the escalate-to-Opus routing for the witty/tangled minority. **Opus is now "prove you still need
  it," not the assumed client-facing default.**
- **Intro window = test now.** $2/$10 through Aug 31 is Anthropic nudging real-workload testing; do the voice
  back-test inside that window.

### Guy's time at steady state — ~3 days/week is feasible IF held (2026-06-17)
- **Yes, ~3 days/wk is feasible** at steady-state (machinery built, VA competent, churn low) — but a
  **ceiling actively held**, not automatic. Rough split: acquisition/sales ~1–1.5d; VA mgmt + escalations
  ~0.5d; onboarding trust-touches + coaching overflow ~0.5d; product maintenance ~0.5–1d.
- **The usual killer (support load) is offloaded** here (VA + Wingguy + self-serve) → Guy's days are
  *front-end* work.
- **The two things that blow past 3 days if unmanaged:** (1) **acquisition** — the **least-delegable**
  task (relationship sale; a VA/Wingguy can't do it) → balloons if churn high or still growing; (2)
  **Guy's urge to keep building Wingguy** — dev time is unbounded (the "elegant-architecture" trap). 3
  days requires *stopping building* once it's good enough.
- **Pressure valve:** the economics **buy time back** — a 2nd VA / part-time appointment-setter or closer
  takes ops or the least-compressible sales off Guy. If 3 creeps to 4, **hire it down** (margin affords it).
- **NB:** 3 days = *steady-state* figure AFTER the build (build phase is more). For Guy's goals (74,
  cash-flow, don't-kill-me): ~3 days of mostly the work he enjoys (relationships/sales) for ~AUD $265k/yr
  = close to the ideal shape he described.

### LinkedIn analogy — you're renting a SOLVED network (2026-06-17)
- Guy's thesis: LinkedIn works because *the right people are there*, not because of community/meetings →
  a tool that makes finding/reaching them easier needs no community either. **On the right track**, with
  two sharpenings:
- **(1) Not anti-community, anti-MEETING.** LinkedIn *is* a network (latent, passive, high-utility) — just
  not a *scheduled gathering*. The valuable form of "community" = the **latent network**, not the rah-rah
  event. That IS the intro-mesh.
- **(2) The smart move: you're RENTING LinkedIn's already-solved network**, not building one. The cold
  start is the hardest problem in network businesses (LinkedIn: ~20yrs + hundreds of millions to solve).
  Guy adds a productivity + coaching layer ON TOP → no need to manufacture belonging, he's **borrowed
  LinkedIn's network effect.** (Guy's *own* intro-mesh still has a cold-start ramp → a later-compounding
  bonus, not an early crutch.)
- **Honest caveat:** LinkedIn's other truth — most users are passive + get little. Guy's argument rides on
  *"provided people do it + get results"* → the real risk is **activation**, not community.
- **★ Ties the day together:** "100 clients at low touch" is gated on **productised onboarding +
  Wingguy-DELIVERED coaching** (today's content-surfacing system = how coaching scales past Guy's
  calendar), NOT on running a community.

### Connection follow-up worklist / "Thanks for Connecting" — design (2026-06-19)
Design session for the backlog feature flagged 2026-06-18. Backbone re-verified in code first, then the UX +
status model worked out in chat. Not yet built — this is the agreed spec.

**Backbone re-verified (2026-06-19) — we are NOT building ingestion.** Two-campaign LH flow maps cleanly onto
the code: (1) profile-extraction campaign captures 2nd-degree leads → `currentConnectionStatus = Candidate`,
`Date Connected = null` ([leadService.js:98,118](services/leadService.js)); (2) when they accept the connection
request LH fires again with `Connected`/`degree 1st`/`distance _1` → status flips to Connected and the existing
record gets `Date Connected` stamped ([leadService.js:156-160](services/leadService.js); handler flags it an
existing-connection update so scoring is preserved, [webhookHandlers.js:185-194](routes/webhookHandlers.js)).
So Guy's invariant holds: **null date = extracted-not-yet-connected; has-a-date = actually connected.** Three
precision notes: the *true* signal is `LinkedIn Connection Status = Connected` (date rides along — key the queue
on status, sort on date); the stamped date is LH's real `connected_at` if provided, else `now()` as fallback;
worth eyeballing one real connected record someday to see whether LH actually sends `connected_at` (affects sort
precision only, not correctness).

**UX = inbox-zero.** The queue IS "where I'm up to" → kills the manual "where did I get to" scan entirely. Two
views: **Outstanding** (drains to zero) + **All recent** (status-badged reconciliation against LinkedIn). Row:
name links to the LinkedIn profile, "connected X days ago", primary one-tap button + secondary actions.
Optimistic-remove + undo toast (no per-row confirm dialog); a live "N to thank" count (the motivator that makes
it a habit); a real "all caught up" empty state. **Oldest-first** — Guy's call, and it dovetails with the LH
window: oldest = closest to the deadline before LH auto-sends.

**Lookback limit (2026-06-20) — bounds the queue + solves cold-start.** Outstanding shows only connections from
the last ~N days (configurable, default ≈ the LH window, ~14). Without it, day-1 launch would dump *every
historical connection ever* (blank tick-status but a real `Date Connected`) into the queue — thousands, useless.
With it, launch shows only ~2 weeks and the queue stays bounded forever (rows you never get to just drop off
screen rather than piling up stale). **Crucially this is NOT a return of the dropped mirrored-window** — it's a
benign *display filter*; if it's a bit out of step with the real LH window nothing breaks (a few more/fewer days
shown), because the correctness-critical auto-resolve still comes from the message-sent webhook. Pairs with
oldest-first (top of a 14-day list = "about to age out, do this now"). **No separate one-time bulk-clear** —
decided unnecessary (Guy, 2026-06-20): the lookback already shrinks launch to a handful Guy can eyeball and clear
by hand if some were already done the old way. Possible later nicety: a "last 7 / 14 / 30 days" range toggle on
screen; v1 = one configured number.

**Status model (locked).** One to-do state + two done-outcomes, both leave the queue:
- **Outstanding** (blank) — Connected, still in window, no decision yet.
- **Messaged** — Guy personally reached out (AI Blaze). Hand-ticked. LH suppresses its automated send because it
  sees the correspondence ("filter out of my list").
- **Let go (LH sent)** — Guy chose not to personalise; LH's automated sequence handles it. Auto-resolved.

Principle used to keep the set minimal: *a status earns its place only if it changes a downstream behaviour or
answers a question someone will actually ask.* Messaged-vs-Let-go survives because "how many did I personally
welcome vs let the sequence handle?" is a real (and client-friendly) number. A "will-be-sent-by-LH" status was
**rejected** — the portal can't know LH's internal state and it would go stale. **Vocab fix:** "keeper" = cricket
(*let it go through to the keeper*) = "Let go", NOT "save for nurturing" (Claude had it backwards first pass).

**Auto-resolve mechanism (the key 2026-06-19 decision).** Replaces the earlier mirrored-window + date-lapse idea
(which Guy was rightly uneasy about — two sources of truth for the window → drift). Guy confirmed **LH can fire a
webhook at any campaign stage.** So: drop a webhook step right after LH's first-message send → when LH actually
sends (i.e. Guy let the person go), it pings us → row auto-resolves to **Let go (LH sent)**. Ground-truth event,
not a guess. The Messaged path never pings (LH suppressed its send), so the two outcomes self-separate. This lets
us **drop the duplicated window config** entirely; "connected X days ago" comes free from `Date Connected` (no
config), and we lose only the precise "days-left" countdown (oldest-first covers urgency anyway).
- **Reuse the ONE existing webhook** — Guy's explicit preference so clients configure only one thing. Our side:
  `/lh-webhook/upsertLeadOnly` already matches leads by canonical URL→`Profile Key`; the message-sent ping is a
  thin sibling (`/lh-webhook/messageSent`) or an `event=` flag on the same route — same plumbing, small build.
- **The "fly" largely dissolves — $8 LH tier = 20 webhooks/day.** Counts *firings*, not endpoints, so reusing
  one URL does NOT save budget. **But the message-sent draw is self-throttling** (Guy's 2026-06-19 insight, which
  flips the concern): a lead's webhook lifecycle is at most **3 firings — (1) into Airtable on extraction, (2) on
  connect, (3) on message-out** — and #3 fires ONLY for *let-go* leads. Working the 14-day window properly with
  AI Blaze suppresses LH's automated send on the ones you personalise, so #3 is **inversely proportional to
  engagement**: the harder you work the list, the less it fires. #1+#2 already fit today's volume. So the cap only
  bites a *disengaged* user (lets everyone fall through to automation — getting little value anyway), and their
  fix is a clean ~$12 LH upgrade. **Net:** keep message-sent **optional**, but the cap is a natural ceiling that
  maps to daily connection volume, not a blocker — and a *confident* upsell line to the unlimited tier (aligns
  with what Guy already advocates), not a hedge that makes price-sensitive prospects walk.

**Build shape.** Guy-first to validate the loop, then client-facing (clients won't do the manual scan Guy does,
but will use an easy in-portal list). v1 = plain portal list + manual tick + click-through to LinkedIn; **v2 =
the extension magic** (detect you're on the profile, mark + advance to next). Needs a **dedicated tick-field** in
Airtable — the generic `Status` is auto-clobbered to "In Process" on every webhook upsert, so it can't carry
this; candidate = the unused `Conversation Stage`, or a new `Thanks Status`.

**Naming + placement (DECIDED 2026-06-20).** Portal tab **"Thanks for Connecting"** (names the job-to-be-done in
Guy's own words; three words, same footprint as "Lead Search & Update"/"Top Scoring Leads"; beats the
alternatives — "Connections" reads as the whole list, "New Connections" collides with "New Leads", "Follow-ups"
clashes with "Follow-Up Manager"). Subtitle **"Welcome your recent connections"** (matches the others' verb+object
style). Icon = handshake/wave. **Placement: after "Top Scoring Leads"** — the last *working* tab, just before the
Settings + Start-Here utility tabs (keeps that grouping clean without reshuffling).

**Airtable schema PROVISIONED 2026-06-20 (✅ done — was item 3/4 below).** Tick-field = new **`Thanks Status`**
(singleSelect: *Messaged* / *Let go*; blank = Outstanding) — created on all 17 client Leads tables + the Client
Template. Lookback = **`Connection Lookback Days`** (number) on the master **Clients** table (empty treated as 14
by the app). **Per-client gate = `Thanks for Connecting`** (singleSelect Yes/No) on the master Clients table —
default off (blank/No); **Guy-Wilson set to Yes**. The portal shows the tab ONLY when this is Yes, so the screen
ships **Guy-first** and rolls out **client-by-client by flipping the switch** (via `scripts/set-client-flag.js` —
a reusable one-field setter — or in Airtable). Additive: zero change for any other client until enabled. Rolled
out via the new reusable tool **`scripts/ensure-client-fields.js`** (idempotent; template is a
DEFAULT target; `--audit` mode diffs template vs clients; runs via Render one-off job — see
[[reference_render_jobs_exec]]). Template base id now lives in env var **`CLIENT_TEMPLATE_BASE_ID`**
(`app6W6k9GiDlJktvt` — the old hardcoded `…GiDUlktvt` was a typo); same pass backfilled the template's missing
**`Alt Emails`**. Audit confirmed no other all-client field was missing from the template. Memory:
[[feedback_airtable_field_rollout_includes_template]].

**Open / homework (pre-build).** (1) Guy to confirm the exact LH webhook step + payload (carries profile URL for
matching) — he's confident it can; this gates only the *auto-resolve enhancement*, NOT v1. (2) v1 note freehand
vs AI-suggested draft — lean freehand, AI draft = later extension hook. The remaining build is the **portal UI**
(the "Thanks for Connecting" tab + the Outstanding / All-recent views reading these now-provisioned fields). Not
yet built.

---

## Build plan — vertical slices (2026-06-24)
> The ordered build sequence for the Wingguy extension. Each slice is proven (on Guy first) before the next.
> Principle: **prove the pipe → add the hard agentic engine → make it tunable → make it commercial → make it
> multi-tenant.** Volatile "which slice / done" status lives in ▶ You are here below.

**Slice 1 — Fork + personalised thanks-for-connecting (single-tenant Guy). ✅ BUILT 2026-06-24 (on `main`; awaiting
Guy's live LinkedIn test — volatile status → ▶ You are here).** Proves the end-to-end plumbing. Fork
`chrome-extension` → `wingguy-extension` (rename, namespace DOM `wingguy-*`, visually distinct; the old one stays
installed + untouched). On a LinkedIn profile: read profile (About expanded) + connection thread → campaign-template
quick-pick buttons (human-picks, from Guy's `\tks`/`\frac`) → ONE backend endpoint behind the existing auth
middleware (`req.client`) → **templates seeded directly (NO Postgres store yet; do NOT touch the Notion→Postgres
migration)** → Sonnet draft + prompt-caching → formatting-preserving insert; human clicks send. **No tools** (single
AI call) — that's why it's first.

**Slice 2 — The conversation engine (replies + booking).** The multi-tool agent. **Gets its own design session
first** (use the Tony + Ranya worked examples as the brief). **[PARTIAL — "Option A" pulled forward 2026-06-25: the
SMALL half (read the open thread → code-classify thanks-vs-reply → single-call contextual reply, NO tools) is BUILT +
proven live; see ▶ You are here. The BIG half — move-judgment + booking/calendar/Airtable multi-tool orchestration —
is still the design-session work below.]** Read the WHOLE thread → decide the next move → execute:
warm reply → offer Zoom times; question/objection → answer/reframe; picks a time → calendar clash-check + create
invite (Notion spec) + Airtable email-reconcile + confirm; reschedule gracefully. Drafts shown first; human sends.

**Slice 3 — Rules store + management.** Build the Postgres "Wingguy" rules store; **migrate Guy's templates off
Notion** (the one-time conversion = the de-personalisation pass); the **"manage my templates" screen** (visibility /
name / enable / "use when" / light edits — NOT a prompt IDE) + **edit-as-you-go** tuning through the write-door.

**Slice 4 — Metering + commercial.** Action counter (**operator daily view** + **client trial counter "X of 500"**);
the **~3,000/mo cap** backstop; the **$50 flat + 500-action trial** via Stripe. Meter tokens underneath; count
"actions" (AI writes incl. redos), not reads/clerical.

**Slice 5 — Multi-tenant rollout.** Per-request tenant resolution at the drafting surface; per-tenant config/chips
(make `extension-config` per-client); the **"sharpen" button + code auto-route to Opus** (from back-test evidence);
onboard client #2; distribution → **Chrome Web Store "Unlisted"**.

## ▶ You are here / next pick-up

**★ EXTENSION HARDENING BATCH — real-run bugs from Guy's live testing (2026-07-01, through `90498460`, on `main`).**
A run of `content-wingguy.js` fixes found by using it on real leads (all client-side → need extension reload + tab
refresh; NOT deploy-gated):
- **Bubble-over-profile = wrong person (`12f36dce`,`4ea63f55`,`2b87f168`).** Typing `/wg` in a floating message bubble
  open over someone ELSE'S `/in/` profile drafted for the profile behind it (Deepti's bubble on Todd's page → drafted
  Todd). Root cause (from live console): `activeThreadContainer`/`scrapeMessagingHeader` guarded the anchor with
  `document.contains()`, which **can't see into shadow DOM** — LinkedIn's composer is in an open shadow root, so it
  reported the box as "gone" and fell back to the profile. Fix: `.isConnected` (shadow-aware). Plus `scrapeProfile`
  now treats "a thread is open" (not just the URL) as messaging context, and the header read got robust (name from
  heading text, not just a link).
- **Internal member-id URL (`d8eedd59`).** In a thread LinkedIn often links the internal `/in/ACoA…` member-id, not
  the vanity URL Airtable stores → lookup misses → save skipped. Fix: prefer a vanity `/in/` link; else resolve the
  ACoA URL via the existing `RESOLVE_LINKEDIN_URL` background redirect-follow before lookup.
- **On-send capture hardening (`c074a657`).** LEADING→TRAILING debounce (emoji reactions + text fire several sends;
  snapshot after the LAST), one retry on the header read, and a toast on EVERY skip path (no more silent misses —
  this is how Guy caught the internal-URL bug live).
- **★ Wrong-person SAVE guard (`90498460`) — the important one.** A *missed* save is safe; a *wrong* save silently
  corrupts a record (James's chat was found written onto Neville's record). Before QUICK_UPDATE, the lead matched by
  URL must appear as a participant in the scraped thread (name vs senders); else refuse + toast. Turns silent
  corruption into a visible refusal. **⚠ Watch for other stray cross-saves from before the guard** — clean by hand
  (did James→Tony→Neville this session). Only guards when senders are readable (won't false-refuse on Unknown).

**★ GREETING + SIGN-OFF HOUSE STYLE, MULTI-TENANT-READY (2026-07-01, `5260e335`+`5097647d`, on `main`).** Guy's
request: always open with a warm first-name greeting; sign off `(I know a) Guy` by default but drop to plain `Guy`
when his previous message in the thread was already plain (trim-don't-re-add). Built the multi-tenant-correct way per
"Where each thing lives — code vs rule vs variable" (nothing tenant-specific hardcoded):
- **VARIABLE** = `config/wingguyVoicePrefs.js` — the SEAM (mirrors `wingguyBookingPrefs.js`): `getVoicePrefs(clientId)`
  → `{ greetWithFirstName, signoffName:'Guy', signoffTagline:'(I know a)' }`. Guy's values are the defaults now;
  per-tenant overrides/self-edit land later (their record + the rules write-door). Multi-tenant = fill in values, no rework.
- **CODE** = `wingguyChat.chooseSignoff()` deterministically picks tagline-vs-plain from the thread's previous coach
  message (verified all 3 branches). And `propose_times` now strips any model sign-off + appends the chosen one (the
  times-message draft is code-assembled, so it was coming out sign-off-less — caught by the cloud test, then fixed).
- **RULE** = `buildContext` voice block: greet with first name fitting the moment; sign off the code-chosen line verbatim.
- **Verified on Sonnet 5** via cloud test Scenario D (Deepti-like, prev plain → greets "Hi Deepti," + plain "Guy"),
  booking/Greg/Vanessa unchanged. Backend change — no extension reload needed.
- **This is the first live instance of the code/rule/variable split in the extension** — the pattern to reuse for the
  next tunable (and the thing the rules write-door will eventually let clients edit themselves).

**★ SONNET 5 NOW LIVE — thinking disabled + firmer confirm-first (2026-07-01, `dcdf99ca`, on `main`). RESOLVES the
outage below; this is the state of the "swap 4.6 → Sonnet 5" call.** Timeline: the first swap to `claude-sonnet-5`
(`e0aac716`, 2026-06-30) broke the panel — on a normal profile the auto-draft came back **"(No response — try
rephrasing)"**. Root cause (proven by live prod probes, not a guess): **Sonnet 5 is real + API-accepted, but it thinks
by default**, and in the tool-using agent loop with the small `CHAT_MAX_TOKENS` the turn returned no reply/no draft.
Two fixes, both verified on prod via the cloud test (`scripts/wingguy-chat-test.js`):
1. **`CHAT_THINKING={type:'disabled'}` on the chat `messages.create`** (`8a1b08e1`) — this agentic booking chat is
   latency-sensitive and drafts/books rather than deep-reasons; disabling thinking is the seam that makes thinking-by-
   default models usable here. Killed the empty-turn failure.
2. **Firmer two-step confirm-before-booking instruction** (`90cd1a58`) — Sonnet 5 is more literal/eager and read "book
   the first one" as the go-ahead (booked immediately; 4.6 held back). Rewrote the rule so a request to book = Guy
   CHOOSING the time, and the agent must read the day/time back and wait for a separate explicit yes. **Restores the
   two-step on Sonnet 5; 4.6 re-run confirmed no regression.**
- **Verified green on BOTH models:** Turn 1 offers times; Turn 2 "book the first one" HOLDS BACK for confirm; Turn 3
  "yes" books; Greg fractional scenario weaves the topic + doesn't push times.
- **`MODEL_ID` default is now `claude-sonnet-5`.** Fall back via `WINGGUY_DRAFT_MODEL_ID=claude-sonnet-4-6` if ever
  needed (switch at the default, not per-turn — a mid-conversation model switch invalidates the prompt cache).
- **★ Second Sonnet-5 over-caution tune (`b70f78d5`).** Flip side of the eager-booking fix: on a connection whose
  opener had already been SENT but not answered, Sonnet 5 (more deliberate) HEDGED — "no reply yet, want me to draft a
  nudge or just wait?" — instead of drafting. Fixed in `WINGGUY_AGENT_INSTRUCTIONS`: split the no-reply branch (opener
  not-yet-sent → thanks opener; opener sent + unanswered → light follow-up nudge, never re-send, never say "wait"), plus
  an **ALWAYS DRAFT** rule (every turn leaves a ready draft; never end with only a question). New cloud-test Scenario C
  (Vanessa-like unanswered opener) locks it: verified on Sonnet 5 it now drafts a proper nudge; booking + Greg unchanged.
  Pattern to remember: **Sonnet 5 is more literal/deliberate — expect to nudge behaviour with explicit instructions in
  both directions (rein IN eager booking, push OUT over-cautious hedging).**
- **Open follow-up (Guy's earlier back-test):** whether Sonnet 5 also replaces **Opus** on client-facing (journal
  "Sonnet 5 … resets the model choice") is still a voice back-test, separate from this booking-chat swap.

**★ MESSAGING SURFACE OPENED UP (2026-07-01, `bbba054e`, pushed to `main`).** Guy hit the gap live: from the
LinkedIn **messages** (full `/messaging/` page or a floating conversation bubble — no `/in/` profile page in
play, e.g. a lead asking to rebook), neither the teal launcher NOR `/wg` appeared, and replies didn't auto-save.
Root cause: launcher injection, the `/wg` trigger's message-box gate, and `captureConversationToPortal()` were all
gated to `isProfilePage()`. Fix (`content-wingguy.js`, additive): `shouldShowLauncher()`/`hasOpenMessageThread()`
show the launcher whenever a thread is open on any page (+ a polling `syncLauncher()` for bubbles that open/close
without a URL change); `/wg` now fires on the messaging surface even if the composer markup varies/is shadowed;
`captureConversationToPortal()` derives the `/in/` URL from the thread header (`scrapeMessagingHeader`) instead of
bailing, so sends from the messages auto-save to the lead's record. The panel flow already handled messaging
(`scrapeProfile`→messaging header + email lookup), so this just opened the doors. **⚠ NEEDS GUY'S LIVE TEST** (reload
the unpacked extension → open a message thread → confirm the teal button appears, `/wg` opens the panel, and a sent
reply toasts "Saved N messages"). DOM-fragile: if the launcher doesn't show or the header scrape is weak, the
console logs a diagnostic to lock selectors from his real DOM.

**★ PORTAL ENRICHMENT INTO THE DRAFT (2026-07-01, `62f6d2fa`, pushed to `main`).** Follow-on to the messaging surface:
the `/api/wingguy/chat` agent used to draft only from the LinkedIn-page scrape, so on messaging (About/headline blank
there) it went in thin, and CRM context was never available on ANY surface. Now the `/chat` route enriches server-side,
keyed by the same `/in/` URL Wingguy already extracts (name fallback), reusing the portal's own `Leads` read
(`clientService.getClientBase`): `enrichProfileFromPortal()` merges the approved set — about, headline, jobTitle,
companyName, location, **aiProfileAssessment, notes, followUpNotes, status, followUpDate, ceaseFup**. Live page wins where
it has a value; the Portal fills gaps + supplies the CRM-only fields. `buildProfileBlock()` renders a clearly-fenced
"FROM YOUR PORTAL — private CRM context" section that tells the model to use it for angle/tone/timing but NEVER quote/reveal
it to the lead (do-not-FUP flag surfaced prominently). Best-effort — never throws into the request. Works on BOTH surfaces
(profile pages gain CRM context; messaging gains About/headline + CRM context). **⚠ NEEDS LIVE VERIFICATION** (open a chat
on a scored lead → confirm the draft reflects their About/assessment/notes; check the console `[Wingguy] enrich: merged
Portal record …` line). ⓘ Re-queries Airtable once per chat turn (cheap, keeps data fresh); optimise later if needed.

**★ FULL MULTI-TENANT NYLAS — IN PROGRESS (2026-06-30).** Guy asked to finish making Wingguy booking
fully multi-tenant (he'd already moved the WRITE to per-client Nylas; this closes the rest). Three gaps
were identified; **2 of 3 DONE + pushed to `main`, additive + Guy-safe + unit-tested:**
- **✅ Gap 1 — availability READ + clash detection now per-client Nylas (read/write parity).** Commit `7d440855`.
  Booking-write was already per-tenant Nylas, but the READ only worked via the Google service account (a
  calendar shared with us), so a Nylas-only client could be booked but their free/busy couldn't be read.
  Now: a client with a Google Calendar Email shared with the service account keeps the proven Google read
  (Guy, untouched, *regardless of the global provider flag*); a Nylas-grant-ONLY client reads via their grant.
  `services/wingguyCalendar.js`: `getCoachCalendarInfo` also returns Nylas Grant ID + Calendar Provider (no
  longer throws on a missing Google email); `readsViaNylas`/`coachForNylas` pick the path; `buildDaysFromBusy`
  = pure luxon slot generator (busy events → free 30-min slots, business hours + day boundaries in the coach's
  tz). `getAvailabilityForCoach` + `clashesForWindow` branch; signatures unchanged. `tests/wingguy-nylas-
  availability.test.js` (14 assertions).
- **✅ Gap 2 — per-client booking IDENTITY on the invite (Zoom + contacts).** Commit `4357b813`. `clientService`
  loads optional `Booking Zoom Link` / `Coach LinkedIn URL` / `Coach Phone Number` onto the coach; `createBookingEvent`
  prefers them, falls back to the shared default (Guy's). ADDITIVE: blank/absent fields = identical to today.
  ⚠ Those three Airtable fields don't exist yet — booking falls back to Guy's defaults until they're added
  (to BOTH Master Clients base AND the Client Template — see [[feedback_airtable_field_rollout_includes_template]];
  pattern = idempotent `--template` script). Non-blocking.
- **⏳ Gap 3 — the self-serve "connect your calendar" flow (Nylas hosted auth → save grant). NOT STARTED.**
  This is the only piece needing GUY's input: (a) confirm the Nylas app is set up for HOSTED AUTH (client_id/secret
  + which providers) and (b) register a redirect URI on our domain; then the code = an auth-start route + a callback
  that exchanges the code for a grant and writes `Nylas Grant ID` + `Calendar Provider='nylas'` to the client's record.
  Can't be end-to-end proven without a real 2nd tenant. (Guy edited `onboard-client/page.tsx` this session — check
  what's already there before building the UI entry point.) **NEXT = brief Guy on the Nylas-dashboard specifics, then build.**

**★ BOOKING = WARN, DON'T BLOCK (decided 2026-06-30; reverses a previously-locked iron rule).** Reviewing the deferred
Slice-2 bits, Guy re-scoped how the agent handles a time that's off-grid or clashing. **New product rule:** the agent
NEVER hard-blocks a time — Guy is always the decision-maker. (1) Guy can propose ANY time (on or off the availability grid),
and the agent works with it rather than only offering times from its own scan. (2) If a proposed time CLASHES with an
existing meeting (or is outside Guy's hours / off the 30-min grid), the agent must SURFACE that clearly ("heads up — you've
already got X then; book it anyway as a double-booking?") and proceed ONLY on Guy's explicit yes. (3) **Double-booking is
now ALLOWED** when consciously confirmed + clearly flagged — it is NO LONGER a hard rule. **The ONLY remaining
non-overridable hard rule = timezone-correct-for-both-parties** (Guy's own call). This supersedes the locked
"no-double-book = HARD rule, never user-editable" line in the code/rule/variable split. **STATUS: doc updated (this entry +
the split note + the deferred re-scope); CODE CHANGE IN PROGRESS** — agent instructions (add the "Guy proposed a specific
time" + clash-warn branch; relax the strict check_availability grounding so an arbitrary time can pass with a clash flag),
`book_meeting`/`check_availability` path, + a cloud test case for "lead/Guy proposed a specific time → verify → warn-or-book".

**★ UNIFIED CHAT 2026-06-28 — Thanks + Reply collapsed into ONE chat surface (the "just a chat" end-state).** Trigger:
on a real lead (Greg Abbey, a fractional CMO who replied warmly + shared two LinkedIn URLs), `/wg` auto-picked "Reply"
→ the booking chat, which was the wrong surface (a warm follow-up isn't a booking moment), and Thanks mode had no chat
to refine. **Fix:** removed the Thanks/Reply mode tabs; the panel now ALWAYS opens the chat agent, which works out the
move itself (thanks opener / warm-reply follow-up / reply / suggest times / book). Built: `WINGGUY_AGENT_INSTRUCTIONS`
rewritten to the whole lifecycle; the route now detects the campaign template (`\tks`/`\frac`) server-side and passes
its real voice-tuned structure into the agent context (`runWingguyChatTurn({campaignTemplate})` → `buildContext`), so
opener/follow-up drafts match Guy's templates. Extension: `renderRoute`/`renderContext` simplified, `draftReply`→
`startChat` with a kickoff that differs for a fresh connection (opener) vs an open thread. `classifyMode`/
`autoDraftThanks`/`renderDraftStep` are now dead (left in place, safe to delete next pass).
- **SHARED LINKS — slug-level weave (decided 2026-06-28).** The agent mines the topic from a shared LinkedIn URL's slug
  (e.g. `…marketingthatmeansbusiness…` / `youre-already-doing-marketing` → weave that theme in) and NEVER claims to have
  read the article. **Why not fetch the article:** a SERVER fetch isn't logged in → LinkedIn login wall → near-empty;
  only a BROWSER/extension fetch rides Guy's session, and even then feed `/posts/` are JS-rendered (need render+scrape,
  some account-risk) while `/pulse/` articles are more static/readable. True reading = a later browser-side enhancement.
- **Cloud test extended** (`scripts/wingguy-chat-test.js`): Scenario B = Greg warm reply + URLs → expects a fractional
  follow-up that weaves the marketing topic and does NOT push times. **Both scenarios PASSED on prod** (job
  `job-d90bbe6gvqtc739c9lv0`): Greg → detected `frac`, drafted the follow-up nodding to "marketing that means business",
  did NOT call the calendar; booking flow still spreads/confirms/books.
- **UX polish 2026-06-28:** chat draft box now AUTO-GROWS to fit the whole message (capped ~45vh; chat-log trimmed to
  30vh) — the pinned "Message to send" was scrolling inside a small box. Modal max-height 92vh.
- **★ MESSAGING-PAGE LEAD READ 2026-06-28 (`10f663da`).** From the messaging INBOX, `scrapeProfile` was reading the page
  h1 ("Messaging") + the thread URL → CONTEXT showed "Messaging" and the email lookup couldn't match. Now on
  `/messaging/` pages it reads the open thread's HEADER (name + headline + `/in/` link, scoped to the conversation the
  user acted in via `closestConversationContainer`), normalises the URL, and suppresses About/posts/pageText (not loaded
  there). Fixes name + email-lookup from messaging; About/posts still need the profile page (decided: NOT worth
  hidden-tab/private-API scraping — conversation grounds the reply). DOM-fragile: logs a diagnostic if it can't find a
  clean name — if CONTEXT still shows "Messaging" on Guy's real DOM, lock the header selectors from his console line.

**★ DECISION 2026-06-27 — SLICE 2 "BIG HALF" = A FROM-SCRATCH CLAUDE TOOL-USING CHAT AGENT IN THE PANEL.
NO booking form, NO fixed buttons, NOT the portal's Gemini assistant.** This supersedes the form-based "📌 Book it"
+ "📅 Suggest times" approach (those are RETIRED for this purpose; the `renderBookForm`/fixed-button code comes out
when the chat lands). **Guy's call + reasoning (2026-06-27):** he wants a **pure chat-driven, maximally flexible**
experience — "just a chat, and I can always ask for a change." It emulates his **proven Claude+MCP cloud-chat flow**
(today he copies the LinkedIn convo into Claude, chats, and it suggests times / books beautifully and flexibly). His
banked **Tony/Ranya examples = the design brief + eval cases.**
- **Why NOT reuse the portal's Smart Booking Assistant (`POST /api/calendar/chat`, routes/apiAndJobRoutes.js:8578):**
  read it closely — it's **Gemini emitting a magic `ACTION:{…}` string** that a regex parses to drive **portal form/UI
  actions** (openCalendar, setBookingTime). That's "AI bolted onto forms," not a chat agent. Retrofitting it to
  book-anything-via-chat fights its design — starting clean is *less* work than the retrofit. (It WAS in the old Slice 2
  reuse list; superseded here.) Also: it runs Gemini, breaking Guy's tuned **Claude voice**.
- **Shape to build:** **`POST /api/wingguy/chat`** — a **Claude (Sonnet 4.6) tool-use loop**, STATELESS (panel sends the
  running message history each turn; backend executes tools server-side, loops until Claude's text turn). **Tools:**
  `check_availability`, `lookup_lead_email`, `book_meeting` (wraps the PROVEN Nylas `/api/wingguy/book` path),
  `propose_message` (pins the editable LinkedIn draft, separate from chat). **"From scratch" is only the BRAIN** — the
  HANDS are already proven (availability read, Airtable email lookup, Nylas invite write). The one genuinely-hard part =
  **timezone/DST correctness**; borrow the *logic* (not the Gemini prompt) from `/api/calendar/chat`.
- **Locked product rules (from this + the 2026-06-27 design chat):** (1) lead comms stay **100% LinkedIn** — Wingguy
  NEVER emails the lead; the **calendar invite (option A) is the only thing hitting their inbox**, guest email looked up
  from **Airtable via the LinkedIn URL**. (2) **Confirm-first** — the agent asks before it ever books (system-prompt
  enforced, like cloud chat). (3) Booking → a **past-tense "invite's on its way" LinkedIn draft** → Guy edits/accepts →
  Insert → **Guy sends**. (4) On `/wg` over a live thread, **Reply mode auto-selects + auto-drafts** (already built via
  `classifyMode`); the chat is where Guy then steers it.
- **✅ BACKEND AGENT BUILT + PROVEN LIVE ON PROD 2026-06-27 (commit `ef741fec`, on `main`, owner-gated, deployed +
  healthy).** `POST /api/wingguy/chat` runs a Claude (Sonnet 4.6) tool-use loop. Code: `services/wingguyChat.js`
  (the loop + the 3 tools + confirm-first system prompt; deps-injectable for tests), `services/wingguyCalendar.js`
  (`getAvailabilityForCoach` = proven calendar read returning both-sides display strings + `createBookingEvent` = the
  proven Nylas write, now shared by `/book`), `config/wingguyTemplates.js` `WINGGUY_AGENT_INSTRUCTIONS`. **Cloud test
  `scripts/wingguy-chat-test.js`** (Render one-off job `job-d8vnqsbsq97s738j6tk0`, real Claude + real calendar read,
  booking STUBBED) PASSED all three checks: turn 1 read the real calendar (64 busy periods/30 days) → offered 3 slots in
  a Guy-voice LinkedIn draft with the lead's Melbourne times + tz note; turn 2 "book the first one" → it **confirmed
  first** (did NOT book); turn 3 "yes" → `book_meeting` + a past-tense "invite's on its way" draft. **Render prod service
  = `srv-cvqgq53e5dus73fa45ag`** (the id in `scripts/deploy-to-render.js` is STALE/wrong). **Tuning note for later:** the
  agent picks valid open slots but didn't strictly prefer Guy's 10:00 start — fine for v1, can strengthen the instruction.
- **✅ EXTENSION CHAT PANEL UI BUILT 2026-06-27 (awaiting Guy's live test).** Reply mode IS the chat now:
  `draftReply()` in `wingguy-extension/content-wingguy.js` renders a **pinned editable draft** (Insert/Copy → Guy sends,
  reusing the proven `insertIntoComposer`) above a **chat box**, wired to a new `WG_CHAT` background handler →
  `POST /api/wingguy/chat`. On open it looks up the lead's email (`WG_CAL_LOOKUP`, non-blocking) and auto-kicks a hidden
  first turn so it reads the thread and proposes the next message; each turn it stores the server's full `messages`
  (incl. tool blocks) and renders `reply` (chat bubble) + `draft` (pinned) + a "✓ invite created" line when `booked`.
  Chat bubble CSS added to `styles.css`. The old form-based `suggestTimes`/`bookIt`/`renderBookForm` are marked
  SUPERSEDED (dead, safe to delete next pass). On `/wg` over a live thread, `classifyMode` still auto-selects Reply →
  the chat. **No backend change — it calls the already-proven `/chat`.**
- **NEXT = Guy's live test of the panel** (reload the unpacked `wingguy-extension/`, open a real LinkedIn thread, `/wg`
  → Reply → chat: "suggest times" / "book the X one" / "yes"). Watch-items: the lead-email lookup populating before a
  book attempt (else the agent asks Guy to add it); the composer insert landing the pinned draft.
- **★ BOOKING-TIME RULES REFINED 2026-06-28 (from a real miss — Mary Anne, who got offered three back-to-back mornings
  starting tomorrow).** Replaced the old "prefer 10:00 start" with a FALLBACK LADDER (Guy's words): (1) IDEAL — spread
  the options across the NEXT WORKING WEEK, one per day, on the LEAST-BUSY days first, with VARIED times of day (morning/
  midday/afternoon), and ≥1 CLEAR day's notice (never today/tomorrow); (2) if no clean spread → allow back-to-back/
  same-day; (3) still short → drop toward 9:30 earliest. Timezone/DST stays a HARD rule (Guy's own call: not a
  preference). Built: `config/wingguyBookingPrefs.js` (dropped `preferredStart`; added `minLeadDays`/`preferSpreadOverWeek`/
  `preferLeastBusyDays`/`spreadAcrossDay`), `services/wingguyCalendar.js` now returns per-day `meetingCount` so
  "least-busy" works, and `WINGGUY_AGENT_INSTRUCTIONS` encodes the ladder. All overridable in chat. *(Open: stale prod
  service id in `scripts/deploy-to-render.js` — prod is `srv-cvqgq53e5dus73fa45ag`.)*

**★ BUILT 2026-06-26 (session 2) — ON-SEND → PORTAL CAPTURE shipped (commit `fcf76bae`); the full-screen shell +
auto-detect were PROVEN LIVE on a real lead (Vera) first.** The thanks-for-connecting loop is now end-to-end: `/wg` →
full-screen → auto-detect template → draft → insert → **Guy clicks Send → Wingguy full-replace snapshots the whole
thread onto the lead's Portal record** (kills the manual copy). Capture reuses the legacy "Save to Portal" path exactly
(scrape → format LinkedIn-style raw → `LOOKUP_LEAD` → `QUICK_UPDATE {section:'linkedin'}` → backend `parseConversation`
REPLACES the `linkedin` section of the **Notes** field — there's no dedicated conversation field; both background
handlers already existed in the fork). Send detection = shadow-aware send-button click (composedPath) + Enter, debounced,
1200ms settle. **✅ CAPTURE PROVEN LIVE (Jane, end of session) — right thread only (no bleed), correct senders.** Three
bugs fixed in-session to get there: (1) thread read empty → auto-detect fell back to General → `scrapeOpenThread` made
shadow-aware + `classifyMode` prospect-aware (Guy's own note alone stays THANKS); (2) shadow-aware scrape then over-read
ALL open bubbles (Vera+Doug mixed) → scoped to the single conversation container anchored on the box the user acts in,
and capture REFUSES to save an unscoped scrape; (3) senders read "Unknown" → `senderForItem` hardened (avatar alt-text
first) + a `dumpSenderDiag` fallback. **So the THANKS-FOR-CONNECTING LOOP IS FULLY PROVEN END-TO-END.** Known v1 nit
(not blocking): capture carries no per-message timestamps yet (neutral time; order preserved) — a later fidelity pass.
**NEXT = Slice 2** (the tool-using conversation/booking engine into the same screen). **★ Slice 2 DESIGN PASS DONE
2026-06-26** (journal "Slice 2 — booking engine design"): mostly REUSE (`/api/calendar/availability` +
`/quick-pick-message` + `/chat` + `/lookup-lead`, all `x-client-id`). **Guy's design calls (2026-06-26): auto-pick slots;
SERVER-SIDE auto-create the invite** (not the prefilled-URL interim). **✅ "SUGGEST TIMES" SPIKE BUILT (`7af12047`)** then **✅ OPTION A — PER-TENANT BOOKING PREFERENCES seam (`0a0a6223`,
awaiting Guy's live test):** reply view → "📅 Suggest times" reads the tenant's prefs and picks accordingly →
`quick-pick-message` → drafted times message → insert → send. **Prefs seam = `config/wingguyBookingPrefs.js`
`getBookingPrefs(clientId)`** (code defaults now, **Postgres later** — set conversationally, migrated from Notion, Guy =
tenant 0), surfaced by `GET /api/wingguy/booking-prefs`. **Guy's defaults (locked 2026-06-26):** preferred start 10:00,
earliest 9:30 (soft floor), last start 16:30, 3 slots, 30-min, no buffer (back-to-back OK), exclude weekends unless told,
**soft 12:00–12:45 lunch hold** (skipped when auto-suggesting, still bookable on request). Picker (`pickSlotsByPrefs`,
unit-tested): prefer ≥preferred then relax to earliest only to fill, skip lunch, drop post-last-start, exclude weekends,
one per day. **★ Code/rule/variable split made concrete:** these are user-owned PREFERENCES (variables); timezone-correct-
for-both-parties stays a HARD rule in the calendar code, never user-editable. **(SUPERSEDED 2026-06-30: "no-double-book"
is NO LONGER a hard rule — see journal "Booking = warn, don't block (2026-06-30)". Double-booking is now ALLOWED when Guy
explicitly confirms it, provided the clash is clearly surfaced first. Timezone correctness remains the only non-overridable
hard rule.)** **★ BOOKING = via NYLAS, decided 2026-06-26** (Guy: emails stay on the
client's own Claude/connector — NOT the extension; the extension creates the calendar entry agentically like his
Claude+MCP does, multi-tenant). **✅ NYLAS READ CONFIRMED LIVE ON PROD 2026-06-26** (re-ran `scripts/nylas-check.js` via a
Render one-off job → 50 real events off Guy's calendar, `provider=nylas`, grant alive carried from Airtable `Nylas Grant
ID`). **The read foundation already exists + works:** swappable seam `services/calendarProvider.js` (`getMeetingsInWindow`,
Google|Nylas, per-coach `calendarProvider`), per-client grant in `clientService.js` (`Nylas Grant ID` + `Calendar
Provider`), Nylas v3 event mapping — currently used by the Fathom splitter, default Google. **So Nylas is NOT a
from-scratch build.** **✅ NYLAS WRITE PROVEN LIVE ON PROD 2026-06-26** — `scripts/nylas-write-test.js` via a Render
one-off job created a real event on Guy's calendar (HTTP 200, id `7et6h3j0…`) with external guest
`taniaadelewilson@gmail.com` and `notify_participants:true`. **So the grant HAS write scope (no reconnect needed) and
external invites send.** ✅ **Guy confirmed Tania received the invite in her inbox; the test event was then deleted (HTTP
200, `--delete`, notify on → cancellation clears the guest's side too).** So **create → external invite → cancel** are ALL
proven end-to-end. **The whole calendar read+write foundation is now proven.** **✅ "BOOK IT" BUILT (`1f6d4737`, on `main`, owner-gated, deployed + healthy; awaiting Guy's live test):**
(1) `createCalendarEvent(coach, details)` added to `calendarProvider.js` behind the same seam as the read (Nylas
`POST /v3/grants/{grantId}/events?notify_participants=true`, mirrors the proven test; Google path = "read-only, use
Nylas"); (2) `POST /api/wingguy/book` (owner-gated) resolves the full coach (nylasGrantId + clientName), builds a
guest-first title + puts the coach Zoom (new `yourZoom` booking pref) on the invite, creates the event inviting the lead;
(3) extension **"📌 Book it"** button in the reply + times views → a confirm form (date/time + guest email pre-filled via
`/api/calendar/lookup-lead`) → `WG_BOOK` → invite created + emailed. **No LinkedIn send involved (calendar only).**
**Deferred:** ~~Airtable Follow-up/status sync on book~~ **(2026-06-30: DROPPED as a must-do — visibility is already
covered. The lead modal does a LIVE calendar read by the lead's email (`LeadDetailModal.js` → `/api/calendar/upcoming-
meeting-with-lead` → `getUpcomingMeetingsWithAttendee`, 90-day forward window) and shows a green "Meeting booked: …"
banner; Wingguy books the invite using the SAME Airtable-looked-up email, so a booked meeting auto-appears with no sync.
Only revisit a stored status field IF we later need list-level filtering ("show all leads with a meeting"), sequence-halt
(stop LH/thanks nurture on book), or post-meeting history (the live read is upcoming-only).)~~; ~~auto-detecting the agreed
time from the thread (manual datetime entry for now)~~ **(2026-06-30: the manual datetime FORM is gone — the chat agent
reads the whole thread and drives booking conversationally ("They PICKED A TIME → BOOK IT" + confirm-first). RE-SCOPED to
the "warn, don't block" work — see journal "Booking = warn, don't block (2026-06-30)" + ▶ top of You-are-here.)**;
multi-tenant per-client `yourZoom`/grant onboarding (Nylas
hosted-auth connect flow). **NEXT after Guy's live test = those deferred bits, as they prove needed in real use.** Then the Postgres prefs store + conversational editing (seam already isolates this). Real per-message
timestamp capture also shipped this session (`fed2217a`).

**★ BUILT 2026-06-26 (session 1) — THE FULL-SCREEN SHELL + `/wg` TRIGGER + KEYWORD AUTO-DETECT ARE
ON `main`, owner-gated; backend healthy + auto-detect unit-tested.** Commit
`f2d1f5d1`. This is the thanks-for-connecting phase rebuilt into the new shell (the no-tools path that proves the whole
UX). What shipped:
- **Backend auto-detect (`routes/wingguyRoutes.js` + `config/wingguyTemplates.js`):** `POST /draft-thanks` now accepts
  `templateId:"auto"` → `detectTemplate(profile, conversation)` matches each template's **`detectionKeywords`** against
  the **connection-request note (= first thread message) + profile**; **`fractional` → `\frac`, else `\tks`** (the locked
  first-test rule). Returns `templateId`/`templateLabel`/`autoDetected` so the panel shows the pill. Detection is **one
  keyword on `\frac`, none on `\tks`** (catch-all). **Unit-tested 4/4 locally** (first-message match, profile-headline
  fallback, default, empty). Prod `/api/wingguy/status` = healthy after deploy.
- **Extension (`wingguy-extension/content-wingguy.js` + `styles.css` + `manifest.json`):** type **`/wg`** (or
  `/wingguy`/`/wingman`, slash-prefixed) **inside LinkedIn's message box** → a **FULL-SCREEN overlay** takes over (the
  teal launcher is KEPT as a reliable fallback). CONTEXT header shows who + a **mode switch** (thanks/reply,
  auto-routed, overridable) + the **auto-detected template pill with one-tap override** to the other template. Auto-drafts
  on open; **"Insert into LinkedIn"** drops the message at the cursor (the proven AI-Blaze cursor-insert) and **closes the
  overlay** so Guy edits + sends. All `wingguy-*` namespaced, teal, no double-inject with the legacy extension.
- **NEXT (in order):** (1) **Guy's live test** — reload the unpacked `wingguy-extension/`, open the portal once to sync
  creds, go to a real LinkedIn profile/thread, type `/wg`, confirm: trigger fires on the shadow-DOM composer · full-screen
  looks right · auto-detect picks `\frac` on a fractional / `\tks` otherwise · insert lands. **Watch-items** (known
  LinkedIn-DOM risk): the typed-trigger keyup on the shadow/React composer and `scrapeOpenThread` selectors — if `/wg`
  doesn't fire, use the launcher and grab the console; if thread doesn't read, the override pill + mode switch still let
  him proceed. (2) **On-Send → Airtable capture** (the background half — detect Send, full-replace snapshot the thread to
  the Portal; needs the lead-write path wired). (3) Then **Slice 2** booking tools into the same screen.

**★ DESIGN SESSION 2026-06-26 (UX revision; NO code) — THE EXTENSION GETS AN AI-BLAZE-STYLE FULL-SCREEN SHELL + ONE
TRIGGER + KEYWORD AUTO-DETECT + ON-SEND→AIRTABLE CAPTURE. NEXT BUILD = rebuild the thanks-for-connecting phase into the
new full-screen screen FIRST, then slot Slice 2 (booking tools) into it.** Full detail + provenance → journal *"Extension
UX lock — one trigger, full-screen AI-Blaze-style takeover, keyword auto-detect, on-Send capture (2026-06-26)"*. Guy
walked through his live AI Blaze flow (2 screenshots banked). Headlines:
- **Wingguy replaces AI Blaze for this purpose.** Type a trigger (`/wg`/aliases) **inside LinkedIn's message box** →
  full-screen takeover (roomy) → draft shown as a **highlighted block** + refine chat box + model selector → **"Insert
  highlight"** drops only the highlight into the composer → Guy edits → **Guy clicks Send** → on Send, Wingguy
  **full-replace snapshots the whole thread to Airtable** (kills the copy-first chore).
- **Auto-detect, two layers:** phase (thanks vs live-reply — *already built* via `classifyMode()`), then in thanks mode
  the **campaign template by keywords** (matched on profile + connection-request note; default general; human override
  via the CONTEXT-header pill).
- **Why purpose-built:** a screenshot caught general AI Blaze drafting the *first-touch opener* on a thread that had
  already moved to *rescheduling to Friday* — the exact conversation-state blindness Wingguy's engine fixes.
- **NEXT (sequenced 2026-06-26):** build the **thanks-for-connecting full-screen screen FIRST** — proves the whole new
  shell (trigger · full-screen · keyword auto-detect · highlight-insert · on-Send capture) on the no-tools phase, tested
  with the **2 real templates already installed** (`\tks`/`\frac`); only new template work = **add detection keywords**.
  Then the conversation/booking engine (Slice 2) slots into the same screen, de-risked by the one-tool calendar spike.
  *(SUPERSEDES the 2026-06-25 "NEXT CHAT = Slice 2 design" line — Slice 2 still comes, but AFTER the thanks phase is
  re-skinned into the new shell. Backend draft path already works; the work is the UX shell + auto-detect + capture.)*

**★ SESSION CLOSE 2026-06-25 (big build+debug session) — SLICE 1 DONE & PROVEN LIVE ON GUY'S REAL LINKEDIN; both real
templates installed; insert solved. NEXT CHAT = Slice 2 DESIGN session [SUPERSEDED 2026-06-26 → rebuild thanks phase in
the new full-screen shell first; see top block].** Read the dated bullets below for detail.
Headlines of where things stand right now:
- **Slice 1 = DONE and working end-to-end on Guy's real LinkedIn** (fork extension → read profile/thread → pick campaign
  → Sonnet draft on Guy's key → **insert into LinkedIn's box → Guy sends**). The insert was the hard slog (LinkedIn's new
  messaging composer is in shadow/React DOM); solved via the **AI-Blaze "insert at the cursor" model** (see the insert
  bullet below). `\tks` and `\frac` now hold **Guy's FULL literal AI Blaze prompts** (not reconstructions) in
  `config/wingguyTemplates.js` — `\tks` = 3 base messages (Employee/Consultant-Owner/Both) + classification + style
  rules; `\frac` = the fractional **follow-up-after-warm-reply** (4 beats), so the panel now feeds the open thread to
  `draft-thanks` too. All on `main`, owner-gated to Guy.
- **"Read the conversation → then decide what to show" mechanic is LIVE but SIMPLE** (confirmed to Guy): on open the
  panel scrapes the thread + `classifyMode()` shows thanks (no thread) vs reply (thread present); the campaign pick
  inside thanks is human-by-design. **Caveat to verify next session:** thread-reading can miss on LinkedIn's new
  shadow-DOM build (same quirk that hid the composer) → if the panel shows "thanks" while a real conversation is open,
  fix `scrapeOpenThread` selectors. The reply path DID read a full thread live (good Nicola Richards draft), so it works.
- **★ NEXT = Slice 2 DESIGN session (its own chat).** Guy's worry (are we cornering ourselves?) was addressed: NO — the
  extension shell + read-thread + draft→approve→insert→send loop + auth/backend seam all carry over; Slice 2 adds a
  **tool-using agent** alongside (decide the move; if booking → check calendar/create invite/reconcile Airtable →
  confirm). The **user-facing panel keeps the same shape** every situation: *situation → proposed move + draft → approve
  → insert → send* (booking just adds a "do it?" button + a "working…done" step). The booking intelligence is already
  PROVEN in Guy's Claude chat (Tony/Ranya examples = the design brief). **De-risk plan agreed: start Slice 2 with a small
  ONE-TOOL calendar spike** ("they picked a time → check calendar → offer to book") before the full build. Design it
  first, then build.

**As of 2026-06-29 — RECALL SHUT-OFF READINESS: the guest-meeting gap + its fix (live data check, no code).** Checked
the prod store (last ~12d) comparing Recall vs Fathom coverage during the parallel trial. Findings:
- **Fathom is strong** — captured the large majority of meetings, often with *longer* transcripts than Recall; the
  back-to-back splitter is filing per-lead entries live. Most of Recall's "extra" rows are duplicates / tiny no-show
  stubs, not real coverage Fathom lacks.
- **★ Gap = guest-hosted meetings.** A few substantial meetings Recall caught but Fathom missed (recurring *Alasdair
  Bell*; *Paul* walkthrough) — meetings hosted on **someone else's platform** where Guy is a guest and Fathom's
  recorder wasn't admitted (Recall's bot was). Not a bug — a "whose recorder gets let in" problem. (Lianne Grove =
  no-show, ignore.)
- **Fix = Fathom bot-free DESKTOP capture** (now on Windows): records Guy's machine audio locally regardless of host
  → no bot-admission battle; lands in the same Fathom library → flows through the existing ingest with **NO new code**.
  Enable: install `fathom.video/download/win`, log in to the **SAME** Fathom account (key in Airtable Client Master),
  connect calendar, turn on **Auto-record**, use bot-free / "Capture Now".
- **Zoom API ruled out** for this — only the *host* can pull a Zoom recording/transcript via API; as a guest Guy can't
  reach others' recordings.
- **Go-live gate before flipping Recall off:** (1) enable desktop capture + Auto-record; (2) test on a real
  guest-hosted meeting; (3) **verify the desktop capture carries calendar-invitee data so lead-matching still links
  the right lead** (else it falls back to name-match) — the one unverified assumption. THEN set env
  **`RECALL_AUTO_JOIN_DISABLED=true`** (reversible; stops usage-based Recall cost). **Keep Recall ON until that test
  passes** — guest meetings are exactly what it's still catching.

**As of 2026-06-25 — ★ OPTION A BUILT: thread-aware auto-routing + reply engine (front edge of Slice 2; on `main`,
owner-gated; backend proven live, awaiting Guy's live LinkedIn test).** Built on the Slice 1 base when Guy asked for
"read the conversation and work out whether it's a thanks-for-connecting or a follow-on." Deliberately the SMALL half
of Slice 2 — read + classify + a single-call contextual reply, **NO tools** (no calendar/Airtable/booking; that stays
the full Slice 2 with its own design session). All additive, day-to-day untouched.
- **Auto-routing in CODE (deterministic, no AI):** the panel reads the open LinkedIn thread (`scrapeOpenThread()` —
  labels who-said-what via `.msg-s-message-group__name` carried across grouped bubbles) and `classifyMode()` routes:
  real thread → **reply**, else → **thanks-for-connecting**. A **human-overridable mode switch** sits at the top of the
  panel (auto-detect can be wrong → Guy flips it). Draft step generalised (regenerate/back callbacks), shared by both.
- **Backend `POST /api/wingguy/draft-reply`** (single Sonnet call, prompt-cached `WINGGUY_VOICE` + new
  `WINGGUY_REPLY_INSTRUCTIONS`): reads the whole thread + profile, picks the move (warm / question / objection /
  time-picked / stall / cancellation), drafts the next message. **Honest boundary baked into the prompt:** no calendar
  access → never asserts specific availability or claims it booked anything; offers loosely + leaves an easy out.
- **✓ PROVEN LIVE (Render one-off job, real Claude, 2026-06-25):** fed the "Tony / allergic-to-pitches" thread → got a
  register-matched, objection-defusing, loosely-offered-Zoom reply with the softener intact (`mode:reply`,
  `claude-sonnet-4-6`). The thanks path (`draft-thanks`) was proven the same way (Jane/fractional). **Only the LinkedIn
  DOM read (profile + open-thread scrape) + the composer insert remain for Guy to prove on a real page.**
- **Earlier same effort:** robust profile-name read (page → title → `/in/` slug fallback) + launcher moved to mid-right
  so it stops covering the legacy "Save to Portal" button.
- **★ FORMATTING-PRESERVING INSERT SOLVED — "insert at the cursor", AI-Blaze model (2026-06-25):** the long fight to
  push the draft into LinkedIn's message box is **working**. Root cause of the struggle: LinkedIn's newer messaging
  composer isn't a findable light-DOM `contenteditable` (diagnostic showed only `<input>`s + open shadowHosts; the
  editable is in shadow/React and only mounts when the box is open). **The fix is to stop *finding* the box and instead
  insert at the user's CURSOR** — exactly how AI Blaze works (Guy confirmed: AI Blaze only inserts when the caret is in
  the box; its button-only path offers Copy). Mechanism (in `content-wingguy.js`): (1) track the last focused editable
  via a composed `focusin` listener + `deepActiveElement()` (descends into open shadow roots); (2) the **Insert button
  uses `mousedown`→`preventDefault()` so it doesn't steal focus** from the message box; (3) insert via
  `execCommand('insertText')` at the caret (keeps line breaks), `setRangeText` for textarea; (4) **trust a successful
  `execCommand`** — the earlier strict innerText re-read gave FALSE "didn't take" negatives on the shadow/React editor.
  **Required UX:** the user must **click into the message box first** (now shown as a "1. Click in the box → 2. Insert"
  tip). **Copy** is the fallback and now writes `text/html` so a paste also keeps line breaks. *(Verified by Guy: text
  lands in the box; was only the false-failure message + the non-obvious click-first step left, both now fixed.)*
- **★ TEMPLATES VOICE-TUNED TO GUY'S REAL AI BLAZE (2026-06-25, from a real A/B — Josh Seaman):** Guy compared
  Wingguy's `tks` draft vs his actual AI Blaze `\tks` and **preferred AI Blaze** (more natural + humble; Wingguy's was
  slightly self-referential — "the network I'm building" — and asserted a trait not on the page). Fix = **few-shot
  exemplars**: each template (`tks`, `frac`) now carries its **exact beat-structure + sign-off + a WORKED EXAMPLE of
  Guy's real output** (Josh `\tks`, Mary Anne `\frac`), and the shared VOICE block leans **plain + GIVING** (value on
  them, hook must be INTERPRETED not a quoted tagline). Sign-offs corrected: `tks` → "Talk soon / I know a (Guy)",
  `frac` → "(I know a) Guy". **✓ Proven live (BOTH):** re-ran Josh `\tks` → ≈ his AI Blaze version (same opener,
  interpreted hook, giving line, two-way-collaboration ask, sign-off); and Mary Anne `\frac` → grounded interpreted
  hook + network-vision + "(I know a) Guy", and it correctly opened **"Great to connect"** (the cold first-touch
  opener) rather than the example's reply-style "Glad that landed" — i.e. the structure guidance overrode the example
  where they conflicted. (If Guy ever wants the "Glad that landed" reply variant, that's the Reply-mode job, not cold.) **Few-shot worked example = the single biggest
  voice lever; pasting Guy's literal shortcode text over the examples is the final close (the Slice 3 migration done
  early for these two).** Lives in `config/wingguyTemplates.js`. Open nit: Wingguy's hook ran one clause longer than
  AI Blaze's tighter version.
- **★ THIN-PROFILE SCRAPE HARDENED (2026-06-25, from a real miss — Mary Anne Lamssies):** symptom = generic draft +
  "couldn't read About"; root cause = LinkedIn **lazy-loads** profile sections (About/Experience absent until scrolled)
  AND structured selectors missed → the model drafted **blind** (the AI Blaze `\frac` only looked better because it had
  the data; same model + same text ≈ same quality). Fix = **(1)** `autoScrollToLoad()` steps down the page to force lazy
  sections in, then restores scroll; **(2)** capture `main.innerText` as a **raw `pageText` grounding fallback** — the
  backend includes it (bounded) when structured About is thin, and the prompt **mines it for the hook + ignores
  nav/boilerplate**; **(3)** prompt forbids meta "Note:" commentary + `stripMetaCommentary()` backstop; sign-off defaults
  to **"(I know a) Guy"**. **✓ Proven live:** raw-pageText-only (boilerplate mixed in) → a specific, grounded hook
  rivalling AI Blaze, no leaked note. Open: does the extension's scroll actually surface About on Guy's real pages (his
  live retest) — if not, lock exact selectors from his DOM. **Design note for future: raw page text is a legitimate,
  robust grounding source vs LinkedIn's class churn — keep it.**

**As of 2026-06-24 (session 2) — ★ SLICE 1 BUILT END-TO-END (fork + personalised thanks-for-connecting; on `main`,
owner-gated to Guy; awaiting Guy's live LinkedIn test).** First Wingguy *code*. All additive, day-to-day untouched.
What got built:
- **Backend (additive, owner-gated, on `main`):** new route `routes/wingguyRoutes.js` mounted at **`/api/wingguy`**
  behind the existing auth middleware (`req.client`) + an **owner gate (`Guy-Wilson` only)** + kill-switch
  `WINGGUY_DRAFT_ENABLED` (default on). Endpoints: `GET /status` (public — `{enabled, aiConfigured}`),
  `GET /templates` (the quick-pick set), `POST /draft-thanks` `{templateId, profile}` → `{draft, model}`. **ONE AI
  call, NO tools.** Model = **Sonnet** (`WINGGUY_DRAFT_MODEL_ID`, default `claude-sonnet-4-6` — deliberately NOT the
  repo-wide Opus default), **stable voice/rules system block prompt-CACHED** (`cache_control: ephemeral`).
- **Templates seeded directly** in `config/wingguyTemplates.js` (NO Postgres — Slice 3 owns the store + the
  Notion→Postgres migration): `tks` (general) + `frac` (fractional), encoding the documented voice beats + the three
  back-test rules (ground-the-facts / keep-the-softener / passion-first hook). ⚠ The instruction text is reconstructed
  from the doc's voice seed — **Guy can paste his real `\tks`/`\frac` AI Blaze text to swap them in** (the pipe is
  identical; the swap is really Slice 3's de-personalisation work).
- **Extension fork `wingguy-extension/`** (copy of `chrome-extension/`, old one byte-untouched + still installed):
  manifest renamed **"Wingguy (LinkedIn)"**, DOM namespaced **`wingguy-*`**, **visually distinct (teal)**. Reuses the
  auth plumbing by copying (`background.js` + `content-portal.js`). **New focused content script `content-wingguy.js`**
  on `/in/` pages (deliberately does NOT carry the legacy "Save to Portal" messaging surface → no double-injection with
  the old extension). Flow: teal launcher → reads profile (name/headline/About auto-expand "see more"/light recent
  activity) → template quick-pick buttons (with "use when" hints) → backend draft → editable panel →
  **formatting-preserving Insert** into the LinkedIn composer (writes `<p>`-per-line + input event; **Copy** fallback)
  → human clicks send.
- **Deferred, in scope (Slice 2+):** replies/booking/conversation engine, Postgres rules store + "manage templates"
  screen, metering/$50 trial, multi-tenant, auto-advance, campaign auto-tracking, save-reminder-to-Gmail, the
  soft-default template *suggestion*.
- **REAL NEXT:** (1) **Guy's live test** — load the unpacked `wingguy-extension/` (dev mode), open his portal once to
  sync creds, go to a real LinkedIn profile, draft + insert + send; tune the seeded templates / scraping selectors from
  what he sees. (2) Then **Slice 2 (the conversation engine) gets its own design session** (Tony + Ranya as the brief).
  *(Automated proof done from here: `/api/wingguy/status` live-checked after deploy; full draft path exercised via a
  Render one-off job with the dev key — see commit notes. The LinkedIn DOM read + insert can only be proven by Guy on
  the real page.)*

**As of 2026-06-22 (discussion + live verification, no extension code) — EXTENSION: panel data model + full cost/
quality + commercial model settled.** Deep session; full detail → journal *"Extension — panel data model, cost/quality
model, commercial model & voice seed (2026-06-22)"*; canonical AI-model + pricing lines updated. Headlines:
- **Panel = foreground draft / background capture.** Draft is the foreground job; full message snapshot
  (**full-replace, never delta**) + contact reconcile (**speak only on mismatch**) run silently in the background →
  no ingest wait. **Unified view = Portal record + live page; Portal = record, not cache;** re-pull is human-triggered
  when working a lead. **Recent posts** added as a draft source. *(Corrected the earlier "hydrate once → warm forever"
  — wrong for messages.)*
- **Summary-not-raw is ALREADY BUILT** (`recall_meetings.summary_json`, Gemini, once + cached). Drafter reads the
  summary; pulls raw only on shortfall (deterministic triggers + on-demand fetch).
- **Cost driver = drafting, esp. agentic flows** (context re-send across tool rounds), not summaries. Levers:
  **caching + Sonnet-default/Opus-escalation**; routing decided by **code up front from facts** (transcript / deep
  thread / post-call) + a human **"sharpen" button**. Start all-Sonnet + button, auto-route later from back-test.
- **Model finding:** prod summary/scoring defaults to **Gemini 2.5 PRO, not Flash** (canonical corrected; verify +
  switch to Flash before scaling lead-scoring). Claude client defaults to **Opus** (set Sonnet-default deliberately).
- **Commercial model:** **flat $50/mo on Guy's key** (NOT metered billing), **500-action free trial**, **~3,000/mo
  daily-cap backstop (~150/day)**, **"action" = an AI write incl. redos** (not reads/clerical), **no paid counter /
  trial counter only**, **stickiness-first pricing** ($50 now → grandfather → ~$100 later). **Who-pays CORRECTED:**
  heavy work is in the EXTENSION (Guy's key), a consumer Claude sub can't power a panel — so Guy's-key-billed-via-
  pricing, BYO-key outlier-only; the connector is where "their Claude" actually fits.
- **Claude-in-Chrome re-confirmed OUT** — backend-control reasons reinforced by today's design.
- **Voice seed banked** from ~20 real threads + AI Blaze prompts (templated beats + implicit judgment rules); **★
  ground truth = Guy's judgment/preference, not his sent history; bar = considered best, not rushed average.**
- **★ BACK-TEST DONE (model axis) + DECISION:** ran real Opus-vs-actual-Sonnet on 5 real threads → **Sonnet
  validated as the default** (holds on templated voice AND judgment); **DECISION = Sonnet-default + manual
  "sharpen" (Opus) button + code auto-route the heavy/witty.** Three rules fell out: **ground the facts** (no
  confabulation), **keep the softeners** (easy-out on proactive bookings), **Opus for wit/register-match**.
- **★ SURFACE/COST SPLIT (resolves the post-call worry):** transcript-deep / post-call work = **CLAUDE CHAT +
  MCP on the CLIENT'S Claude (their cost)**, NOT the extension; the **extension is the pre-call LinkedIn/booking
  layer (Guy's key, Sonnet, summary-suffices)**. So post-call quality + cost both move off Guy's key →
  **summary-vs-raw test downgraded to nice-to-confirm.** (Refines the "second front door" → connector, not panel.)
- **✓ PHASE-0 AUTH RECON DONE (2026-06-22):** auth layer is solid + reusable — per-client `Portal Token` (Airtable)
  → `x-client-id`/`x-portal-token` headers → `req.client`; **the off-switch (Active→403) and tier gating
  (`requireServiceLevel`) + `features.*` flags already exist** (free wins); `ash-backend`/`ash-attributes-api` off
  the critical path. Net-new backend = drafting-agent endpoints + action-counter/cap. Detail → "Existing extension
  recon" §VERIFIED. **Runway clear — nothing blocks the fork.**
- **REAL NEXT = Slice 1 of the Build plan (above): Fork + personalised thanks-for-connecting** (single-tenant Guy,
  no tools, templates seeded directly, Sonnet). Proves the end-to-end plumbing; Slice 2 (the conversation engine)
  then gets its own design session. **No extension code yet; day-to-day untouched.**

**As of 2026-06-21 (planning, no code) — CHROME EXTENSION: build mechanic + 4 operational questions settled.**
Discussion-only session as Guy moves onto the extension (the next real build). Full detail → journal *"Chrome
extension — fork-and-run-two, distribution, cost caps, scope & client lifecycle (2026-06-21)"*; the stale "NOT
a new extension" line in **Existing extension recon** is now annotated with the refined mechanic. Headlines:
- **Build mechanic = FORK, not in-place edit.** Copy `chrome-extension/` → a parallel **`wingguy-extension/`**,
  build the product in the copy, keep the old installed + working (**zero disruption**), run two side-by-side,
  decommission the old when proven. Still "fold in, don't rebuild" — reuse the code by *copying*. **Gotcha:**
  namespace the fork's DOM ids/classes (`wingguy-*`) + make it visually distinct, else both inject on LinkedIn
  and collide.
- **Distribution:** unpacked/dev-mode now (**skips Google review** — already the method, fine for build + early
  trusted clients) → **Chrome Web Store "Unlisted"** at wider client rollout (auto-update, no dev-mode nag).
- **AI cost:** reaffirm **Guy's-key-as-COGS for the panel**; correction — a client "key" = a per-token *developer*
  account (their flat Claude.ai sub has NO key; flat-sub reach = the MCP connector = cockpit, not panel); any key
  lives in the backend, never the extension; **BYO-key = outlier pressure-valve only**.
- **Caps:** count **drafts/actions (client-facing), meter tokens underneath**; **watch-then-enforce** (no cap day
  1, add before rollout); one allowance first, split heavy post-call emails only if numbers warrant.
- **Scope:** **fixed-button panel + backend-only job paths + instruction-rules = out-of-scope blocked by design**
  (only watch free-text boxes).
- **Client lifecycle:** **central server-side off-switch** (idle = ~$0/no action; non-paying = flip inactive,
  ties to Stripe, graceful "paused", reversible, never touch their machine; same gate as `features.thanksForConnecting`).
- **Multi-tenant content model (clarified this session, captured in "Rules de-personalisation"):** three layers
  — **code** (one copy, identical for all) · **shippable template** (de-personalised defaults the client owns a
  copy of, seed-then-diverge) · **un-shippable** (Guy's private originals + each client's generated state). The
  test for template-vs-private = "would this still be true/useful for someone who isn't me?". Build everything
  **tenant-keyed from day one** (default = Guy), so going multi-tenant = "stop hardcoding", not a rewrite.
  **Sorted further (new section "Where each thing lives — code vs rule vs variable…"):** not every "rule" is a
  Wingguy-rule (data-integrity/ingestion = CODE, fixed; method/judgment = tunable RULE; identity/preference =
  VARIABLE); **surface-tells-the-bucket** heuristic (Claude Code = code · "from now on when X" = rule · "my
  name/link" = variable); the **graceful boundary** (client asks past the tunable surface → fix the in-scope
  bit, be honest, **escalate via a flag tool**, never ignore/fake; doubles as a cross-tenant bug feed); and the
  channel = **flag to a QUEUE, not Guy's inbox** (Claude owns the client ack + first-line-filters; email only
  for rare urgency as a digest — protects the ~100-clients-on-~3-days scaling model).
- **Notion → Postgres (refined):** Notion = a legacy SOURCE everyone migrates FROM, **Guy included** (he's
  tenant 0). Storage is trivial + cheap; the real work = the rules **editor** + the **one-time migration (only
  Guy has one)**. Additive/prove-before-switch: Guy's cockpit keeps reading Notion until the Postgres path is
  proven, then re-points. Most of this was already in the doc; only the "Guy-migrates-too" delta was new.
- **REAL NEXT:** start the fork — `cp -r chrome-extension wingguy-extension` (rename in manifest) + finish the
  Phase 0 recon on the auth wiring (`content-portal.js` / `/api/linkedin` / `/api/extension-config`,
  `clientId`/`portalToken` issuance) before bolting on the injected panel. **No code yet; day-to-day untouched.**

**As of 2026-06-20 (session 2) — "THANKS FOR CONNECTING" WORKLIST v1 BUILT + VERIFIED LIVE (Guy-first, per-client gated; on `main`).**
The designed worklist tab is now coded end-to-end and proven against Guy's real prod data — additive, gated, daily flow untouched. Built on the schema
provisioned earlier today (`Thanks Status` on all Leads tables; `Thanks for Connecting` Yes/No + `Connection
Lookback Days` on master Clients; Guy's gate flipped **Yes**). All on `main` (no `dev`/`staging` service in play here).
- **Backend gate plumbing:** `clientService` now maps `thanksForConnectingEnabled` (master "Thanks for Connecting"=Yes)
  + `connectionLookbackDays`; `/api/auth/test` surfaces `features.thanksForConnecting` so the portal shows the tab
  only for enabled clients.
- **New route `routes/thanksForConnectingRoutes.js`** (mounted `/api/thanks-for-connecting`): `GET /worklist?view=outstanding|all`
  (Connected · Date Connected not blank · `Days Since Connected ≤ lookback`; Outstanding also needs `Thanks Status` blank;
  oldest-first = inbox-zero) + `PATCH /lead/:id {thanksStatus: Messaged|Let go|null}`. **Per-client gate enforced server-side**
  (403 if off) on top of a process kill-switch `ENABLE_THANKS_FOR_CONNECTING` (default ON; per-client switch is the real rollout control).
  Lookback default 14 when blank; `?days=` override.
- **Frontend:** `components/ThanksForConnecting.js` + `app/thanks-for-connecting/page.tsx` — two views (Outstanding / All recent),
  live "N to thank" badge, row = name→LinkedIn profile · headline/company · "connected X days ago" · **Messaged** (primary) / **Let go**
  (secondary), optimistic remove + Undo toast, "all caught up 🎉" empty state. Nav tab added in `Layout.js` after Top Scoring Leads,
  **gated on `features.thanksForConnecting`** (handshake/wave icon). `next build` passes.
- **★ DESIGN-PREMISE CORRECTION (2026-06-20, Guy, from live data) — "connected" = `{Date Connected}` is set, NOT
  `{LinkedIn Connection Status} = 'Connected'`.** The 2026-06-19 spec assumed new connections land as status `Connected`;
  prod proved otherwise (probe via Render one-off job): the `Connected` status value is a **stale historical state** (newest such
  lead = 325 days old), while **live inflow lands as `Candidate` with a fresh `Date Connected`** (231 in the last 30 days). Guy's
  rule: **blank Date Connected = not connected; set = connected** (matches his Airtable "Date Connected is not empty" view = 1,539
  real connections). So the worklist keys **purely off `{Date Connected}`** (presence + lookback window) and **ignores
  `{LinkedIn Connection Status}` entirely** (`1e96760a`). See memory [[reference_connected_means_date_connected_set]].
- **VERIFIED LIVE (2026-06-20, against Guy's prod base via curl + Render probe jobs):** `/worklist` 200s with the gate ON for Guy
  (proves clientService→auth gate→`thanksForConnectingEnabled=true`); after the filter correction the default 14-day Outstanding
  queue returns **87 real leads, oldest-first** (14d→0d, names/headlines/LinkedIn URLs populated); `PATCH /lead/:id` round-trips to
  Airtable (Messaged→count drops→restored to null cleanly). Lookback defaults to 14 (Guy's `Connection Lookback Days` blank).
  **One caveat I did NOT verify:** the portal *tab visibility* (Layout reads `features.thanksForConnecting` from `/api/auth/test`,
  which needs a real portal token — testClient mode returns LINK_UPDATED, so I couldn't curl it). Guy opening his own portal is the
  final check the tab renders for him (and is absent for a non-gated client) and the 87-item Outstanding queue looks right.
- **REAL NEXT:** Guy eyeball-checks the tab in his portal; then v1 = freehand note (Guy uses AI Blaze externally); v2 = the
  **LH message-sent webhook auto-resolve → "Let go"** (reuse the one LH webhook) + extension auto-advance. Roll out to a 2nd client
  by flipping their master switch to Yes once Guy's happy.

**As of 2026-06-20 — FATHOM "CONTENT READY" WEBHOOK + MULTI-TENANT RECORDING FOUNDATIONS + NYLAS CALENDAR DOGFOOD — ALL SHIPPED & VERIFIED LIVE.** Big build session (all additive, kill-switched, Guy-default-safe, daily flow untouched). Full detail → memory `project_recall_to_fathom_migration`. Headlines:
- **Fathom "content ready" webhook LIVE** (`c311609a`) — push replaces the ~5-min poll lag; same Svix HMAC as Recall (reuses `verifyRecallWebhook`); registered with Fathom (id `ZVa_DLhYLngu5Pyx`); gates `FATHOM_WEBHOOK_ENABLED`+`FATHOM_LIVE_FROM`+`FATHOM_INGEST_ENABLED`; dedup no-op; poll kept as backstop. Verified (tampered→401, fake→graceful, real→"already ingested").
- **Multi-tenant recording foundations LIVE** (`6d61f455`) — (#3) `recall_meetings.coach_client_id` stamp (243 rows backfilled to Guy); (#2) `fathomPollService.pollAllFathomTenants()` polls every Active client with a Fathom key under their own id; (#5 data-layer) `getMeetingQueue`/`getMeetingsForLead`/`getMeetingById` take optional `coachClientId` filter (live surfaces still pass nothing → identical for Guy). 12/12 checks via `scripts/test-multitenant-recording.js`. **Deferred (has teeth):** per-request tenant resolution at consuming surfaces, per-tenant webhook URLs.
- **Nylas calendar dogfood LIVE for Guy as client 0** (`8f26e522`,`7c816eef`) — proper per-client config: `NYLAS_API_KEY` in shared env-group "Authentication & API Keys"; **grant + provider in Airtable Client Master** (`Nylas Grant ID`, `Calendar Provider=nylas`); `clientService` reads both; service-level `NYLAS_*` env vars removed. Verified live (`scripts/nylas-check.js --live` → `provider=nylas` from Airtable, 36 real events). Splitter now reads Guy's calendar via Nylas; degrades to single on failure; Recall backstop. **Calendar ONLY — email/Gmail untouched (Nylas-email = separate deferred step).**
- **Next picks:** real client #2 onboarding (their Fathom key + Nylas grant + connect flow); per-request tenant resolution; Nylas email piece; and the still-pending Recall-off **switchover** after the clean trial.

**As of 2026-06-19 (session 3, planning/no code) — "THANKS FOR CONNECTING" WORKLIST DESIGNED:** Brainstorm-only
session on the backlog connection-follow-up worklist; backbone re-verified in code, UX + status model settled.
Full spec → journal *"Connection follow-up worklist / 'Thanks for Connecting' — design (2026-06-19)"* + the
canonical Backlog entry (now marked DESIGN SETTLED). Headlines: **inbox-zero** list, oldest-first, two views
(Outstanding + All recent); statuses **Outstanding → Messaged (manual tick) / Let go (LH sent)**; **auto-resolve
via reusing the ONE existing LH webhook** (message-sent ping → Let go), replacing the mirrored-window idea; the
only catch = **$8 LH tier's 20-webhooks/day cap** → make message-sent optional (gentle upsell to the $20
unlimited tier). Guy-first then portal; v1 manual tick, v2 = extension magic. **No code, day-to-day untouched.**
**Real next:** (1) Guy confirms the exact LH webhook step + payload; (2) decide naming ("Thanks for Connecting"
vs "Connections"/"Follow-ups"); (3) freehand vs AI-draft for v1; then it's a small build (a view + a dedicated
Airtable tick-field + a thin message-sent webhook tap).

**As of 2026-06-19 (session 2) — SPEAKER RECONSTRUCTION BUILT + CLAUDE WIRED (shipped to `main`, flag OFF, awaiting cloud test):**
Claude is now wired into the backend (first consumer of the swappable seam) and the full speaker-reconstruction
trust layer is built — both halves on `main`, fully inert until the flag flips. Two commits: backend (`config/anthropicClient.js`
+ `@anthropic-ai/sdk` + reconstruction service/endpoints + DB columns) and frontend (the confirm card). **Kill-switch:
`SPEAKER_RECONSTRUCTION_ENABLED` (default off ⇒ import path behaves exactly as before; `/reconstruct` 403s; the card never renders).**
- **Claude client:** `config/anthropicClient.js` — `new Anthropic()` reads `ANTHROPIC_API_KEY` (live in the Render "AI Service
  Configuration" group, linked to main + staging); model env-switchable `CLAUDE_MODEL_ID` (default `claude-opus-4-8`). Adaptive
  thinking + `effort:high` + streamed + structured output. Gemini/OpenAI untouched.
- **Detection (plain code, no AI):** `services/speakerReconstructionService.js` `detectSingleSpeaker` counts distinct labels.
- **Reconstruction (Claude):** re-derives intro direction; a free-text correction propagates across the whole mislabelled stretch.
- **DB:** `recall_meetings.reconstruction_status` / `reconstruction_json` (additive, auto-migrated via `ensureSchema`). Canonical
  `transcript_text` NOT overwritten until the human confirms.
- **Import path:** detect on ingest → if flagged, reconstruct + mark `pending` and **defer the summary** (chosen 2026-06-19:
  never summarise off a mislabelled transcript) → clean multi-speaker passes straight through with the inline summary as before.
- **Endpoints:** `POST /recall-review/:id/reconstruct` (run/re-run + correction), `POST /recall-review/:id/confirm-reconstruction`
  (commit canonical + regen summary off it). Confirm card surfaces ONLY the high-stakes lines + a "run another pass" button.
- **Env model (clarified by Guy 2026-06-19 — see memory [[feedback_pervasive_change_approach]]):** work in `main` by default;
  for major/risky work, OVERWRITE the `staging` branch (its Render+Vercel already have the env vars wired) rather than a fresh
  feature branch. Branches are deliberately NOT kept in sync — `staging`/`dev` staleness is normal, NOT abandonment. Frontend
  shipped to `main` flag-gated (Vercel build lenient — `typescript.ignoreBuildErrors`).
- **FLAG IS ON IN PROD (2026-06-19):** `SPEAKER_RECONSTRUCTION_ENABLED=true` set on the prod service (`pb-webhook-server`,
  `srv-cvqgq53e5dus73fa45ag`) + redeploy triggered. Rationale (Guy): single-tenant (only Guy uses recall-review), low-frequency,
  not the default path (only fires on single-speaker pastes), graceful failure (fall back to pasting into Claude). Dogfooding IS the test.
- **REAL NEXT (in-use test, Guy-driven):** next time a dodgy/single-speaker transcript comes up (Alicia/Alisdair Zoom-Notes is the
  origin case), paste it into recall-review and watch: single-speaker detection fires, Claude reconstructs, the card shows the intro
  direction, a free-text correction re-renders, confirm regenerates the summary off the corrected text. Clean multi-speaker pastes
  must pass straight through (no card). Watch token cost on a real 90-min transcript (re-emits the full transcript;
  `CLAUDE_RECONSTRUCT_MAX_TOKENS` default 32000). If intro direction comes out wrong, no disaster — fall back to manual Claude.

**As of 2026-06-19 (planning, no code) — NEXT BUILD CHOSEN + provider audit:** The next Wingguy build is the
**speaker-reconstruction-on-paste** feature (spec locked — see canonical Backlog + journal "Speaker
reconstruction on transcript ingest (paste path)"): always show the confirm card · single-speaker **detection
in plain code (no AI)** · **reconstruct only on detection-or-demand** (+ a manual "run another pass" button) ·
free-text correction that **propagates across the mislabelled stretch** · surface only the high-stakes lines
(intro direction / who-knows-whom / commitments) · **regenerate the summary off the corrected version**. The
paste path already exists more than the doc implied (`importTranscript` in `recallImportService.js`: source
dropdown, lead-link, inline Gemini summary, `recall-review` page) — this adds the trust layer. **Reconstruction
model = Claude `claude-opus-4-8`** (a reasoning job, not Gemini-Flash scoring). **Gated on a prerequisite:
Claude is NOT yet wired into the backend** — a small job (API key + `@anthropic-ai/sdk` + a tiny
`config/anthropicClient.js`; needs an Anthropic API account). Provider audit → **end-state = Gemini scores ·
OpenAI runs the Start Here help-Q&A (embeddings, no Claude equivalent) · Claude drafts/reasons; all three
intentional, nothing to migrate.** Journal: "Wiring Claude into the backend + AI-provider audit (2026-06-19)".
**Real next actions:** (1) create the Anthropic API account + add `ANTHROPIC_API_KEY` to Render + `.env.local`;
(2) add `config/anthropicClient.js` behind the seam; (3) build detect → reconstruct → confirm-card →
store-confirmed on the existing `importTranscript` path, regenerating the summary from the confirmed transcript.

**As of 2026-06-17 — FATHOM MIGRATION IS LIVE (go-live shipped; supersedes the 06-15 "real next = go-live list" below):**
The Fathom capture pipeline now runs in **production**, additive + kill-switched, in its **trial period alongside Recall**
(Recall still recording as the safety net — NOT yet turned off). Shipped + enabled today:
- **Auto-ingest trigger** — `services/fathomPollService.js`, in-process poll every **5 min** (`FATHOM_POLL_ENABLED`),
  gated by `FATHOM_LIVE_FROM` cutoff (`2026-06-16T01:33:23Z`) + `FATHOM_INGEST_ENABLED` for writes; dedup via new
  `recall_meetings.fathom_recording_id` (idempotent — re-poll never double-files).
- **Prefer-Fathom + loud fallback** read path — `latest-transcript-by-email` returns the Fathom copy of the latest
  meeting; when it must serve Recall for a **post-cutoff** meeting it attaches a loud `sourceNotice` (baked into the
  transcript so the MCP surfaces it). No whinging about historical Recall-only meetings.
- **Splitter false-split guard** — `fathomSplitService.eventLeadSpeaks`: only split a back-to-back when the second
  meeting's lead ACTUALLY speaks. Kills phantom splits from overrun-into-cancelled-slot / duplicated calendar events.
- **Proven on real data:** JB+Julian back-to-back split correctly into two named, lead-matched meetings; Al's call
  (overran into Courtney's cancelled slot) correctly filed as ONE meeting after the guard. First real write = Shoma.
- **Remaining:** (a) store Nylas creds on Render (still sandbox-only — prod calendar reads use Google, fine for Guy);
  (b) Fathom **"new meeting content ready" webhook** to replace/augment the poll (kills the ~5-min lag); (c) **switchover**
  (Recall off) once the trial is clean for ~2-3 wks; (d) **tenancy** stamping (deferred); (e) ~~email-identity hardening~~
  **✅ SHIPPED 2026-06-17** (multi-email per lead + self-healing write-back — see Next steps). Live status of record =
  memory `project_recall_to_fathom_migration`.

**As of 2026-06-17 (session 2) — WEBSITE + CONTENT STRATEGY + CONNECTOR/AUTH (planning, no code):**
Triggered by JB's blunt website critique on his 09:30 onboarding call. New section above —
**"Website + content strategy, and the one-connector / auth path (2026-06-17)"**. Headlines: website's
job = credibility + conversion (NOT lead-gen); WordPress = single source of truth with a per-page
public/Private flag (worldview public, IP Private, Wingguy reads both); content surfacing = pull
(reactive) vs push (worldview — Wingguy manufactures the trigger); deliver Wingguy as **ONE** remote MCP
connector (fits free Claude's 1-connector cap → free-tier wedge); connector auth = a **bolt-on provider**
(WorkOS AuthKit, free to 1M MAU) not hand-rolled OAuth — clients log in once via "Sign in with Google",
persistent, $0 at our scale. **No code; day-to-day setup untouched.** Next: pick the website read-only
access path (WordPress REST API + app password) + start the editorial tagging pass on the essays. Also added this session: a **competitive-position** note
(own-the-niche-the-giants-won't-serve; moat = packaging/trust not novelty; platform-eats-product wildcard)
+ the **scaling model** (3 levers; **3rd lever = a Wingguy-seeded intro-MESH, NOT a community Guy runs** — Guy's hard constraint is NO recurring
meetings (he's done years of that grind); Wingguy matchmakes + drafts double-opt-in intros, Guy just
approves; belonging-moat trade resolved as a *good* one for this buyer (emotional belonging →
economic/relational stickiness, tuned-state carries the weight)).
**Session-2 cont. (economics + path to 100)** — new section **"Economics, time-load & targeting — the path
to ~100 clients"**: ICP = frequency-of-use not title (fractionals split); onboarding = delegated
relationship investment whose real job is **activation** not rapport; stage the reveal but don't drag out
Wingguy activation (basics = least sticky); **+$50 = penetration price / near-pure margin** (grandfather
early adopters, raise later, framing flips); VA ~AUD $1.5–2.5k/mo (one VA ~50–80, ~1.5–2 by 100);
**100-client P&L ≈ net AUD ~$22k/mo (~$265k/yr, ~78% margin)** with take-rate barely moving revenue;
**~3 days/week feasible if held** (cap dev + acquisition, hire down creep); LinkedIn = renting a solved
network, so 100-at-low-touch is gated on productised onboarding + Wingguy-delivered coaching, NOT community.

**As of 2026-06-18 (planning, no code) — DIRECTIVES vs CLIENT'S GENERAL CLAUDE MEMORY:** new subsection
**"Keeping Wingguy directives in Wingguy, not the client's general Claude memory"** (under the connector/auth
section). Resolves Guy's worry about onboarding a client whose own Claude already has a full memory: don't try
to *prevent* leakage into native memory (unwinnable — it's Anthropic's, in their Claude) — instead make
**Wingguy deaf to general memory** (server context built ONLY from our Postgres store) so any leaked copy is
inert, and **own the save-path** via the existing `teach-rule`/Commit write-door with an **assertive tool
description** that routes "from now on…" changes to the tool, not native memory. Two concrete to-dos noted.
Day-to-day setup untouched.

**As of 2026-06-18 (capture, no code) — SPEAKER RECONSTRUCTION ON TRANSCRIPT INGEST:** flagged a new backlog
feature from a real mucked-up call (Alicia/Alisdair, 18 Jun — Zoom→Teams, captured by Zoom Notes with NO
diarisation; auto-notes reversed the intro direction). Non-Zoom captures arrive all-host-labelled → who-said-
what is untrustworthy for the lines that matter (intros/direction, who-knows-whom, commitments). Proposed flow
captured: source dropdown → single-speaker detection → AI reconstruction → **human confirm card** ("done my
best, may not be right — check it?") → store only the confirmed version; clean transcripts pass straight
through. Principle: AI detects+reconstructs, the human (who was in the room) confirms direction = the feature.
Added to the canonical **Backlog** block, a full journal section **"Speaker reconstruction on transcript ingest
(paste path)"** (sits in the transcript cluster next to the universal-paste seam, item 5), a topic-map pointer,
and a ⚠ cross-link on the universal-paste item. **Not yet spec'd — discussion + an item to be done.**

**As of 2026-06-18 (doc hygiene) — TOPIC MAP + DEDUP PASS:** full end-to-end read of the doc. Added a
**🗺 Topic map** near the top (skim + Ctrl-F before adding, to stop duplicates as it grows) + a **scan-first**
rule in the header. Reconciled the one genuine contradiction found — the **AI-account / who-pays** story (the
early "clients need no AI account / Guy's COGS" line is **panel-only**; the connector/cockpit runs on the
**client's own Claude** at ~$0 to Guy) — via a scope-clarifier note on "AI / model layer". Recorded the
**name-variant policy** at the Naming section (accept name-spellings silently; **"Wingman" = serve-but-sign-
back-as-Wingguy, never silent-alias**). No content removed; dated provenance intact. *(A full thematic
restructure was considered and rejected — it'd flatten the doc's "supersedes/corrected" lineage; navigability
via the map was the lower-risk fix.)*

**As of 2026-06-18 (doc hygiene, cont.) — CANONICAL STATE BLOCK + restructured for an AI-only reader**
(Guy confirmed he won't read this doc himself; it exists for Claude). Added **✅ CANONICAL CURRENT STATE** at
the top — deduplicated, present-tense decisions = the thing to trust — with a **═══ JOURNAL ═══** divider
before the dated entries (now explicitly provenance/"why", not current state). Volatile build-status is
deliberately **not** duplicated there (stays here + memories, so it can't drift). Directly targets the
documented stale-status failure (`feedback_check_code_state_before_status`). **Also flagged a new backlog
feature** in that block: **Connection follow-up worklist** — a "where am I up to" list driven off the Airtable
leads table's connection date, flagging each lead actioned/not-actioned; Guy-first + client-facing; no spec yet.

**As of 2026-06-08:** Full planning done — architecture, cost model, model-lock-in,
pricing (crystallised), and a **7-phase implementation roadmap** all captured above.
Environment/deploy flow confirmed (build on `dev`, flag-gated, promote up). **No ASH code
written yet.** Day-to-day setup fully intact and untouched.

**As of 2026-06-09:** Planning extended — full **rules-system design** now captured (Postgres-on-
Render confirmed; de-personalisation = strip identity not method, via identity-tokens/asset-library/
voice-seed-then-diverge; integrity-in-code with LLM-proposes-only; curated categories not free;
gated extension is doable without mess — two-kinds-of-mess; rules editing = edit-as-you-go +
visibility/history/settings screen; stickiness reconciliations). Still **no ASH code written.**

**As of 2026-06-15:** Render cost cleanup + strategy recap (see **"Transcript layer deep-dive"** above).
**Infra:** trimmed unused Render web services — **deleted** `pb-webhook-server-dev` + `-hotfix`, **suspended**
`ash-backend` → bill ~$86 → **~$65 USD/mo** (~$92 AUD). Shipped `scripts/prune-recall-webhook-events.js` (one-off
prune done; deliberately NOT cronned — flat-rate Postgres = no cost pressure). Confirmed transcript storage is a
non-problem at scale. **CORRECTION:** this chat first assumed "no ASH code / do the read-only API check next" —
WRONG: the Fathom ingest + splitter + Nylas adapter were already built & dry-run-proven on 2026-06-13 (entries
above). **Real next = the go-live list:** store Nylas creds on Render → trigger → one real write-path test → switchover.
*(Lesson: check actual code + `git log` before asserting build status — planning sections go stale.)*

**As of 2026-06-12 (session 2):** Read-only Fathom check run against Guy's real account — see
**"Fathom API — live verification + back-to-back finding"** above. Outcomes: (1) **STEP 1 is
effectively DONE** — the Fathom read path already ships in Smart Follow-Up / Meeting Prep
(`fetchFathomTranscripts`, email-keyed; key in Airtable Client Master, not env). (2) Live shape
confirmed good (per-line transcript+timestamps, invitee emails, rich `default_summary`). (3) **★
Back-to-back lumping CONFIRMED** — 3 same-room calls became ONE 93-min recording labelled with the
first lead only; the 2nd/3rd leads have no recording, no invitee entry, no email in Fathom (spoken
labels only). (4) **Decided fix:** calendar-anchored Fathom splitter reusing the existing
`recallAutoSplitService` skeleton (swap presence-events → calendar-window + speaker-name transitions).
(5) Calendar read **and** Airtable name-fallback are now **required** (not optional) for back-to-back
users. No new ingest code written this session — verification + design only.

**As of 2026-06-13:** ★ FIRST ASH CODE SHIPPED (supersedes "no ASH code written"). STEP 2 build
started — two additive, kill-switched modules on `main` (commit 46491640), nothing wired into the
server yet so production is unchanged:
- **`services/fathomIngestService.js`** — pull a Fathom meeting → canonical `[ts] Speaker: text`
  transcript + title/start/duration + **email lead-match** → file via the existing
  `insertImportedMeeting` (source=`fathom-api`, reversible). Write path gated on
  `FATHOM_INGEST_ENABLED` (default off); `dryRun` mode verified read-only against the **Recall copy
  of the same meeting** (Liam McCafferty: same lead, same title, started 1 min apart — and Fathom's
  120-min lump vs Recall's clean 29-min slot re-confirmed the lumping live).
- **`services/fathomSplitService.js`** — pure speaker-transition splitter (SERIAL cut, overlap
  ACCEPTED per the decision above). Proven on the real Tom/Alfred/Hrishekesh 93-min lump → **3
  correctly-labelled segments**, boundaries exactly on the handovers (seg 1 ends on Guy's "But
  Alfred, why don't you tell us…" line), 59 accepted overlap-tail lines.
- **Local test method:** ran both via scripts that source prod creds from Render (Airtable env group
  + Postgres external connection-info) and let the services resolve the Fathom key from Airtable — so
  no env-var sync. Throwaway test scripts were deleted after proving.
- **WIRING DONE (2026-06-13, commit aa1fc4c4):** `ingestFathomMeeting` is now split-aware — reads the
  coach calendar for the recording window (reuses `recallAutoSplitService`'s calendar read + real-meeting
  filter), and if >1 meeting runs `fathomSplitService` and files **one correctly-named entry per segment**,
  each lead-matched by calendar email with **NAME fallback**; else files single; graceful degrade to single
  if calendar unreadable. Dry-run-verified on the real Tom/Alfred/Hrishekesh lump (injected windows): 3
  named entries, **all 3 leads resolved via NAME fallback** — incl. Alfred & Hrishekesh who have no email in
  Fathom. So "I had a meeting with Alfred" will find Alfred's own entry. ⇒ the core pipeline is built + proven.
- **CALENDAR ADAPTER + NYLAS DOGFOOD — DONE & PROVEN (2026-06-13, commits 3a334231 + this):**
  Added `services/calendarProvider.js` — one swappable seam with a `CALENDAR_PROVIDER` switch
  (`google` default / `nylas`); the Fathom splitter's calendar read routes through it; daily booking
  untouched. **Guy stood up a Nylas sandbox app (US region) and connected his Google calendar as
  client #1.** Verified READ-ONLY on real data: Nylas returns his calendar (3 back-to-back meetings +
  correctly skips Lunch/Dinner/no-URL items). **CAPSTONE: full pipeline dry-run with `CALENDAR_PROVIDER=nylas`
  live** → the Tom/Alfred/Hrishekesh 93-min Fathom lump split into 3 named segments, **all 3 leads matched
  by EMAIL** (Nylas supplies the back-to-back leads' emails that Fathom lacked). So the multi-tenant
  calendar path is proven on Guy himself. **Nylas creds (sandbox):** US region (`api.us.nylas.com`),
  grant `67c86864-6d13-4258-9777-38063b83eecc`; API key generated (Guy holds a copy) — NOT yet stored on
  Render. For real tenants the grant moves to an Airtable Client Master field (code already reads
  `coach.nylasGrantId` then env `NYLAS_GRANT_ID`).
- **Next:** (a) **store the Nylas creds on Render** (NYLAS_API_KEY / NYLAS_GRANT_ID / NYLAS_API_URI) —
  note: editing the shared env group may briefly redeploy services, so pick a quiet moment; (b) the
  **trigger** (lean poll over webhook for MVP); (c) the skipped one-row **save-and-delete** write-path check;
  (d) the **switchover** (Recall off / Fathom on, reversible).

**As of 2026-06-14:** Discovery & onboarding design captured from a strategy chat — see
**"Discovery & onboarding — teaching tenants what's possible (2026-06-14)"** above. Closes the gap
that the doc was deep on *what* the system does but silent on *how a new tenant discovers it*.
Three-tier discovery (contextual **chips** = discover / **"Wingguy" keyword** = recall / Portal
**"What's possible?" page** = reference), and both chips and **proactive chaining** are per-tenant
**config/rules, not forks** (chips = extension-rendered from config; chaining = a context-scoped
Wingguy rule type, reveal-not-enforce). Discovery = the front of "Onboarding IS the business".
Design capture only — no code; day-to-day setup untouched.

**Phase 0 progress:** ✓ Extension recon DONE — existing "Network Accelerator" extension will be
**extended, not rebuilt** (already has multi-tenant auth, LinkedIn scraping, lead lookup, portal
quick-update, remote-config selectors). See "Existing extension recon" above.

**Next concrete steps (start a fresh chat per item):**
- **Fathom GO-LIVE — DONE 2026-06-17 (was "build trigger + write-path + switchover"):** the **trigger** (5-min poll,
  `fathomPollService`), real **write-path**, **dedup** column, **prefer-Fathom + loud fallback**, and the splitter
  **speak-guard** are all SHIPPED and live in prod (kill-switched, trial alongside Recall). See "You are here" above.
  **Still pending:** (a) store **Nylas creds on Render** (`NYLAS_API_KEY` / `NYLAS_GRANT_ID` / `NYLAS_API_URI` — prod
  calendar reads use Google today, fine for Guy); (b) Fathom **"content ready" webhook** to kill the ~5-min poll lag;
  (c) **switchover** (Recall off) after a clean ~2-3 wk trial. *(Schema change `fathom_recording_id` shipped via the
  additive ensureSchema-ALTER pattern — the `staging` branch is ~2750 commits stale, so it's no longer a usable gate;
  validated via dry-run jobs on prod instead.)*
- **✅ LIVE IN PROD 2026-06-17 (commit `c311609a`) — Fathom "content ready" webhook (replaces the poll lag).**
  **Research confirmed:** Fathom's "new meeting content ready" webhook is real; it signs with the **identical
  Svix HMAC scheme as Recall** (`whsec_` secret + `webhook-id`/`webhook-timestamp`/`webhook-signature` headers,
  signed over `${id}.${timestamp}.${rawBody}`), and the payload carries a **top-level numeric `recording_id`**
  (`{recording_id, url, share_url, type:"meeting_content_ready"}`). So the receiver reuses
  `utils/verifyRecallWebhook.verifyRequestFromRecall` verbatim. **Shipped:** `routes/fathomWebhookRoutes.js`
  (POST/GET/HEAD `/webhooks/fathom`, mounted before `express.json` in index.js) → verify sig → extract
  `recording_id` → `ingestFathomMeeting()` (same path as poll). Gates: `FATHOM_WEBHOOK_ENABLED` (process; default
  OFF), `FATHOM_LIVE_FROM` (must be set), `FATHOM_INGEST_ENABLED` (write). Dedup via `fathomRecordingIngested`;
  always 200-acks; **poll kept as backstop**. Registration helper `scripts/fathom-webhook.js` (`--register`/`--list`/
  `--delete`) prints the `whsec_` to set as `FATHOM_WEBHOOK_SECRET`.
  **GO-LIVE DONE 2026-06-17 (all via Render API, single-tenant Guy-Wilson):** Registered the webhook with Fathom
  (`POST /external/v1/webhooks`, id `ZVa_DLhYLngu5Pyx`, `triggered_for:["my_recordings"]`, `include_summary:true`).
  Set `FATHOM_WEBHOOK_SECRET` (the returned `whsec_…`) + `FATHOM_WEBHOOK_ENABLED=true` on Render → deployed →
  probe confirms `processing_enabled:true, secret_configured:true, live_from_set:true`. **Verified live end-to-end**
  with signed Svix POSTs: (A) tampered signature → **401**; (B) valid sig + fake `recording_id` → **200**
  `processed:false` `"not in fetched window"` (graceful, no crash, no retry-storm); (C) valid sig + real recent
  recording → **200 `"already ingested"`** (dedup held — poll had already filed it, no double-file). Full chain
  proven: signature security → process gates → ingest path → dedup → graceful ack. Only un-exercised sliver is a
  brand-new write *via the webhook* (the 5-min poll files everything before a fresh one exists to catch) — but it's
  the SAME `ingestFathomMeeting` the poll uses, so the next genuinely-new meeting will file in seconds, with the
  poll as backstop. **To revoke:** `node scripts/fathom-webhook.js --delete ZVa_DLhYLngu5Pyx` + unset the env flag.
- **(superseded — original brief) Fathom "content ready" webhook (replaces the poll lag). Verified safe + additive 2026-06-17:**
  Today ingest is a timer (`services/fathomPollService.js`, interval = `FATHOM_POLL_INTERVAL_MS`) that lists recent
  meetings and files new ones. The webhook just turns that pull into a push. **Design:** a new inbound route receives
  Fathom's "meeting/recording content ready" callback → verifies the signature → extracts `recording_id` → calls the
  SAME `ingestFathomMeeting({ recordingId, coachClientId })` the poll already uses. **Why it's safe/additive:** the
  ingest path is unchanged; double-fire is impossible because every ingest first checks
  `recallWebhookDb.fathomRecordingIngested(recording_id)` and skips duplicates; existing gates still apply
  (`FATHOM_INGEST_ENABLED`, `FATHOM_LIVE_FROM`); KEEP THE POLL RUNNING as a backstop during the webhook trial.
  **First task = research:** confirm from Fathom's API docs whether the "content ready" webhook exists and its exact
  payload shape + signature/auth scheme (our notes say Fathom has webhooks — verify). **Mirror the existing pattern:**
  Recall already does signed inbound webhooks (`routes/recallWebhookRoutes.js`, `RECALL_VERIFICATION_SECRET`) — copy
  that shape for verification + route registration in `index.js`. **New env:** a webhook on/off flag + a Fathom signing
  secret. **Test live:** register the webhook, book/finish a real Fathom meeting, confirm it ingests within seconds and
  the poll then reports it as `already ingested` (no double-file).
- Decide: use Fathom's `default_summary` directly vs regenerate via `recallSummaryService` (cost).
- Finish Phase 0 recon: read `content-portal.js` + the `/api/linkedin` & `/api/extension-config`
  backend (how `clientId/portalToken` are issued); investigate `ash-backend` / `ash-attributes-api`.
- De-risking spikes — **Nylas first** (also underpins multi-tenant calendar read for the splitter);
  then LinkedIn content-script insert.
- **Rules de-personalisation spike:** Guy pastes ONE section of his Notion rules → Claude returns a
  de-identified master + variable catalogue + flagged implicit-personal bits.
- Then Phase 1: define the calendar/email/LLM interfaces + Google adapter (no behaviour change).
- **Email-identity hardening (LinkedIn personal → business email switch): ✅ SHIPPED 2026-06-17**
  (commit `5d3e5b19`, verified live). A lead is ONE person with MANY emails over time (personal on LinkedIn →
  business when they book), but matching + lookup keyed off a single email, so a switch broke both linking
  (meeting → lead) and lookup ("pull up X's call"). What shipped:
  - **Multi-email per lead.** New Airtable field `{Alt Emails}` on Leads (newline-separated, lowercase).
    `findLeadByEmail` now falls back to it ONLY on a primary `{Email}` miss (FIND() narrows, then exact
    membership check in JS to avoid substring false positives). Every caller — Fathom matcher, inbound/BCC
    flow, the `latest-transcript-by-email` MCP lookup — inherits ANY-known-email matching for free. Live hot
    path unchanged; degrades to "not found" if the field is absent in a base.
  - **Self-healing write-back** (`learnEmailForLead`, services/inboundEmailService.js). When a lead is resolved
    by a UNIQUE name match while the incoming booking email matched nobody, it appends that email to `{Alt Emails}`
    so future lookups by it resolve. Auto-records (a unique name match already attaches the whole meeting);
    never fires on ambiguous; best-effort, never throws. Kill-switch `EMAIL_SELFHEAL_ENABLED=false`. Wired into:
    Fathom split/segment path, Fathom single path (with a NEW invitee-NAME fallback — was email-only, so a normal
    booking with a brand-new business email previously matched nothing), and the inbound meeting-notetaker path
    (conservative: only when exactly one lead found).
  - **Multi-tenant rollout DONE:** `{Alt Emails}` column now exists in ALL 17 client Leads bases (not just Guy's),
    created via a one-off backend job over the master Clients list using the server Airtable key (idempotent, additive,
    no data touched). Code degrades gracefully if absent, so this was safe to do incrementally.
  - **Portal UI SHIPPED 2026-06-17** (commit `07ea07fc`). The lead screen (`LeadDetailForm.js`) now shows the primary
    Email plus an editable **"Other emails"** list (add box + per-row remove). Light validation on entry: must look like
    an email, auto lowercased/trimmed, no duplicates / not equal to the primary, inline error. Server mirrors the same
    sanitize (`sanitizeAltEmailsString` in `linkedinRoutesWithAuth.js` — GET/PUT `/leads/:id` now carry `altEmails`).
    `api.js` maps `altEmails` ↔ `{Alt Emails}`. Portal `next build` passes. NOTE: no per-email provenance is stored, so
    the portal can't distinguish auto-learned vs hand-typed emails — the "added automatically" tag from the mockup was
    deliberately dropped (would need an extra provenance mechanism to be truthful).
  - **Verified end-to-end on live prod via Render one-off jobs:** (1) READ — primary lookup intact, an alt-email
    resolved to the same lead, a genuine miss returned null cleanly. (2) WRITE/self-heal — `learnEmailForLead` learned a
    new email onto a lead, a lookup by it then resolved, and the guards held (dedupe → `already_known`, primary →
    `is_primary`). (3) SINGLE-PATH name fallback — a fabricated single meeting with a brand-new email + a known name
    correctly captured the name, missed on email, and resolved the name uniquely to the lead. All test writes cleaned up.
    (Courtney's record already had the business email as PRIMARY by the time we looked — the original 404 predated that
    field being overwritten, which is exactly the lossy single-field behaviour this prevents going forward.)
  - Same identity layer as the calendar/Nylas work. Interim habit for Guy is now optional, but still safe: ADD a
    new email, don't REPLACE the old one (the system also learns it automatically on the next booking).
  - **Only un-exercised sliver:** a literal Fathom recording flowing through and triggering the learn automatically —
    needs a real new-email booking to occur; every building block + the glue between them is verified.
- *(Maybe: a light tidy/consolidation pass on this doc — it has grown organically.)*

The Fathom **read path** ships in production (Smart Follow-Up / Meeting Prep); the Fathom **ingest + splitter +
`google|nylas` calendar adapter** are now **LIVE in production** (2026-06-17) — auto-ingest poll, prefer-Fathom +
loud fallback, and the splitter speak-guard all shipped and kill-switched, running in a **trial period alongside
Recall** (Recall = safety net, not yet off). Remaining = store Nylas creds on Render, the "content ready" webhook
(to kill the poll lag), and **switchover** (Recall off) after a clean trial.
