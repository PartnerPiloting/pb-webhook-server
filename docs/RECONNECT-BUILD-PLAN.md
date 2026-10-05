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
  **BUILT 5 Oct 2026:** `mintHostedLink(clientId, { linkedin: true })`; callback
  `POST /api/unipile/notify-linkedin/:token` (its own path and its own token purpose, so it can
  never be confused with the mail-and-calendar callback) writes only `Unipile LinkedIn Account ID`
  and `LinkedIn Connected At`. Mint it from the clients board
  (`POST /api/client-board/:clientId/linkedin-link`) or `node scripts/linkedin-connect-link.js
  --tenant=X`. Send it DAYS before the session - Unipile starts pulling history the moment they
  connect (Guy's took 3h15m for the first 3,000 conversations and doubled over two days).
  How smooth Guy wants onboarding (5 Oct): the client does three things - click Connect, answer a
  few questions for their description and look at 30 samples, say yes to the counts. Everything
  else runs by itself: the copy starts when LinkedIn connects and re-checks daily until it stops
  growing; Guy is told when a client is ready; the connection is switched off after a month. A
  Reconnect page under My Wingguy explains it and shows their own progress; Claude chat does the
  talking parts; Guy sees each client's progress on his board. NOT built yet beyond the link.
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

## The client process, as agreed with Guy step by step (5 Oct 2026)

This is the target. Marked BUILT / BY HAND / NOT BUILT against each step as of 5 Oct.

**How Unipile collects history (Pierre, Unipile support, 5 Oct 2026) - this shapes steps 1, 2 and 4:**
the history sync takes at most 3,000 conversations per LinkedIn inbox per 24 hours, newest first,
and carries on by itself every day until the whole history is in. It cannot be sped up per account.
About 27,000 conversations is 9 to 10 days. NEVER call the `/accounts/{id}/sync` route to hurry it:
when a run of that route finishes, the automatic daily continuation stops. Unipile's account status
webhook (`SYNC_SUCCESS`) is the signal that an account's history is complete.

**START WITH WHAT IS THERE (Guy, 5 Oct 2026).** Nobody waits for the whole history. The first day's
3,000 conversations are the most recent ones - the best reconnect material, and already more than
a client can work in months. The session goes ahead on that first batch, and each later day's
older conversations are collected, read and added behind it without anyone doing anything. This
works because every stage only adds: the copy appends, the read skips what it has read, the leads
step skips who is already there.

1. **Guy sends the connect link.** Connecting LinkedIn is done under Guy's direction, like the
   calendar link - a link he gets from his side and sends when he chooses, a day or two before the
   session (the first batch is in within hours). It is NOT a button the client can press in their portal. *Link BUILT; a button for it on
   Guy's clients board NOT BUILT (he asks Claude for the link).*
2. **The history is collected by itself, a day at a time.** After the click, Wingguy takes its
   copy once the first batch is in, and again each day as older conversations arrive, until
   Unipile says the history is complete. Guy is told by BOTH an email and a status on his clients
   board (waiting for LinkedIn / first batch in - ready for a session / collecting older history /
   complete). Two emails matter: "ready for a session" (first batch in) and "history complete";
   plus one if it stalls. Neither Guy nor the client does anything. *BUILT 5 Oct 2026:
   `services/linkedinCollect.js` + `scripts/linkedin-collect-daily.js` (run it once a day as a
   Render cron job), table `linkedin_collect_status`, the three emails, and
   `GET /api/client-board/reconnect/status` (state, connection count, near-the-limit flag at 25,000).
   "Complete" is judged by two days with nothing new, so the email says so and gives the numbers -
   Unipile's SYNC_SUCCESS webhook should replace that guess once its behaviour is confirmed. The
   connections list is read on the first run and weekly, not daily. It is scheduled: `GET /api/cron/linkedin-collect` (answers 202, runs behind the
   request, refuses a second run while one is going), hit once a day by a Render cron job.
   THE TOP-UP IS BUILT: for a client whose Reconnect list is on, each day's arrivals are then read
   and the good ones added at their cut-off, on their own key; a client not yet switched on is only
   collected. NOT BUILT: the status shown ON the board screen.*
3. **The description and the 30 samples - in the session, with Guy there.** In the client's own
   Claude chat through their Wingguy connection ("set up my reconnect list"), and only once their
   history is collected and Guy has opened it for them. *BY HAND (Claude Code runs the sample job);
   the chat tool NOT BUILT.*
4. **Two yeses, same session.** Yes to the read - covering what is there now AND the older
   conversations as they arrive, so the cost shown is the estimate for the whole history ("about
   US$4 today, roughly US$20 in total over the next ten days"), not just day one. Then yes to the leads (counts shown; the cut-off - 3 and over, or 4 and over - is chosen
   here with real numbers, and the same cut-off is used for each later day's arrivals). The list then
   switches on by itself, and "more waiting" simply grows over the following days. While the read runs Guy shows them
   the Follow-Ups screen. *Each BY HAND as a job; the chat flow NOT BUILT.*
5. **The Reconnect list is the whole first session.** *BUILT.*
6. **Disconnects are an optional extra, not part of the journey.** Most clients will never use it -
   only those approaching LinkedIn's 30,000 limit. Its own switch on the master record, off by
   default; off means no Potential disconnects section and no Disconnect button. Guy's board shows
   each client's connection count and flags anyone near the limit, so he knows who to offer it to.
   *Section BUILT but currently shown to anyone with Reconnect on (only Guy); the separate switch,
   the count and the flag NOT BUILT.*
7. **The Disconnect button.** On a Reconnect row, "Potential disconnect" becomes **Disconnect**:
   one click, the person goes to that night's removal, and sits in a "going tonight" line with an
   Undo until midnight - no confirm box. Approve on the suggestions list feeds the same Linked
   Helper campaign by itself, with progress shown instead of copy-the-links. Removals run midnight
   to 5am so they never compete with a person using LinkedIn by day. *Night campaign and
   add-by-command PROVEN on Guy's machine; the removal itself not yet seen; the wiring NOT BUILT.*
8. **The month ends by itself.** Five days before, Guy gets an email. On the last day Wingguy does
   a final top-up (collect, read anything newly quiet past 90 days, add those at or over the
   client's cut-off), switches the LinkedIn connection off so the charge stops, and emails Guy what
   it added. Automatic - a gate that waits for a click gets forgotten and costs money. A client
   paying to keep the connection (LinkedIn Feed = Yes) is skipped. *NOT BUILT.*

DONE 5 Oct 2026: the five lead fields are on every client base and the template (125 added, 0
errors). The client's description is saved as their own setup value `reconnect_looking_for`
(`conversationScore.saveWho`, or `scripts/conversation-score.js --save-who`), NOT as an instruction
under a new `reconnect` category: adding a category means widening a CHECK constraint on the
instructions table, the exact change that file records as having caused a live outage. A setup
value needs no schema change and is never rendered into a drafting prompt by itself.

## Side job, not blocking - prove Linked Helper removals

**Stage one PROVEN 5 Oct 2026** on Guy's own machine: recipe
`scripts/linked-helper/campaigns/04-remove-connections.json` built campaign 45 "Remove approved
connections" with the existing builder - one `RemoveFromFirstConnection` action (settings null), 5
at a time, four hours apart, 09:00-17:00; paused, nobody in it. Found in Linked Helper's own code
and NOT yet run: `callWrite("people.actions.importPeopleFromUrls", actionId, 0, text, true,
liAccountId)` adds people to an action's queue from profile links (0 = Target; the campaign-level
call uses 1 = Target, 0 = ExcludeList). **Adding by command PROVEN 5 Oct 2026:** `lh-campaigns.py queue 45 -` put the one person Guy
approved for the test (Alastair Ferguson) into the action's queue - 0 to 1, nobody else. Linked
Helper had never seen him, so it made a new person from the link alone; it loads the profile when
the action runs. The campaign was then started with `lh-campaigns.py start 45` (18:18 AEST, outside
its 09:00-17:00 hours). STILL TO SEE: the removal itself, the next morning. New commands in the
builder: `queue`, `start`, `pause`, `queued`.
Guy wants the finished version to be: tick, Approve, and the approved people go to this campaign
by themselves - no copy and paste.

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
