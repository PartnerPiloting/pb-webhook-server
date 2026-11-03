---
slug: train-it-dont-fix-it
title: Train it, don't fix it
dek: "The goal with /wg is three moves - type /wg, click Insert, send - with almost no changes. You get there by treating every change as training for next time, not fixing this one message."
series: network-building-rethought
order: 38
status: final
audience: client - sent once the client is drafting regularly (an event)
kind: habit
stops: voice, rhythm
problems: no-time
resend: yes
event: drafting regularly - /wg used on 10+ people over 4+ days in a fortnight
teases: no
---

# Train it, don't fix it

**The goal**

The goal with /wg is three moves: type /wg, click Insert, send. Almost no changes.

That's where I am now. I rarely change a word - not because I've stopped caring, but because I trained it.

**Why the back-and-forth costs you**

When a draft isn't right, the natural thing is to tell the /wg window "warmer"... "shorter"... "drop the last line". Every one of those rounds sends the whole chat again, plus all of Wingguy's instructions, to Claude - on your own Claude key. Three rounds a person adds up fast. And it only fixes this one message. Tomorrow's draft makes the same mistake.

**Treat every change as training**

Two cheaper ways:

- **Quick - change it in LinkedIn.** Click Insert, fix the wording right there, send. Wingguy keeps what it wrote next to what you sent. Every so often, open Claude and say "review my edits" - it spots what you keep changing and turns it into an instruction. Use Insert, not copy and paste - a pasted message can't be matched to its draft.
- **Deliberate - tell Claude what you want from now on.** Paste the draft into the Claude app and say "Wingguy wrote this - in future I'd like..." That runs on your Claude subscription, not your key, and it changes the instructions, not just this one message.

Either way, you teach it once instead of correcting it every time.

**One thing for this week:** next time a draft isn't right, don't ask the window to fix it. Insert, make the change yourself, send - and at the end of the week, say "review my edits".

<!-- Approved by Guy 2026-11-04 ("Approve both" - the piece and its trigger). Came out of David Gould's ~US$190/month
bill on his own key (3 Nov 2026): about three rounds of back-and-forth per person in the /wg window, each round
re-sending the whole chat. This is the owed "Your corrections compound" piece for the voice stop.

WHEN: an event-set-off email - the first fortnight the client has used /wg on 10+ different people on 4+ different
days (wingguy_chat_metrics; DRAFTING_PEOPLE / DRAFTING_DAYS in services/clientTouchPlanner.js). Not in the default
order (config/onePagerSeriesManifest.js) on purpose - it only means anything once they are drafting.

Facts it relies on (checked 4 Nov 2026): the extension pairs draft vs sent on Send only when the draft went in via
Insert; changing instructions from the Claude app goes through wingguy_rule_propose/commit, which call no Claude on
the server - so it costs the client's subscription, not their key. If the weekly automatic edit review lands, a line
here can say Wingguy now does "review my edits" for them each week. -->
