# Wingguy client onboarding - the checklist

This is the step-by-step guide for taking a brand-new client from "signed up" to "fully live on
Wingguy". Work through it top to bottom - each step builds on the one before it.

For every step you'll find:

- **What happens** - in plain English
- **Who does it** - you, the client, or both of you together on a call
- **How to check it worked** - before moving to the next step
- **Traps** - things that have actually gone wrong before, and how to avoid them

The traps in here are real: this checklist was built from onboarding Julian (our first pilot
client, July 2026), and every warning below is something that actually happened or nearly did.

Other docs you'll need along the way:
[wingguy-connector-install.md](wingguy-connector-install.md) has the exact message to send the
client in step 1. [wingguy.md](wingguy.md) is the big technical build diary - you shouldn't need
it during onboarding.

---

## Step 0 - Set up their record (you, about 5 minutes)

Before the client does anything, their row in the Master Clients Base needs to be ready.

- [ ] Their **Status** is set to **Active**. (An inactive client can't connect at all.)
- [ ] They have a **Portal Token** - this is their secret key. It's what makes their personal
      Wingguy link work and keeps other people out.
- [ ] Their own **leads base** is linked on the row.
- [ ] Their **Timezone** is filled in - every time Wingguy shows them (or their leads) a meeting
      time, it uses this. Wrong timezone = every offered time is wrong.
- [ ] **Wingguy Enabled**: set to **Yes** only if this client is getting the Chrome extension
      (the LinkedIn drafting tool). If they're chat-only for now, leave it - this switch has
      nothing to do with the chat connector.
- [ ] Decide how their AI is paid for. **Managed Claude Key = Yes** means they pay you and their
      LinkedIn drafting runs on your account. Leave it blank if they're bringing their own Claude
      subscription (like Julian does).

**How to check it worked:** there's a small program that checks the whole row automatically -
`scripts/wingguy-julian-preflight.js` followed by their client ID. (Ask Claude to run it against
the live server - it takes a minute and prints a green/red result for each item.) Everything green
before you send them anything.

---

## Step 1 - They add the connector to their Claude (client, about 2 minutes)

**What this is:** the "connector" is how Wingguy appears inside the client's own claude.ai. Once
it's added, they can talk to Wingguy in any Claude chat - it's their doorway to everything else.

- [ ] Build their personal link: `https://pb-webhook-server.onrender.com/mcp2/` followed by their
      Portal Token.
- [ ] Send it **privately** - direct message or direct email, never a shared doc or group chat.
      That link IS their key: anyone who has it can act as them. (If it ever leaks, regenerate
      their Portal Token and the old link stops working instantly.)
- [ ] Send the ready-made instructions along with it - they're written out word-for-word in
      [wingguy-connector-install.md](wingguy-connector-install.md), section 2. Short version of
      what they'll do: claude.ai → Settings → Connectors → Add custom connector → name it
      "Wingguy" → paste the link.
- [ ] Once added, they start a **new chat** and type: **"what can I do with Wingguy?"** - Wingguy
      introduces itself and takes it from there.

**⚠ Trap - the stale tool list.** Claude takes a snapshot of what Wingguy can do at the moment
the connector is added, and keeps using that snapshot. So whenever WE add new abilities to
Wingguy, existing clients won't see them until they disconnect and reconnect the connector, then
start a fresh chat. If a client ever says "Wingguy says it can't do that" about something you
know shipped - this is almost always why.

---

## Step 2 - The rules session (client + Wingguy, about 20 minutes)

**What this is:** Wingguy interviews the client about how they work - their voice, their offer,
their do's and don'ts - and saves it all as their personal rules. This is what makes Wingguy's
drafts sound like THEM and not like a robot.

- [ ] The client types **"let's set up my rules"** in a chat. Wingguy runs the whole interview
      itself - there's nothing for you to do.
- [ ] This is deliberately the first real experience: it needs no calendar, no email, nothing else
      connected. It's the "wow, this thing gets me" moment. Let it land before pushing on.

---

## Step 3 - Connect their calendar (client, 5 minutes + your verification)

**What this is:** Wingguy needs to see the client's calendar to do its core job - offering
meeting times that are genuinely free, and never double-booking them.

- [ ] **Google or Outlook calendar:** they click a connect link and approve access on a standard
      permission screen. (Behind the scenes this goes through a service called Nylas - the client
      just sees a normal "allow access" page.)
- [ ] **Zoho calendar:** they use their special link:
      `/auth/zoho/start?clientId=` their client ID `&token=` their Portal Token.

**⚠ Trap - the wrong-account trap (this one bit Julian).** When the client clicks the connect
link, the permission screen belongs to **whoever is currently logged in on that browser**. Julian
was logged into his personal Zoho account, so Wingguy got connected to his personal calendar -
which was empty - instead of his work one. The result looked like a bug ("Wingguy says I have no
events") but was really the wrong account. **The fix is one sentence to the client:** "before you
approve, check the permission screen shows your WORK email - if it doesn't, use a private/incognito
window and try again." Re-clicking the link is always safe. Check this on EVERY client, every time.

- [ ] **Turn on multi-calendar.** On their Master Clients row, set **Calendar Read IDs** to the
      word **`all`**. Plain English: most people have more than one calendar (work, personal,
      family). This setting makes Wingguy check every one of them before offering a time - so a
      dentist appointment on their personal calendar blocks that slot just like a work meeting
      would. Without it, "Wingguy will never double-book you" isn't really true.
- [ ] **Calendar Write ID** - leave it **blank** for almost everyone. Blank means "when Wingguy
      books a meeting, put it on their main (default) calendar", which is what people expect.
      You'd only fill this in for the rare client who wants bookings landing on some other
      specific calendar.

**How to check it worked** (ask Claude to run these against the live server):

- [ ] `scripts/wingguy-list-calendars.js` + their client ID - shows every calendar in the account
      they connected, with the default one marked. Eyeball it: does this look like their real
      account? (One lonely near-empty calendar can be the wrong-account trap again.)
- [ ] `scripts/wingguy-multi-calendar-check.js` + their client ID - the full health check:
      settings, calendars, availability and this week's events, all read-only.
- [ ] Best check of all: the client asks Wingguy **"what's on my calendar this week?"** and
      confirms it matches reality - including the things they know are on their personal calendar.

---

## Step 4 - The meeting link conversation (you + client on a call, 5 minutes)

**What this is:** when Wingguy books a meeting for the client, the invite needs a "join the call
here" link. Our policy is simple: **one reusable personal meeting link, on every invite,
automatically.** We deliberately do NOT create a fresh link for every meeting - one link that
never changes is simpler, can't fail, and makes back-to-back call days painless (everyone comes
through the same door).

The conversation, in order:

1. Ask: **"Do you have a personal meeting link?"** Zoom users may know it as their Personal
   Meeting Room or PMI. Google Meet and Microsoft Teams users can create a reusable link too -
   many just don't know that.
2. If no: **"Let's create one now."** It's about two minutes in any of the three platforms, and
   you're on a call with them anyway - do it together.
3. The sell (in your words): one link, on every invite, automatically. Leads just click and away
   we go. Nothing to generate, nothing to forget, nothing to break.
4. While they're in their settings: turn on the **waiting room** (Zoom) or **"ask to join"**
   (Meet/Teams). Because the link never changes, anyone who has it could knock at any time - the
   waiting room means a lead running late can't wander into the next call.
5. Paste the link into the **Meeting Link** field on their Master Clients row.

**⚠ Trap - do not skip this step.** If Meeting Link is blank, every invite Wingguy books goes out
with NO way to join the call. Nobody notices until a lead is sitting there at meeting time with
nothing to click. Catch it here, on the onboarding call - not after the first real booking.

- [ ] While you're on their row anyway: fill in their **LinkedIn URL** and **Phone** if they're
      empty - those go on the invite too, so leads can reach them.

---

## Step 5 - Connect their email (client + you)

**What this is:** connecting their mailbox lets Wingguy draft emails as them - and this unlocks a
whole family of abilities at once: clean email drafts (no mangled links), replies that thread
properly into existing conversations, "show me my email history with this lead", "has this lead
replied since I sent that?", and the guard that stops the same document being sent to the same
lead twice.

- [ ] **Gmail or Outlook:** same easy pattern as the calendar - click, approve on a permission
      screen, done.
- [ ] **Zoho mail (Julian's case):** Zoho doesn't support the easy click-and-approve route for
      mail, so it's a slightly more manual one-off: the client creates an "app-specific password"
      in their Zoho settings (a special password just for this connection - their real password is
      never shared), and we use it to set up the connection for them.
- [ ] Success looks like: a value appearing in **Nylas Grant ID** on their row.

**Worth knowing (Zoho/app-password connections only):** for these, the connection service keeps
roughly the last 90 days of mail instantly available. Asking about older mail still works -
Wingguy automatically goes back to the mailbox the slow way - so the first deep-history question
may take noticeably longer. That's normal, not broken.

**How to check it worked:** the client asks Wingguy to find a recent email from a sender they
know. Then have them ask for the full text of it.

---

## Step 6 - Fathom, the meeting recorder (client + you)

**What this is:** Fathom records and transcribes their calls. Once it's connected, Wingguy can
use what was actually said in meetings - follow-ups that reference the conversation, and so on.

- [ ] The client signs up for Fathom (Julian has already done this on the free plan) and gets an
      **API key** from their Fathom settings - a code that lets Wingguy fetch their transcripts.
- [ ] The key goes in the **Fathom API Key** field on their row.

**⚠ Two things to check BEFORE promising this works:**

1. Does their Fathom plan actually include an API key? (Unconfirmed whether the free plan does -
   check their account before setting expectations.)
2. Our Fathom plumbing was built for one user - you. Getting it working for a second client will
   probably need a development session first. Don't promise dates until that's been looked at.

---

## Step 7 - Close-out (you + client, 10 minutes)

The victory lap - prove the whole chain works end to end.

- [ ] Have them disconnect and reconnect the Wingguy connector, then start a fresh chat. (This
      picks up any new abilities shipped since they first connected - see the step 1 trap.)
- [ ] **The full dress rehearsal:** the client asks Wingguy to offer times for a real lead → picks
      one and books a test meeting → the invite arrives → **open it and confirm the meeting link
      is on it** → cancel the test meeting together.
- [ ] Sanity-check their booking rules: their booking hours, lunch break, how many meetings a day
      they prefer, and their standard meeting length. These all have defaults - confirm the
      defaults actually match how this client works, and adjust if not.

Done. They're live.
