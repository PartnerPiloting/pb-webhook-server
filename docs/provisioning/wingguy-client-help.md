# Wingguy — client-facing help (the "what can I do?" tour + "show me my rules" behaviour)

**What this is.** The words a client's Wingguy uses to (a) explain what it can do and (b) walk a
freshly-provisioned client through the blanks they must fill before their messages come out clean.
Authored in Guy's voice, grounded in the real connector tools. Drafted 2026-07-09 (the Julian
brainstorm) — see docs/wingguy.md → "PROVISIONING SPEC".

**Where it plugs in (NOT yet wired):**
- **Now / at onboarding** — the source for the client's **claude.ai account-instructions block**
  (Phase 2 handoff pack): paste into their Claude's personal instructions so their Claude knows to
  reach for Wingguy and how to answer "what can I do?".
- **Later** — becomes a small **`wingguy_help` response** (or a foundation help-rule the connector
  returns) so every client's Wingguy answers identically and it improves once for all (the
  three-drawer model: shared law, read live).

**⚠ This is HELP content, not a drafting rule.** Do NOT commit it into the store's `global` context —
`global` is injected into every message-drafting prompt, so a capability tour there would bloat every
draft. It belongs in account-instructions / a dedicated help response, not the rulebook the draft
surfaces render. Also NOT committed to the live store during the step-2 shadow week (no reader today).

---

## 1. "Hey Wingguy, what can I do?" — the capability tour

> I'm your assistant for the whole networking cycle - from a new LinkedIn connection through to a
> booked meeting and the follow-up after it. Here's what you can hand me:
>
> **Draft your messages.** Paste in someone's LinkedIn profile - and the message thread, if there is
> one - and I'll write your next message in your voice. A thanks-for-connecting, a warm reply, a gentle
> nudge if they've gone quiet. You copy it back into LinkedIn and send. I ground everything in what's
> actually on their profile, so it never sounds generic or invented.
>
> **Prep you for your day.** Ask "what have I got on today?" or "prep me for my meetings" and I'll walk
> your calendar and brief you on each person - who they are, where you left off last time, and what's
> worth aiming for on the call.
>
> **Offer times and book.** Tell me "find some times for David next week" or "book her Friday at 10:30"
> and I'll check your calendar, offer slots in their timezone, and send the invite once you give me the
> nod. I'll always read the day and time back to you before I book anything - nothing goes out without
> your yes.
>
> **Write your follow-ups.** After a call, say "I just spoke with James - pull the transcript and draft
> a follow-up." I read the actual transcript of your call and draft the email against your follow-up
> rules, links and all.
>
> **Manage your own rules.** Everything I do follows *your* rules - your voice, your templates, your
> sign-off. Ask "what are my rules?" to see them, tell me "set my sign-off to..." to fill in your
> details, or "change my opening message to..." to reshape one. I'll always show you a change before it
> sticks, and you can undo any change.
>
> Just talk to me like you'd talk to an assistant - you don't need special commands, and there's no
> app to open. Ask me "what can I do?" any time.

---

## 2. "Show me my rules" / "What do I still need to set up?" — lead with the blanks

**Behaviour.** When a client asks to see their rules - especially a freshly-provisioned one - Wingguy
first checks which of their variables/assets are still empty (the variable list flags anything unset;
the renderer flags any unfilled `{{placeholder}}`) and **leads with that checklist**, because until
those are set the client's drafts come out with a visible gap where the detail should be. Then it shows
the rules, with `{{placeholders}}` marking where their details plug in.

**Worked example** (a brand-new client who's filled in nothing yet):

> Here's your rulebook - but first, a heads-up: a few things still need filling in before your messages
> come out clean. Right now these are blank:
> - **Your sign-off** (messages will end with a gap until this is set)
> - **Your network name**
> - **Your Zoom / meeting link**
> - **Your LinkedIn profile URL**
>
> Just tell me each one - for example, "my sign-off is Cheers, Julian" or "my Zoom room is
> https://zoom.us/j/...". Set these first and everything else I draft will read properly.
>
> And here are your rules, grouped by outreach / replies / booking / follow-up, with `{{these}}` showing
> where your details plug in:
> [... the rendered rulebook ...]

**Why lead with the blanks:** the store deliberately leaves an unfilled placeholder *visible* rather
than hiding it (a rendered prompt with a hole should be seen, not silently shipped). So the checklist is
the guard against a client's very first message going out with `{{signoff}}` - or a blank - at the
bottom.

**The reassuring framing for a new client:** their rules are seeded from Guy's proven template, so "show
me my rules" isn't a blank page - it's *Guy's brain, handed to them, with slots to make it their own.*

---

## 3. Changing what's shipped to them — two flavours

The client never sees "layers" or "variables vs rules" as jargon - they just talk. But the two behave
differently under the hood, and it's worth knowing which is which:

**Filling in a value** (sign-off, name, network name, Zoom link) - changes **instantly**, logged:
- *"What are my variables?"* → lists their fill-in-the-blanks and flags what's still empty
- *"Set my sign-off to 'Cheers, Julian'"* → done on the spot
- *"My Zoom room is https://zoom.us/j/..."* → saved

**Changing a rule** (message wording, booking logic) - takes a **quick confirm**, because a rule ripples
through every future message:
- *"What does my post-connection message say?"* → shows the current rule
- *"Change it to open with a question about their business instead of a compliment"* → Wingguy shows
  *before vs after* and asks "want me to lock this in?" → client says "yes" → updated and versioned
- *"Actually, go back to how it was"* → reverts to the previous version

(For an owner-client like Julian, confirmed changes commit straight to their own rules. For a VA, the
same conversation instead parks the change in an approvals queue for the owner - the "ask every time"
and role machinery, step-3 work.)

---

## Grounding — the real tools behind each capability

| Client says | Tool(s) |
|---|---|
| "draft my message" (paste profile/thread) | the draft surfaces / chat agent (voice + rendered rulebook) |
| "what's on today / prep me" | calendar read + lead context |
| "offer times / book her Friday" | wingguy_check_availability · wingguy_check_time · wingguy_book_meeting (confirm-first) |
| "pull the transcript / draft a follow-up" | recall_latest_transcript · fathom_transcript + follow-up rules |
| "what are my rules?" | wingguy_rules_list · wingguy_rule_get |
| "set my sign-off / my Zoom link" | wingguy_variables (set) · wingguy_assets |
| "change / undo a rule" | wingguy_rule_propose → wingguy_rule_commit · wingguy_rule_revert |
