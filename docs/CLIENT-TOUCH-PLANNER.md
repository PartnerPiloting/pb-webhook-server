# The Weekly Client Touch Planner

A design, not yet built. Internal only. Written 19 October 2026 from Guy's direction the same
day: for clients, the one-pager series stops being a fixed sequence and becomes a **tagged
pool** that a weekly planner picks from, per client. Prospects keep the fixed 18-piece drip -
nothing here changes them.

Parent strategy: `docs/CLIENT-ENGAGEMENT-STRATEGY.md` (mechanism 3, "sequence one-pagers to
where the client is").

## What it does

Every Monday morning it looks at each running client and picks **one thing to send them this
week - or nothing**. Guy sees the whole week on one screen, each pick with a one-line reason
("stuck on the calendar stop for three weeks"), and can approve, swap or skip any row. On
approve, the emails go out from Guy at knowaguy.

The point: the right piece lands the week it is useful, not when a counter says it is due. A
client who is stuck connecting their calendar gets the piece that makes calendar matter; a
client who just had a call where a misconception came up gets the piece that answers it.

## What it reads (all of it already exists)

Everything is derived live at planning time, the same rule as the client board and the
journey - no stored stage that can drift.

| Signal | Where it comes from today |
| --- | --- |
| Who is in | Clients base: `Status` = Active, `Email Series Start Date` set and not in the future, `Series Unsubscribed` not ticked, not in the board's paused group |
| Where they are on the journey | `services/clientJourney.js` - the eight stops and which one is `current` |
| What they have not used | the same journey statuses (todo / started), plus last use from `wingguy_learning_events` |
| When they last had a call | the board's last session (recorder filing or past calendar match, `services/clientBoardService.js`) |
| What they have already had | **new** - a send ledger (below). `Series Sent Count` cannot say *which* pieces |

## What the pieces need - tags

Each piece in `content/one-pagers/*.md` gets four new frontmatter fields. Guy reviews the tags
once, as one table, before anything is built on them.

| Tag | Values | What the planner does with it |
| --- | --- | --- |
| `kind` | `why` / `mindset` / `how` | Keeps the mix varied; WHY = the current one-pagers, MINDSET = Beth Berghan FORM in Guy's words (none written yet), HOW = feature pieces |
| `stage` | one or more journey stop keys (`claude`, `reconnect`, `voice`, `linkedin`, `calendar`, `calls`, `rhythm`, `newpeople`) or `any` | Matches a piece to the stop a client is stuck on |
| `problem` | a short fixed list, e.g. `expects-fast-results`, `chasing-strangers`, `skips-follow-up`, `ai-sounds-like-ai`, `not-recording-calls` | Matches a piece to a misconception Guy flagged on a call |
| `reinforce` | `yes` / `no` | Whether a short re-send is allowed later |

The current client run order in `config/onePagerSeriesManifest.js` stays, as the **default
order** - the planner falls back to it when no signal says otherwise.

## How it picks - in this order, first match wins

1. **Not this week.** Skip the client if they were sent anything in the last 6 days, or Guy
   has marked them skip-this-week.
2. **Guy pinned something.** A piece Guy pinned for this client (from a call, or on the
   approval screen) goes first.
3. **A call problem.** A call in the last 10 days tagged with a `problem` → the unsent piece
   with that problem tag. (Version 2 - needs a way to tag a call; until then Guy pins.)
4. **Stuck on a stop.** The current journey stop has been current for 14+ days → the unsent
   piece whose `stage` matches it, HOW pieces first.
5. **Mindset rhythm.** Every fourth send is a MINDSET piece, when one exists. An empty shelf
   is simply skipped.
6. **Next in the default order.** The first piece in the client run they have not had.
7. **Reinforce.** All full pieces sent → a short re-send of a `reinforce: yes` piece not sent
   in the last 8 weeks, preferring one that matches the current stop.
8. **Nothing.** If nothing qualifies, nothing is sent. A quiet week is fine.

Hard rules across all of it: a full piece goes to a client at most once; the orientation
("What you've actually joined") is always first; one email a week, except two a week for the
first four weeks after the start date (the old twice-weekly opening, kept).

## One-off emails - a client's open meeting, an event

Sometimes the right email for a week is not a one-pager at all - say a client is running an open
meeting and every other client is invited. That email **replaces** the week's pick; it is not an
extra. One email a week is the promise, and an invite is worth more that week than a one-pager -
the one-pager simply moves to the next week.

- **Pin for everyone.** On the approval screen Guy can pin a one-off email for all clients (or a
  chosen few) for a given week. It wins as rule 2 for each of them.
- **It goes in the ledger.** One-off sends are recorded in `series_sends` with a slug like
  `event:<name>`, so the 6-day rule sees them and the next week carries on as normal. They never
  count as a one-pager sent.
- **The one exception to one-a-week:** a meeting more than a week away may get a short reminder a
  day or two before, sent only to those who have not said yes. That reminder is the only extra
  email the planner allows.

## The short form

A reinforcement re-send is about 150-200 words: the dek, three bullets, and "read the full
piece" linking to the library page. This is also Rick Wong's ask (brief bulleted emails with a
link to the long version). Each piece gets a `short:` frontmatter block with the bullets,
written once by hand - not generated on the fly.

## The craft rule

Every email must read as the next instalment of the series. Never "we noticed you haven't
connected your calendar". The reason line is for Guy's screen only and never appears in the
email.

## Guy's screen

A "This week's touches" section on the client board. One row per client: name, the pick, the
reason, a swap dropdown (every eligible piece), skip, and pin-for-next-week. One "Send
approved" button.

**Recommendation: Guy approves every week for the first month,** then it switches to send
automatically with a Monday preview email he can veto until Tuesday 9am. Approving by hand
first is how we find out whether the picks are any good before they reach clients unseen.

## What has to exist first

- **A send ledger** - a Postgres table `series_sends` (tenant, slug, form full/short/one-off,
  sent_at, reason). This replaces `Series Sent Count` as the truth for clients; the count stays updated
  for the prospect drip and the board.
- **An unsubscribe token per client.** The Clients base has none, so every client email would
  ship a dead unsubscribe link. Add the field and fill it for current clients before the first
  send.
- **The drip engine learning the client audience.** `services/seriesDrip.js` is hardcoded to
  prospects and reads website signups. The planner takes over the "what to send" half for
  clients; the existing build → send → mark half is reused.

## Build order

1. Tag the 23 client pieces; Guy reviews the tag table.
2. Send ledger table + client unsubscribe tokens.
3. The picker as a pure function - facts + pieces + ledger in, `{ slug, form, reason }` out -
   with tests for each step of the order above.
4. The approval section on the client board, sending through the existing series mailer.
5. A Monday schedule that builds the week's plan (never sends on its own while approval is on).
6. Later: tagging a call with a problem; short forms; the first MINDSET pieces.

## Still open

- The `problem` list - Guy to confirm the starting five, drawn from real call misconceptions.
- Whether a client's own reply to a series email should pause the next week's send.
- Whether clients who started before the pool existed (none have had drip sends - the client
  drip was never wired) start at the orientation or further in.
