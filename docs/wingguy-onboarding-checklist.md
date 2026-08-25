# Wingguy client onboarding - the live-call guide

This guide is built for a three-way session: **you** (Guy) on a call with the **client**, with a
**Claude chat** open beside you. You ask Claude for the overview, read it out, and as you reach
each step you say "expand step 3" and read the detail - to yourself or straight to the client.

How each expanded step is laid out:

- **Say to the client** - words you can read out loud, as-is
- **You do** - your actions. ONE action per step wherever it can be one
- **The client does** - their actions, in plain click-this-then-that language
- **Claude does** - everything else: the minting, the lookups, the field writes, the proving
- **Check it worked** - before moving on (some checks are "ask Claude to run...")
- **Watch out** - the traps. Every one of these actually happened during the Julian pilot
  (July 2026); none are hypothetical.

### THE TWO STANDING RULES (they govern how every step above is delivered)

**1. One action for Guy, the rest is Claude's.** Guy is on a call, in front of a client, with the
clock running. His half of any step should be a single thing he can do without leaving the
conversation - usually "paste this into the meeting chat". Minting links, reading account ids out
of dashboards, setting Airtable fields, running health checks: Claude's half, silently. If a step
reads like it needs Guy to open a second window, it is written wrong - rewrite it.

**2. Lead with the action, not the architecture. Every time, from scratch.** When Guy asks "what's
our next step with <client>?", the answer is the one action and an offer to do it - *"I think the
first step is for me to mint a Unipile link for him. Want me to do that?"* - not an explanation of
how the plumbing works. The explanation is available the moment he asks for it, and never before.
And restate the step in full every time, as though it has never been done: no "as we discussed",
no assumed memory. Guy runs sessions across a dozen clients every week. The cost of repeating a
step he remembers is three seconds; the cost of assuming he remembers is a stalled call in front
of a client.

---

## THE OVERVIEW - the whole journey, one paragraph per step

**Step 0 - I get your record ready (before our call).** Behind the scenes there's a row with your
name on it - your status, your timezone, your secret access key. I set that up and run an
automatic health check on it before we start, so everything you touch from here just works.

**Step 1 - Wingguy joins your Claude (2 minutes).** I send you a private link, you paste it into
your Claude's settings, and from then on Wingguy lives inside your own Claude - you just talk to
it in any chat. This is the doorway; everything else happens through it.

**Step 2 - Wingguy learns how you work (about 20 minutes).** You tell Wingguy "let's set up my
rules" and it interviews you - your voice, your offer, what you'd never say. That's what makes
everything it writes sound like you and not like a robot. Nothing else needs to be connected for
this - it's the first real taste of what you've bought.

**Step 3 - Wingguy meets your calendar and your mailbox (5 minutes, one approval).** You click
one link and approve once. Your calendar, so Wingguy can offer meeting times that are genuinely
free - checking ALL your calendars, personal ones included, so it never double-books you. And
your mailbox at the same time (that's step 5 below - for Google and Microsoft clients the two
happen in the same click). One thing to get right here: approve it from the correct account
(we'll check together).

**Step 4 - Your meeting link (5 minutes).** Every invite Wingguy books needs a "click here to
join" link. We use one reusable personal link - yours - on every invite, automatically. If you
don't have one yet we'll create it together on this call, and switch on the waiting room so nobody
wanders into the wrong meeting.

**Step 5 - Wingguy meets your email.** Wingguy can draft emails as you, reply into existing
conversations properly, tell you your history with any lead, and stop you accidentally sending
someone the same document twice. For Google and Microsoft clients this needs no separate step -
the one approval back at step 3 covered it. Zoho clients connect their mail separately.

**Step 6 - Your meeting recorder (Granola).** The first time you say "draft an email based on
the transcript of the call we just had" and see the job it does, you'll get it - that's not just
work off your plate, it's the strain of holding the call in your head, gone. Then before your
next call you'll say "prep me for my meetings" and Wingguy pulls the transcript from last time
and clues you in. After those two moments you will not want a single transcript to ever be
missed - and that's why we recommend Granola: it takes notes right on your computer, no bot in
your calls, and it works on any platform, even when you're not the host. (See the expanded step
before promising it.)

**Step 7 - The dress rehearsal (10 minutes).** We prove the whole chain works: Wingguy offers
times for a real lead, books a test meeting, the invite arrives with your link on it, and we
cancel it together. Then you're live.

**Step 8 - Your own Claude key (BYO clients only, ~15 minutes).** Some things Wingguy does happen
on our servers while you're asleep - overnight it reads your follow-ups and pre-writes your drafts
- and your Chrome extension drafts on LinkedIn too. That work runs on a Claude API key that's
yours: you create it, you put a monthly spend cap on it, and you can switch it off any time. You
hand it to me once and it lives safely on your record. (On a managed plan? Skip this - your
drafting runs on my account and there's nothing for you to do.)

**Step 9 - Linked Helper, last on purpose (decided 2026-08-22, new clients only).** The engine that
fills your database goes in last, once everything above is proven, your targeting has had a few
weeks to settle, and your profile says connector. Nothing is lost by waiting - the Linked Helper
trial only starts when the first campaign launches. The targeting conversation starts at session 1
and threads through every session, so this final step launches at full speed. (Clients already
mid-journey on the old LH-first order finish that way.)

---

## STEP 0 EXPANDED - get the record ready (you, solo, before the call)

**You do:**

- [ ] On their Master Clients row: **Status = Active**. An inactive client can't connect at all.
- [ ] **Portal Token** is set. This is their secret key - it's what makes their personal Wingguy
      link work and keeps everyone else out.
- [ ] Their own **leads base** is linked on the row.
- [ ] **Timezone** is filled in. Every meeting time Wingguy ever shows them or their leads uses
      this. Wrong timezone = every offered time is wrong.
- [ ] **Wingguy Enabled = Yes** only if they're getting the Chrome extension (the LinkedIn
      drafting tool). Chat-only client? Leave it alone - it has nothing to do with the connector.
- [ ] Decide the plan (this is about the AI that powers **server-side drafting** - the overnight
      brief and the Chrome-extension drafting; it is NOT the chat, which always runs on the client's
      own claude.ai subscription):
      - **Bring-your-own (default, like Julian):** leave **Managed Claude Key** blank. They create
        their own Anthropic API key in Step 8 and you paste it into their **Anthropic API Key**
        field. Their drafting then runs on their key + their spend cap - not your account.
      - **Managed plan:** **Managed Claude Key = Yes**. Their drafting runs on your account (they
        pay you); leave **Anthropic API Key** blank and skip Step 8.
- [ ] **Followup Brief = Yes** only once the AI lane above is settled. For a BYO client, do NOT
      switch it on until their **Anthropic API Key** is in the record - otherwise their overnight
      brief quietly runs on YOUR key instead of theirs (see Step 8's "Watch out").

**Check it worked:** ask Claude - *"run the onboarding preflight for [client ID]"*
(`scripts/wingguy-onboarding-preflight.js <clientId>`). It prints the whole journey - every step
DONE / OWED with live probes, not just record fields - so you see exactly where this client is
before every session, not only the first one. All green on today's steps before the call.
(The original record-only check, `scripts/wingguy-julian-preflight.js`, still exists.)

---

## STEP 1 EXPANDED - the connector

**Say to the client:** "Wingguy is going to live inside your own Claude - the same Claude you
already use. I'm sending you a private link right now. It's your personal key, so keep it to
yourself - don't forward it or put it in a shared doc."

**You do:**

- [ ] Build their link: `https://pb-webhook-server.onrender.com/mcp2/` + their Portal Token.
- [ ] Send it by DM or direct email only, together with the ready-made instructions from
      [wingguy-connector-install.md](wingguy-connector-install.md) section 2.
- [ ] If the link ever leaks: regenerate their Portal Token - the old link dies instantly.

**The client does:**

1. Opens **claude.ai** → **Settings** → **Connectors**
2. Clicks **Add custom connector**
3. Names it **Wingguy**, pastes the link, clicks **Add**
4. Starts a **new chat** and types: **"what can I do with Wingguy?"**

**Check it worked:** Wingguy introduces itself in their chat and lists what it can do. If they see
that, you're done here.

**Watch out - the stale snapshot.** Claude memorises what Wingguy can do at the moment the
connector is added, and keeps using that memory. Whenever we add new abilities later, the client
won't see them until they refresh: Settings → Connectors → Wingguy → **Refresh Tool List**, then
start a fresh chat. Any time a client says "Wingguy says it can't do that" about something you
know exists - it's this. (If a refresh ever doesn't do it, disconnecting and re-adding the
connector is the sledgehammer version.)

**If it won't connect:** the troubleshooting list is in
[wingguy-connector-install.md](wingguy-connector-install.md) section 3 (wrong/revoked token,
free-plan connector limit, needs a fresh chat).

---

## STEP 2 EXPANDED - the rules session

**Say to the client:** "This is the fun one. You're going to tell Wingguy how you actually work -
how you talk, what you offer, what you'd never say to a lead. It interviews you; you just answer
honestly. Takes about twenty minutes and it's what makes everything Wingguy writes sound like YOU.
Type: let's set up my rules."

**The client does:** types **"let's set up my rules"** and follows the interview. Wingguy runs the
whole thing - questions, examples, confirmation. There is genuinely nothing for you to do.

**Check it worked:** at the end, the client can ask Wingguy *"what are my rules?"* and see their
own words reflected back.

**Why this is step 2 and not later:** it needs nothing connected - no calendar, no email - and
it's the moment the client feels "this thing gets me". Let that land before asking them to do
more plumbing.

---

## STEP 3 EXPANDED - the calendar (and the mailbox, same click, for most clients)

**Know this before anything else: for a Google or Microsoft client, the calendar and the mailbox
are ONE approval, not two.** One link covers both, so step 3 and step 5 happen in the same two
minutes. Zoho is the exception - there, calendar and mail connect separately.

**Which lane is this client on?** Their email domain settles it (an MX lookup takes seconds -
Claude does this, don't go looking yourself).

| Their provider | The lane | How it goes |
|---|---|---|
| Google or Microsoft | **Unipile hosted link** - calendar AND mail in one | Claude mints the link, you paste it, they approve |
| Zoho | calendar = their own `/auth/zoho/start` link; mail = app-specific password | Claude builds the link, you paste it |

**YOU DO - the whole of your part:** paste the link Claude hands you into the meeting chat.
That is the entire step from your side. If you find yourself opening a dashboard, copying an
account id or editing a field, stop: that is Claude's half, hand it back.

**Say to the client:** "Now we connect your calendar and your mailbox - one approval covers both.
The calendar so Wingguy can offer your leads times you're actually free, and I mean actually: it
checks ALL your calendars, personal included, so a dentist appointment blocks that slot the same
as a work meeting. You'll never be double-booked. And your mailbox so it can draft as you, reply
into existing conversations properly, and answer 'what's my history with this person?' in
seconds. One thing before you click: when the permission screen comes up, check it's showing your
WORK email at the top. If it shows a personal account, stop, and we'll use a private window
instead."

**THE CLIENT DOES:** clicks the link, reads out the account shown on the permission screen,
approves. Ten seconds.

**CLAUDE DOES** - say *"connect <client>'s calendar and mail"* and it runs all of this:

- mints the hosted link from Unipile and hands it over ready to paste
- once they've approved, fetches the new account id from Unipile and puts it on their row
  (nothing calls back to us - see the invisible-connection trap below)
- sets **Unipile Account ID**, **Calendar Provider** = `unipile`, **Email Provider** = `unipile`
- leaves **Calendar Email** BLANK - a value there forces the old Google service-account path and
  Unipile gets silently ignored
- sets **Calendar Read IDs** to `all` - the "check every calendar they have" switch. Without it
  the no-double-booking promise only covers one calendar
- leaves **Calendar Write ID** blank for almost everyone (blank = bookings land on their main
  calendar, which is what people expect). Only fill it for the rare client who wants bookings
  landing somewhere specific
- proves both halves live as that client before either of you tells them it works

**Watch out - "just share your Google calendar with us" CANNOT BOOK.** Sharing a Google calendar
with the service account is read-only by design (`calendar.readonly`). Wingguy will see their
diary and happily offer times, then fail at the moment of booking - and step 7, the dress
rehearsal, is where you find out. It is not a quicker version of this step. Anyone who needs a
meeting booked goes through the hosted link.

**Watch out - the wrong-account trap (this exact thing bit Julian).** The permission screen
belongs to whoever is logged in on that browser at that moment. Julian was logged into his
personal Zoho, so Wingguy got connected to his personal calendar - which was empty - and it looked
exactly like a bug: "Wingguy sees my calendar but says I have no events." The one-sentence
prevention is in the script above ("check it shows your WORK email"). If they get it wrong,
re-clicking the link in a private/incognito window is always safe. **Check this on every client,
every time.**

**Watch out - the connection is invisible to us until Claude goes and looks.** Unipile can ping a
URL of ours the moment a client connects; we have never built the endpoint to catch it. So a
client who has approved and a client who has not look identical from our side until someone
fetches the account id by hand. That is why "proves it live" above is not optional, and why this
step is never marked done on the strength of the client saying "yep, clicked it".

**Check it worked:**

- [ ] Claude runs the multi-calendar health check for them
      (`scripts/wingguy-multi-calendar-check.js`) and lists their calendars
      (`scripts/wingguy-list-calendars.js`).
- [ ] Eyeball that calendar list WITH the client: "does this look like your account?" One lonely,
      near-empty calendar usually means the wrong-account trap struck again.
- [ ] Best check of all - the client asks Wingguy: **"what's on my calendar this week?"** and
      confirms it matches reality, including something they know is on their personal calendar.
- [ ] Then the mail half: the client asks Wingguy to find a recent email from a sender they know,
      and then for the full text of it.

---

## STEP 4 EXPANDED - the meeting link

**The policy first, so you can explain it with confidence:** one reusable personal meeting link
on every invite, automatically. We deliberately do NOT generate a fresh link per meeting - one
link that never changes is simpler, can't fail at booking time, and makes back-to-back call days
painless because everyone comes through the same door.

**Say to the client:** "When Wingguy books a meeting for you, the invite needs a 'click here to
join' link. Do you have a personal meeting link? Zoom calls it your Personal Meeting Room. Meet
and Teams have the same thing - a link you can reuse forever. If you've never set one up, let's do
it right now, it's two minutes. The beauty of it: one link, on every invite, automatically. Your
leads just click and away we go - nothing to generate, nothing to forget, nothing to break. While
you're in there we'll switch on the waiting room, so if someone's running late to one call they
can't wander into your next one."

**The client does:**

1. Finds (or creates) their reusable meeting link - Zoom: Personal Meeting Room; Google Meet or
   Teams: create a meeting link they'll reuse.
2. Turns on the **waiting room** (Zoom) or **"ask to join"** (Meet/Teams).
3. Reads the link out to you.

**You do:**

- [ ] Paste the link into the **Meeting Link** field on their row.
- [ ] While you're on the row: fill their **LinkedIn URL** and **Phone** if empty - those go on
      the invite too, so leads can reach them.

**Watch out - do not skip this step.** A blank Meeting Link means every invite Wingguy books goes
out with NO way to join the call - and nobody notices until a lead is sitting there at meeting
time with nothing to click. Catch it here, together on the call, not after the first real booking.

---

## STEP 5 EXPANDED - the email

**For Google and Microsoft clients there is nothing to do here - step 3 already did it.** The one
approval they clicked covered calendar and mailbox together. Run the mail check below to prove it
and move on.

**Say to the client** (if their mailbox is connecting separately, i.e. Zoho): "Next is your
mailbox. Once it's connected, Wingguy can draft emails as you - proper ones, that thread into
existing conversations - and it can answer things like 'show me my history with this lead' or
'has she replied since Tuesday?'. It'll even stop you from accidentally sending someone the same
document twice."

**The Zoho lane only.** Zoho doesn't offer the easy click-and-approve route for mail, so it's a
one-off manual step: in their Zoho settings they create an **app-specific password** - a special
password that only works for this one connection; their real password is never shared - and read
it out to you. Claude sets up the connection from there.

**Check it worked:**

- [ ] The client asks Wingguy to find a recent email from a sender they know, then asks for the
      full text of it.
- [ ] Their row shows a live mail connection: **Email Provider** = `unipile` with a **Unipile
      Account ID** (Google/Microsoft), or the Zoho/Nylas equivalent for that lane.

**Worth knowing (app-password connections only):** the last ~90 days of mail is instantly
searchable; older mail still works but Wingguy has to fetch it the slow way, so the first
deep-history question can take noticeably longer. Normal, not broken.

---

## STEP 6 EXPANDED - the meeting recorder (Granola)

**Why this step earns its place - two moments sell it:** the first time the client says *"draft
an email based on the transcript of the call we just had"* and sees the job it does - that's not
just work off their plate, it's the mental strain of holding the call in their head, gone. And
the first time they say *"prep me for my meetings"* and Wingguy pulls the transcript from last
time and clues them in before they walk in. After those two, they will never want a transcript
missed - which is the whole pitch for Granola: the recorder that doesn't miss.

**Why Granola first:** Granola captures the meeting on the client's own computer - no bot joins
the call. That means it works identically on Zoom, Meet and Teams, works when the client is a
guest rather than the host, never puts an extra "participant" in the meeting for a lead to
wonder about, and produces one tidy note per meeting. Just as important on our side: the Granola
pipe was built per-client from day one - each client's own key, own webhook, own signing secret -
so it's the one lane that's genuinely ready for every client.

**Say to the client:** "One more connection, and it's the sleeper hit: your meeting recorder.
Here's what it feels like. You finish a call, and you say to Wingguy: 'draft an email based on
the transcript of the call we just had' - and watch the job it does. That's not just work off
your plate, it's the strain gone too: you don't have to hold the whole call in your head any
more. Then before your next meeting you say 'prep me for my meetings' and it pulls the
transcript from last time and clues you in. Once you've felt those two, you won't want a single
transcript to ever be missed - and that's why we recommend Granola: it takes notes straight on
your computer, no bot joining your calls, and it works whatever the platform - even when you're
the guest."

**The client does (Granola):**

1. Gets set up on Granola (granola.ai) if they aren't already. **The API key needs Granola's
   Business plan** - check what they're on before promising anything.
2. In Granola's settings, creates an **API key** and gives it to you.

**You do (Granola):**

- [ ] Paste the key into the **Granola API Key** field on their row.
- [ ] Run the registration script (Render one-off job):
      `node scripts/register-granola-webhook.js --client=<Client-ID>`. It prints a **signing
      secret, shown once** - paste it into **Granola Webhook Secret** on their row. The
      connection is not live until that paste happens.

**Check it worked:** after their next recorded meeting, the client asks Wingguy *"what was my
last meeting?"* and sees the note come back. (Until then, ask Claude to confirm the webhook
registration listed cleanly: `--list` on the same script.)

**Watch out:**

1. **Calendar before Granola - the order is load-bearing.** Wingguy works out who a meeting was
   with by looking at the client's calendar, so Granola connected before the calendar (step 3)
   just files orphan notes. Never swap these steps.
2. **The first client through is the proving run.** The pipe is live on prod but its switches
   ship dark and the note shape hasn't been verified against a real client note yet. Until a
   first real note has filed cleanly, say "we're switching it on now", not "it works".
3. **Business plan.** No Business plan, no API key, no pipe - check before setting expectations.

### The Fireflies lane - PROVEN 2026-08-21 (Rick Wong, first client through)

Fireflies is the one non-Granola recorder with a real pipe. It is a bot-joining tool, and
**Fireflies only fires for meetings the account OWNS** (organiser) - a client who is a guest on
someone else's Fireflies call gets nothing. For a client already living in Fireflies it is a
straight swap, and their phone app covers face-to-face meetings too.

⚠ **The screens below were observed on 21 Aug 2026 in a live account. Fireflies moves its UI and
its own docs were wrong on two counts that day - trust what is on the client's screen over what
is written here, and update this when it drifts.**

**Before the call (you):** mint the signing secret yourself, 16-32 chars, and have it ready. Do
not make the client invent one live.

**The client does:**

1. **Settings -> MCP and API** (NOT "Developer settings", whatever the docs say) -> copy the
   **API key** and read it to you.
2. **Settings -> Webhooks.** An existing config shows as a row ("Default Configuration"). The row
   does NOT open on click - hover it, then **three dots -> Edit**. If there is none, **Add Config**.
3. Paste the webhook URL: `https://pb-webhook-server.onrender.com/webhooks/fireflies/<Client-ID>`
4. Press **Continue**. The **Signing Secret** field is on that NEXT step, it is OPTIONAL, and it
   is the easiest thing in the whole flow to skip straight past. Paste your secret there.
5. Tick **Meeting transcribed** AND **Meeting summarized**. Leave **Meeting bot joined** off.
6. The button says **Update**, not Save, when editing - and stays greyed out until Continue.

**You do:**

- [ ] **Put the secret on their row BEFORE they save their side**, so the proving step works first
      time. Ours rejects every unsigned delivery, so the wrong order looks like a failure.
- [ ] **Fireflies API Key** + **Fireflies Webhook Secret** on their row, and **Transcript
      Provider** = `Fireflies`. The secret must match theirs EXACTLY or every delivery is
      rejected on signature.
- [ ] Confirm: `GET https://pb-webhook-server.onrender.com/webhooks/fireflies/<Client-ID>` -
      wants `processing_enabled`, `api_key_configured` and `secret_configured` all true.

**Prove it ON THE CALL - never send them away hoping.** The three-dots menu beside **Add Config**
has **Push past meetings**: pick a date range and Fireflies pushes real historic meetings through
on demand. Watch them file, then tell the client it works. This is the best thing in the Fireflies
flow and it turns "configured" into "proven" while they are still on the screen.

**Watch out:**

1. **Corporate link rewriting - check BEFORE the call.** Rick's Sales Xceleration mail runs
   through Proofpoint, which rewrites every link that lands in his inbox. He pasted a
   `urldefense.proofpoint.com` wrapper into the webhook URL field and it would never have reached
   us. For ANY client on a company domain, send paste-targets by Zoom chat or text - never email -
   and tell them the tell, because it will bite every link you ever send them.
2. **Their clipboard holds one thing.** This flow needs a URL and a secret at the same moment and
   the client loses one copying the other. Send values one at a time, in the order needed.
3. **Event names differ from the docs.** The docs say `Transcription completed`; the app sends
   `meeting.transcribed` / `meeting.summarized`. Our filter accepts all three (0c5019e3).
4. **Env gates** `FIREFLIES_WEBHOOK_ENABLED` + `FIREFLIES_INGEST_ENABLED` must be `true` on prod
   (set 2026-08-21) - and an env change needs a REDEPLOY before the running process sees it.
5. **Paid plan.** Free-tier API access to sentence-level data is not guaranteed.

---

**If they push for a different recorder (Otter, Fireflies, whatever they already use):**

1. **Re-sell the why, once - EXCEPT for Fireflies, which now has its own lane above.** The point
   was never the brand - it's that no transcript is ever missed. The other tools have no pipe into
   Wingguy, so their transcripts go nowhere: no draft-from-the-call, no prep-me, no history. And most of them work by sending a bot into the
   call - the thing Granola exists to avoid.
2. **If they still insist, don't fight it - stack instead.** They keep their tool for whatever
   they like about it, and run Granola alongside. Granola captures on their computer, so it
   doesn't clash with a bot tool at all - both can sit on the same call. They give up nothing;
   Wingguy stays fed.
3. **The escape hatch, framed honestly:** the odd transcript from elsewhere can be pasted into
   chat and Wingguy will file it ("here's the transcript from my call, file it" - it's the same
   pipeline as the portal's Import button). But walk them through what "manual" actually means
   before they build a workflow on it: export the transcript from their tool, paste it in, give
   the lead's email so it links to the right person (no email, no link - the note is invisible
   next time they ask about that person), and if the paste arrives without speaker labels
   there's a confirm step on the review screen before the summary exists. Granola has done all
   of that before they've stood up from the call. Offer the paste door as a patch, not a plan -
   every manual step is a missed transcript waiting to happen. (Your side: imported rows have no
   tidy delete, so real transcripts only - never demo it with a test paste.)
4. **Never promise a custom pipe for their tool on the call.** That's a development decision,
   not an onboarding one - "I'll look into it" is the strongest commitment to make.

---

## STEP 7 EXPANDED - the dress rehearsal

**Say to the client:** "Last step - we prove the whole thing end to end, with a safety net. We'll
have Wingguy book a real test meeting, watch the invite arrive with your link on it, and then
cancel it together."

**Do together:**

- [ ] Client clicks **Refresh Tool List** on the Wingguy connector (Settings → Connectors), then
      starts a fresh chat. (Picks up anything shipped since step 1 - the stale-snapshot trap.)
- [ ] Client asks Wingguy to **offer times for a real lead** → picks one → **books a test
      meeting**.
- [ ] The invite arrives → **open it and confirm the meeting link is on it** → cancel the test
      meeting together.
- [ ] Sanity-check their booking rules with them: booking hours, lunch break, preferred meetings
      per day, standard meeting length. These have sensible defaults - confirm the defaults match
      how THIS client actually works, adjust if not.

**Say to the client:** "That's it - you're live. From here, anything you want changed, just tell
Wingguy 'update my rules'."

---

## STEP 8 EXPANDED - your own Claude key (BYO clients only)

**Skip this entirely for managed-plan clients** (Managed Claude Key = Yes). This step is only for
clients who run their drafting on their own key - the default.

**The idea first, so you can explain it plainly:** the chat runs on the client's own claude.ai
subscription, but two things happen on OUR servers - the overnight follow-up brief, and the Chrome
extension's LinkedIn drafting - and those need a Claude *API* key (a different thing from a claude.ai
subscription). We put that key on the client's own account so those runs are billed to them, capped
by them, and switch-off-able by them. It's the one part of setup where the client does a little
homework in a website that isn't ours.

**Say to the client:** "There's one bit of the AI that works for you while you're asleep - overnight
it goes through your follow-ups and pre-writes your replies - and your LinkedIn drafting runs on our
servers too. That runs on a Claude key that's yours, not mine. You'll set it up in Anthropic's
console: it takes about fifteen minutes, most of which is them, not you. The important part - and the
reason you can relax about it - is that YOU put a monthly spend limit on it, a number you choose, and
you can revoke it with one click any time. Worst case in the whole world is a bill the size of the cap
you set. I'll walk you through it, then you send me the key once and we're done."

**The client does** (read these out one at a time - the console shifts its layout occasionally, so
these are the *concepts*; the labels may sit a click away):

1. Goes to **console.anthropic.com** and signs in (or creates an account - this is separate from
   their claude.ai login, even if it's the same email).
2. **Adds a little credit / a payment method** under Billing. This is the part people trip on: the
   API is pay-as-you-go and needs its own funding - a claude.ai Pro subscription does NOT cover it.
   A small starting credit is plenty.
3. Creates a **Workspace** (call it "Wingguy"). A workspace is just a walled-off compartment - it's
   what lets the spend cap apply to us alone and not touch the rest of their account.
4. **Sets a monthly spend limit on that workspace** - the safety number, their choice. This is the
   step that makes the whole thing safe; don't let them skip it.
5. Creates an **API key** inside that workspace, and copies it. **It's shown once** - if they click
   away before copying, they just make a new one.
6. Sends the key to you (it starts with `sk-ant-`). Ask them not to paste it into anything public;
   if they're ever uneasy about it later, they can revoke it and make a fresh one in ten seconds.

**You do:**

- [ ] Paste the key into the **Anthropic API Key** field on their Master Clients row. That's the
      whole install - this stored key is the ONLY client lane (the extension's browser-key field
      was removed 2026-08-05; platform key serves just the owner and Managed-plan clients), so from
      now on their overnight brief and extension drafting run on their key automatically.
- [ ] Only now flip **Followup Brief = Yes** (if they're getting the overnight brief). Order matters
      - see the Watch out.

**Check it worked:**

- [ ] Ask Claude: *"prepare the follow-up brief for [client ID]"*, then check the run log shows
      **`anthropic lane=client-stored-key`** (not `platform-fallback`). That line is the proof it
      picked up their key. `platform-fallback` here means the field is blank or didn't save - re-paste.
- [ ] Or the client's own proof: they draft something (a reply in chat, or a thanks note via the
      extension) and it comes back normally - no "your Anthropic key was rejected" message.

**Watch out - switching the brief on before the key is in.** If Followup Brief = Yes but the
Anthropic API Key field is still blank, the overnight brief doesn't fail - it quietly falls back to
YOUR platform key, so you silently pay for their nightly run. No alarm fires because nothing broke.
The fix is just sequence: key in the field first, brief switched on second. (A managed-plan client is
the deliberate exception - they're *meant* to run on your key.)

**Watch out - the two-keys confusion.** Clients (and you, at 5pm) mix up the claude.ai *subscription*
that powers the chat with the Claude *API key* this step is about. They are separate accounts with
separate billing. If someone says "but I already pay for Claude" - yes, and that covers the chat;
this key covers the server-side drafting, and it's usually only a few dollars a month at their cap.

**Watch out - a revoked or capped key later on.** This is the safety net working, not a bug. If a
client revokes their key or hits their spend cap, their drafting stops with a clear "your Anthropic
key was rejected - update it" message, and the overnight brief emails you a "key rejected" alert and
serves yesterday's brief (flagged stale). It never silently moves onto your key. The fix is always
the same: they make a fresh key (or raise the cap) and you paste it into the field.

---

## STEP 9 EXPANDED - Linked Helper, last on purpose

This is the closing move of onboarding for new clients (decided 2026-08-22), and it deliberately
comes after everything else. The early sessions build trust through the Wingguy plumbing; by the
time you get here the client understands why the collection engine matters and wants it right.

**Say to the client:** "Now that you've seen what Wingguy does with the people in your database,
let's fill it. This is the step that decides who you'll be meeting, so it's worth the thought
you've already been giving it - and remember, it's changeable, so we aim roughly right and adjust."

**You do:**

- [ ] Confirm the targeting is decided BEFORE this session - it should have been threading through
      every session since session 1. If it hasn't, send the prep question ahead of time: ask
      Wingguy *"talk me through who I should be looking for and how to build my search"* (it
      serves the Wingguy Learning topics: who you're looking for / finding your audience / your
      LinkedIn profile).
- [ ] Confirm their profile says connector (headline + About, connector first) - the first thing
      every new connection does is look them up.
- [ ] Then the hookup: Linked Helper install, the search URL into Campaign 1, webhook into their
      leads base. The trial clock only starts at first campaign launch, so all the prep above is
      free.
- [ ] **Set "Email Series Start Date" on their Clients row** (Master Clients base) - convention is
      this session's date. The client email drip starts from that date and takes over the weekly
      drumbeat when the onboarding sessions stop, covering the collection quiet zone. Blank = the
      series never starts for them. (Until the drip send loop is built, the date is recorded but
      nothing sends - set it anyway so launch day is on the record.)

**Check it worked:** first profiles land in their leads base and get scored overnight.

**Watch out:**

- The 14-day trial starts at first campaign LAUNCH - never launch a test campaign "just to see"
  during an earlier session, or the clock burns while the rest of onboarding finishes (this is
  what stalled a real client's collection in Aug 2026).
- One LinkedIn account, one machine - never run Linked Helper from two computers at once.
- When the trial ends: yearly + pro, and Guy has a 10% promo code - send it before the trial runs
  out.

---

## THE EXTENSION UPDATE FOLDER - delivery that survives updates

**★ THE MODEL (updated 2026-08-25 - ONE SYNCED LANE + ZIP; supersedes the 2026-08-21
three-lane doctrine and everything before it about work accounts or client-owned folders):**

The extension installs once, but it gets improved - and updates must reach the client's computer
with ZERO ongoing effort from them. The mechanism: one **Wingguy folder** per client, **owned by
Guy in HIS cloud storage and shared to the client VIEW-ONLY**; the client's own sync tool pulls
it down; the browser picks up a new version at the next restart (or the refresh button for
immediately). Guy's ship command (`scripts/ship-extension.js`) pushes every new version into
every folder with Guy's own credentials - no client ever approves an app, and no employer is
ever involved. The client record carries **Extension Folder Provider** + **Extension Folder Ref**.

The lanes on offer to clients:

1. **Personal OneDrive - THE DEFAULT for every synced client, Windows or Mac.** The client
   syncs Guy's shared folder with the OneDrive app. The Julian model, syncing in the field
   since 2026-08-13; push automated (local copy on Guy's machine) 2026-08-21. Why it's the
   default: a OneDrive folder is a REAL local path that exists from boot, so with the
   "Always keep on this device" pin the extension folder is always readable, no matter what
   starts first. Nearly every Windows user already has what's needed: the OneDrive app ships
   preinstalled, and Windows 11 setup already made them a personal Microsoft account (it's
   what they sign into Windows with) with 5GB free - overkill for a few megabytes. Macs
   install OneDrive from the App Store (Julian proves it works).
2. **Zip self-manage** - ONLY for tech clients who prefer to manage their own copy (Ashley),
   and the fallback for company-managed machines that block personal accounts. Built with
   `git archive "origin/main:wingguy-extension" --prefix=Wingguy/ --format=zip`; delivered by
   Zoom chat where a mail filter (Proofpoint) mangles emailed links.

**Personal Google Drive is PARKED as a client lane (decided 2026-08-25). Do not offer it.**
The API push works (proven 0.3.12, 2026-08-20) and the code stays in ship-extension.js,
dormant. Why parked: Google Drive for desktop's streaming mode mounts a virtual drive
(`G:`) only after the Drive app starts - and Chrome SILENTLY REMOVES a developer-mode
extension whose folder it can't read at browser start. So any reboot where the browser wins
the startup race makes the extension vanish (hit Guy twice; diagnosed 2026-08-25; the
offline pin does NOT help - the drive letter itself is missing, not the files). Google
offers no per-folder real-local sync: "Mirror files" is all of My Drive or nothing, and is
unverified for shared folders. The only honest client experience on this lane is "sometimes
it disappears after a restart, here's the 30-second re-load" - not good enough as a default.
Revisit only for a genuinely Microsoft-refusing client, eyes open, or fold it into the
Chrome Web Store endgame (~20+ extension clients).

**Microsoft 365 WORK accounts are NOT a delivery channel - rejected 2026-08-21.** Two reasons,
both proven the hard way: (a) a share from outside can never sync into an M365 work account, and
Guy can never push into one from outside the company's tenant (hard Microsoft limits - Ashley,
2026-08-20); (b) every workaround needs the client's company to approve something, which is the
same wall that stalls calendar admin consent for weeks. Instead: a work-Microsoft client on
their OWN machine (Rick) simply uses a free personal Microsoft account - work and personal
OneDrive run side by side on one PC without conflict. A client on a company-managed machine that
blocks personal accounts goes on the zip lane, or gets updates done together on calls. **Do NOT
resurrect the work-tenant lane without Guy explicitly reopening it.**

**View-only is load-bearing:** the folder's contents execute inside the client's browser, so
only Guy's account may ever be able to write to it. Never grant edit rights.

**The ask changes too (re-simplified 2026-08-25):** two questions - **"is the computer you use
for LinkedIn your own, or one your company manages?"** and **"do you have a personal Microsoft
account?"** (for Windows users the answer is nearly always "yes - it's what I sign into Windows
with", even if they live entirely in Google, like Guy did). Own machine + personal Microsoft
account = OneDrive lane, no IT department in the loop. Company-managed machine = zip lane or
updates together on calls; don't fight the policy - and it's worth gently making the point that
their network is a PERSONAL asset that belongs on a machine they own.

### EDGE WORKS - proven on a real machine 2026-08-21 (Guy's own, Edge 151, extension v0.3.12)

The extension is a Chrome extension in name only. It ran in Edge unchanged, first go, `/wg` live on
a LinkedIn profile with no reload needed. A read of the source beforehand found nothing
Chrome-only: every browser API it uses (storage, tabs, scripting, messaging, the toolbar action) is
standard MV3 that Edge supports, the manifest carries no `minimum_chrome_version`, no `key` and no
`update_url`, and the code does not sniff which browser it is running in. So **stop calling it
"Chrome only" to clients** - if they live in Edge, put it in Edge.

**What differs from the Chrome install:**

- `edge://extensions/`, not `chrome://extensions/`.
- **Developer mode is a toggle in the LEFT sidebar in Edge**, not the top-right corner.
- One content script needs Edge 111+ (`world: "MAIN"`). Anything from the last couple of years is
  fine; `edge://settings/help` shows the version if in doubt.

**⚠ THE TRAP - the extension's storage is PER BROWSER.** A fresh install in Edge inherits nothing
from the same person's Chrome copy. **They must open their portal once in Edge** before `/wg` will
know who they are. Skip it and a perfectly good install looks broken. Same applies in reverse, and
to anyone running both browsers side by side.

**The only friction Guy hit was signing in to LinkedIn (and the portal) from scratch, 2FA
included - nothing to do with the extension.** That is a cost of using a browser you don't
normally use, so budget five minutes for a client being moved to a new browser, and none at all
for a client who already lives there. Rick Wong is an Edge native, so he should hit less of this
than Guy did.

The update folder mechanism is unaffected - Edge picks up a new version on browser restart exactly
as Chrome does.

**The comms doctrine (bulletproof rules, learned 2026-08-20):**
- Two steps: ASK first (which cloud + Windows or Mac), then send exactly ONE card that matches
  their answer. Nobody ever reads steps that don't apply to them.
- Cards are FROZEN canonical text - proven click-for-click on a real machine before first client
  use, carrying a proven-on note. A client stalling on a step = fix the card the same day.
- Every step says WHERE it happens (File Explorer, never the browser) and ends with
  "you'll know it worked when...".
- Every risky step has a zero-cost exit: "stop here and reply - we'll do it together on the
  call, two minutes, nothing lost." Nobody troubleshoots alone.
- The loop closes BEFORE the call: client replies "done", Guy ships to their folder and the
  client confirms the files appeared. No session ever starts with a delivery surprise.

### The ask email (send at the extension stage, before the install session)

> Subject: Your Wingguy extension - one quick question first
>
> Hi [name],
>
> Next up is the extension - the piece that puts Wingguy right inside LinkedIn, the /wg
> magic I showed you.
>
> Before I send it over, one thing to get right: I don't just install it once - I keep improving
> it, and I want my updates to reach your computer automatically, without you ever having to
> download anything. That works through a folder I set up and share to you in a personal cloud
> account.
>
> So, three quick questions:
>
> 1. Is the computer you use for LinkedIn your own, or one your company manages?
> 2. Do you have a personal Microsoft account? If you're on Windows, it's almost certainly the
>    account you sign into Windows with (a hotmail, outlook.com or live.com address). Tell me
>    the address. Work accounts don't work for this one, so if you're not sure what you've
>    got, just say so and we'll sort it together on the call. Nothing lost.
> 3. Is your computer Windows or a Mac?
>
> Reply with those and I'll set the folder up at my end and send you the two steps to connect
> it - about two minutes, once, and then updates look after themselves forever.

### The folder standard (new clients from 2026-08-21)

One folder per client, named **Wingguy**, with the extension files (manifest.json) DIRECTLY
inside it - the client loads that one folder and never sees the plumbing. Guy's side of the
layout:

- onedrive: `OneDrive / Wingguy-clients / <Client-ID> / Wingguy` - share the inner **Wingguy**
  from onedrive.live.com; **Extension Folder Ref** = the path
  `Wingguy-clients/<Client-ID>/Wingguy`. Guy himself is on this standard path
  (`Wingguy-clients/Guy-Wilson/Wingguy`, no share needed - it's his own OneDrive) since
  2026-08-25, when he moved off the parked gdrive lane; his old
  `My Drive/Wingguy/wingguy-extension` folder is retired.
- (parked gdrive lane, for the record: `My Drive / Wingguy-clients / <Client-ID> / Wingguy`,
  ref = the folder's ID from its drive.google.com URL.)
- Exception that pre-dates the standard, leave it alone: Julian's INNER LAYOUT - his folder
  was MOVED to the standard path 2026-08-21 (web move on onedrive.live.com; share to both his
  addresses survived, verified in Manage Access; renaming was avoided on purpose - a rename
  would have changed the folder's name on his Mac and killed his loaded extension). His ref =
  `Wingguy-clients/Julian-Davis/Wingguy/wingguy-extension` - files sit one level deeper than
  the standard because his Mac loads that inner folder. Ship re-proven at the new path
  (0.3.12, byte-identical).

⚠ Loading from a NEW folder path gives the extension a NEW identity in the browser - storage
starts blank, so the client (or Guy) must open the portal once to sign back in. Budget that
into any folder move.

### How a ship runs (the two-environment split)

`node scripts/ship-extension.js` covers every configured client and prints a per-client table.
Each lane runs where its access lives, and the script SKIPS (never silently drops) what it
can't reach from where it's running:

- **onedrive clients** - run it **locally on Guy's machine**: it copies the files into Guy's
  synced OneDrive folder and the OneDrive app carries them up. No Azure, no tokens, ever. A
  Render run lists them as SKIPPED. (Local runs need `.env` with AIRTABLE_API_KEY +
  MASTER_CLIENTS_BASE_ID - already set up on Guy's machine, values copied from the prod env.)
- **zip clients** - no script: build the zip (below) and hand it over.
- **gdrive clients** - none exist (lane parked 2026-08-25); if ever revived, run as a
  **Render one-off job** (the `GOOGLE_SHIP_*` env lives on prod). A local run lists them as
  SKIPPED.

So a full ship = one local run (onedrive) + zips for zip-lane clients. Proven 2026-08-21: local
run shipped Julian-Davis 0.3.12, verified byte-identical to origin/main; Julian's by-hand era
is over. 2026-08-25: same local run shipped Guy-Wilson onto the standard OneDrive path.

---

## THE ONEDRIVE LANE - the default for every synced client

**What Guy does:**

- [ ] After the ask email reply: create `OneDrive/Wingguy-clients/<Client-ID>/Wingguy` (in
      File Explorer on Guy's machine is fine - it's Guy's own OneDrive).
- [ ] Share the **Wingguy** folder to the client's personal Microsoft address from
      **onedrive.live.com** with **"Can view"** (Windows' right-click "Give access to" is LAN
      sharing, NOT OneDrive - always share from the website). Never edit rights.
- [ ] Set their row: **Extension Folder Provider** = `onedrive`, **Extension Folder Ref** =
      `Wingguy-clients/<Client-ID>/Wingguy`.
- [ ] First ship to just them: `node scripts/ship-extension.js --client=<Client-ID>` **run
      locally on Guy's machine** - table must say OK at the current version. Give OneDrive a
      minute to sync up before the client looks.
- [ ] Send the card below.
- ⚠ For a client whose company mail mangles links (Proofpoint - Rick): send the share link by
      Zoom chat or text, never email.

**What the client does [DRAFT - UNPROVEN in this direction; walk it on a real machine
(Rick, 27 Aug, is the proving run), stamp the proven-on date, then freeze]:**

> Great - OneDrive it is. I've already set the folder up and shared it to your personal
> account, so your part is two small steps, once, and then my updates reach you automatically
> forever.
>
> 1. **Add my folder to your OneDrive.** Open the share message I sent you and click the link -
>    it opens the OneDrive website. Sign in with your **personal** Microsoft account (the
>    hotmail/outlook one you gave me, not your work sign-in). You'll see the **Wingguy**
>    folder - click **Add shortcut to My files** in the menu bar at the top.
>    *You'll know it worked when: back on your computer, the Wingguy folder appears in File
>    Explorer (the yellow folder icon in your taskbar) under **OneDrive** in the left-hand
>    column.*
>    *If anything looks different from what I've described, stop here and reply with what you
>    see - we'll do it together on the call, two minutes, nothing lost.*
> 2. **Pin it to your computer.** In File Explorer, right-click that **Wingguy** folder and
>    choose **Always keep on this device**.
>    *You'll know it worked when: the icon next to the folder becomes a solid green circle
>    with a white tick.*
>
> Then just reply "done" and I'll confirm the files are flowing - so before our call we both
> already know it's working.

---

## THE ZIP LANE - tech self-managers (their choice) + company-locked machines

**What Guy does:**

- [ ] Build the zip fresh from main every time - NEVER from a checkout:
      `git archive "origin/main:wingguy-extension" --prefix=Wingguy/ --format=zip -o wingguy.zip`
- [ ] Hand it over: attach to email, or by **Zoom chat/text for Proofpoint-afflicted clients**
      (Ashley: email is fine).
- [ ] On every later ship: send the new zip with a one-liner - "new version [X.Y.Z], same
      routine".
- [ ] Their row: **Extension Folder Provider / Ref stay BLANK** (nothing to push to) - which
      means the preflight can't tick "extension updates" for them; that's correct, the send is
      manual.

**What the client does [DRAFT - confirm the wording with the first zip-lane client, then
freeze]:**

> You're on manual updates - you asked to run your own copy, so here's the routine. It's the
> same every time, about a minute.
>
> **Once, at the start:** make a permanent home for it - a folder like **Documents\Wingguy**.
> NOT your Downloads folder (things in Downloads get cleaned up, and the extension dies with
> them).
>
> **Every time I send a new version:**
>
> 1. Save the zip I sent you, right-click it, choose **Extract All...**, and point it at your
>    Wingguy home folder, replacing what's there.
>    *You'll know it worked when: the folder's files show today's date.*
> 2. Go to your browser's extensions page (**chrome://extensions** or **edge://extensions** in
>    the address bar) and click the **↻ reload** arrow on the Wingguy card, then refresh any
>    LinkedIn tabs you have open.
>    *You'll know it worked when: the version number on the Wingguy card matches the one I
>    sent you.*

---

## PARKED 2026-08-25 - THE GOOGLE DRIVE LANE (do not offer; kept for the record)

Why it is parked is in THE MODEL section above (Chrome silently removes the extension when
the streamed G: drive loses the startup race). The push code stays dormant in
ship-extension.js. Everything below is the lane as it stood - do NOT send these cards.

**What Guy does:**

- [ ] After the ask email reply: create `My Drive/Wingguy-clients/<Client-ID>/Wingguy`, share
      the **Wingguy** folder to the client's gmail as **Viewer** (never Editor - edit rights =
      code injection into their browser).
- [ ] Set their row: **Extension Folder Provider** = `gdrive`, **Extension Folder Ref** = the
      folder ID from its drive.google.com URL.
- [ ] First ship to just them: `node scripts/ship-extension.js --client=<Client-ID>` as a
      Render one-off job - table must say OK at the current version.
- [ ] Send the card below. When they reply "done", they install (see the install card) on the
      call or solo.

**What the client does [DRAFT - UNPROVEN in this direction; walk it on a real machine, stamp
the proven-on date, then freeze]:**

> Great - Google Drive it is. I've already set the folder up and shared it to you, so your part
> is two small steps, once, and then my updates reach you automatically forever.
>
> **First, a quick check:** open File Explorer (the yellow folder icon in your taskbar) and
> look at the left-hand column for **Google Drive**. If it's there, carry on. If it's not,
> stop here and just reply "not there" - it means Google's desktop program isn't installed
> yet, and we'll set it up together on our call. Two minutes, nothing lost.
>
> 1. **Put my folder into your Drive.** In your web browser, go to **drive.google.com** (signed
>    in with the same Google account you gave me). Click **Shared with me** in the left-hand
>    column - you'll see a folder called **Wingguy** shared by me. Right-click it, choose
>    **Organise**, then **Add shortcut**, pick **My Drive**, and click **Add**.
>    *You'll know it worked when: Wingguy appears when you click My Drive.*
> 2. **Pin it to your computer.** Back in File Explorer: click **Google Drive** in the
>    left-hand column, open **My Drive**, right-click the **Wingguy** folder, go to **Offline
>    access**, and choose **Available offline**.
>    *You'll know it worked when: a green tick appears next to the folder.*
>
> Then just reply "done" and I'll confirm the files are flowing - so before our call we both
> already know it's working.

### On-call script - installing Google Drive for desktop (when the client replied "not there")

Read this out, watching their shared screen:

1. "Open a new browser tab and go to **google.com/drive/download**. Click the download button
   for Drive for desktop, and run the file it gives you."
2. "It'll ask you to sign in. **Before you click - which Google account is it showing?**" (The
   wrong-account trap applies here exactly like calendars: it must be the personal account Guy
   shared the folder to. If the wrong account shows, sign in with the right one.)
3. "Accept the defaults and let it finish. You'll know it's done when **Google Drive** appears
   in the left-hand column of File Explorer."
4. Then run the card above from step 1, together.

---


## THE INSTALL CARD - loading the extension into Chrome or Edge (one-time, any lane)

**What Guy does:** send this after the client's update folder is flowing (OneDrive lane) or
with the first zip (zip lane). Do it together on the call for anyone non-technical - it's the fiddliest
single step in the journey. ⚠ Rick (27 Aug) = Edge, first client walk-through of this card.

**What the client does [DRAFT - Chrome side matches what Guy has done on his own machine many
times; the Edge wording was proven on Guy's machine 2026-08-21; freeze after the first client
walk-through]:**

> One-time setup - after this, updates arrive on their own and at most I'll ask you to click
> one refresh button.
>
> 1. **Open your browser's extensions page.** Click in the address bar and type
>    **chrome://extensions** (Chrome) or **edge://extensions** (Edge), then press Enter.
> 2. **Turn on Developer mode.** In Chrome it's a toggle in the TOP-RIGHT corner; in Edge it's
>    in the LEFT sidebar. Click it so it's on.
>    *You'll know it worked when: a "Load unpacked" button appears.*
> 3. **Load the folder.** Click **Load unpacked** and pick your **Wingguy** folder (under
>    Google Drive or OneDrive in the picker's left-hand column - or your Documents\Wingguy if
>    you're on manual updates).
>    *You'll know it worked when: a Wingguy card appears on the extensions page.*
> 4. **Sign it in.** Open your portal (your bookmarked link) once in THIS browser. That's how
>    the extension knows it's you - and it's per browser, so even if it already works in
>    Chrome, a copy in Edge needs the portal opened once in Edge.
>    *You'll know it worked when: you open any LinkedIn profile, type /wg, and the Wingguy
>    panel appears.*
>
> If any screen doesn't match what I've written, stop and reply with what you see - we'll do
> it together on the call, nothing lost.

⚠ Traps that bite here (Guy-side knowledge, not for the card): the loaded folder must be the
one with manifest.json DIRECTLY inside; never leave two copies of the extension enabled
(double panels); the "Always keep on this device" pin is load-bearing - unpinned online-only
placeholders can't be read until OneDrive starts, and a browser that starts first SILENTLY
REMOVES a developer-mode extension it can't read (the failure that parked the Google lane).

### Mac variants [UNPROVEN - walk them live with the first Mac client, then freeze]

Same skeletons; Finder instead of File Explorer; OneDrive pin wording is **"Always Keep on
This Device"** (field-proven - it's how Julian has synced since 2026-08-13). Do NOT send a
Mac card cold.

### Guy's wrap-up, any lane

- [ ] Client confirms the "you'll know it worked when" of their last step.
- [ ] OneDrive lane: the journey preflight now shows "extension updates DONE" for them - it
      checks the Provider/Ref fields before every session. The zip lane stays manual by design.
