# The Weekly Client Touch Planner

A design, not yet built. Internal only. First written 19 October 2026; rewritten 20 October 2026
after a long working session with Guy (walk-throughs on Steve Nelson, Rick Wong and Mehnaaz
Ahmed). Parent strategy: `docs/CLIENT-ENGAGEMENT-STRATEGY.md`.

## What it does

**Every client gets one email from Guy every week - or, deliberately, nothing that week.** One
system decides, for every client, every Monday. It replaces the separate ways Guy touches clients
today:

- the one-pager drip as a fixed sequence (for clients - it was never switched on anyway)
- habit emails written and scheduled by hand in Gmail
- setup to-do emails between onboarding sessions (built by hand per client, e.g. a scheduled
  task for Mehnaaz)
- one-off emails sent ad hoc (a client's open meeting, an event)
- the weekly call as the default touch - "time for a call" becomes one of the planner's picks

Not touched: the prospect drip (18 pieces, people who are not clients), the Mindset Mastery
newsletter (GMass), and Wingguy's follow-up queue (that is clients touching their own contacts).

## Each email = a personal opening + an approved body

- **The opening** - one to three sentences written fresh for that client, from their calls,
  emails, journey stage and special circumstances. "You've seen this from the receiving end - I
  introduced you to Roland, and to Brad today."
- **The body** - something Guy has already approved: a one-pager, a habit email, a setup step,
  a one-off. The planner chooses it; it is never written from scratch each week.

Why: it goes out in Guy's name, so he must recognise what was sent; a system writing whole
emails gets facts wrong more often (Steve's habit email claimed invitations were going out when
they were not - and Guy wrote that one); and "AI sounds like AI" is the objection Guy sells
against. Whole fresh emails can come later, for specific situations, once trusted.

## The kinds of email it chooses from

| Kind | What it is | When it is eligible |
| --- | --- | --- |
| **why** | the current one-pagers | any time after onboarding |
| **mindset** | Guy's own mindset pieces (the first is the energy piece) | any time after onboarding |
| **how** | feature and craft pieces | when they match where the client is stuck |
| **habit** | the one-prompt habit emails ("A few minutes a morning") | only once the client's Today tab has records, and only claiming what is proven for that client |
| **setup step** | the next small to-do during onboarding | when the previous step is done; during onboarding only |
| **one-off** | an event, a client's open meeting | the week Guy pins it |
| **personal note** | Guy writes it himself ("ask how the call with John went") | Guy's choice |
| **time for a call** | a flag to Guy, not an email | client stuck, drifting, or long since the last call |
| **nothing** | a deliberate quiet week | always allowed |

## Who gets what, when

**During onboarding** (the client board's onboarding group - until Guy marks them Graduated):
no scheduled emails. Only setup steps and emails set off by an event (below), at most one a week.
The session is the touch. Note: "a week without a session" is the wrong test - Mehnaaz's
sessions are three weeks apart.

**The opening run starts the week the client's first invitations actually go out** - the
record's "Last Invite Sent" fills in. That is when the plumbing turns into real conversations.
Not "the machine says IDLE" - a paused campaign also says IDLE (Steve, 19 Oct). Guy can start it
earlier (Email Series Start Date, or pin it) or hold it.

**The opening run** (discovery calls first - "that's where everything starts"):

1. **Begin with the end in mind** - what the calls are for, how many a week, work backwards.
2. **The energy piece** - what you bring to the table.
3. **What can you discover?**
4. **What to say in the discovery call.**

Plus the busy-weeks piece whenever a client goes quiet or Guy notes they are flat out.

**After the opening run**, each Monday, first match wins:

1. **Not this week** - Guy personally wrote to them in the last 6 days about something
   substantial (advice, an introduction, a follow-up after a call), or had a session with them,
   or marked them skip. Admin-only emails (billing, rescheduling, a quick link) do not count.
2. **Guy pinned something** - for this client, or for everyone this week (a one-off).
3. **An event fired** - see below.
4. **A call problem** - a recent call showed a misconception a piece answers.
5. **Stuck on a journey stop** for 14+ days - a piece that helps with that stop, how-pieces first.
6. **Mindset rhythm** - every fourth email is a mindset piece, when one exists.
7. **Next in the default order** - the client run in `config/onePagerSeriesManifest.js`.
8. **Reinforce** - everything sent: a short re-send of an earlier piece (not within 8 weeks).
9. **Nothing.**

**Limits:** at most two emails a week from Guy to a client, a habit email taking the first slot
(Guy's rule, 8 Oct). A full piece goes to a client once. Never stack two on the same day.

## Emails set off by something that happened

The best time for an email is just before the client needs it - not week three. Examples:

- **The client's Today tab first has records** -> "Make the important urgent", that week, even in
  the middle of the opening run ("get on top of it right at the very beginning, or it becomes a
  chore"). It replaces habit email #1 "A few minutes a morning" for new clients. Again when
  their campaign runs low on people, with a flag to Guy to top up the search.
- **First discovery call booked** -> "What can you discover?" or "What to say in the discovery
  call" the day before. (Check first that the system reliably matches a calendar meeting to a
  lead; if not, start with "Wingguy booked a meeting", which it definitely knows.)
- **First lead says yes** -> the "book it" email.
- **First introduction made** -> introductions-that-land.
- **Previous setup step done** -> the next setup step.

These may go during onboarding (at most one a week). If a client has not booked a call within a
few weeks of the opening run, the discovery-call pieces come up in normal order anyway.

## How to write to each person - the client note

Each client has a short note on their record that Guy keeps. It says three things:

1. **The frame - set per topic, not per person.** *Teach* or *recognise*. Steve is a recognise
   on selling (25 years in sales) and a teach on being a connector (a self-rated LinkedIn
   "beginner"). Rick is a recognise on everything relationship ("We work on referrals").
   Recognise = "You'll know better than most..."; teach = "here's how".
2. **The length** - full piece, or short (dek + three bullets + "read the full piece"). Rick
   asked for short in so many words.
3. **What to include or avoid** - optional extras (a how-to link, the button-level mechanics),
   and what lands badly (Rick: calendar links are "lazy", no self-promotion; Steve: no generic
   networking lines - his test is "would I send that to the CEO of Bunnings?").

**The client's own number.** Each client picks how many discovery calls a week they can keep
up consistently (Guy, 20 Oct - never given to them). Once they tell Guy, it goes on their note,
and later emails can use it ("you said three a week - how's it going?").

**The note holds lasting things only.** Background, format and what to avoid hold for months.
Where the client is right now (campaign running, calls booked) goes stale in a week, so the
planner reads that live every Monday, never from the note.

**Drafted from the evidence, approved by Guy.** The system drafts each note from the client's
call transcripts and emails, with evidence and a confidence for every line; Guy approves or
corrects it once (about a minute a client). Tested blind on 20 Oct for Rick and Steve - both
came out close to what Guy knows. Limits: most recordings are Guy's setup sessions, which show
little of how someone is with a new person; speaker labels in older transcripts are sometimes
wrong. Updates are proposed when something changes, never applied silently.

**Per-client extras, same body.** The idea is in every client's email ("connect before you ask
anything"); only the optional link or the how-to varies. Rule: at most one "more on this" link
per email, and only to a short how-to piece. A piece big enough to be an email in its own right
is sent, never linked.

## Where Guy's input goes - nothing is lost

Guy thinks out loud and the improvements keep coming. Each kind of input has one home, and
Claude files it the moment he says it - he never has to say "save this".

| What Guy says | Where it goes | Who reads it |
| --- | --- | --- |
| An improvement to an email ("book the first call with another straight after it") | `content/one-pagers/IMPROVEMENTS.md`, under that piece | whoever next revises the piece - read first, worked in, Guy approves, closed |
| An idea for a new email ("what energy do you bring?") | the same file, under **New pieces** | the same |
| Something about one client ("Steve's away until the 3rd", "invite everyone to Rick's meeting") | that client's note, or a pin on the Monday screen | the planner, every Monday |
| A rule about how the weekly emails work ("one link max", "skip if I've written to them") | this document | whoever builds or changes the planner |
| A business idea unrelated to the series | Guy's `ideas.md` | Guy |

**What makes it hold:**

- **Folded in, not just filed.** The Monday screen shows "3 improvements waiting on What to say
  in the discovery call", so the list does not depend on someone remembering to look.
- **Calls feed it too.** A weekly sweep of Guy's call transcripts proposes items ("on your call
  with Mehnaaz you said X - add it?"). Proposals only; Guy says yes. (Not built.)
- **Client replies feed it.** "I didn't get this bit" is a gap in that piece.
- **Earlier recipients are not left behind.** An important improvement can reach clients who
  got the older version as a short "one more thing on discovery calls" (the reinforce kind).
- **Don't let it hold up sending.** A client who got last month's version has lost nothing.
  Send the good version now; send the better one to the next person.

**⚠ The gap still open: capture away from the laptop.** Filing works when Guy says it in Claude
Code on his laptop, where the project lives. Ideas said in Claude.ai on his phone do not reach
these files. Fix: a small Wingguy tool ("note for the series: ...") that writes the idea into
the system from any chat, which a session on the laptop then files into the right home. Until
that exists, say it on the laptop.

## When a call was not recorded

Some calls have no transcript (Steve, 20 Oct: Fathom stopped at the previous guest's goodbye and
never recorded him). The planner must not then think the client has not had a call:

- **Count the call from the calendar** - an accepted event in the slot is a session that happened.
- **Let Guy add a line or two after any unrecorded call** ("pressed Start, wants the Brad
  intro"), into the same record the planner reads. The import tool covers a recording that
  turns up later.

## The craft rules

- Every email reads as a next instalment, never "we noticed you haven't...". The reason line on
  Guy's screen never appears in the email.
- Helpful, never watched: "following up from our call" yes; quoting a client's own leads' emails
  back to them, never.
- Facts are checked when the email is sent, not when it was written. "Your invitations are going
  out" appears only if they are.
- The series says what to do and the words to use; button-level mechanics only for clients
  whose note says they need them. When in doubt, leave it out - a stuck client asks; a client
  who feels babysat stops reading.

## Guy's Monday screen

A section on the client board. One row per client: the pick (or "nothing this week"), the
one-line reason, the email with its personal opening, and buttons to approve, edit, swap, skip
or pin for next week. "Pin for everyone this week" for one-offs. One "Send approved" button.
Also on the screen: onboarding clients with no next session booked, or an invite not accepted
within a week, and the waiting improvements count per piece.

**First month: Guy approves every email.** After that it sends on its own with a Monday preview
he can veto until Tuesday 9am. **When Guy is away** (Thailand, soon): approve the next two weeks
before leaving, or switch to send-with-veto from his phone for that stretch.

## What has to exist first

- **A record of every email each client has had** - one-pagers, habit, setup, one-offs and Guy's
  own substantial emails - so nothing repeats and the skip rule works. A Postgres table
  (tenant, what, form full/short/one-off, sent_at, reason). `Series Sent Count` cannot say which.
- **A working unsubscribe link per client.** The Clients base has no token, so every client
  email would ship a dead link.
- **The right address for each client.** Rick's mail all comes from rwong@salesxceleration.com,
  not the address on file; that inbox's filter rewrites links.
- **The real "invitations going out" signal** - fix the journey, which counts a paused machine
  (IDLE) as leads arriving.
- **Labels on every piece** - kind, journey stop(s), problem, can-be-re-sent - reviewed by Guy
  in one table. The labelling also shows empty shelves (nothing yet on the voice stop or on
  recording calls).
- **The drip engine learning clients.** `services/seriesDrip.js` is hardcoded to prospects; the
  planner takes over "what to send", and the existing build -> send -> mark is reused.

## Build order

1. **Today:** this document and `content/one-pagers/IMPROVEMENTS.md`. (Done 20 Oct.)
2. **Guy decides:** approves (or changes) "Connection isn't charm"; how the planner covers his time away.
3. **Write the opening run:** Begin with the end in mind, the energy piece, the discovery-call
   craft update, busy weeks; then the two gap pieces. Guy reviews each.
4. **Label the pieces; draft a note per client.** Guy checks one table and approves each note.
5. **Plumbing:** the send record, unsubscribe links, addresses, the invitations signal.
6. **The picker** - facts + pieces + send record + note in, `{ what, form, reason, opening }`
   out - with a test for each rule above.
7. **The Monday screen,** sending through the existing series mailer.
8. **Switch on:** Guy approves every email for a month, then send-with-veto.
9. **Later:** the phone capture tool; the weekly call sweep that proposes improvements; tagging
   a call with a problem; whole fresh emails for specific situations.

## Still open

- The starting list of problems a piece can answer, drawn from real call misconceptions.
- Whether a client's own reply to a weekly email pauses the next week's.
- Whether clients who started before the planner exists begin at the opening run or further in.
