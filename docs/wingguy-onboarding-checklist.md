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

**Step 6 - Your meeting recorder (Fathom).** If you use Fathom to record calls, we connect it so
Wingguy can use what was actually said in your meetings for follow-ups. (This one may lag the
others - see the expanded step before promising it.)

**Step 7 - The dress rehearsal (10 minutes).** We prove the whole chain works: Wingguy offers
times for a real lead, books a test meeting, the invite arrives with your link on it, and we
cancel it together. Then you're live.

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
- [ ] Decide the plan: **Managed Claude Key = Yes** if they pay you and their drafting runs on
      your account; blank if they bring their own Claude subscription (like Julian).

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

## STEP 6 EXPANDED - Fathom (the meeting recorder)

**Say to the client:** "If you record your calls with Fathom, we can plug that in too - then
Wingguy can use what was actually said in a meeting when it drafts your follow-ups."

**The client does:** signs up for Fathom (if they haven't), and finds their **API key** in
Fathom's settings - a code that lets Wingguy fetch their transcripts.

**You do:** put the key in the **Fathom API Key** field on their row.

**Watch out - check these two things BEFORE promising Fathom works:**

1. Does their Fathom plan actually include an API key? (Unconfirmed whether the free plan does -
   look at their account before setting expectations.)
2. Our Fathom plumbing was built for one user - you. Getting it running for a second client
   probably needs a development session first. Until that's done, say "coming soon", not dates.

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
