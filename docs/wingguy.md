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
  Rules de-personalisation · Rules editing UX · Rules integrity (code gates, LLM proposes only) · Gated
  extension — two kinds of mess · Stickiness vision · Where this sits vs frontier · Keeping Wingguy directives
  in Wingguy (not the client's general Claude memory).
- **Naming & terminology:** Naming the second brain (✅ Wingguy chosen) · name-variant policy (in Naming +
  Discovery) · Terminology — "the Portal" not Airtable · Terminology trap — "recall_".
- **Calendar / email / transcript infra:** Middleman (Nylas) · "Catch 1" · Provider notes · Pricing snapshot ·
  Transcript layer deep-dive · Fathom API — live verification + back-to-back. *(Live status → ▶ You are here +
  memory `project_recall_to_fathom_migration`.)*
- **Architecture & build process:** Environments & deploy flow · Implementation roadmap (7 phases) · De-risking
  spikes · What actually paces the build · Scope reality check · Key code anchors.
- **GTM / market / scaling:** Target market + go-forward · Strategy handoff · Competitive position · Scaling to
  ~50 (intro-mesh; NO recurring meetings) · Ideal client = frequency-of-use · Onboarding = activation ·
  Sequencing the reveal · VA model + cost · Guy's time ~3 days/wk · LinkedIn analogy (renting a solved network).

---

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
- **Panel type: injected DOM panel** (not Chrome's native side panel) so the **width is
  adjustable** (drag handle + remembered preference).

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
**Decision: the new build EXTENDS this — NOT a new extension.** Hard plumbing already present:
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
running start. **Verify next:** `content-portal.js` (auth broadcast), the `/api/linkedin` +
`/api/extension-config` backend, and how `clientId/portalToken` are issued.

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

5. **Multi-source, not Fathom-only.** Build **one normalized-transcript shape + a thin source-mapper per provider**. Ship Fathom API + **universal paste** (`insertImportedMeeting` already exists). Add others (**Fireflies** = strongest alt API; Otter weak/enterprise-gated) **only when a paying client needs it** — build the seam, not all the plugs. Paste = universal fallback → sales pitch becomes "keep your tool", not "switch to Fathom".

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

---

## ▶ You are here / next pick-up

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

**As of 2026-06-18 (doc hygiene) — TOPIC MAP + DEDUP PASS:** full end-to-end read of the doc. Added a
**🗺 Topic map** near the top (skim + Ctrl-F before adding, to stop duplicates as it grows) + a **scan-first**
rule in the header. Reconciled the one genuine contradiction found — the **AI-account / who-pays** story (the
early "clients need no AI account / Guy's COGS" line is **panel-only**; the connector/cockpit runs on the
**client's own Claude** at ~$0 to Guy) — via a scope-clarifier note on "AI / model layer". Recorded the
**name-variant policy** at the Naming section (accept name-spellings silently; **"Wingman" = serve-but-sign-
back-as-Wingguy, never silent-alias**). No content removed; dated provenance intact. *(A full thematic
restructure was considered and rejected — it'd flatten the doc's "supersedes/corrected" lineage; navigability
via the map was the lower-risk fix.)*

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
