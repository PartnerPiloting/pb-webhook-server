# Follow-Ups Screen - build plan

Status: PLANNED, approved by Guy 2026-08-15. Mockup reviewed and liked same day
(built from his live queue; Frank Filler's real dossier as the expanded row).

## What it is

A portal tab that presents the Wingguy follow-up queue the way Thanks for
Connecting presents new connections: one row per person, the story so far on
expand, four labelled actions. It replaces working the queue through chat for
the high-volume case - the 15 Aug session showed ~90% of chat interactions were
reading context in order to say no, which is the wrong shape of work for a
conversational interface.

Guy's words on the model to copy: "I am extremely pleased with the thanks for
connecting screen and just want the follow-up screen to follow a similar
pattern."

## The tab rule (Guy's decision, 2026-08-15)

- `Followup Brief` = Yes on the client's master record -> the NEW Follow-Ups
  screen shows, and the simple Follow-Up Manager tab is HIDDEN for that client.
- Otherwise -> the simple Follow-Up Manager, exactly as today.

One switch, not two. The screen is a window onto the overnight stores, so the
flag that turns on the stores is the flag that shows the window. This also
falls out as the pricing tier boundary: simple screen = no-key product, smart
screen = BYO-key product, and the billing gate (`resolveClientAnthropic`,
commit ae05af87) already polices the boundary - a keyless client with the flag
on gets a "your Claude key isn't set up yet" status, not a bill to Guy.

Do NOT delete the simple screen or the `Follow-Up Date` stamping - the field
keeps being written on both tiers so a client can move between them losslessly.

## Architecture rule: one queue, two renderers

`wingguy_queue` currently builds chat text directly. The screen must NOT get
its own copy of that logic - that is exactly how the queue and dossier came to
contradict each other on draft availability (the Vikas `[draft ready]` vs
"NO DRAFT ON PURPOSE" fault, 15 Aug). Instead:

    buildQueue(tenant, opts) -> structured items
        |-- runQueue (chat)          renders text from it
        `-- GET /api/followups/queue serves it as JSON

Chat and screen can then never disagree, and the false-`[draft ready]` bug is
fixed at the source because the structure carries an explicit draft state
instead of a rendering fallthrough.

## Bricks, in order

### Brick 1 - structured queue (foundation; no visible change)

Refactor `runQueue` in services/wingguyMailMcp.js:

- Extract `buildQueue(tenant, {page})` returning items:
  `{ name, recId, email, linkedin, src: 'today'|'backlog', tier, whyLine, jog,
     quietDays, channel, parkDate, builtAt,
     draft: { state: 'ready'|'wg-angle'|'error'|'none', text?, angle?, error? } }`
  plus `{ counts, suppressed }`.
- `draft.state` is computed ONCE, honestly: draftText -> ready; wgAngle ->
  wg-angle; draftError -> error; else none. The chat renderer derives its
  markers from this - the current fallthrough that prints `[draft ready]` when
  nothing exists is deleted (Fault B fix, ships with this brick).
- `applyLiveQueueGates` additionally returns WHO it dropped and why
  (`suppressed.items: [{name, reason}]`), not just counts. Chat keeps the
  aggregate tail; the screen shows "N already handled were hidden" with a
  click-through (Fault C fix).
- New tiny Postgres table `wingguy_followups_dismissed (tenant_id, person_key,
  dismissed_at)`: the screen's Done for a TODAY-brief item (backlog items
  already have markItem). buildQueue filters dismissals for both surfaces, so
  chat and screen agree about what's been handled. Dismissals age out after
  14 days (a person who becomes actionable again for a NEW reason should
  resurface).

Chat behaviour after this brick: identical output except the Fault B fix.

### Brick 2 - API routes

New routes/wingguyFollowupsRoutes.js, modelled line-for-line on
routes/thanksForConnectingRoutes.js (per-client gate resolved server-side,
process kill-switch env, x-client-id auth via the same middleware):

- `GET /status` - `{ enabled }`; enabled = client.followupBrief === 'Yes'.
- `GET /queue` - buildQueue output + suppressed items + brief prepared-at.
- `GET /story?name=&email=` - the dossier PAYLOAD as JSON (it is already JSONB
  in wingguy_dossiers; no reformatting), plus `builtAt` and a computed
  `stale` flag (built_at earlier than the thread's last message date). With
  `refresh=1`, rebuild first via the existing fingerprint-checked path - an
  unchanged thread costs nothing, a changed one rebuilds on the client's own
  key. This is the brief's staleness requirement (the James Bennett-Ackland
  case: dossier described a 6 Aug call as upcoming on 15 Aug).
- `POST /action` - `{ name, email, action: 'drop'|'park'|'done', parkDate? }`
  - drop  -> runCeaseFollowups (cease flag + Cease FUP At + clears Reconnect
             On) AND backlog markItem(done) when a backlog row exists - both
             stores, always, so a cease can never resurface from the backlog
             (Fault A defence).
  - park  -> runSetReconnect with the chosen date. The screen offers 1 month /
             3 months / New year / pick-a-date and sends a concrete date -
             no chat round-trip to resolve "mid-September".
  - done  -> backlog markItem(done) for backlog rows; dismissed-table insert
             for today rows.
  All three are the SAME functions chat calls - no second write path.

### Brick 3 - the screen

linkedin-messaging-followup-next: `app/followups/page.tsx` +
`components/FollowUpsQueue.js`, copied structurally from ThanksForConnecting.js.

- Layout.js nav: new entry gated on `features.followupsScreen`; the existing
  Follow-Up Manager entry gains `hideWhen: features.followupsScreen` (the tab
  rule above). authTestRoutes.js adds
  `followupsScreen: req.client.followupBrief === 'Yes'`.
- Collapsed row: days quiet (+ last-message date when known) | name linking to
  LinkedIn + honest draft badge | why-line + jog | four labelled buttons
  right-aligned: Draft, Done, Park, Drop. Words, not icons (icon-only failed
  the mockup test in the 15 Aug brief).
- Header: count chip, cleared-this-session, live-check chip with the hidden
  count (click to see names + reasons), Outstanding/All, sort + tier filter.
- Bulk select + "Drop selected" (about half the observed decisions were
  checkbox-obvious).
- Expanded row = the /story payload: where-it-stands, promises both sides,
  remember bullets, dated timeline with channel chips (channel labels are
  load-bearing - they say whether to reply by email or LinkedIn), build date
  + stale marker with a Refresh control.
- Draft button v1 = open the EXISTING signed draft page (wingguyDraftLink) in
  a new tab - message + copy button + LinkedIn link already built and
  prod-verified. LinkedIn people without a draft get the card page + "open the
  thread and type /wg" (never resurrect pre-written LinkedIn messages - Guy's
  2026-08-01 decision stands on the screen too). In-screen draft tweaking is
  deliberately NOT v1; chat remains the hands for wording.
- Park is optimistic-update with the row greying out; errors surface inline.

### Brick 4 - migration + go-live (Guy only)

- The legacy `Follow-Up Date` field holds 3 deliberate far-future parks that
  the new engine ignores: Nita Arora-Parkes 2026-12-05, Mirko Mandic
  2026-09-08, Carlos Ghiselli 2027-02-01 (checked live 2026-08-15; the other
  ~46 future dates are auto +14 stamps the engine derives better from the
  thread itself). Show Guy the three, stamp Reconnect On on his go - checking
  first whether any are ceased (a Reconnect On stamp on a ceased lead hides
  fresh inbound until the date; Nita was ceased 2026-07-28, so she is probably
  a no-op).
- Ship dark (gate off = invisible), flip Guy's flag, verify against his real
  queue on prod, only then hide his old tab. Julian is the natural second
  client, same as the extension pilot.

## What this closes from the 15 Aug triage brief

- Fault B (queue/dossier draft contradiction) - Brick 1, at the source.
- Fault C (silent top-tier drops) - Brick 1 names them, Brick 3 shows them.
- Fault A (cease not suppressing backlog) - Drop writes both stores (Brick 2).
  The deeper question - should a brief REBUILD resurrect a ceased person's
  reply-owed item - is still Guy's call; the current cease-waiver semantics
  ("new inbound after cease still surfaces") are preserved untouched.
- Item 3 (the screen) - Bricks 2-3.
- Open decision 1 (single vs cross-tenant) - per-client gate, nothing
  hardcoded; cross-tenant is flipping a flag once the client has a key.
- Item 1 (six-week auto-cease) - NOT BUILT, deliberately: no such rule exists;
  it was rejected 2026-08-10 in favour of cease-on-send (d17d035f). The screen
  plus bulk-drop is the intended way the 73-item backlog gets worked down.

## Cost note

Expanding a row can trigger a dossier rebuild, but only when the thread
actually changed (fingerprint check), and on the client's own key. The
overnight jobs are unchanged. No new model calls are introduced by the screen
itself.

## Testing

No local dev loop (house rule). Bricks 1-2 carry pure-function unit tests
(draft-state derivation, dismissal filtering, suppressed-name collection) in
tests/, node-run like the existing wingguy tests. Everything else verifies on
the prod deploy behind the dark gate, Guy's tenant first.
