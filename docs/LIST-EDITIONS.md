# Network building, rethought - the weekly email to Guy's list

Designed with Guy in chat on 26 Oct 2026. Code: `services/listEditions.js`. Tests: `node tests/list-editions.test.js`.

## What it does

One email a week to the people Guy has enjoyed talking with - prospects, not clients. It keeps him in front of
them without chasing anyone one by one, and an unsubscribe tells him where he stands.

- **The list** = leads tagged `mindset mastery` in Guy's CRM (it revives the old Mindset Mastery list) plus anyone
  added with the **Weekly** button on the Today tab (Waiting on you, Worth picking up again, Reconnect) or with
  `wingguy_list_edition action=add`. The button also takes them off the chase list - the weekly email becomes the
  touch - and a reply still brings them back to the top.
- **Left off every week:** active clients (they have their own weekly email), anyone tagged `unsubscribed`, addresses
  that bounced in the last 30 days, Guy himself.
- **The launch (Wed 4 Nov 2026) and every newcomer's first email** is the fixed "What does better mean?" piece. Old
  Mindset Mastery readers get "Mindset Mastery is back, with a new name..." on top; Weekly-button adds and later
  newcomers get "I'm starting a short weekly email for people I've enjoyed talking with...".
- **Every edition after that:** one idea from the idea library (`content/inspiration-library.json`), told through
  network building - a moment people recognise, the idea in Guy's words, what is different now, one thing to try -
  then the fixed closer ("What would a better network mean for you..." with the I Know A Guy link), "Cheers / (I know
  a) Guy", a P.S. credit when the idea is Beth Berghan's, and the reply-"unsubscribe" line. No header block. Subject
  "Network building, rethought - <title>" (a different title each week, so editions never thread together).
- **Which idea:** Who Not How first (it follows on from the launch piece), then best-rated, books and Beth in turn.
  Never one the list has had. Guy's own Mindset Mastery editions are left out - most of the old list has had them.
  No fixed plan: Guy sees the next two coming up and can swap either.
- **Same content for everyone** that week except the name - so Guy reviews ONE email, never 200.

## The week

| When (Brisbane) | What happens |
| --- | --- |
| From the Saturday before | The edition is written and waits for Guy |
| Any time before Wednesday noon | Guy approves - in chat (it comes first in "let's do this week's emails"; tool `wingguy_list_edition`) or on the portal's Scheduled page (Approve / Edit / Send me a test / Hold this week) |
| Monday 3pm | One nudge email to Guy if it is still not approved |
| Wednesday 9:30am | It goes, one email per person, 20 every 5 minutes |
| When the last one has gone | A summary to Guy: how many sent, who was left off and why |

Not approved by Wednesday noon = it does not go that week (status `missed`).

## Sending

From `guy@knowaguy.com.au` through Mailgun (`services/mailgunCreds.js`), Reply-To Guy's own mailbox, so ~250 sends a
week never land in his Gmail Sent folder (Guy, 26 Oct). Each send is recorded per person in `list_sends`. A
`List-Unsubscribe` header points at a reply to Guy.

Switches: `LIST_EDITION_SEND=off` (or `SCHEDULED_SEND_ENABLED=off` / `CLIENT_TOUCH_SEND_ENABLED=off`, as on staging)
holds sending; `LIST_EDITION_TICK=off` stops the whole thing; `LIST_EDITION_LAUNCH` moves the first Wednesday.

## Unsubscribes

Three ways off, all automatic, and each one emails Guy a line ("Sam unsubscribed from Network building,
rethought") - Guy, 31 Oct 2026, replacing the 17 Sep "no link" decision made for the old GMass newsletter:

- **The footer link** ("unsubscribe here"): one unguessable token per send (`list_sends.unsub_token`), served by the
  shared `/series/unsubscribe` route on knowaguy.com.au (`routes/marketingRoutes.js`), no login, no confirm.
- **Gmail's own Unsubscribe button**: `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` point at the same link.
  The mailto fallback in that header has the subject "Unsubscribe - Network building, rethought", which the watcher
  takes as an unsubscribe whatever the body says.
- **A reply**: every hour the watcher reads replies in Guy's mailbox. One that is only an unsubscribe ("Unsubscribe",
  "Please remove me") counts; anything longer is a normal reply for Guy.

Each one is recorded in `list_members` (source `unsubscribed`) first, so the address is left off every send even if
the tag swap on the lead fails; then `mindset mastery` comes off and `unsubscribed` goes on. A reply from an address
no lead has gets Guy a note saying so - the list may still mail them at another address.

Test copies carry a working link that shows the page and takes nobody off (`list_state` key `unsub:test:<token>`).

## Tables

`list_editions` (one row per Wednesday), `list_sends` (one row per person per edition), `list_members` (who came
by the Weekly button, who unsubscribed), `list_state`.
