# The concierge run sheet - onboarding a client myself, in one sitting

This is the run sheet for the client who is not technical and would rather I did it: I log into
their computer over Splashtop and do the whole setup in about an hour. They are there for the
first twenty minutes - three things need their card or their passwords - and the last five.
Everything in between is me at their keyboard. Plumbing first, all of it, then the instructions
call, then the first campaign.

It is written for me to follow, step by step, in plain English. `node scripts/run-sheet.js
<Client-ID> --mint` turns it into a page with the client's own links already filled in and a
box to tick beside each step; the same file is what Claude reads when I say "I'm onboarding
Alex, I'm up to step 6, I don't get this" in any chat. The standard week-by-week journey is
`docs/wingguy-onboarding-checklist.md` - this sheet points into it and never repeats it.

Who types what, on the day: I drive their machine over Splashtop. When a screen asks for their
card or a password, I take my hands off and say "type it now" - they type on their own keyboard,
I watch it go through, and I carry on. I never type a client's card or password, and I never
ask them to read one out.

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
- Own key or managed plan decided. This sheet assumes their own key (step 4). Managed Claude Key = Yes means step 4 disappears.

Worked when: The record line below says DONE with their timezone in it.

## Step 2 - Pre-session answers in

Phase: Before the call
Who: You alone

Do:
- Which email address Wingguy works from. It decides which account has to be at the top of the approval screen.
- Any call recorder already in use. Own machine or company-managed. Windows or Mac.
- Tell them to have their credit card next to them for the first twenty minutes - two small sign-ups need it - and to be signed in to Claude, their email and LinkedIn in the browser they normally use.
- Make this page the same day as the session - the calendar-and-mail link inside it only lasts a day.

Watch: Mac - the installer script is unproven on a real Mac. Plan a slower extension step and expect to do it by hand.

## Step 3 - Remote access on

Phase: The session
Who: runs one file, reads you a code
Minutes: 3

Say: I'll drive your screen for the next hour. You're here for the first twenty minutes, because a couple of sign-ups need your card, then you can go and do something else. I'll call you back for the last five.

Do:
- Send the Splashtop link in the Zoom chat. They run the file and read you the code.
- Install the unattended streamer so you can get in later without them.
- Ask them to confirm they're signed in to Claude, their email and LinkedIn in this browser.

Worked when: You can move their mouse. This is the only technical thing they do all day.

## Step 4 - Their own Claude key

Phase: The session
Who: types their card details, nothing else
Minutes: 10
Proves: 11

Say: There's one bit of the AI that works for you while you're asleep, and your LinkedIn drafting runs on our servers too. That runs on a key that's yours - you put a monthly cap on it, and the worst case in the whole world is a bill the size of the cap. I'll set it up, you just put your card in.

Do:
- On their screen, open console.anthropic.com. Create the account with their email - it's separate from their claude.ai login even if it's the same address. Their password to type, not yours.
- Billing: add a payment method. Hands off - they type the card. A small starting credit is plenty. The API is pay-as-you-go; their claude.ai subscription does not cover it.
- Create a workspace called Wingguy, and set a monthly spend limit on it - their number, and don't let it be skipped. This is what makes the whole thing safe.
- Create an API key inside that workspace. It's shown once. Paste it straight into your chat with Claude: "store this key for <client>". Claude puts it on the record and confirms it masked. Never via Zoom chat, never typed by hand into Airtable.
- Then, and only then, Followup Brief = Yes on the record.

Worked when: Claude confirms the key stored, masked, and the record line below says DONE.

Watch: A key with no credit behind it is a dead key. If the account already existed, check it has money on it before moving on.

## Step 5 - Their rented computer, bought

Phase: The session
Who: types their card details, nothing else
Minutes: 3

Say: This is the small computer in a data centre that Linked Helper will run on instead of your laptop. About $20 a month, on your card, cancel any time. I build it later today and I mind it. You never open it.

Do:
- On their screen, open binarylane.com.au, Linux VPS. Sign up with their name and email - you type those.
- Pick the 2 vCPU / 4 GB / 60 GB plan, about $20 a month. City: whichever Australian city is nearest them, all the same price. Operating system: the newest Ubuntu LTS offered. Name it lh-<client-id>, for example lh-alex-solti.
- In the SSH key box, paste the wg_clients public key: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMHSFmW3Yds7YTIVRUK+1Bz1P0YfmNX8JoYQT34LIy73 wingguy-client-machines. If they have a key of their own, add it alongside - it's their machine.
- Card: hands off, they type. Note the machine's address from the confirmation screen for step 15.

Worked when: Binary Lane shows the machine running and you have its address. Nothing else happens on it today.

Watch: Their machine has to be in the same country as them - LinkedIn notices an account that is in two places at once. Never put Guy's own production key on a client machine, only the wg_clients one.

## Step 6 - Wingguy into their Claude

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

## Step 7 - Calendar and mailbox, one click

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

## Step 8 - Prove calendar and mail, then they can go

Phase: The session
Who: says "yes, that's my week", then leaves you to it
Minutes: 4
Proves: 3, 5

Do:
- In their chat type: what's on my calendar this week? They check it against reality, including something personal.
- Then: find a recent email from [someone they name]. Then: read me the whole thing.
- That's their twenty minutes done. Tell them you'll call them back for the last five, and carry on alone.

Say: That's Wingguy reading your diary and your mail. Now you know what it can see. Go and do something else - I'll shout when I need you.

Worked when: They've confirmed both. Don't move on until they have - they're the only one who can.

## Step 9 - Their meeting link

Phase: The session
Who: away
Minutes: 3
Proves: 4

Do:
- If they have a personal Zoom link, paste it into their settings page.
- If not, create one and turn on the waiting room. Ask them about it when they're back.

Worked when: The link is on their record. Every invite Wingguy books carries it.

## Step 10 - Extension installed and proven

Phase: The session
Who: away
Minutes: 8
Link: installer
Proves: 9, 10

Do:
- Open PowerShell on their machine, not as administrator. Paste the installer line. It reports the daily task, the login run and the version on disk.
- Chrome or Edge extensions page. Developer mode on. Load unpacked. Pick C:\Wingguy.
- Open the portal link once in this browser. That's how the extension knows who they are. Skip it and a good install looks broken.
- Open a LinkedIn profile of someone they'd genuinely reach out to. Type /wg. The panel appears and drafts - their key from step 4 is what makes it draft.

Worked when: The panel appears on a real profile, on their machine, and drafts. The version on the card matches what shipped.

Watch: Fiddliest step in the journey - that's why you drive it.

## Step 11 - Dress rehearsal

Phase: The session
Who: away
Minutes: 8
Proves: 8

Do:
- In their chat: offer [a real lead] some times next week.
- Book a test meeting with you as the guest. The invite lands in your inbox with their join link on it.
- Cancel it.

Worked when: The invite arrived with their link. They're now live in chat.

## Step 12 - Meeting recorder

Phase: The session
Who: away, unless a key needs their login
Minutes: 5
Proves: 7

Do:
- Granola: needs their Business plan for the key. Create the key in their Granola settings, paste it on the record, Claude registers the webhook.
- Already on Fireflies? That lane is proven. Straight swap, secret on the record before their side is saved.
- No recorder yet? Leave it for the instructions call and say so in the wrap email.

Watch: Calendar before recorder, always. Wingguy works out who a meeting was with from the calendar.

## Step 13 - Call them back: the draft, and the next date

Phase: The session
Who: back for five minutes - reads the draft, agrees a time
Minutes: 5
Proves: 12

Say: Two moments will sell this to you. "Draft the follow-up from the call I just had." And before the next one, "prep me for my meetings." And here's the LinkedIn one.

Do:
- Show them the /wg draft from step 10 on someone they know. Say: that's a starting point, not an oracle - your edit is what teaches it.
- Book the instructions call. Twenty minutes, a few days out. Together, not homework. They talk, Wingguy types.
- Tell them the rented computer gets built today and Linked Helper comes last, once everything is proven. Their side is topping up campaigns.

Worked when: The next call is in both diaries before you hang up.

## Step 14 - Wrap the sitting

Phase: After the call
Who: You alone

Do:
- Send the wrap email: what got done, the instructions call date, and what comes next in one line each.
- Log anything owed on the board - yours under "You owe", theirs under "They owe".
- Update their memory file with what was proven and what is still open.

Worked when: What they never had to do - create anything alone, connect a cloud folder, download or unzip anything, remember a setting, or come back to a page.

## Step 15 - Build their machine

Phase: After the call
Who: You alone, same day

Do:
- One command on the fresh machine from step 5, scripts/linked-helper/setup-ubuntu-vps.sh, installs Linked Helper, remote access, the watchdog that restarts it, the nightly backup and the nightly reboot. Pass the Tailscale auth key, the rclone token and the machine report secret. Full detail: docs/linked-helper-machine-setup.md, Part 5.
- It joins Tailscale by name, lh-<client-id>, and reports its own health onto their record every five minutes.
- Set the two fields the machine can't fill in itself: Remote Access Method = Tailscale RDP, Remote Access Consent Date = the date of the sitting. Everything else about the machine writes itself.

Worked when: Their record shows Machine Status and Machine Last Seen filling in by themselves, and stopping Linked Helper by hand brings it back within a few minutes.

## Step 16 - The instructions call, and LinkedIn onto the machine

Phase: After the call
Who: talks, Wingguy types; then signs into LinkedIn once
Minutes: 30
Proves: 6

Say: This is the twenty minutes that makes everything it writes sound like you and not like a robot.

Do:
- A few days after the sitting. They open a chat and type: let's set up my rules.
- You sit with them through the interview - their voice, their offer, what they'd never say. Together, not homework. An Alex never does homework.
- Start the targeting conversation while you're there: who are they looking for, and how would they find them. It threads through everything from here.
- Last ten minutes: you open the machine's screen, they sign into LinkedIn on it - their password and any code to their phone are theirs to type - and you put in their Linked Helper licence. Pro, annual, one licence per LinkedIn account, with the promo code.
- A recorder left over from step 12 gets sorted here.

Worked when: Ask Wingguy to draft a reply to a real message and they say "that sounds like me". And LinkedIn is signed in on the machine.

## Step 17 - First campaign, and then it's theirs

Phase: After the call
Who: watches, then owns it
Minutes: 30
Proves: 14

Say: From here your side of Linked Helper is topping up the campaign when it runs low and having a look at how it's going. Yours lasted months last time.

Do:
- Only once everything above is proven and their targeting has settled. Nothing is lost by waiting - the Linked Helper trial only starts when the first campaign launches.
- Build campaign 1 together from the targeting conversation - the standard campaigns go in by script - and prove the webhook: a connection lands in their database, scored overnight.
- Show them the one thing they do from here: open Linked Helper, top up the campaign, glance at how it's going.
- Set Email Series Start Date to today and Coaching Status to Graduated. The weekly drumbeat hands over to the email series.
- Point your people at them, as promised. That's where their referrals come from.

Worked when: New people appear in their database without anyone touching the laptop, and they can tell you how the campaign is going without asking you.
