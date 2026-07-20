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

*Captured 2026-07-20 from a working session (Chris/Emily/Kay). Draft for discussion.*
