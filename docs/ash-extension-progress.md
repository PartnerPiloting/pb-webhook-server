# ASH Extension — State of Play (living doc)

> **How to use this doc.** This is the single source of truth for the ASH LinkedIn
> outreach extension + multi-tenant calendar/email work. It is **weekend / after-hours
> paced** — Guy is in a sales push by day, so this progresses slowly and must never
> disrupt the day-to-day setup. At the start of each session, read the **"You are here"**
> section at the bottom first. At the end of each session, update it. Companion to
> [`ash-extension-plan.md`](ash-extension-plan.md) (the original vision/brief).

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

## De-risking spikes — prove the unknowns BEFORE building around them (2026-06-08)
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
   NOTE: the spike is NOT testing Claude's *reasoning* (proven tonight) — it tests the **wiring**,
   which is the real unknown because today's tools are **single-tenant/hardcoded to Guy**
   (`DEFAULT_CLIENT_ID="Guy-Wilson"`, baked-in base IDs). Unknowns: (a) can the tools be made
   multi-tenant so a *different* person's Claude gets *their* data *as them* (per-tenant auth)?
   (b) does a typical client's Claude plan/tier even connect our MCP servers the way Guy's does?
   (c) how painful is the per-client connector setup (Mr-Busy friction)? Spike = connect ONE 2nd
   Claude to ONE tool serving that account's data; confirm it reaches the right data as the right
   tenant. **Load-bearing:** the self-serve "their cost" pricing depends on this being easy; if
   not, fallback = Guy-run (his cost) → changes the economics. Cheap to prove now.
4. **Fathom (underpins transcript capture/migration).** Pull a transcript + attendee/speaker data
   via API/webhook for one account; check it can replace the calendar-read for attendee matching.

**Don't bother spiking (known tech — design, not feasibility):** Postgres versioned rules table,
Stripe basics, seat/auth model, encrypted credential storage.

**Honest:** spikes kill the big "fundamental doesn't work" surprises (the ones that burn); they
don't catch every integration/scale wrinkle — still hugely worth it.

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

## ▶ You are here / next pick-up

**As of 2026-06-08:** Full planning done — architecture, cost model, model-lock-in,
pricing (crystallised), and a **7-phase implementation roadmap** all captured above.
Environment/deploy flow confirmed (build on `dev`, flag-gated, promote up). **No ASH code
written yet.** Day-to-day setup fully intact and untouched.

**Next concrete steps = Phase 0 (read-only recon, any order):**
- Read the existing `chrome-extension/` scaffold (env-aware per `manifest.json`) — report what's
  wired; likely shrinks Phase 2.
- Investigate `ash-backend` (main) + `ash-attributes-api` — what's running, where new work belongs.
- Then Phase 1: define the calendar/email/LLM interfaces + Google adapter (no behaviour change).

Nothing here is committed/deployed; it's all design + recon.
