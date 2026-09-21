# The concierge run sheet - Guy sets a client up, in one sitting, with both of them looking at it

This is the run sheet for the client who is not technical and would rather Guy did it. Guy logs
into their computer over Splashtop and does the whole setup in about an hour. The client is there
for the first twenty-five minutes - a few things need their card or their passwords - then they
leave Guy to it and are not needed again that day.

It is written to be read by BOTH people on a shared screen, so it names them: "Guy" is the coach,
`{{first}}` becomes the client's first name when the page is made. Plain English, one job per
line, and every step says who does what. Nothing on it should embarrass anyone or need
explaining. `node scripts/run-sheet.js <Client-ID> --mint` makes the page with the client's own
links in it; the same file is what Claude reads when Guy says "I'm onboarding Alex, I'm up to
step 6, I don't get this" in any chat. The standard week-by-week journey is
`docs/wingguy-onboarding-checklist.md` - this sheet points into it and never repeats it.

The one rule on the day: Guy drives. When a screen asks for a card or a password, Guy takes his
hands off and says "type it now" - the client types on their own keyboard and Guy carries on.
Guy never types a client's card or password, and never asks them to read one out.

Format, for the generator: each `## Step N - Title` block has `Phase:`, `Who:` (the client's
part, or "Guy alone"), optional `Minutes:`, optional `Link:` (connector | unipile | installer |
none), optional `Proves:` (the checklist step numbers the live preflight uses to mark it DONE),
`Why:` (one plain line on what the step does for the client), a `Do:` list (start each line with
who does it), optional `Worked when:` and optional `Watch:`. Keep that shape.

## Step 1 - Guy checks the record

Phase: Before the call
Who: Guy alone
Proves: 0

Why: Behind the scenes there is a row with {{first}}'s name on it - status, timezone, secret access key. Everything else hangs off it.

Do:
- Guy: {{first}} paid on the join page, so the record, the key, the leads base and the welcome draft already exist. Send the welcome email.
- Guy: check the timezone on the record is {{first}}'s. Every meeting time Wingguy ever offers comes from this field.
- Guy: confirm the plan - this sheet assumes {{first}} runs on their own Claude key (step 4).

Worked when: The record line below says DONE with {{first}}'s timezone in it.

## Step 2 - {{first}}'s answers are in

Phase: Before the call
Who: Guy alone

Why: A few answers from {{first}}'s reply decide how the session goes. They're listed at the top of this page.

Do:
- Guy: which email address Wingguy works from. It decides which account has to be at the top of the approval screen.
- Guy: any call recorder already in use, own machine or company-managed, Windows or Mac.
- Guy: {{first}} has been asked to have a credit card handy for the first twenty-five minutes, and to be signed in to Claude, email and LinkedIn in the usual browser.
- Guy: make this page the same day as the session - the calendar link inside it only lasts a day.

Watch: Mac - the installer is unproven on a real Mac. Plan a slower extension step and expect to do it by hand.

## Step 3 - Guy takes the wheel

Phase: The session - {{first}} is here
Who: runs one small file and reads out a code
Minutes: 3

Why: For the next hour Guy drives {{first}}'s computer. {{first}} watches, types a card number or a password when asked, and otherwise relaxes.

Do:
- Guy: send the Splashtop link in the Zoom chat.
- {{first}}: click it, run the file it downloads, and read out the code on the screen.
- Guy: connect, and install the unattended streamer so later fixes never need {{first}} at all.
- {{first}}: confirm you're signed in to Claude, your email and LinkedIn in this browser.

Worked when: Guy can move the mouse. That's the only technical thing {{first}} does all day.

## Step 4 - {{first}}'s own Claude key

Phase: The session - {{first}} is here
Who: types a card number, nothing else
Minutes: 10
Proves: 11

Why: Some of Wingguy's work happens on Guy's servers while {{first}} is asleep - the overnight follow-ups, the LinkedIn drafting. That runs on a key that belongs to {{first}}, with a monthly cap {{first}} chooses. Worst case in the whole world is a bill the size of the cap.

Do:
- Guy: open console.anthropic.com and create the account with {{first}}'s email. It's separate from the Claude login even if it's the same address.
- {{first}}: type a password for it.
- Guy: go to Billing, add a payment method.
- {{first}}: type the card details. A small starting credit is plenty - it's pay as you go.
- Guy: create a workspace called Wingguy, and set a monthly spend limit on it. Ask {{first}} for the number. Don't skip this - it's what makes the whole thing safe.
- Guy: create an API key inside that workspace. It's shown once. Paste it straight into your chat with Claude: "store this key for {{first}}". Claude puts it on the record and confirms it masked.
- Guy: then, and only then, switch Followup Brief to Yes on the record.

Worked when: Claude confirms the key is stored, and the record line below says DONE.

Watch: A key with no credit behind it is a dead key. If the account already existed, check it has money on it before moving on.

## Step 5 - {{first}}'s rented computer, bought

Phase: The session - {{first}} is here
Who: types a card number, nothing else
Minutes: 3

Why: Linked Helper wore {{first}} out last time because it lived on the laptop. From now on it lives on a small computer in a data centre that never sleeps. About $20 a month, on {{first}}'s card, cancel any time. Guy builds it later today and minds it. {{first}} never opens it.

Do:
- Guy: open binarylane.com.au, Linux VPS. Sign up with {{first}}'s name and email.
- Guy: pick the 2 CPU / 4 GB / 60 GB plan, about $19.60 a month before GST. City: any Australian one - {{first}}'s own if it is on the list, they all cost the same. Operating system: the newest Ubuntu **LTS** offered - not a newer non-LTS. Hostname: **linkedinhelper**, the same as the playbook topic tells clients, so every machine is named alike.
- Guy: in the SSH key box paste the wg_clients public key: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMHSFmW3Yds7YTIVRUK+1Bz1P0YfmNX8JoYQT34LIy73 wingguy-client-machines. If {{first}} has a key of their own, add it alongside - it's their machine.
- {{first}}: type the card details.
- Guy: note the machine's address from the confirmation screen for step 15. Nothing else happens on it today.

Worked when: Binary Lane shows the machine running and Guy has its address.

Watch: The machine must be in the same country as {{first}} - LinkedIn notices an account that seems to be in two places at once. Only the wg_clients key goes on a client machine, never Guy's own production key.

## Step 6 - Wingguy moves into {{first}}'s Claude

Phase: The session - {{first}} is here
Who: watches
Minutes: 2
Link: connector
Proves: 1

Why: Wingguy lives inside {{first}}'s own Claude. No new program to learn - from here {{first}} just talks to it in any chat.

Do:
- Guy: in {{first}}'s Claude open Customize, then Connectors, then Add custom connector. Name it Wingguy and paste the connector link below.
- Guy: start a new chat and type: what can I do with Wingguy?
- {{first}}: read what comes back. That's Wingguy introducing itself.

Worked when: Wingguy introduces itself and lists what it can do.

## Step 7 - Calendar and mailbox, one click

Phase: The session - {{first}} is here
Who: reads out the email address on the screen, types a password if asked
Minutes: 2
Link: unipile
Proves: 2

Why: One approval connects both the calendar and the mailbox. Then Wingguy can offer people times {{first}} is genuinely free, book the meeting, and draft emails as {{first}}.

Do:
- Guy: paste the approval link below into {{first}}'s browser. The permission screen comes up.
- {{first}}: read out the email address at the top of that screen. It has to be the work one.
- Guy: if it's the wrong account, close it and open the link again in a private window.
- Guy: click approve.
- {{first}}: if Google or Microsoft asks for a password, type it.
- Guy: nothing to type onto the record - it fills itself in the moment {{first}} approves.

Worked when: The permission screen says done, and a fresh check shows the record connected.

Watch: The link on this page was made when the page was made and lasts a day. If it has gone stale, ask Claude for a fresh one - it takes a second.

## Step 8 - {{first}} checks it can see the week

Phase: The session - {{first}} is here
Who: looks at the week on the screen and says "yes, that's mine"
Minutes: 4
Proves: 3, 5

Why: Before going any further, {{first}} sees Wingguy read the real diary and the real mail. That's the moment it stops being a demo.

Do:
- Guy: in {{first}}'s chat type: what's on my calendar this week?
- {{first}}: check it against reality, including something personal. Say "yes, that's my week" or say what's missing.
- Guy: then type: find a recent email from [someone {{first}} names]. Then: read me the whole thing.
- {{first}}: confirm that's the real email.

Worked when: {{first}} has said yes to both. Only {{first}} can.

## Step 9 - Book the next call, then {{first}} can go

Phase: The session - {{first}} is here
Who: agrees a time, then leaves Guy to it
Minutes: 3

Why: There's one more call a few days from now - twenty minutes where Wingguy learns how {{first}} talks. After that everything it writes sounds like {{first}}, not a robot. Book it now while both diaries are open.

Do:
- Guy: offer two or three times a few days out. Twenty minutes. It's a conversation, not homework.
- {{first}}: pick one.
- Guy: put it in both diaries.
- Guy: tell {{first}} what happens next - the rest of today's setup is Guy alone, the rented computer gets built this afternoon, and a wrap-up email lists what got done.
- {{first}}: that's you done for today. Leave the computer on and signed in, and go and do something else.

Worked when: The next call is in both diaries and {{first}} has gone.

## Step 10 - {{first}}'s meeting link

Phase: The session - Guy alone
Who: Guy alone
Minutes: 3
Proves: 4

Why: Every invite Wingguy sends needs a "click here to join" link. One personal link, on every invite, automatically.

Do:
- Guy: if {{first}} has a personal Zoom link, paste it into the settings page.
- Guy: if not, create one and turn on the waiting room. Mention it in the wrap email.

Worked when: The link is on the record.

## Step 11 - Wingguy inside LinkedIn

Phase: The session - Guy alone
Who: Guy alone
Minutes: 8
Link: installer
Proves: 9, 10

Why: This is the piece that puts Wingguy on any LinkedIn profile. It updates itself from Guy's server every night, so nothing ever reaches {{first}} as a download.

Do:
- Guy: open PowerShell on the machine, not as administrator. Paste the installer line below. It reports the daily task, the login run and the version on disk.
- Guy: open the Chrome or Edge extensions page. Developer mode on. Load unpacked. Pick C:\Wingguy.
- Guy: open the portal link below once in this browser. That's how the extension knows it's {{first}}. Skip it and a good install looks broken.
- Guy: open a LinkedIn profile of someone {{first}} would genuinely reach out to. Type /wg. The panel appears and drafts - the key from step 4 is what makes it draft.

Worked when: The panel appears on a real profile and drafts. The version on the card matches what shipped.

Watch: Fiddliest step in the journey - that's why Guy does it.

## Step 12 - Dress rehearsal

Phase: The session - Guy alone
Who: Guy alone
Minutes: 8
Proves: 8

Why: Prove the whole chain once: offer times, book a meeting, the invite arrives with {{first}}'s link on it.

Do:
- Guy: in {{first}}'s chat type: offer [a real lead] some times next week.
- Guy: book a test meeting with yourself as the guest. The invite lands in your inbox with {{first}}'s join link on it.
- Guy: cancel it.

Worked when: The invite arrived with the right link. {{first}} is live in chat.

## Step 13 - Meeting recorder

Phase: The session - Guy alone
Who: Guy alone, unless the recorder needs {{first}}'s login
Minutes: 5
Proves: 7

Why: Once calls are recorded, {{first}} can say "draft the follow-up from the call I just had" and "prep me for my meetings". Nobody expects this one until they've felt it.

Do:
- Guy: on Fathom (the default)? Sign in at fathom.video with the calendar account, install the desktop app from Settings > Fathom apps (the icon in the system tray is the proof it is running - no icon, no recordings), then Settings > API Access > generate a key and paste it on the record as Fathom API Key. The free plan is enough.
- Guy: Granola needs the Business plan for a key. Create the key in Granola's settings, paste it on the record, Claude registers the webhook.
- Guy: already on Fireflies? That lane is proven. Straight swap, secret on the record first.
- Guy: no recorder yet? Leave it for the instructions call, and put the six Fathom steps in the wrap email (playbook topic "Fathom - setting it up"). Signing up is not the same as being set up - the desktop app is the step people miss.

Watch: Calendar before recorder, always - Wingguy works out who a meeting was with from the calendar.

## Step 14 - Wrap the sitting

Phase: After the call
Who: Guy alone

Why: {{first}} gets one email that says what got done, when the next call is, and what happens next. Nothing to do.

Do:
- Guy: send the wrap email - what got done, the instructions call date, what comes next, one line each.
- Guy: log anything owed on the board - yours under "You owe", {{first}}'s under "They owe".
- Guy: update {{first}}'s memory file with what was proven and what is still open.

Worked when: What {{first}} never had to do - create anything alone, connect a cloud folder, download or unzip anything, remember a setting, or come back to a page.

## Step 15 - Guy builds the machine

Phase: After the call
Who: Guy alone, same day

Why: The computer bought in step 5 becomes {{first}}'s Linked Helper machine. It restarts itself, backs itself up, and tells the record how it's doing every five minutes.

Do:
- Guy: one command on the fresh machine, scripts/linked-helper/setup-ubuntu-vps.sh, installs Linked Helper, remote access, the watchdog, the nightly backup and the nightly reboot. Pass the Tailscale auth key, the rclone token and the machine report secret. Full detail in docs/linked-helper-machine-setup.md, Part 5.
- Guy: it joins Tailscale by name, lh-{{first}}, and reports its own health onto the record.
- Guy: set the two fields the machine can't fill in itself - Remote Access Method = Tailscale RDP, Remote Access Consent Date = today's date. Everything else writes itself.

Worked when: The record shows Machine Status and Machine Last Seen filling in by themselves, and stopping Linked Helper by hand brings it back within a few minutes.

## Step 16 - The instructions call, and LinkedIn onto the machine

Phase: After the call
Who: talks for twenty minutes, then signs into LinkedIn once
Minutes: 30
Proves: 6

Why: This is the twenty minutes that makes everything Wingguy writes sound like {{first}}. And it's where {{first}} sees the first LinkedIn draft.

Do:
- {{first}}: open a chat and type: let's set up my rules.
- Guy: sit with {{first}} through the interview - their voice, their offer, what they'd never say. Together, not homework.
- Guy: show {{first}} the LinkedIn draft from step 11 on someone they know. It's a starting point, not an oracle - {{first}}'s edit is what teaches it.
- Guy: start the targeting conversation - who is {{first}} looking for, and how would they find them.
- Guy: last ten minutes, open the machine's screen.
- {{first}}: sign into LinkedIn on it - your password, and any code sent to your phone.
- Guy: put in the Linked Helper licence. Pro, annual, one licence per LinkedIn account, with the promo code.
- Guy: a recorder left over from step 13 gets sorted here.

Worked when: {{first}} asks Wingguy to draft a reply to a real message and says "that sounds like me". And LinkedIn is signed in on the machine.

## Step 17 - First campaign, and then it's {{first}}'s

Phase: After the call
Who: watches, then owns it
Minutes: 30
Proves: 14

Why: From here {{first}}'s side of Linked Helper is topping up the campaign when it runs low and having a look at how it's going. New people appear in the database without anyone touching the laptop.

Do:
- Guy: only once everything above is proven and {{first}}'s targeting has settled. Nothing is lost by waiting - the Linked Helper trial only starts when the first campaign launches.
- Guy: build campaign 1 together from the targeting conversation - the standard campaigns go in by script - and prove a connection lands in the database, scored overnight.
- Guy: show {{first}} the one thing they do from here - open Linked Helper, top up the campaign, glance at how it's going.
- Guy: set Email Series Start Date to today and Coaching Status to Graduated. The weekly drumbeat hands over to the email series.
- Guy: point your people at {{first}}, as promised. That's where the referrals come from.

Worked when: New people appear in {{first}}'s database without anyone touching the laptop, and {{first}} can say how the campaign is going without asking Guy.
