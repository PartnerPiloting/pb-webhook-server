# ASH Extension — State of Play (living doc)

> **How to use this doc.** This is the single source of truth for the ASH LinkedIn
> outreach extension + multi-tenant calendar/email work. It is **weekend / after-hours
> paced** — Guy is in a sales push by day, so this progresses slowly and must never
> disrupt the day-to-day setup. At the start of each session, read the **"You are here"**
> section at the bottom first. At the end of each session, update it. Companion to
> [`ash-extension-plan.md`](ash-extension-plan.md) (the original vision/brief).
>
> **Working rhythm (decided 2026-06-09):** THIS doc (in git) is home base — NOT any single
> chat. Start a **new, focused chat per area** ("Nylas spike", "de-personalise rules",
> "Phase 0 recon", etc.); open it with *"where are we on the ASH extension"* and Claude reads
> this doc to orient. Claude updates + commits this doc at the end of each session. Chats are
> disposable; the doc accumulates. Don't reload old mega-chats as working context.

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
**✅ CHOSEN: "Wingguy"** (Guy's coinage = win + guy; brand-tied to "I know a Guy"). Survived first-pass
screen (no exact product/trademark found). **Framing (Guy's call, and a good one): it's a CULTURE/term
spread by word-of-mouth — like "I know a Guy" — NOT a defended product SKU.** That dissolves most
collision/trademark worry. Two mechanics confirmed: (1) **Guy sets pronunciation by voice** ("Wing-guy")
→ on-paper ambiguity is moot; (2) **the agent resolves any variant** ("wingguy"/"wing guy"/"wing-guy"/
typos) automatically — it's an LLM, not a rigid parser, so no magic command word.
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

## Transcript layer deep-dive (2026-06-12)

A focused live-workflow chat that pinned down the transcript/capture migration. Problem → finding/decision:

1. **Storage worry is dead.** Transcript *reads* come from Postgres (`recall_meetings.transcript_text`), never the recorder. All transcripts total ~4 MB; Postgres is a **flat instance charge** (~$10.50/mo, `basic_256mb`, NOT metered by storage), 63 MB used of a 15 GB disk. 100 clients of transcripts ≈ a few hundred MB → bill barely moves. Airtable was never viable (100k-char field cap; longest transcript already 79k chars). So "rules + transcripts in Postgres for 50–100 clients" costs effectively nothing extra.

2. **The real DB growth was `recall_webhook_events`** — the raw Recall webhook firehose (33 MB = 8× all transcripts; Recall streams hundreds of chunk-events per meeting). Did a one-time prune; committed `scripts/prune-recall-webhook-events.js` (dry-run default, `--commit`, `RETENTION_DAYS=30`). **Decided NOT to cron it** — flat-rate Postgres = no cost pressure; run manually if it ever balloons. Becomes moot post-Fathom (one "ready" event, not a stream).

3. **Capture-model shift (the core change).** Recall = *our server* injects a live bot, real-time chunk stream. **Fathom = the client's Fathom captures** (bot or bot-free, their setup) and fires a **post-event "transcript ready" webhook** → our server pulls the finished transcript + attendees via API. Responsibility moves to the client; we become a downstream consumer; trigger is **per-client**; short processing delay (mins) — fine for our use.

4. **Who pays + Fathom tiers (corrected).** Fathom's **Public API & webhook is on EVERY tier, including Free** (confirmed from Guy's pricing-page screenshots — an earlier automated read wrongly said Team-gated). Free = unlimited transcripts. So accessing a client's transcript **never depends on their tier**. Requiring clients to be paid is a *business choice* (better AI summaries / commitment), not a technical gate. Capture cost stays the client's, never ours.

5. **Multi-source, not Fathom-only.** Build **one normalized-transcript shape + a thin source-mapper per provider**. Ship Fathom API + **universal paste** (`insertImportedMeeting` already exists). Add others (**Fireflies** = strongest alt API; Otter weak/enterprise-gated) **only when a paying client needs it** — build the seam, not all the plugs. Paste = universal fallback → sales pitch becomes "keep your tool", not "switch to Fathom".

6. **Identity is multi-tenant + multi-provider (correction).** "Identity from calendar, not recorder" is solved **for Guy only** (single-tenant, Google). Multi-tenant needs *each client's* calendar across **Google AND Outlook** → the **same Nylas layer**. The transcript matcher should read attendees **through Nylas**, not Google Calendar directly. Delivery decoupling: **ingestion ships independent** (paste/API lands it); calendar identity is **enrichment that trails per tenant**, with graceful fallback to name-only matching. Nylas cost ≈ **$1.50–2/connected account/mo** (per-client, **our** cost vs Fathom = client's), ~$153/mo at 100 clients — <1.5% of revenue.

7. **Build-env decision: main is OK here.** Backend-only, additive, single-user (Guy) → **main acceptable** (avoids env-swap friction Guy dislikes). Protection comes from the **design, not the environment**: additive (new route → existing store, Recall untouched) + **kill switch** (`FATHOM_INGEST_ENABLED`) + **parallel-run** (Fathom shadows Recall until trusted). **One guardrail:** gate any *schema change* on the `staging` Postgres schema first (it already exists in the same DB). Retire Recall only after Fathom earns trust — no big-bang cutover.

8. **Forward sequence:** (1) **prove Fathom API** returns transcript + attendee data (read-only, needs Guy's key) → (2) build additive ingest behind the kill switch → (3) parallel-run vs Recall on real meetings → (4) retire Recall once trusted. Complements the "Recall lookup-chain rewrite" noted in Strategy handoff.

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

## ▶ You are here / next pick-up

**As of 2026-06-08:** Full planning done — architecture, cost model, model-lock-in,
pricing (crystallised), and a **7-phase implementation roadmap** all captured above.
Environment/deploy flow confirmed (build on `dev`, flag-gated, promote up). **No ASH code
written yet.** Day-to-day setup fully intact and untouched.

**As of 2026-06-09:** Planning extended — full **rules-system design** now captured (Postgres-on-
Render confirmed; de-personalisation = strip identity not method, via identity-tokens/asset-library/
voice-seed-then-diverge; integrity-in-code with LLM-proposes-only; curated categories not free;
gated extension is doable without mess — two-kinds-of-mess; rules editing = edit-as-you-go +
visibility/history/settings screen; stickiness reconciliations). Still **no ASH code written.**

**As of 2026-06-12:** Transcript/capture migration pinned down in a focused chat — see **"Transcript layer
deep-dive (2026-06-12)"** above. Key outcomes: storage is a non-problem (Postgres flat-rate); capture model
shifts to Fathom's post-event "transcript ready" webhook (we become a downstream consumer); Fathom API is on
ALL tiers incl Free; build multi-source via a normalized-transcript seam + universal paste (not Fathom-only);
identity-matching needs the multi-tenant + multi-provider Nylas calendar layer; **build on `main`** (additive +
kill switch + parallel-run; gate only schema changes on the staging schema). Webhook-bloat prune script shipped
(`scripts/prune-recall-webhook-events.js`). Still **no ASH code written** — next is the read-only Fathom API check.

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
- **Fathom ingest (the real STEP 2):** build the additive path that lands a Fathom transcript into
  the `recall_meetings` store (so Fathom feeds the review-queue/summary/share pipeline Recall feeds),
  behind the `FATHOM_INGEST_ENABLED` kill switch; trigger = Fathom "new meeting content ready" webhook
  → pull + normalise. Gate any schema change on the staging Postgres schema first.
- **Fathom back-to-back splitter:** port `recallAutoSplitService` to Fathom data — calendar-window +
  speaker-name-transition boundaries (absolute line time = `recording_start_time` + line `timestamp`),
  one child transcript per appointment linked to the right lead. Recover the hidden 2nd/3rd leads via
  calendar attendee, with **Airtable name-fallback** where the calendar isn't wired (confidence-flagged).
- Decide: use Fathom's `default_summary` directly vs regenerate via `recallSummaryService` (cost).
- Finish Phase 0 recon: read `content-portal.js` + the `/api/linkedin` & `/api/extension-config`
  backend (how `clientId/portalToken` are issued); investigate `ash-backend` / `ash-attributes-api`.
- De-risking spikes — **Nylas first** (also underpins multi-tenant calendar read for the splitter);
  then LinkedIn content-script insert.
- **Rules de-personalisation spike:** Guy pastes ONE section of his Notion rules → Claude returns a
  de-identified master + variable catalogue + flagged implicit-personal bits.
- Then Phase 1: define the calendar/email/LLM interfaces + Google adapter (no behaviour change).
- *(Maybe: a light tidy/consolidation pass on this doc — it has grown organically.)*

The Fathom **read path** already ships (Smart Follow-Up / Meeting Prep); the Fathom **ingest +
splitter** are not built yet. Nothing new deployed this session — verification + design only.
