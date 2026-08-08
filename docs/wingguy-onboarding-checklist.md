# Wingguy client onboarding - the live-call guide

This guide is built for a three-way session: **you** (Guy) on a call with the **client**, with a
**Claude chat** open beside you. You ask Claude for the overview, read it out, and as you reach
each step you say "expand step 3" and read the detail - to yourself or straight to the client.

How each expanded step is laid out:

- **Say to the client** - words you can read out loud, as-is
- **You do** - your actions (usually in the Master Clients Base)
- **The client does** - their actions, in plain click-this-then-that language
- **Check it worked** - before moving on (some checks are "ask Claude to run...")
- **Watch out** - the traps. Every one of these actually happened during the Julian pilot
  (July 2026); none are hypothetical.

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

**Step 3 - Wingguy meets your calendar (5 minutes).** You approve access to your calendar so
Wingguy can offer meeting times that are genuinely free - checking ALL your calendars, personal
ones included, so it never double-books you. One thing to get right here: approve it from the
correct account (we'll check together).

**Step 4 - Your meeting link (5 minutes).** Every invite Wingguy books needs a "click here to
join" link. We use one reusable personal link - yours - on every invite, automatically. If you
don't have one yet we'll create it together on this call, and switch on the waiting room so nobody
wanders into the wrong meeting.

**Step 5 - Wingguy meets your email.** You approve access to your mailbox, and Wingguy can then
draft emails as you, reply into existing conversations properly, tell you your history with any
lead, and stop you accidentally sending someone the same document twice.

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
(`scripts/wingguy-julian-preflight.js`). It checks the whole row against the live system and
prints green/red per item. All green before the call.

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

## STEP 3 EXPANDED - the calendar

**Say to the client:** "Now we connect your calendar, so Wingguy can offer your leads times
you're actually free - and I mean actually: it checks ALL your calendars, personal included, so a
dentist appointment blocks that slot the same as a work meeting. You'll never be double-booked.
One thing before you click: when the permission screen comes up, check it's showing your WORK
email at the top. If it shows a personal account, stop, and we'll use a private window instead."

**The client does:**

- **Google or Outlook calendar:** clicks the connect link you give them and approves on the
  permission screen. Normal "allow access" page, ten seconds.
- **Zoho calendar:** clicks their special link:
  `/auth/zoho/start?clientId=` their client ID `&token=` their Portal Token.

**Watch out - the wrong-account trap (this exact thing bit Julian).** The permission screen
belongs to whoever is logged in on that browser at that moment. Julian was logged into his
personal Zoho, so Wingguy got connected to his personal calendar - which was empty - and it looked
exactly like a bug: "Wingguy sees my calendar but says I have no events." The one-sentence
prevention is in the script above ("check it shows your WORK email"). If they get it wrong,
re-clicking the link in a private/incognito window is always safe. **Check this on every client,
every time.**

**You do:**

- [ ] On their row, set **Calendar Read IDs** to the word **`all`**. This is the "check every
      calendar they have" switch - without it, the no-double-booking promise only covers one
      calendar.
- [ ] Leave **Calendar Write ID** blank for almost everyone. Blank = "bookings land on their main
      calendar", which is what people expect. Only fill it for the rare client who wants bookings
      landing somewhere specific.

**Check it worked:**

- [ ] Ask Claude: *"list the calendars for [client ID]"* (`scripts/wingguy-list-calendars.js`).
      Eyeball the result WITH the client: "does this look like your account?" One lonely,
      near-empty calendar usually means the wrong-account trap struck again.
- [ ] Ask Claude: *"run the multi-calendar check for [client ID]"*
      (`scripts/wingguy-multi-calendar-check.js`) - the full read-only health check.
- [ ] Best check of all - the client asks Wingguy: **"what's on my calendar this week?"** and
      confirms it matches reality, including things they know are on their personal calendar.

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

**Say to the client:** "Next is your mailbox. Once it's connected, Wingguy can draft emails as
you - proper ones, that thread into existing conversations - and it can answer things like 'show
me my history with this lead' or 'has she replied since Tuesday?'. It'll even stop you from
accidentally sending someone the same document twice."

**The client does:**

- **Gmail or Outlook:** same easy pattern as the calendar - click the connect link, approve on
  the permission screen, done.
- **Zoho mail:** Zoho doesn't offer the easy click-and-approve route for mail, so it's a one-off
  manual step: in their Zoho settings they create an **app-specific password** - a special
  password that only works for this one connection; their real password is never shared - and
  give it to you to set up the connection.

**Check it worked:**

- [ ] A value has appeared in **Nylas Grant ID** on their row.
- [ ] The client asks Wingguy to find a recent email from a sender they know, then asks for the
      full text of it.

**Worth knowing (Zoho/app-password connections only):** the last ~90 days of mail is instantly
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

**If they push for a different recorder (Otter, Fireflies, whatever they already use):**

1. **Re-sell the why, once.** The point was never the brand - it's that no transcript is ever
   missed. Those tools have no pipe into Wingguy, so their transcripts go nowhere: no
   draft-from-the-call, no prep-me, no history. And most of them work by sending a bot into the
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
