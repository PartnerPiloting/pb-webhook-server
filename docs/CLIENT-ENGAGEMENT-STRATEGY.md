# Keeping Clients Engaged and Sticky

A living document. Update it after any call insight, strategy conversation, or shipped
mechanism. Internal only - not client-facing (the client-facing material is
`docs/client-playbook.md`).

Started 2 August 2026 from a strategy conversation between Guy and Claude.

## The goal

Handle more clients with less direct input from Guy. Two stickiness outcomes define success:

1. **Consistency** - clients keep doing outreach and follow-up because the system makes it so
   easy that stopping feels harder than continuing.
2. **Promotion** - clients use Wingguy heavily and talk about it (Wingguy specifically, not
   just I Know A Guy) to friends and associates.

## The core trade

Historically, constant follow-up calls kept clients sticky. Calls were doing three jobs:

- **Teaching** - each call moved their understanding forward.
- **Accountability** - someone noticed if they drifted.
- **Detection** - Guy spotted misconceptions and wobbles early (the subtle attitude stuff).

The new model replaces calls as the default, keeping them as the exception path:

| Job of the old weekly call | Replaced by |
| --- | --- |
| Teaching | Onboarding arc + one-pager series + insight-article library |
| Accountability | Client pulse (system watches consistency, flags drift) |
| Detection | Partly the pulse, partly what clients say to Wingguy; monthly call remains the sensor for subtle stuff |

**Taper, don't cut**: weekly → fortnightly → monthly. The pulse decides who is safe to taper.
Some clients were sticky *to Guy*, not to the system - the pulse identifies who still needs
the human version rather than finding out via churn.

## The five mechanisms

### 1. Client pulse - clients inside Guy's own follow-up machinery

Clients become records in Guy's own leads base with reconnect cadences set. They surface in
his own follow-up queue and morning brief like any lead. Last-contacted is derivable from
correspondence history; the cadence gate already knows not to nag.

- Calls become exception-based: contact only when the system flags drift.
- Sales line for free: "I manage my relationship with you using the same tool I'm selling you."
- **Gate**: confirm whether current clients already exist as lead records with correspondence
  attached, or live only in the Master Clients base. If the latter, a small import is step one.

### 2. Onboarding arc - sessions right through to Wingguy

Wingguy comes in at the very first onboarding session (it explains itself via
`wingguy_learn`), so clients see early that two-thirds of the magic is beyond scoring:
follow-up, booking meetings, the Chrome extension.

Rules for the arc:

- **Session one does not end until the connector is live**, Calendar Email is set, and one
  real thing has happened in the client's own account (a genuine draft or booking). A demo
  they watched is impressive; a thing in their own inbox is sticky. (Lesson from Sam Noble:
  "the connector could go live in two minutes" helps nobody if the session ends blank.)
- **Every session ends with the client having done the thing themselves** - driver's seat,
  not demo. The realisation "this makes it easy" only happens when they do it.
- Each session ends with a habit assignment; "prep me for today" is the daily trigger.
- **Define "graduated"** measurably - e.g. client runs the daily loop unprompted for two
  weeks. That tells Guy when sessions can stop and gives the pulse a relapse definition.
  (Exact definition still to be settled.)
- The playbook (`wingguy_learn`) carries the explaining load between sessions.

### 3. One-pager series - the drumbeat between sessions

The drip series (built, not yet scheduled) keeps teaching landing in the inbox between and
after sessions.

Refinement to build toward: sequence one-pagers to where the client is in the arc rather
than a fixed broadcast schedule - the "follow-up habit" one-pager lands the same week that
session happens. Per-record series state fields support this.

### 4. Insight → article library (the Alistair pattern)

One call insight becomes a permanent asset:

1. Guy notices a misconception on a call.
2. He explains it to Claude.
3. Claude writes a *general* article addressing it.
4. It goes into that client's series - and into the library, so future clients get it
   automatically, ideally *before* the misconception bites.

Over time the library covers the common failure modes, authored from real cases. That is
Guy's teaching, scaled.

Triggered sending: the pulse can also fire a relevant one-pager on drift (consistency drops
→ consistency article). **Craft rule**: it must read as a well-timed instalment of the
series, never "we noticed you've stopped" - helpful, not surveilled.

**Article backlog:**

- *Trusted relationships take time - and that's why they're worth more.* From Alistair:
  expects networking to yield results in weeks; naive about cold-approaching end clients
  with AI expertise (every man and his dog is doing it, and even interested people check
  with their trusted circle rather than buy from a cold approach). Status: waiting on Guy's
  fuller version of the rant, then Claude drafts.

### 5. Retellable moments - the promotion mechanism

People don't retell dashboards; they retell "it booked the meeting while I was still on the
call". Promotion comes from moments worth retelling: the extension capturing a chat, a
meeting booked mid-conversation. These can't be manufactured, but onboarding is designed so
every client experiences at least one in week one.

## Re-onboarding existing clients

The scoring-only clients (the two technical ones piping the webhook into their own
spreadsheets, and the Sam Noble shape generally) are engaged but stuck at the shallow end -
they self-served on scoring and concluded that's the product. Scoring alone is comparable to
other tools; the follow-up-and-booking layer is the part nobody else has, so scoring-only
clients are churn risks.

They don't need onboarding; they need **re-onboarding**: a 30-minute "here's the two-thirds
you haven't seen" session, extension and a live booking as the centrepiece. Highest-leverage
single action on this whole list.

## Build gaps

- Drip send: built, not scheduled - waiting on Guy to say go.
- Trigger hook (pulse event → one-pager send) - not built.
- Per-client series variation / stage-aware sequencing - not built (state fields planned in
  the email series system).
- Client pulse setup - depends on whether clients are already lead records (see gate above).
- Graduation definition - to be agreed, then the pulse can detect relapse against it.

## Running log

- **2026-08-02** - Document started. Strategy landed: calls taper behind habit + pulse +
  drip; re-onboard the spreadsheet clients; connector-live-before-session-one-ends rule;
  Alistair article queued as first library entry.
