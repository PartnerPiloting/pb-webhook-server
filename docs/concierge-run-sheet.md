# The concierge run sheet - onboarding a client myself, in one sitting

This is the run sheet for the client who is not technical and would rather I did it: I log into
their computer over Splashtop and do the whole setup in about forty minutes. They are there for
the first five minutes and the last five. Everything in between is me at their keyboard.

It is written for me to follow, step by step, in plain English. `node scripts/run-sheet.js
<Client-ID> --mint` turns it into a page with the client's own links already filled in and a
box to tick beside each step; the same file is what Claude reads when I say "I'm onboarding
Alex, I'm up to step 6, I don't get this" in any chat. The standard week-by-week journey is
`docs/wingguy-onboarding-checklist.md` - this sheet points into it and never repeats it.

Format, for the generator: each `## Step N - Title` block has `Phase:`, `Who:`, optional
`Minutes:`, optional `Link:` (connector | unipile | installer | none), optional `Proves:` (the
checklist step numbers the live preflight uses to mark it DONE), optional `Say:`, a `Do:` list,
optional `Worked when:` and optional `Watch:`. Keep that shape.

## Step 1 - Check the record

Phase: Before the call
Who: You alone
Proves: 0

Do:
- They paid on the join page, so the record, their secret key, their leads base and the welcome draft already exist. Send the welcome email.
- Timezone on the record is theirs. Provisioning writes Brisbane flat, and every meeting time Wingguy ever offers comes from this field.
- Own key or managed plan decided. Managed Claude Key = Yes means there is no console step at all.

Worked when: The record line below says DONE with their timezone in it.

## Step 2 - Pre-session answers in

Phase: Before the call
Who: You alone

Do:
- Which email address Wingguy works from. It decides which account has to be at the top of the approval screen.
- Any call recorder already in use. Own machine or company-managed. Windows or Mac.
- Make this page the same day as the session - the calendar-and-mail link inside it only lasts a day.

Watch: Mac - the installer script is unproven on a real Mac. Plan a slower extension step and expect to do it by hand.

## Step 3 - Remote access on

Phase: The session
Who: runs one file, reads you a code
Minutes: 3

Say: I'll drive your screen for about half an hour. You watch, and say yes to a couple of things.

Do:
- Send the Splashtop link in the Zoom chat. They run the file and read you the code.
- Install the unattended streamer so you can get in later without them.
- Ask them to confirm they're signed in to Claude, their email and LinkedIn in this browser.

Worked when: You can move their mouse. This is the only technical thing they do all day.

## Step 4 - Wingguy into their Claude

Phase: The session
Who: watches
Minutes: 2
Link: connector
Proves: 1

Do:
- In their Claude: Customize, then Connectors, then Add custom connector. Name it Wingguy, paste the connector link.
- New chat. Type: what can I do with Wingguy?

Say: That's Wingguy living inside your own Claude now. From here you just talk to it in any chat.

Worked when: Wingguy introduces itself and lists what it can do.

## Step 5 - Calendar and mailbox, one click

Phase: The session
Who: glances at the email address, says "that's the one"
Minutes: 2
Link: unipile
Proves: 2

Do:
- Paste the approval link into their browser. The permission screen comes up.
- Before you click approve, ask them to read out the email address at the top. Wrong account? Redo it in a private window.
- Click approve. A Google or Microsoft password prompt is theirs to type, never yours.

Worked when: The record sets itself the moment they approve - account id, both providers, every calendar read. Nothing to type onto the row. If you want to see it, ask Claude for a fresh preflight.

Watch: The link on this page was minted when the page was made and lasts a day. If it has gone stale, ask Claude to mint a fresh one - it takes a second.

## Step 6 - Prove calendar and mail

Phase: The session
Who: says "yes, that's my week"
Minutes: 4
Proves: 3, 5

Do:
- In their chat type: what's on my calendar this week? They check it against reality, including something personal.
- Then: find a recent email from [someone they name]. Then: read me the whole thing.

Say: That's Wingguy reading your diary and your mail. Now you know what it can see.

Worked when: They've confirmed both. Don't move on until they have - they're the only one who can.

## Step 7 - Their meeting link

Phase: The session
Who: watches
Minutes: 3
Proves: 4

Do:
- If they have a personal Zoom link, paste it into their settings page.
- If not, create one with them now and turn on the waiting room.

Worked when: The link is on their record. Every invite Wingguy books carries it.

## Step 8 - Extension installed and proven

Phase: The session
Who: watches, then reads the draft
Minutes: 8
Link: installer
Proves: 9, 10

Do:
- Open PowerShell on their machine, not as administrator. Paste the installer line. It reports the daily task, the login run and the version on disk.
- Chrome or Edge extensions page. Developer mode on. Load unpacked. Pick C:\Wingguy.
- Open the portal link once in this browser. That's how the extension knows who they are. Skip it and a good install looks broken.
- Open a LinkedIn profile of someone they'd genuinely reach out to. Type /wg. The panel appears and drafts.

Say: That's a starting point, not an oracle. Your edit is what teaches it.

Worked when: The panel appears on a real profile, on their machine, and the version on the card matches what shipped.

Watch: Fiddliest step in the journey - that's why you drive it. A draft only appears if their key is on the record or they're on the managed plan.

## Step 9 - Dress rehearsal

Phase: The session
Who: watches
Minutes: 8
Proves: 8

Do:
- In their chat: offer [a real lead] some times next week.
- Book a test meeting with you as the guest. The invite lands in your inbox with their join link on it.
- Cancel it together.

Worked when: The invite arrived with their link. They're now live in chat.

## Step 10 - Meeting recorder

Phase: The session
Who: watches
Minutes: 5
Proves: 7

Say: Two moments sell this. "Draft the follow-up from the call I just had." And before the next one, "prep me for my meetings."

Do:
- Granola: needs their Business plan for the key. Create the key in their Granola settings, paste it on the record, Claude registers the webhook.
- Already on Fireflies? That lane is proven. Straight swap, secret on the record before they save their side.

Watch: Calendar before recorder, always. Wingguy works out who a meeting was with from the calendar.

## Step 11 - Book the instructions call

Phase: The session
Who: agrees a time
Minutes: 2
Proves: 6

Do:
- Twenty minutes, a few days out. Together, not homework. They talk, Wingguy types.
- Mention Linked Helper comes last, on a rented computer you mind. Their side is topping up campaigns.

Worked when: It's in both diaries before you hang up.

## Step 12 - Wrap the sitting

Phase: After the call
Who: You alone

Do:
- Send the wrap email: what got done, the instructions call date, and what comes next in one line each.
- Log anything owed on the board - yours under "You owe", theirs under "They owe".
- Update their memory file with what was proven and what is still open.

Worked when: What they never had to do - create an Anthropic key alone, connect a cloud folder, download or unzip anything, remember a setting, or come back to a page.

## Step 13 - The instructions call

Phase: After the call
Who: talks, Wingguy types
Minutes: 20
Proves: 6

Say: This is the twenty minutes that makes everything it writes sound like you and not like a robot.

Do:
- A few days after the sitting. They open a chat and type: let's set up my rules.
- You sit with them through the interview - their voice, their offer, what they'd never say. Together, not homework. An Alex never does homework.
- Start the targeting conversation while you're there: who are they looking for, and how would they find them. It threads through everything from here.

Worked when: Ask Wingguy to draft a reply to a real message and they say "that sounds like me".

## Step 14 - Their Linked Helper machine, built by you

Phase: After the call
Who: there for five minutes, to sign up and sign in
Minutes: 45
Proves: 14

Say: Linked Helper wore you out last time because it lived on your laptop. From now on it lives on a small rented computer that never sleeps. I build it and I mind it. Your side is topping up campaigns and having a look at how they're going.

Do:
- Only once everything above is proven and their targeting has settled. Nothing is lost by waiting - the Linked Helper trial only starts when the first campaign launches.
- Over Splashtop, with them there: sign them up at binarylane.com.au for the Linux VPS, about $20 a month, in any Australian city, on their own account and their own card. At signup paste in the wg_clients public key, and their own key if they have one.
- Then you alone: one command on the fresh machine, scripts/linked-helper/setup-ubuntu-vps.sh, installs Linked Helper, remote access, the watchdog that restarts it, the nightly backup and the nightly reboot. It joins Tailscale by name, lh-<client-id>, and reports its own health onto their record every five minutes. Full detail: docs/linked-helper-machine-setup.md, Part 5.
- With them there again: their LinkedIn signed in on the machine - their password and any code to their phone are theirs to type - and their Linked Helper licence. Pro, annual, one licence per LinkedIn account, with the promo code.
- Set the two fields the machine can't fill in itself: Remote Access Method = Tailscale RDP, Remote Access Consent Date = today. Everything else about the machine writes itself.

Worked when: Their record shows Machine Status and Machine Last Seen filling in by themselves, and stopping Linked Helper by hand brings it back within a few minutes.

Watch: Any Australian city is fine, but the machine has to be in the same country as them - LinkedIn notices an account that is in two places at once. Never put Guy's own production key on a client machine, only the wg_clients one.

## Step 15 - First campaign, and then it's theirs

Phase: After the call
Who: watches, then owns it
Minutes: 30

Do:
- Build campaign 1 together from the targeting conversation - the standard campaigns go in by script - and prove the webhook: a connection lands in their database, scored overnight.
- Show them the one thing they do from here: open Linked Helper, top up the campaign when it runs low, glance at how it's going. Theirs lasted months last time, so that's not much of a job.
- Set Email Series Start Date to today and Coaching Status to Graduated. The weekly drumbeat hands over to the email series.
- Point your people at them, as promised. That's where their referrals come from.

Worked when: New people appear in their database without anyone touching the laptop, and they can tell you how the campaign is going without asking you.
