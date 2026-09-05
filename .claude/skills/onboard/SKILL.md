---
name: onboard
description: Run a client onboarding move - "onboard <client>" (or /onboard <client>). Works out where that client is in the journey, sets every record field it can, and preps or wraps sessions with email drafts in Guy's voice. Use whenever Guy says he's onboarding someone, has an onboarding session coming up, or has just finished one.
---

# Onboard a client - the one door

One command, any time: **"onboard <client>"**. Work out from context which move applies and run it.
Ask only if genuinely ambiguous.

- **PRE** - a session is coming up (usually tomorrow or today). Output: record fixed, agenda, pre-session email draft.
- **LIVE** - Guy is on the call now, narrating ("we're at step 3", "he just clicked the link"). Act immediately, answer tersely, fix records live.
- **WRAP** - the session just happened. Output: state updated, follow-up email draft, owed-items list.

## How to answer Guy - the two standing rules

These govern the SHAPE of every reply, not just what gets done. They are also written into
`docs/wingguy-onboarding-checklist.md` on `origin/main`, which is the master copy.

**1. One action for Guy, the rest is Claude's.** He is on a call, in front of a client, with the
clock running. His half of any step is a single thing he can do without leaving the conversation -
usually "paste this into the meeting chat". Minting links, reading account ids out of dashboards,
setting Airtable fields, running health checks: do them, don't narrate them as instructions for
him. If the answer needs him to open a second window, it is the wrong answer - take that half back.

**2. Lead with the action and the offer, never the architecture. Every time, from scratch.**
"What's our next step with <client>?" gets *"I think the first step is for me to mint a Unipile
link for him. Want me to do that?"* - one line, one action, one offer. Not how the plumbing works,
not the lanes, not the caveats. All of that is available the moment he asks for it and never
before. If a real risk needs flagging, one sentence after the offer, not instead of it.

And restate every step in full each time, as though it has never been done before: no "as we
discussed", no assumed memory. He runs sessions across a dozen clients every week. Repeating a
step he remembers costs three seconds; assuming he remembers costs a stalled call in front of a
client.

## Always start by gathering state (parallel where possible)

1. **Memory** - read `project_<client>_onboarding.md` in the memory dir (create it on first contact).
2. **Journey preflight** - run `node scripts/wingguy-onboarding-preflight.js <clientId>` as a
   read-only Render one-off job. It prints the whole journey (checklist steps 0-8) as
   DONE / OWED / MANUAL, derived from the live system - record fields PLUS real probes (calendar
   through the seam, rules/variables store, transcript-pipe gates, held-capture errors, trap
   checks). This IS the ledger: never keep a stored done-list, it drifts (Ashley 2026-08-20: the
   record looked complete while ingest had been off nine days and the calendar was routed wrong).
   Job recipe: memory `reference_render_jobs_exec` - POST job to prod `srv-cvqgq53e5dus73fa45ag`,
   base64 inline `node -e` or a plain script command, poll, read logs with `resource=<jobId>`.
   For anything the preflight doesn't cover, read the row with `getClientById` the same way -
   never trust a cached/remembered record state.
3. **Latest transcript** - `recall_latest_transcript` with the client's email (store first, never raw fathom_*).
4. **Latest emails** - Gmail search to/from the client; read the most recent onboarding thread in full.
5. **The process** - `git fetch origin && git show origin/main:docs/wingguy-onboarding-checklist.md`
   (steps 0-8 with say-to-client wording, checks, traps). `wingguy_onboarding_guide` serves the same doc.

Then place the client on the journey: which checklist step is DONE / IN FLIGHT / NEXT.

## The journey order - Wingguy first, Linked Helper LAST (decided 2026-08-22)

For NEW clients, checklist steps 0-8 (the Wingguy plumbing) fill the early sessions and the
Linked Helper hookup + first campaign are the CLOSING move (checklist step 9). The early sessions
build trust and delight; LH's fiddly, get-it-right-critical setup lands when the client
understands why. Never open a new client's journey with LH, and never let the final session start
the targeting decision from scratch: the targeting CONVERSATION begins at session 1 and threads
through every session - point the client at the Wingguy Learning topics (who you're looking for /
finding your audience / your LinkedIn profile) and the prep question to ask Wingguy: *"talk me
through who I should be looking for and how to build my search"*. The LH trial clock only starts
at first campaign launch, so nothing burns while LH waits. Clients already mid-journey on the old
LH-first order (Luke, Matthew) finish that way, but still get the prep question.

## The session arc - onboarding is a SERIES, not one big call

Clients get ~30-minute weekly sessions, so the checklist's steps spread across several of them.
The goal is long-term, delighted clients who advocate - and the arc is what builds that. Every
session gets the same drumbeat, and the PRE and WRAP emails are the product as much as the call:

1. **Preflight with live proofs** (the journey printout above).
2. **PRE email** the morning of (or day before) - the finish-the-plumbing pattern in
   [email-templates.md](email-templates.md). Pre-call homework is what makes a 30-minute slot
   enough: anything the client can bring ready (a key, a signup, a refresh) goes in the email.
3. **The session** - end it with one live "wow" demo chosen from whatever just got plumbed.
4. **WRAP email** + memory update (see WRAP specifics).

**The live-proof rule (non-negotiable):** never write "X is live - try it" in any client email
until X has been exercised as THAT client, that day. Run the door, read the result, then promise
it. The fastest way to lose an advocate is a "try this" that doesn't work; the fastest way to make
one is five promises in an email that all work first go.

## The record doctrine

- **Objectively-right fields: set immediately, no asking.** Timezone, phone, LinkedIn URL, launch
  date, client email corrections, Calendar Read IDs=all at the calendar step, Thanks for
  Connecting when the plan includes it - anything whose correct value is already known from
  emails, transcripts, or the checklist. Show Guy the batch as a short before→after diff in the
  same message that reports it done.
- **Decision fields: recommend once, then set on Guy's word without re-asking.** Managed vs BYO
  key, service level, Wingguy Enabled (extension), Followup Brief, calendar scope choices.
  Present as: recommendation + the argument against + one question.
- **Verify every write** in the job output (blank→set), and re-read the field if anything looks off.

## Traps - every one of these actually happened

- **The connector URL is per-client**: `https://pb-webhook-server.onrender.com/mcp2/` + THEIR
  Portal Token. Never paste Guy's own URL to a client (Owen + Dean got Guy's, 2026-08-19).
- **Followup Brief = Yes only AFTER their Anthropic API Key is on the row** (BYO clients) -
  otherwise the overnight brief silently runs on Guy's key.
- **Unipile calendar tenants: leave Calendar Email BLANK** - a set Calendar Email forces the
  Google service-account path (`providerForInfo` in services/wingguyCalendar.js).
- **Wrong-account trap on every OAuth connect** - the permission screen belongs to whoever is
  logged in. Check the account shown, every client, every time. Many clients have 2+ Google
  accounts (check the record email vs the correspondence email - they often differ).
- **Unipile hosted-auth link**: one link covers calendar AND email; nothing calls back on
  connect - read the new account_id out of the Unipile dashboard by hand, then set
  Unipile Account ID + Calendar Provider=unipile + Email Provider=unipile. Delete stray
  accounts the client connected by mistake (they bill).
- **Sales Navigator gifts only take on never-Premium accounts** - confirm history before promising.
- **Extension delivery runs the update-folder system - never improvise delivery on a call**
  (Ashley 2026-08-20: ten minutes of a 30-minute session lost to OneDrive). The full doctrine,
  ask email, and frozen instruction cards live in the checklist's "THE EXTENSION UPDATE FOLDER"
  section (origin/main docs/wingguy-onboarding-checklist.md): ask cloud + Windows/Mac → send the
  ONE matching card → client replies "done" → Guy confirms the share arrived BEFORE the session
  → set Extension Folder Provider/Ref on the row → `scripts/ship-extension.js --client=<id>`
  pushes and verifies. Cards are frozen canonical text - send them verbatim, never re-derive;
  a client stalling on a step means fix the card the same day. The preflight's "extension
  updates" line polices the fields. Fallback zip if ever needed:
  `git archive "origin/main:wingguy-extension" --prefix=Wingguy/ --format=zip` - unzip target
  somewhere permanent, never Downloads.
- **Client keys never travel by Zoom chat** - Ashley's key was pasted there one session and lost.
  The pattern that works: client pastes it in the meeting chat, Guy relays it HERE immediately,
  Claude stores it on the row and confirms masked, on the call.
- **A key with no credit behind it is a dead key** - Ashley's /wg came up and failed with "no
  money on my account". When a client already has console keys, still confirm their account has
  CREDIT (prepaid API billing) before promising drafting works.
- **Granola API key needs their Business plan; Fathom's API is on the FREE plan** (verified twice).
- **Stale-snapshot**: after new tools ship, clients need Settings → Connectors → Refresh Tool
  List + fresh chat.
- **`wingguy_create_draft` stamps a Follow-Up Date on To-recipients that match a lead** - after
  drafting to a client who is also a lead, flag the spurious stamp so Guy can clear it.

## Emails

- **"Draft" means show in chat first.** Compose the email, show Guy the full text here, iterate
  until he's happy, and only THEN push via **`wingguy_create_draft`** (never the Gmail
  connector, never patch an existing draft - new draft + delete). The tool never sends; Guy
  sends from Gmail.
- Shell: the `email-html-format` instruction (fetch via `wingguy_rule_get` if not in context) -
  Arial 14px named in full, line-height 1.4, #333333, inline styles, 8px paragraph margins,
  related sentences share a <p> with <br>, links Gmail blue #1155CC, close "Cheers," +
  "(I know a) Guy" via <br>.
- Patterns and worked examples: [email-templates.md](email-templates.md) in this folder.
- House style: plain ` - ` dash never an em dash, Australian English, "instructions" never
  "rules" in client-facing wording, first person Guy, never praise Wingguy's own drafting.
- BCC `track@mail.australiansidehustles.com.au` on client emails (Guy's standing pattern).
- Show Guy the finished draft content in chat when reporting it done.

## WRAP specifics

- Update `project_<client>_onboarding.md` with: what got done (with proof), what's owed by whom,
  next session date/agenda, and any new traps hit. Update the MEMORY.md hook line.
- Draft the follow-up email: what we got done - homework (max 2-3 concrete items, written
  because verbal homework does not stick) - what's next.
- **At the LH-launch wrap (step 9, the final session): set "Email Series Start Date" on the
  Clients row** - convention = that session's date (Guy 2026-08-23). The client email drip starts
  there and takes over the drumbeat when sessions stop. The preflight's step 9 line polices it.
- **Suggested-prompts calibration (Guy 2026-08-23):** the wrap email's literal prompts-in-quotes
  are picked as TWO that exercise what this session just plumbed + ONE that points at the next
  step so it never lands cold. Use Wingguy Learning topics as the pointing device ("ask Wingguy:
  talk me through..."), and the live-proof rule applies to every prompt: exercised as THAT client
  that day, or it doesn't go in.
- If the transcript hasn't filed yet, say so and pick it up when it has - don't wrap from memory.
