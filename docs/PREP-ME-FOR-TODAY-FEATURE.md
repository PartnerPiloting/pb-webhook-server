# "Prep Me For Today" - Feature Note

**Status:** Concept captured, not built. Documents an idea Guy has been carrying (surfaced 2026-07-20) that wasn't written down anywhere.
**Owner:** Guy Wilson (tenant 0)
**Related:** `docs/MEETING-PREP-FEATURE-HANDOVER.md` (per-lead call prep, planned) · `docs/SMART-FOLLOWUP-DECISIONS.md` · `services/smartFollowUpService.js` · `docs/wingguy.md`

---

## 1. The idea in one line

A single trigger - **"prep me for today's meetings"** - that returns two streams woven together:

1. **Today's calendar meetings**, with prep context for each.
2. **Time-triggered nudges** - leads whose follow-up moment has *arrived*: "Kay's back from overseas around now - she asked to reconnect in August."

The value isn't the list. It's the **timing**: saying the right thing *at the right time*, so a lead who deferred to a future month resurfaces on the right day instead of falling through a crack.

---

## 2. Why it matters (real, recurring examples)

This isn't hypothetical - it's Guy's weekly reality. In a single session (2026-07-20):

| Lead | What they said | The right time to act |
|------|----------------|-----------------------|
| **Chris White** | "Tuesday 28th 4pm" | Same week - easy, book now |
| **Emily** | "defer to mid-August" | Surface ~mid-Aug, then offer times |
| **Kay Ridge** | "overseas until August, chat then" | Surface ~early Aug, when she's back |

The same-week case (Chris) handles itself. The **deferrers (Kay, Emily) are the ones that get lost** - there's no reliable mechanism today that says "it's August now, Kay's back, reach out." This feature is that net.

---

## 3. What already exists to build on

Most of the hard parts are already primitives in the codebase - this is largely **assembly**, not a from-scratch build.

- **The "right time" query** - `getLeadsNeedingFollowUp` finds leads whose **Follow-Up Date is due** (`<= today`) or were touched in the last 7 days. See [smartFollowUpService.js:231](../services/smartFollowUpService.js). This IS the timing engine.
- **AI-suggested follow-up date** - Smart Follow-Up already reads a conversation and *suggests when to follow up* when no date is set (`AI_SUGGESTED_DATE`, [smartFollowUpService.js:308](../services/smartFollowUpService.js) / returned at ~line 470). This is the seed of the capture half.
- **The anchor field** - `Follow-Up Date` on the Leads table (`fldtGi5EFfG4RZA9o`). One date per lead = the whole timing model.
- **Calendar listing** - `listEventsForCoach` ([wingguyCalendar.js:685](../services/wingguyCalendar.js)) and the connector's `wingguy_list_events` already return a day's meetings, timezone-correct.
- **Meeting prep context** - the Fathom transcript read (`fetchFathomTranscripts`) and lead Notes are already wired for Smart Follow-Up and specced for Meeting Prep.

---

## 4. The two real gaps

### Gap 1 - CAPTURE (the linchpin)
"At the right time" is only as good as the date getting **stamped** when a lead defers. Today, when Kay says "August," nothing records "reconnect ~1 Aug" unless Guy does it by hand.

The fix: when Wingguy sees a defer in a thread ("overseas until August", "let's chat mid-August", "circle back next quarter"), it **proposes and sets the Follow-Up Date**. The AI-suggested-date primitive already exists; this closes the loop so the suggestion actually lands on the record.

> This is the highest-leverage piece. Get it reliable and the whole feature comes alive. Skip it and the daily brief surfaces nothing, because no dates were ever set.

### Gap 2 - THE SURFACE
A trigger that **merges the two streams** into one brief:
- today's calendar meetings (+ prep), and
- leads whose Follow-Up Date is due (or within a small lookahead window).

Delivered as a Wingguy connector capability the way Guy phrases it: "prep me for today's meetings."

---

## 5. Proposed shape

- **New connector tool** (e.g. `wingguy_prep_today`) that assembles and returns:
  1. **Meetings** - today's calendar events via the existing listing, each with lead + prep context.
  2. **Due follow-ups** - leads with `Follow-Up Date <= today` (reuse the Smart Follow-Up query), each with a one-line "why now" ("back from overseas", "mid-Aug defer") and a suggested next action (offer times / send a note).
- **Timing model** - the anchor is `Follow-Up Date`. Surface a lead on that date, with an optional **lead-time window** (e.g. also show anything due in the next 2-3 days) so nothing is missed if Guy skips a morning.
- **Capture model** - defer detected in-thread -> propose a Follow-Up Date -> confirm -> stamp. Runs wherever Wingguy already reads the thread (connector + extension).

Both halves are **client-scoped** (`x-client-id`), same auth pattern as Smart Follow-Up and booking.

---

## 6. Open questions / decisions to make

1. **Lookahead window** - surface exactly on the Follow-Up Date, or also N days early? (Leaning: a small 2-3 day window so a missed morning doesn't drop a lead.)
2. **Pull vs push** - only when Guy says "prep me for today," or also a scheduled morning push? (Guy's framing is a pull trigger; a push is a natural add later.)
3. **Capture: auto vs confirm** - should a detected defer set the date automatically, or always propose-then-confirm? (Leaning: propose-then-confirm at first, to build trust in the detection.)
4. **Surface home** - Claude connector (conversational, matches "prep me for...") vs a portal daily view. Connector first; portal optional later.
5. **Prep depth** - how much per-meeting prep to pull (Notes only, or Notes + Fathom transcript). Ties directly into the Meeting Prep plan (`MEETING-PREP-FEATURE-HANDOVER.md`) - this feature is the daily *surface*; Meeting Prep is the per-lead *deep dive*. They should share the Fathom read path.
6. **Nudge tone** - warm and specific ("Kay's back around now - she wanted to reconnect in August"), never a bare task list.

---

## 7. How it relates to what exists

- **Smart Follow-Up** = the follow-up *engine* (finds due leads, drafts messages). Built.
- **Meeting Prep** (`MEETING-PREP-FEATURE-HANDOVER.md`) = per-lead *call prep* deep dive. Planned.
- **Prep Me For Today** (this note) = the daily *surface* that unifies both + the calendar, driven by the Follow-Up Date as the "right time" anchor. Concept.

The three are complementary layers, not competitors: this feature is the front door that decides *what to show and when*; the other two supply the substance once a lead is in focus.

---

## 8. Suggested build order

1. **Capture first** - make defers reliably stamp a Follow-Up Date (propose-then-confirm). Without dates, nothing else has anything to surface.
2. **Surface second** - `wingguy_prep_today` merging today's meetings + due follow-ups.
3. **Deepen** - fold in per-meeting Fathom/Notes prep (shared with Meeting Prep) and, optionally, a scheduled morning push.

---

*Captured 2026-07-20 from a working session (Chris/Emily/Kay). Draft for discussion - not yet a build spec.*
