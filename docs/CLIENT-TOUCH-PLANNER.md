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
| **time for a call** | a flag to Guy plus a drafted offer of times | six weeks since the last call, or stuck / drifting |
| **nothing** | a deliberate quiet week | always allowed |

## Who is never sent anything - checked every time, with a test for each

Guy (22 Oct): "if a client becomes inactive, then nothing will be sent." The planner checks these
on the day of sending (not only on Monday), and the Monday screen lists everyone left out and why:

- **Not an active client** - Status is not Active, or they're in the board's paused group, or
  they've left / been offboarded, or their billing has lapsed (the billing lapse chain pauses them).
- **Unsubscribed** from the weekly emails.
- **Still in onboarding** - only setup steps and event-set-off emails, as above.
- **No working address** - the address check found no address they read, or recent mail bounced.
- **Guy said skip** this week, or for a stretch ("away until the 3rd").

**"Inactive" has two meanings - only one stops the emails.** A client who has paused or left gets
nothing. A client who is still paying but has gone quiet (not logging in, campaign stalled) KEEPS
getting their weekly email - that drift is exactly what it's for - and may get "time for a call".

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
2. **What energy do you bring?** - the first mindset piece.
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

## Three kinds of idea - how a hundred good ideas fit into one email a week

Guy's ideas keep coming (21 Oct: active posters, scoring, the profile, the connection request,
the person inside the organisation - all in one conversation). The answer is not to fit them all
into one email. A client gets 52 emails a year; a big pile of good ideas is a full shelf, and the
planner takes ONE off it each week - the one that fits where that client is now. Every idea is
sorted into one of three kinds:

1. **A way of thinking -> its own email.** Ideas that change how someone sees things (what your
   network is for, the energy you bring, make the important urgent). Each needs room to land.
2. **A practical tune-up -> a short email, set off by the client's own numbers.** The problem,
   the fix, one thing to do this week. Because it arrives when their campaign shows the need, it
   reads as useful, not as homework:

   | Tune-up | Sent when |
   | --- | --- |
   | Your connection request (some curiosity - "I know a guy") | their matured acceptance rate is low |
   | Your search (people who posted in the last 30 days) | their campaign is running out, or acceptances are slow |
   | Your scoring ("rebuild my scoring", think it through) | the top of their list isn't leading to good conversations |
   | Your profile ("connector" above the fold) | before their campaign starts, or their profile doesn't lead with it |

3. **Button-pressing -> never an email.** "Where in Linked Helper do I see my acceptance rate?" -
   they shouldn't have to look; the Monday campaign numbers email reports it. Mechanics belong in
   the system, the portal Help or the playbook.

**One idea per email.** A link only when the depth already exists (the playbook, another piece),
at most one per email, and never as a way to squeeze in a second idea.

## Monthly inner-circle connections (Guy, 22 Oct - to build after the deep client brief)

Once a month every graduated client gets ONE person in the inner circle to reach out to, chosen for
fit from both people's briefs (what each wants, who each wants to meet - e.g. Ashley wants platform
builders, so Julian). Pairs run as a chain (Ashley -> Julian -> someone -> ...) so each person makes
one reach-out and receives one a month. Guy approves the month's pairs on the Monday panel. The pair
appears in that week's email ("This month's inner circle connection: <name> - why you two should
talk") with a short suggested message the client can send. Pairs never repeat until good matches run
out; the next month's email asks how it went. Recorded in the introductions record.
Decided by Guy, 22 Oct:
- **The inner circle is a list Guy curates** (a yes/no on each client record), not everyone. Only
  graduated clients are eligible, and Guy selects them. When a client graduates, the Monday panel asks
  "Add <name> to the inner circle?" and keeps nudging until Guy answers yes or no.
- **Guy approves every month's pairs.** A pair is never repeated.
- **The following month's email asks "How did it go?"**
- **Two good reasons to connect, both valid:** (1) a functional fit - one can help the other or knows
  the people they want to meet; (2) simply because both are on the list - they're connectors, and two
  connectors will come across people who are good for each other. The reason line on the panel and in
  the email says which.
Still to settle when built: whether Guy introduces the first few pairs himself to start the habit.

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

**Two more things on the Monday screen (Guy, 22 Oct):**

- **Last touched base, per client.** How long since Guy last had a call with them, and since any
  real touch (call, substantial email, introduction). Read live from the calendar, the transcript
  store and the send record - the client board already works out "last session".
- **Introductions to make.** Each week, one to three suggested PAIRS of people - client to client,
  or a client to someone in Guy's wider network - who would clearly benefit from meeting and have
  NOT already been introduced. Each with a one-line why, from what each has said they want (their
  client note: what the network is for, their unique thing) and their call transcripts. Guy
  approves a pair and Wingguy drafts the introduction (the existing introduction instructions and
  layout). Rules: pairwise only, never "all these people"; space each person's introductions about
  a week apart; never suggest a pair already introduced - which needs every introduction recorded
  (the master Clients base Referrals table records introductions TO Guy today; client-to-client
  and Guy-made introductions must be recorded too, or the "not already connected" check can't work).

**Six-weekly check-in calls (Guy, 22 Oct).** Every running client gets a call with Guy about every
six weeks. When one is due (six weeks since the last call, nothing booked), the planner shows
"time for a call" and drafts an email offering two or three considered times from Guy's free slots
(never a booking link - never-send-calendly). Guy approves the draft; nothing is booked or sent on
its own. A client who is stuck or drifting can be brought forward; a client in onboarding sessions
is skipped. This is a regular rhythm, not a stalled-client alert (the 24 Aug 2026 "no alerts"
decision stands).

**Tuning by approval (Guy, 22 Oct).** Every week Claude prepares each client's email; Guy approves
it, or says in a few words why not. Each "why not" is filed where it fixes the cause, not just that
email - so the same mistake can't come back:

| Guy's reason is about... | It goes to... |
| --- | --- |
| the body ("that point's wrong") | content/one-pagers/IMPROVEMENTS.md, under that piece |
| the choice ("too soon for this one", "he's had enough on X") | a rule in this document |
| the person ("Rick hates long emails") | that client's note |
| how openings are written ("too gushing", "don't mention the call") | a writing instruction for openings, used every week |

Measure it: the share approved without a change. When it stays at about 9 in 10 for three or
four weeks, switch to send-with-veto (below). It won't be perfect - it'll be close enough that
reading the preview takes minutes, and every miss still teaches it.

**First month: Guy approves every email.** After that it sends on its own with a Monday preview
he can veto until Tuesday 9am. **When Guy is away** (Thailand, soon): approve the next two weeks
before leaving, or switch to send-with-veto from his phone for that stretch.

**The week-ahead workflow (Guy, 22 Oct 2026) - this replaces "build Monday, send by hand":**

- **Built a week ahead.** Next Monday's plan is built THIS Monday (after this morning's send), so
  Guy can chip away at it a few clients at a time all week, instead of everything at once on
  Monday morning.
- **Each client's whole picture on the panel:** *Already had* (every touch on the record, newest
  first, with dates) | *This Monday* (the pick to approve, edit, swap, skip or pin) | *Likely next*
  (the next five weeks the picker would choose IF NOTHING CHANGES - run forward on today's facts
  with the earlier picks treated as sent; marked provisional, because an event can jump the queue).
  Any likely-next piece can be pulled into this Monday.
- **Re-checked on the sending morning.** Before anything goes, the never-send checks AND the
  picker run again on fresh facts. If the client's situation changed since Guy approved (status,
  unsubscribed, address, back in onboarding, an event that would now win, Guy wrote to them, the
  piece no longer fits), that one is HELD and shown on the panel with what changed ("their
  invitations started going out on Wednesday - keep or swap?"). Everything else goes.
- **Approved emails go by themselves, Monday about 8am Brisbane.** Only what Guy approved; anything
  not approved by then is never sent and rolls off. This is NOT send-with-veto (that stays OFF).
  Guy then gets a short report: what went, what was held and why, what wasn't approved. Every send
  is recorded in the touch record as before.
- **From any chat:** "show me Steve's emails" (the Guy-only Wingguy tool `wingguy_client_emails`)
  returns the same three parts, so Guy can talk a client's emails through from his phone.

**How the weekly email looks (Guy, 22 Oct 2026):**

- **A personal email, not a newsletter.** No banner, no series branding, no big heading: "Hi
  <first name>," then Guy's words, signed "Cheers, / Guy", and one small quiet line at the bottom -
  "Rather not get these weekly emails? Unsubscribe". When the body is a one-pager it sits
  underneath as plain text under a simple bold title. (The prospect series and the public /series
  pages keep their own look.)
- **The welcome comes first** (Guy, 22 Oct): every client's FIRST weekly email is the welcome
  below, as soon as their invitations are going out - ahead of events, a call offer and everything
  else; only Guy's pins, onboarding and "not this week" come before it. When their invitations
  started more than four weeks before the sending morning (their Launch Date, else the first day the
  planner saw invitations going out - the earliest connection is often an old import), it is built
  but HELD on the panel: "invitations started <date> - 'Congratulations, you've started' may read
  late; keep or reword". Guy approves it as it is, or rewords (or drops) the Congratulations line.
- **The first-email template** (Guy approved 22 Oct): when the pick is the orientation, it is the
  client's first planner email and their invitations are going out (Last Invite Sent - never
  before), the subject is "You're not doing this alone" (no brand prefix) and the email reads: Hi,
  "Congratulations! You've started the process of growing your network predictably and
  consistently - seeded by connection requests to people you've chosen on LinkedIn. From here, small
  tweaks to the process usually bring big improvements in results.", a personal line only when
  there is something real and specific, "First, a quick word on what you're now part of.", the
  heading "You're not doing this alone", the orientation without its first sentence and without
  its "Next email" line, then the note below, Cheers / Guy and the unsubscribe line.
- **The first weekly email** a client ever gets (no planner send on their record - Mindset Mastery
  and Guy's own emails don't count) adds, after the body: "One more thing - from now on I'll send
  you a short email most weeks: an idea, a tip, or something I've picked up from other clients
  that I think will help. If one doesn't land, just reply and tell me. And if you'd rather not get
  them, there's a link at the bottom."
- **No doubles.** The opening never starts with the client's name (the greeting has it). An offer
  of times for a call is ONE short note: "It's been a little while since our last call - I'd love
  to catch up. Would any of these suit for half an hour?", the times, then "Reply with whichever
  works and I'll send the invite - or tell me a time that suits you better." No heading.
- **A thought for the week** in every weekly email whose body is not a one-pager (a call offer, a
  setup step, a one-off, a habit email): two or three sentences lifted word for word from an
  approved piece, introduced "A thought for the week:". One per piece, kept in
  `config/clientTouchNuggets.json` (Guy can change any). **Chosen from the client's own world**
  (Guy, 22 Oct: "look at his profile and work it out"): Claude reads the same material as the
  opening - recent calls, recent emails, the Touch Note - picks the thought that speaks to what is
  going on for them now, and writes a one-line "why this one" that Guy sees on the panel. Guy can
  change it on the row. **Repeats are fine**; only never the same thought two weeks running, and
  never the piece that is this week's body. Without Claude it falls back to the labels (journey
  stop, call problems, a stable per-client shuffle). Times for a call are picked from
  the Tuesday after the sending Monday and re-checked on the sending morning.

## What has to exist first

- **A record of every email each client has had** - one-pagers, habit, setup, one-offs and Guy's
  own substantial emails - so nothing repeats and the skip rule works. A Postgres table
  (tenant, what, form full/short/one-off, sent_at, reason). `Series Sent Count` cannot say which.
  **BUILT 22 Oct 2026:** `services/clientTouchStore.js` (table `client_touches`; kinds one-pager,
  habit, mindset, setup, one-off, personal, call, intro; a touch is never recorded twice). History
  that already existed goes in with `scripts/backfill-client-touches.js` (dry run by default) from
  `scripts/data/client-touches-backfill-2026-10-22.json`: the two habit emails (Rick 14 Oct, Steve
  16 Oct) and every Mindset Mastery edition each client was BCC'd on, Jun 2025 - Jun 2026, read from
  Gmail Sent. Editions sent through GMass are not in Sent, so they are not in the file.
- **A working unsubscribe link per client.** The Clients base has no token, so every client
  email would ship a dead link. **BUILT 22 Oct 2026:** field `Email Unsubscribe Token` on the
  master Clients table (minted at join, backfilled for all 29 rows by
  `scripts/fill-client-unsub-tokens.js`); the existing `/series/unsubscribe?t=` route now also
  recognises a client token and ticks `Series Unsubscribed` (`services/clientUnsubscribe.js`).
  The planner reads `client.emailUnsubscribed` and `client.emailUnsubToken` from clientService; no
  token = no email.
- **The right address for each client.** Checked 22 Oct 2026 against where each active client's
  mail really comes from (Gmail, last 120 days). Rick's record is already rwong@salesxceleration.com.
  Mismatches found - Steve Nelson (steve@euroswift.com, record 24hrbp), Matthew Bulat (gmail,
  record expertaiprompts), Alex Solti (futurefunding, record alexsolti), Sam Noble (findmefirst /
  barclayss, record hotmail), Szymon Zurek (maiababy.co.uk, record gmail), Mehnaaz Ahmed (writes
  from both). Guy decides each; the planner should send to the address the client actually
  writes from.
- **Who has been introduced to whom** - so "introductions to make" never suggests a pair already
  introduced. The Referrals table holds introductions TO Guy, and (since 25 Sep) the ones Wingguy
  drafted FROM Guy; introductions Guy made by hand, and client-to-client ones, are not recorded.
  **BUILT 22 Oct 2026 (Guy's yes):** one linked field `Other Client` on Referrals so both sides
  of a row can be clients (rolled out via ensure-client-fields.js); `alreadyIntroduced(a, b)` /
  `introductionsBetween` in referralService match a pair either way round by record, name or
  email (a Promised row counts - in flight is not to be suggested again; a To Guy row means the
  client and that person have met); `wingguy_referrals action=met` asks it in chat and
  `action=log other_client=` records a hand-made client-to-client introduction. Wingguy's own
  drafted introductions link the other client automatically. Introductions Guy made by hand
  before today are not on record until he logs them.
- **The real "invitations going out" signal** - fix the journey, which counts a paused machine
  (IDLE) as leads arriving. **DONE 22 Oct 2026** (`services/clientJourney.js`: leads arriving =
  the record's Last Invite Sent is filled, not the machine's IDLE/RUNNING word).
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
   out - with a test for each rule above. **BUILT 22 Oct 2026** - see "What is built" below.
7. **The Monday screen,** sending through the existing series mailer. **BUILT 22 Oct 2026.**
8. **Switch on:** Guy approves every email for a month, then send-with-veto. **Guarded 22 Oct
   2026:** nothing sends until Guy approves it on the screen; send-with-veto exists and is OFF.
9. **Later:** the phone capture tool; the weekly call sweep that proposes improvements; tagging
   a call with a problem; whole fresh emails for specific situations.

## What is built - how it runs (22 Oct 2026)

- **Approved pieces only** (Guy's standing rule: nothing reaches a client until he has read it). The
  picker only ever picks pieces with status final - this week, a pin, Likely next. A draft shows
  nowhere until approved; when a piece's ending promises a draft, the next approved piece goes instead.
- **The picker** - `services/clientTouchPicker.js`, pure. Facts + the labelled shelf + the touch
  record in, one pick out. Every rule above has a test in `tests/client-touch-picker.test.js`
  (including the Steve and Mehnaaz walk-throughs). "A week" for the two-a-week limit is a rolling
  six and a half days - so last Monday's 8am email, which went a few seconds after 8am, never
  counts against this Monday's 8am check. After an offer of times for a call, no second offer for
  two weeks (give them time to answer). `projectAhead` is the picker run forward - "likely next". Event keys live in `config/clientTouchLabels.js` (EVENTS) and are matched from each
  piece's `event:` label. One rule not written above: when the last piece sent ended "that's next",
  the piece it promised goes next (ahead of the mindset rhythm and the default order) until Guy
  approves the 17 ending rewrites.
- **The opening** - `services/clientTouchOpening.js`. Reads the client's last three calls with Guy
  (the transcript store), the last 60 days of email between them (Guy's mailbox), the client's
  Touch Note and the live facts; drafts one to three sentences under the craft rules; a code check
  refuses nudges, links, em dashes, system talk and more than three sentences (a failed check shows
  on the screen as "needs your words"). Guy's "how openings are written" feedback becomes a standing
  instruction in every later prompt.
- **The client note** = the `Touch Note` field on the master Clients row (read as `touchNote`).
  "Short" in the note = short form. The "why not" box appends to it live.
- **Monday morning** - `services/clientTouchPlanner.js` `tick`, Brisbane time, each step claimed once
  in Postgres. **8am** (`CLIENT_TOUCH_SEND_HOUR`): send what Guy approved for today, each re-checked
  on fresh facts (below); proposals never approved are marked `lapsed` (never sent); Guy gets the
  report. **9am** (`CLIENT_TOUCH_BUILD_HOUR`, never before the send): build NEXT Monday's plan -
  every client's row from the client board's cards, the record, the journey, the touch record, the
  campaign numbers, the Today tab, pins and skips - judged as at next Monday 8am (days-since counted
  to then), store the proposals (`client_touch_plans`) and email Guy the preview.
  `CLIENT_TOUCH_PLANNER=off` stops the tick; `CLIENT_TOUCH_MONDAY_SEND=off` stops only the 8am send.
  "Not this week" counts Guy's OWN touches only - the planner's weekly email is not one (it would
  make every other week a quiet one).
- **The screen** - on the client board (`TouchPlannerPanel.js`, routes
  `/api/client-board/touch-plan`). Opens on the Monday Guy is working towards (`planningWeek`:
  today before 8am on a Monday, otherwise the Monday after), with arrows to look at other Mondays.
  Per client: Already had | This Monday | Likely next (`outlookFor`). Approve / edit (your words) /
  swap / skip with the "why not" box / pin for the Monday after / "use now" on a likely-next piece /
  pin for everyone; held rows show what changed with "Keep it - send now" and "Swap to ..."; the left-out list; onboarding with no next session;
  "time for a call" (an offer of two or three times from the calendar, never a booking link);
  introduction pairs (`services/clientTouchIntroductions.js` - client to client, never a pair the
  Referrals table knows, a week apart); waiting improvements per piece; the approved-unchanged share.
- **Sending** - `sendApproved` sends rows Guy approved or edited through `seriesMailer` with the
  client's unsubscribe link and records each send in `client_touches`. A proposed row is never
  sent. Each row is checked twice first: "who is never sent anything" from a fresh record (a hard
  hold), then the picker on fresh facts - if it would no longer pick what Guy approved, the row is
  `held` with what changed (`whatChanged`) and the pick it would choose now. "Keep" (route
  `/:clientId/keep`) sends it anyway - the never-send checks still run.
- **The switch** - `CLIENT_TOUCH_AUTOSEND=on` turns on send-with-veto: at the Monday send, untouched
  proposals with a passing opening count as approved. Default off.
- **From any chat** - `wingguy_client_emails` (services/wingguyRulesMcp.js, coach-only) returns
  Already had / This Monday (reason, opening, status, what changed if held) / Likely next for one
  client. Read-only; changes are made on the panel.
- **"Why not" filing** - person -> the Touch Note, now; openings -> the opening instructions, now;
  body and choice -> queued in `client_touch_feedback` and written into IMPROVEMENTS.md / this
  document by `node scripts/file-touch-feedback.js --apply` on the laptop (dry run by default).
- **What the planner cannot yet see** (so these events never fire): a first discovery call booked
  or held (needs the client's own calendar matched to a lead), a first yes, a first introduction
  made or received, a call tagged with a problem, Guy's own substantial emails (the `personal`
  touch kind is only written when the planner sends a call offer, or by hand). "Last touch" today =
  the later of the last session and the last recorded touch.

## Still open

- The starting list of problems a piece can answer, drawn from real call misconceptions.
- Whether a client's own reply to a weekly email pauses the next week's.
- Whether clients who started before the planner exists begin at the opening run or further in.
