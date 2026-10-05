# Reconnect - build plan

Status: DRAFT for Guy, written 5 Oct 2026. Nothing built. This is the build order for the plan
Guy chose on 5 Oct 2026 ("the best plan we've come up with"). The plan itself lives in project
memory (`project_wingguy_reconnect_worklist.md`, the ★ section) - this file is only HOW and IN
WHAT ORDER.

## What it does, in one paragraph

A client connects their LinkedIn for one month. Wingguy reads their connections and their inbox,
and an AI reads how every old conversation ended. The people worth writing to become leads in
Wingguy, and each morning the Follow-Ups screen shows a short Reconnect list (20 by default) with
the reason and the thing to pick up on. People who are plainly not worth keeping go to a
Potential disconnects list the client approves in one click. Zero Linked Helper actions until
removals.

## Ground rules carried over (do not re-decide)

- **One queue, two renderers.** Reconnect rows come out of `buildQueue` in
  `services/wingguyMailMcp.js`, so chat (`wingguy_queue`) and the screen can never disagree. The
  screen gets no logic of its own.
- **Nothing automatic.** Every exit is the client's click. Nothing is removed before one approve.
- **No pre-written LinkedIn messages.** Rows say "open the thread, use /wg" plus the angle.
- **The client's own Claude key** pays for the read and the nightly prep (`resolveClientAnthropic`).
- **Conversations stay in Postgres.** Airtable only gets the people worth working. Real
  conversation data never goes in the repo.
- **Per-client switch.** Off by default. A client with the switch off sees and pays for nothing.
- **Built once for everyone.** Matt differs only in settings, instructions and data.

## Before the first brick

The dev checkout is 176 commits behind `origin/main` and holds uncommitted follow-up edits in the
four files this build touches most (`FollowUpsQueue.js`, `wingguyFollowupsRoutes.js`,
`wingguyFollowupBrief.js`, `wingguyMailMcp.js`). Those edits need to be landed or set aside first,
or they will collide. The build itself happens in a clean worktree off `origin/main`.

## First slice - Guy's own 190 people on the screen

Four bricks. Each one ends at a point where Guy can look at something real and say stop.

### Brick 1 - read LinkedIn from Unipile into our own store

New `services/linkedinNetworkSync.js`. Reads Unipile's copy (fast, unrationed, costs LinkedIn
nothing): connections list (`/users/relations`), chats, attendees, messages. Writes three Postgres
tables, all keyed by client:

- `linkedin_people` - one row per person: LinkedIn ids (classic `ACoA` and Sales Nav `ACwA`),
  vanity link, name, headline, date connected, counts in/out, last message date and who sent it,
  matched lead record id.
- `linkedin_messages` - one row per message, append-only.

(`reconnect_state` - what the client has done with each person - is created in brick 4, where it
is first used.)

The connections list gives each person's id and vanity link together, which fixes lead matching
(it was by name only).

**The Sales Navigator inbox is not used (Guy's decision, 5 Oct 2026).** It made things more
complicated than it was worth: its threads carry a different id with no mapping to the ordinary
one, so the same person shows up twice. Clients are told Wingguy works from the ordinary LinkedIn
inbox. Known cost: on Guy's own data, 26 of the 100 best reconnects had their thread only in the
Sales Navigator inbox, and a person who replied only there reads as "never replied" - so nobody
may be suggested for disconnect on "never replied" alone without this being revisited. The code
keeps one switch (`--sales-nav`) that reads it and merges by name when safe; it is off.
Sales Navigator itself is still needed for SEARCH (the signals tier).

**BUILT 5 Oct 2026** (`services/linkedinNetworkSync.js`, `scripts/linkedin-network-sync.js`,
`tests/linkedin-network-sync.test.js`). Run over Guy's stored prototype data it reproduces the
prototype exactly with the Sales Navigator switch on: 4,449 people with messages, 2,923 never
spoke, 648 they spoke last, 878 replied then quiet.

**RUN LIVE on Guy's account 5 Oct 2026.** Stored and checked by query: 8,374 connections (all with
date connected and profile link), 21,454 ordinary-inbox messages across 5,905 people, oldest July
2019. The pool brick 2 reads (connected, replied at least once, quiet 90+ days) is 1,735. These
are about double the prototype's figures because Unipile's copy of the inbox grew from 3,000 to
6,001 conversations between 3 and 5 October without anything being asked of it.

New master fields: `Reconnect` (the switch), `Reconnect Daily Number` (default 20),
`LinkedIn Feed` (Yes = stay connected past the month), `Unipile LinkedIn Account ID`,
`LinkedIn Connected At`.

**Proof:** Guy's numbers come out the same as the prototype - about 4,150 people after merging,
878 replied-then-quiet, 648 they-spoke-last.
**Limit:** reads what Unipile already holds. No deeper pull on any account until Unipile answers
the ticket, and not on Guy's without his go.

### Brick 2 - the conversation score, as a real service

New `services/conversationScore.js`, ported from the prototype `classify.js` (Desktop folder
`reconnect-prototype`). For each thread: ending type, warmth 1-5, one-line why, "pick up on".

Fixed vs configurable (agreed with Guy 5 Oct 2026):
- **Hard-coded:** the nine ending types, the 1-5 warmth scale, the four things returned. The
  nightly order, the row chips and the disconnect suggestions all read these, so they must mean
  the same for every client.
- **Per client:** a short "who I am and who I'm looking for" paragraph. This is what makes the
  same thread a 2 for one client and a 4 for another.
- **Instructions store:** the reading guidance (what a 5 is, what a polite closer is), as a
  standard instruction - the same for everyone by default, tunable without a code change.
- **Two client settings:** the cut-off for becoming a lead (default 3) and the daily number
  (default 20).
- No weights-and-switches screen. A changed paragraph or guidance only shows after a deliberate
  re-score (a few dollars on the client's key) - never automatic.

Changes from the prototype:
- The prompt stops being about Guy. Who the client is and what they are looking for comes from
  the per-client paragraph above.
- Who gets read: connected, they replied at least once, quiet 90+ days, not ceased, not parked.
- A thread is re-read only when it changes, so the read is paid for once.
- Plain `json_schema` output (the repo's zod is too old for the SDK helper).
- Runs as a Render one-off job, never as a chat tool call (it would time out).

**BUILT 5 Oct 2026** (`services/conversationScore.js`, `scripts/conversation-score.js`,
`tests/conversation-score.test.js`; table `linkedin_conversation_scores`). The paragraph is passed
in by the job for now and the guidance is the default in the code; `loadProfile()` is the one
place the instructions store takes over, which needs a new `reconnect` context in the store (so
scoring guidance can never leak into message drafting). Everyone in the pool is read - ceased and
parked people are filtered later, at the nightly pick, where that state is live.

**Proof:** run on Guy's stored data and compare with the 4 Oct labels - about 850 threads read,
about 190 at warmth 4-5. Cost was about US$3.30 for Guy; expect US$12-20 on Matt's key.

### Brick 3 - straight into Wingguy

New `services/reconnectLeads.js`. For everyone at warmth 3 or better:
- Already a lead (matched on the vanity link) - fill in the conversation fields only.
- Not a lead - create one through the existing `createLead` in `services/wingguyLeads.js`
  (it already dedups), with name, headline, link, the real Date Connected, and the thread written
  into Notes in the existing `=== LINKEDIN MESSAGES ===` format.

New lead fields: `Conversation Score`, `Conversation Ending`, `Conversation Why`, `Pick Up On`,
`Conversation Scored At`. Rolled out the two-part way: `scripts/ensure-client-fields.js` for
existing bases and the template, and `config/clientBaseSchema.json` for future ones.

**BUILT 5 Oct 2026** (`services/reconnectLeads.js`, `scripts/reconnect-leads.js` - count only unless
`--go`, `tests/reconnect-leads.test.js`). Two changes from the lines above, both deliberate:
- **A new lead gets no messages in its Notes yet.** The nightly follow-up sweep reads Notes, and a
  lead whose notes show they once spoke would land in the LIVE follow-up queue - hundreds of them
  at once. The thread stays in `linkedin_messages` until brick 4 hands people quiet past 90 days
  to the Reconnect list; then it can be written across.
- **A name already in the base under a different link is "unsure"** - not created, not updated,
  and counted in the report. A duplicate lead is worse than a missing one.
An existing lead is matched on the profile link only (vanity slug or member id) and only ever
gets the five conversation fields. The cut-off is the master field `Reconnect Lead Cut-Off`
(blank = 3). New leads use the existing Source value "Existing Connection Added by PB" because
the portal's lead form only knows the existing Source list.

No profile score at this stage. It arrives later, free, the first time /wg is opened on the person.

**Proof:** dry run on Guy's base first - "would create X, would update Y, would skip Z" - and Guy
says go before a single record is written.

### Brick 4 - the Reconnect section on the Follow-Ups screen

- New `services/reconnectQueue.js`: the nightly pick of the day's portion, as one pure function
  with tests. Exclusions and order exactly as the plan's item 5 (yesterday's unworked first, then
  conversation score, then ending, and so on). Never padded.
- The overnight brief (`services/wingguyFollowupBrief.js`) prepares the portion in full -
  recommendation, Ask box context, park date, flags - the same way it prepares live follow-ups.
- `buildQueue` returns a second list, `reconnect`, beside the live items. The live gates run over
  it too, so a cease, a booking or a fresh message takes someone off the list straight away.
- `routes/wingguyFollowupsRoutes.js`: four new actions - Done, Skip 90 days, Never, Potential
  disconnect - and "show more" (10 at a time).
- `FollowUpsQueue.js`: a second stacked section under the live one. Same row shape, plus the
  ending chip, the "pick up on" line and the tags.
- Chat's `wingguy_queue` lists the same people.

**BUILT 5 Oct 2026, first cut** (`services/reconnectQueue.js`, `components/ReconnectSection.js`,
`tests/reconnect-queue.test.js`; table `reconnect_state`; routes `POST /api/followups/reconnect-action`
and `/reconnect-more`). Guy's five decisions, all yes: quiet past 90 days moves from the live list
to Reconnect; Never = Drop; people met and not since are on the list, labelled; a disconnect may be
suggested for a decline or a pitch; clients, current or former, never appear.
- The list is worked out when the queue is loaded, not by a nightly job: the first load of the
  client's day stamps that day's portion, and it only shrinks after that.
- The hand-over is conservative: a live row leaves only if the person is in the Reconnect pool AND
  the row shows more than 90 quiet days. A row with no quiet-days figure stays live and that
  person is kept off Reconnect - nobody shows twice, nobody vanishes. Due parks and
  accepted-but-unbooked times always stay live.
- "Written to since" is read from the lead's notes, so someone messaged without pressing Done
  drops off the list by themselves.
- NOT in this cut: the overnight "prepared in full" pass (recommendation, Ask box) - rows show the
  conversation score's own reason and angle; the calendar check for a booked person; writing the
  old thread into new leads' notes (needs the same hand-over applied before the overnight prep,
  or several hundred extra people get triaged each night).

**Proof:** Guy opens Follow-Ups on a real morning, sees 20, works them with /wg, and tomorrow's
20 are right (unworked ones first, nobody he actioned).

## Second slice - disconnects and onboarding

### Brick 5 - Potential disconnects section

Third stacked section. Two sources: the client's own button, and system suggestions (first:
threads read as declined or as their pitch). One line of why per row; select all / none /
individual; one Approve. Approval only records the decision. Until the Linked Helper route is
proven, approved names come out as a list to paste into Linked Helper or remove by hand.
Standing protection: nobody connected in the last year is ever suggested.

**BUILT 5 Oct 2026** (`services/reconnectDisconnects.js`, `components/DisconnectSection.js`,
`tests/reconnect-disconnects.test.js`; routes `GET /api/followups/disconnects` and
`POST /api/followups/disconnect-action` - approve | keep | removed). The section is collapsed until
opened. Approve records the decision only; approved people sit in a short list with "Copy profile
links" and "I have removed these". Keep takes someone off for good (a flagged person goes back to
the Reconnect pool). "Never replied" is never a reason for a suggestion.

### Brick 6 - onboarding a client onto it

- A LinkedIn connect link, minted the way the mail-and-calendar link already is
  (`services/unipileHostedAuth.js`).
- A nightly check that disconnects LinkedIn one month after `LinkedIn Connected At` unless
  `LinkedIn Feed` = Yes, and tells Guy it did.
- **Writing the client's paragraph, in the session:** Claude asks the client a few questions in
  chat, drafts the "who I'm looking for" paragraph, and saves it on their yes. Then a SAMPLE read
  of about 30 of their own threads is shown back; the client says which scores are wrong, the
  paragraph is adjusted, and only then does the full read run. Client-facing wording is
  "instructions".
- The full read, score and lead creation run as one job, with a dry-run count first.
- A playbook topic and tour beat, shown to Guy before committing.

How far back Matt's history can reach depends on Unipile's answer. Everything else is ready for
him without it.

## Side job, not blocking - prove Linked Helper removals

On Guy's own machine, in two stages: (1) the script builds a removal campaign, paused and empty;
(2) one real removal of a connection Guy names. Needs access to his Linked Helper machine first,
which has never been set up. If it never works, brick 5's paste-the-list route stands.

## Later, not in this plan

Signals tier (Sales Nav job changers and posters), the connection-request dial, the
ActiveCampaign push for Matt, automatic removals. Also owed: redraw the workflow diagram, which
still shows the 3 Oct version.

## Decisions - ALL ANSWERED YES by Guy, 5 Oct 2026 (kept for the record)

1. **Who owns someone quiet for more than 90 days?** Today the live list has no time limit.
   Recommended: for clients with Reconnect switched on, anyone quiet past 90 days moves from the
   live list to Reconnect, so nobody appears twice. Clients without the switch see no change.
2. **What does "Never" do?** Recommended: the same as Drop today (sets Cease FUP), so there is
   one meaning of "stop" everywhere and a new message from them still surfaces.
3. **People Guy met and has not spoken to since** (90 of his 190). Recommended: they are in the
   Reconnect list with their own chip, since they are the warmest people on it.
4. **Suggesting a disconnect for someone who wrote to the client.** The earlier rule protected
   anyone who ever wrote; the chosen plan suggests people whose thread read as declined or a
   pitch. Recommended: the protection applies to people who never spoke; a declined or pitch
   thread can be suggested, with the reason on the row, because the client approves every one.
