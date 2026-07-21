# "Prep Me For Today" - Feature Note

**Status:** Concept, decisions settled 2026-07-20. Not built. Draft for a build spec, not yet one.
**Owner:** Guy Wilson (tenant 0), but designed multi-tenant from day one (see §8).
**Relationship to Smart Follow-Up:** deliberately INDEPENDENT. Guy is dropping Smart Follow-Up for his own use (too heavy, he's not using it). This feature does NOT depend on it and must not be coupled to it - some clients may keep Smart Follow-Up, and both can coexist. `services/smartFollowUpService.js` is useful only as a *reference* for the due-date query shape, not as a dependency.

---

## 1. The idea in one line

A single trigger in **Claude chat** - "prep me for today's meetings" - returns today's calendar meetings, then a short, ranked list of leads worth a nudge: *"By the way, don't forget these."* The value is the **timing** - surfacing a promise (like Kay, "I'll reach out when you're back in August") on the right day, so it doesn't slip when you're busy.

The real problem it solves is human: when there's a lot on, you overlook the one lead you told you'd get back to. This is the net under that.

---

## 2. How it works in Claude chat (the whole thing, concretely)

**Getting onto the list** - the moment a lead defers, a follow-up date gets set. Two ways:
- *You tell me:* "Kay's back in August, remind me then" -> I stamp her Follow-Up Date to early August.
- *I notice:* Kay writes "overseas until August, chat then" -> I ask "Want me to set Kay to resurface ~1 Aug?" -> you confirm.

**Asking, on any day** - you type "prep me for today's meetings" and get:

> **Today - Tue 5 August**
>
> **Meetings (2)**
> - 10:00 · Sarah Cann - second call, here's where you left off...
> - 14:00 · April - LinkedIn catch-up
>
> **Before you go - 3 worth a nudge:**
> 1. **Kay Ridge** - you told her you'd reach out once she's back (that's now). *Book?*
> 2. **Emily** - your mid-August "let's talk then" is coming due.
> 3. **Tom Blake** - waiting on your answer 9 days.
>
> *(2 more - say "show all".)*

**Acting, in plain words:**
- "Book Kay" -> pull her times, draft the message.
- "Done with Tom, already replied" -> clears him.
- "Drop Kay, gone off it" -> gone for good, never nags again.
- "Not yet on Emily" -> stays, returns another day.

**The nagging** - if you ignore Kay today, she's back tomorrow, a day more overdue so a notch higher, and keeps gently reappearing until you act or drop her. That persistence is the point.

---

## 3. The state model - two fields, no stored list

There is **no maintained list anywhere.** The nudge list is **dynamically assembled every time** you ask, from data already on each lead record. Source of truth = two fields per lead:

| Field | Role |
|-------|------|
| **`Follow-Up Date`** (`fldtGi5EFfG4RZA9o`) | The "nag" anchor. Due (`<= today`) and not ceased = it shows. **Done** = advance or clear the date. |
| **`Cease FUP`** (`fldnFDjEXmnq0Ye4x`) | The "drop it forever" flag. Set = never nags again. |

Why dynamic, not a stored list:
- **Nothing drifts.** A saved list goes stale the moment you book a lead or edit a date in the portal. A fresh query always reflects reality.
- **Dismiss/done are just field edits, not list edits.** "Drop Kay" sets Cease FUP; "done" moves the date. She simply isn't in the next query result - nothing to remove.
- **Persistence is free.** An overdue date keeps matching the query every day until changed. No "have I shown this before" state needed.

Each "prep me for today" call runs, live: (a) a due-date query over the tenant's leads, (b) a calendar read for today, then ranks and caps the nudges.

---

## 4. Prioritisation - AI-determined, "promise-at-risk" first

The nudges are ranked, and the spine of the ranking is **did you make a concrete promise to a specific person, and is it now due?** Those float to the top (Kay: "I'll touch base once you're back"). That's the expensive kind to forget - it's a credibility and relationship cost, not just a missed opportunity - and it's explainable, so you can see *why* something is #1 and trust the order.

Tiebreakers below that: how overdue it is, and how warm the lead is. Uniform for all tenants in v1 (see §8).

---

## 5. The overwhelm guard (the rule that makes it usable for Guy)

Smart Follow-Up lost Guy because it was a wall. So this is a hard design rule, not a nicety:

- **Never dump everything.** Show the **top 3-5 only**, ranked, one line each. The rest hide behind "show all".
- **Dismissal is one word.** The list stays trustworthy only if clearing junk is frictionless.
- Persistence + brevity + easy dismissal are a **package** - persistence without brevity just trains you to ignore the list, and you skim past Kay again.

---

## 6. Capture - the linchpin

"At the right time" is only as good as the date getting **stamped** when a lead defers. Today nothing records "reconnect ~1 Aug" unless Guy does it by hand. So the highest-leverage piece:

- When Wingguy sees a defer in a thread ("overseas until August", "circle back next quarter"), it **proposes a Follow-Up Date and, on confirm, stamps it.**
- **Propose-then-confirm** at first (not silent auto-set), to build trust in the detection.

Get this reliable and the whole feature comes alive. Skip it and the brief surfaces nothing, because no dates were ever set.

---

## 7. Out of scope for v1 (deliberately)

- **Non-lead reminders** ("send Paul that doc"). Every nudge in v1 hangs off a *lead's* Follow-Up Date. Freestanding tasks have no record to live on and would need a small task store - add later only if the need is real.
- **Escalation** ("this is the 4th morning I've flagged Kay"). Pure-dynamic can't do this; it needs one small "times nagged" counter. Deferred.
- **Per-client prioritisation tuning.** One ranking logic for everyone in v1.
- **Any dependency on Smart Follow-Up.** Independent by design.

---

## 8. Multi-tenant - in shape now, operation later

Build it **tenant-agnostic from day one** (never hardcode Guy). It's nearly free here, because every layer is already per-tenant:

- **Data:** `Follow-Up Date` + `Cease FUP` already exist in every client's Leads base *and* the Client Template - a new client gets them automatically.
- **Surface:** the Wingguy connector tools already take a client ID and resolve *that client's* base (same pattern as the create-lead tool). A `prep_today` tool drops straight in.
- **Calendar:** already read per-tenant (each client's own grant).

Hold the distinction that has bitten the other Wingguy tools:
- **In shape** (takes a client ID, no Guy-specific assumptions) - do this now, free.
- **In operation** (live-serving other clients) - gated by the connector's real multi-tenant auth, today still "hard-wired to Guy = step 1" across all wingguy tools. Separate, known work.

Upshot: **build it clean and tenant-agnostic now; it lights up for everyone the moment that connector auth does, with zero rework.** Guardrails to keep multi-tenant cheap: keep v1 uniform across tenants (per-tenant tuning later rides the existing booking-prefs seam), and don't couple to Smart Follow-Up.

---

## 9. What already exists to build on

- **State fields** - `Follow-Up Date`, `Cease FUP`, multi-tenant, in the template. The whole state model, already there.
- **Calendar listing** - `listEventsForCoach` ([wingguyCalendar.js:685](../services/wingguyCalendar.js)) / connector `wingguy_list_events`, per-tenant, timezone-correct.
- **Connector tenant-resolution** - `clientService.getClientById(tenant) -> airtableBaseId`, the pattern every wingguy tool (and the new create-lead tool) uses.
- **Reference only (not a dependency):** the due-date filter shape in [smartFollowUpService.js:231](../services/smartFollowUpService.js) and its AI-date-suggestion idea ([~line 308](../services/smartFollowUpService.js)) - lift the query shape, don't import the service.

---

## 10. Build order

1. **Capture first** - detect a defer in-thread, propose-then-confirm a Follow-Up Date. Without dates, nothing else has anything to surface.
2. **Surface second** - a `wingguy_prep_today` connector tool: today's meetings + the ranked, capped due-follow-up list, tenant-agnostic.
3. **Deepen later** - per-meeting prep context (Notes / Fathom), the escalation counter, a scheduled morning push, non-lead tasks - each only if wanted.

---

## 11. Settled decisions (2026-07-20)

- Independent of Smart Follow-Up (Guy dropping it for himself; keep both able to coexist).
- Lead-only for v1.
- Dynamically assembled every time - no stored list.
- Two-field state model: `Follow-Up Date` (nag/done) + `Cease FUP` (drop forever).
- AI-determined "promise-at-risk" ranking.
- Hard cap on visible nudges (top 3-5, one line, "show all" for the rest).
- Multi-tenant in shape from day one; operation gated by connector auth.
- Trigger lives in Claude chat: "prep me for today's meetings".

---

---

## 12. Decisions settled 2026-07-21 (these SUPERSEDE the 2026-07-20 body where they conflict)

Live dry-run (real Gmail + Airtable + LinkedIn + one Fathom transcript) reshaped the design. The old "stored Follow-Up Date = source of truth" model is REPLACED by live-derived, store-almost-nothing.

**Decision A - the deferral-date store + the switch-over (SETTLED):**
- The engine is live-derived from mailbox + LinkedIn + transcripts; it stores NOTHING about follow-up **except** one thing: a far-future deferral date (e.g. "come back in December") that would otherwise age out of the ~90-day live-read window.
- That store = a **DEDICATED NEW field `Reconnect On`** (date). [REVISED 2026-07-22 — was "reuse Follow-Up Date"; Guy's call: reusing overloads one field with two meanings, and Legacy clients still use Follow-Up Date the old way. A dedicated field starts clean, keeps the two worlds unambiguous.] **One writer = the engine** (propose-then-confirm in chat); the human NEVER hand-types it; not on client input screens. **TODO: add `Reconnect On` to ALL client bases + the Client Template (base app6W6k9GiDUlktvt) via an idempotent --template script (pattern: scripts/add-cease-fup-field.js).**
- WHAT POPULATES IT (deferred to the content-read / Stage B layer): detecting a deferral written in the correspondence — "get back in a couple of months" in an email/LinkedIn message. NOT handled in v1, and until it is, such a person mis-fires as "reply owed" (they spoke last) — the Marianne failure. The content-read both fixes reply-owed and stamps `Reconnect On` (beyond-window) / holds live (in-window). Higher priority than earlier assumed.
- The old rotted dates (131 overdue of 177 on 2026-07-21) get **wiped** on switch-over - they'd poison the new engine.
- Rollout is **per-client via a `Follow-up Mode` flag on Client Master (Legacy | Dynamic)**, defaulting to Legacy so every current client is untouched (no big-bang). Flipping a client to Dynamic:
  - Backend: the old Smart Follow-Up sweep stops touching them; the Wingguy brief becomes their follow-up.
  - Screens: **automatic** - the portal (custom Next.js app `linkedin-messaging-followup-next`) reads the flag and stops drawing Follow-Up Manager, Smart Follow-ups, and the Follow-Up Date field. This reuses the EXISTING per-client feature-gate pattern (`clientProfile.features.thanksForConnecting`, Layout.js:52/58/308) - no manual per-base screen surgery.
- Strategic framing (Guy, 2026-07-21): this couples follow-up to being on Wingguy, and that's accepted/desired - the follow-up brief becomes a *reason* to migrate each client onto Wingguy. Few clients now, migrated individually, clean cut-over not dual-run. NB most clients are still portal-only today (only Julian live on Wingguy chat, Ashley onboarding).
- Hold-the-line rule: never retire a given client's old follow-up screens until their Wingguy brief is live and they've felt it work once.

**Decision B - On Series (SETTLED):**
- "On Series" is **derived from the existing series fields** (`Series Sent Count > 0` and not `Series Unsubscribed`, added 2026-07-09) - NO new field.
- It suppresses **cadence only**, exactly like Cease FUP - because the drip is the ambient touch, so a timer-nudge would be noise. **Named deferrals and personal replies from series leads STILL surface** (Guy's scenario: "keen but flat-chat 6 weeks, get back to me then" + put on series → the promise surfaces on its date regardless of series membership). My earlier "On Series = never in the nudge list" was too strong and is corrected.
- Muting a specific real follow-up is ALWAYS an explicit per-person act ("stop reminding me about this one" → engine retires that follow-up), NEVER a silent side-effect of series membership. Principle: timer-off flags suppress cadence; only an explicit drop silences a promise.
- Degrades gracefully where a tenant runs no series (everyone = not-on-series).
- Consequence: On Series and Cease FUP behave identically in the engine (both = "don't chase on a timer"); they differ only in why.

**Decision C - reminder-discipline (SETTLED via the draft model):** its detection half ("email yourself an ACTION reminder") is redundant - the sweep does that. Its craft half (day-before-slot nudge timing, the ready-to-paste wording, the "slots lapsed → re-offer fresh times" move) is KEPT by being **absorbed into the follow-up engine's drafting logic** - it becomes how the engine writes the time-aware nudge, not a note Guy writes to himself. So reminder-discipline is not rewritten-in-place so much as *promoted*: its wisdom powers the auto-draft. (Whether to formally retire/revise the stored rule vs leave it as a craft reference = a build-time detail.)

**Decision D - always-append guarantee (SETTLED: code, + independently callable):** the "follow-ups always ride with the briefing" promise lives in CODE, not a rule - the briefing tool fetches meetings AND calls the sweep and returns both welded together, so it can't forget. The sweep is ALSO its own standalone tool: "show me what I need to follow up" / "who's waiting" / "overdue ranked" call it directly. Same engine, two exposures. Rules still own all judgment (ranking, drafting, gates); code owns only the always-append promise.

---

## 13. Consolidated build plan (2026-07-21) - v1 core loop vs later layers

**The interaction model (what the user actually experiences):** the brief surfaces a TINY, ranked, capped list - the few that matter *today*, one line each. Full text never shown inline. Per item, taps: **[remind me]** (short memory-jog, later layer) · **[open draft →]** (the ready, time-aware message, in Gmail) · **drop** (mute forever) · do-nothing (returns another day). Drafts are time-aware (pre-slot nudge vs "missed it, fresh times" re-offer vs longer-silence re-open). Never auto-send - approve each. The point: turn a to-do list into a sub-minute approval queue.

### V1 - the core loop (ship first)
1. **Sweep engine** `wingguy_followup_sweep` (new tool in `services/wingguyMailMcp.js`, both transports auto-register). Stage A cheap pass: read ~90d mail (per-tenant Nylas) + LinkedIn Notes blocks + gates (Cease FUP, On-Series-derived, deferral date), merge PER PERSON, compute who-spoke-last + days-silent + arrived-deferrals + ball-in-court; **cross-check calendar bookings** so it doesn't nag someone who already booked a slot; return a RANKED, CAPPED shortlist. Multi-tenant via existing `getClientById`/`getClientBase`/`mailProvider` plumbing (real per-client on the SDK path behind `WINGGUY_CONNECTOR_MULTITENANT`).
   - *New plumbing needed:* a `listRecent(coach,{after})` on `mailProvider.js` (pull the 90d window once - the cheap inversion; don't loop 300 per-lead calls).
2. **Briefing tool** `wingguy_prep_today`: calendar (`listEventsForCoach`) + calls the sweep, welded (Decision D). Sweep also callable standalone.
3. **Ranking = closeness-to-broken-promise**, one urgency-ordered list: dated-commitment-imminent → arrived-deferral/reply-waiting (longest first) → cadence-overdue (most overdue first).
4. **Gates:** Cease FUP + On-Series = cadence-off only; named deferrals + personal replies always surface; explicit "drop" is the only promise-mute.
5. **Time-aware drafts** via existing `wingguy_create_draft` (Gmail, clean links, threaded) + paste-ready for LinkedIn-only leads; voice from existing rules (manifesto, quote-them-back, reconnection-formula) + absorbed reminder-discipline craft.
6. **Rules:** propose→commit the surfacing rule (client + template, two passes) + **wire `follow-up` into the chat surface's context list** (`wingguyRulesSource.js` SURFACE_CONTEXTS - today follow-up reaches NO surface, so the rule would render nowhere).
7. **Migration mechanism:** `Follow-up Mode` flag on Client Master (Legacy default / Dynamic) + Client Template. Portal reads it (reuse `clientProfile.features.thanksForConnecting` gate pattern, Layout.js) to hide Follow-Up Manager + Smart Follow-ups + the date field for Dynamic clients. Wipe the 131 rotted dates on switch. Retire old screens per-client only AFTER their brief is proven.
8. **Far-future deferral (minimal):** human says "set Nita to December" → engine stamps `Follow-Up Date`. (Auto-detection = later.)

### Later layers (fast-follow, not v1)
- **"Remind me of the details"** recall cards - short memory-jog per person, transcript-powered ("ah yes, now I remember"); doubles as pre-meeting prep. Richest for Guy (Fathom); degrades to email+LinkedIn+notes elsewhere.
- **Fathom multi-tenant** wiring (per-client Fathom key → webhook resolves coach) so transcripts work for other tenants - the Advanced-tier ($300) differentiator.
- **Auto-detect far-future deferrals** ("circle back in March") → propose-then-confirm stamp.
- **Escalation counter** ("3rd morning I've flagged this"), **scheduled morning push**, **per-client priority tuning**, **non-lead tasks**.

### What I can/can't do from Claude Code
- **Code (sweep, briefing, mailProvider, surface wiring, Client Master flag, portal gate, date-wipe):** write here, deploy via git→Render/Vercel.
- **Rules (surfacing rule; reminder-discipline handling):** propose here (read-only, returns diff + expected_version), commit ONLY on Guy's explicit yes to the wording, one commit per layer (client, then template). Foundation untouched.

*Nothing built or rule-committed as of 2026-07-21 - this is the agreed plan, awaiting Guy's go on the v1/later split and the first build step.*

*Full build plan (sweep tool `wingguy_followup_sweep` / new mailProvider window read / wiring `follow-up` context to the chat surface / the surfacing rule) drafted in the 2026-07-21 session; no code or rule committed yet - awaiting B/C/D.*

---

*Captured 2026-07-20 from a working session (Chris/Emily/Kay). Draft for discussion. Section 12 added 2026-07-21.*
